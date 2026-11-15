/**
 * Source blocks by reference (content fidelity plan, Wave B1): a section's source, numbered block by block — [T1] a
 * table, [L1] a list, [C1] code, [P1] a paragraph — so the model can place a block exactly as it is with
 * `{"type":"source","ref":"T1"}` instead of retyping it. The app expands every reference into the verbatim node
 * before anything else sees the plan ("reference, don't regenerate": what the model doesn't retype, it can't drop
 * or shorten, and the tokens go to structure and analysis instead).
 *
 * Also the deterministic table repair: a table the model retyped with the same rows but fewer columns or shortened
 * cells gets the source table's full rows and columns back, in place.
 *
 * Also, in distil mode (knowledge-notes-plan WP1.4), `labelSource`: the same blocks with their source units labelled.
 *
 * Pure and deterministic, except `numberSource` and `labelSource` (which parse).
 */
import { parseContent } from "@/ai/content/parser";
import type { ParsedBlock } from "@/ai/content/types";
import type { SourceUnit, UnitId, UnitLabels } from "./contracts";
import { significant } from "./information";
import { draftUnits, hashUnit } from "./sourceUnits";

export type SourceBlockKind = "table" | "list" | "checklist" | "code" | "paragraph";

export interface SourceBlock {
  /** "T1", "L1", "C1", "P1"… — per kind, in source order. */
  ref: string;
  kind: SourceBlockKind;
  /** The block as the prompt shows it (a table as a Markdown pipe table, whatever its source form). */
  text: string;
  /** The node it expands into, verbatim. */
  node: Record<string, unknown>;
}

const PREFIX: Record<SourceBlockKind, string> = { table: "T", list: "L", checklist: "L", code: "C", paragraph: "P" };

/** A Markdown pipe table (pipes escaped, line breaks as spaces). */
export function pipeTable(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (c: string) => c.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim() || " ";
  const line = (cells: readonly string[]) => `| ${columns.map((_, i) => cell(cells[i] ?? "")).join(" | ")} |`;
  return [line(columns), `|${columns.map(() => "---").join("|")}|`, ...rows.map(line)].join("\n");
}

function blockOf(b: ParsedBlock, input: string): { kind: SourceBlockKind; text: string; node: Record<string, unknown> } | null {
  const slice = input.slice(b.span.start, b.span.end).trim();
  switch (b.type) {
    case "table": {
      const table = pipeTable(b.columns, b.rows);
      return { kind: "table", text: table, node: { type: "table", content: { columns: b.columns, rows: b.rows } } };
    }
    case "list": {
      if (b.items.length && b.items.every((i) => i.checked !== null)) {
        return { kind: "checklist", text: slice, node: { type: "todo", content: { items: b.items.map((i) => ({ text: i.text, checked: !!i.checked })) } } };
      }
      return { kind: "list", text: slice, node: { type: "text", content: { markdown: slice } } };
    }
    case "code":
      return { kind: "code", text: slice, node: { type: "code", content: { ...(b.language ? { language: b.language } : {}), source: b.source } } };
    case "paragraph":
    case "quote":
      return significant(slice).length ? { kind: "paragraph", text: slice, node: { type: "text", content: { markdown: slice } } } : null;
    default:
      return null;
  }
}

/** A section's text as numbered source blocks, and the prompt's view of it (headings kept as plain lines). */
export async function numberSource(text: string): Promise<{ blocks: SourceBlock[]; numbered: string }> {
  const parsed = await parseContent(text);
  const counts: Record<string, number> = {};
  const blocks: SourceBlock[] = [];
  const lines: string[] = [];
  for (const b of parsed.blocks) {
    if (b.type === "heading") {
      lines.push(text.slice(b.span.start, b.span.end).trim());
      continue;
    }
    const block = blockOf(b, text);
    if (!block) continue;
    const prefix = PREFIX[block.kind];
    counts[prefix] = (counts[prefix] ?? 0) + 1;
    const ref = `${prefix}${counts[prefix]}`;
    blocks.push({ ref, ...block });
    lines.push(`[${ref}] ${block.text}`);
  }
  return { blocks, numbered: lines.join("\n\n") };
}

/** A section's source with its units labelled for the prompt (WP1.4): what the model cites, and what the app maps back. */
export interface LabelledSource {
  /** The same blocks, refs and order as `numberSource`, so references expand the same way. */
  blocks: SourceBlock[];
  /** The prompt's view: each block's number, then its units one per line behind their labels (a table's rows behind theirs). */
  labelled: string;
  /** Label → unit id, for this section only. */
  labels: UnitLabels;
  /** Block ref → the units it holds: a block placed by reference cites them all. */
  blockUnits: Readonly<Record<string, UnitId[]>>;
}

/**
 * A section's text with its source units labelled per block (knowledge-notes-plan §3.1, WP1.4): `P2.3` is paragraph
 * block P2's third sentence, `L1.4` list L1's fourth item, `T1.r4` table T1's fourth data row (`T1.r0` its header),
 * `C1` code block C1. The model cites labels; `labels` maps them to the unit ids of `units` — the source version's
 * units (`ContentSourceVersion.units`), matched to the section's own units by their text's hash, in order — so the
 * model never sees or retypes an id. Without `units` (no version yet) the ids are the section's own (`u1`, `u2`, …).
 * A unit `units` doesn't have (the section text differs from the version's) is shown without a label.
 *
 * New in distil mode only: `numberSource` and its output are unchanged.
 */
export async function labelSource(text: string, units?: readonly SourceUnit[]): Promise<LabelledSource> {
  const parsed = await parseContent(text);
  const drafts = draftUnits(parsed, text);
  const ids = units ? matchIds(drafts.map((d) => hashUnit(d.text, d.kind)), units) : drafts.map((_, i) => `u${i + 1}`);
  const counts: Record<string, number> = {};
  const blocks: SourceBlock[] = [];
  const lines: string[] = [];
  const labels: Record<string, UnitId> = {};
  const blockUnits: Record<string, UnitId[]> = {};
  const one = (s: string) => s.replace(/\s+/g, " ").trim();
  for (const b of parsed.blocks) {
    if (b.type === "heading") {
      lines.push(text.slice(b.span.start, b.span.end).trim());
      continue;
    }
    const block = blockOf(b, text);
    if (!block) continue;
    const prefix = PREFIX[block.kind];
    counts[prefix] = (counts[prefix] ?? 0) + 1;
    const ref = `${prefix}${counts[prefix]}`;
    blocks.push({ ref, ...block });
    const inside = drafts.flatMap((d, i) => (d.span.start >= b.span.start && d.span.end <= b.span.end ? [i] : []));
    const label = (name: string, i: number) => {
      const id = ids[i];
      if (!id) return "";
      labels[name] = id;
      (blockUnits[ref] ??= []).push(id);
      return `${name} `;
    };
    if (b.type === "table") {
      // The pipe table's lines are header, delimiter, then the rows; each row line is labelled with its unit.
      const rowTexts = [b.columns, ...b.rows].map((cells) => cells.join(" | "));
      const rowLabel: string[] = rowTexts.map(() => "");
      let cursor = 0;
      for (const i of inside) {
        const at = rowTexts.indexOf(drafts[i]!.text, cursor);
        if (at < 0) continue;
        rowLabel[at] = label(`${ref}.r${at}`, i);
        cursor = at + 1;
      }
      const table = block.text.split("\n").map((line, n) => (n === 0 ? rowLabel[0] : n === 1 ? "" : rowLabel[n - 1]) + line);
      lines.push(`[${ref}]\n${table.join("\n")}`);
    } else if (b.type === "code") {
      const i = inside[0];
      if (i !== undefined) label(ref, i);
      lines.push(`[${ref}] ${block.text}`);
    } else if (inside.length) {
      lines.push(`[${ref}]\n${inside.map((i, k) => `${label(`${ref}.${k + 1}`, i)}${one(drafts[i]!.text)}`).join("\n")}`);
    } else {
      lines.push(`[${ref}] ${block.text}`);
    }
  }
  return { blocks, labelled: lines.join("\n\n"), labels, blockUnits };
}

/**
 * The version's unit id for each of the section's units, by hash, one-to-one and in document order: the first unused
 * unit with the same hash after the previous match (a repeated sentence keeps its own), else any unused one; "" when
 * the version has none.
 */
function matchIds(hashes: readonly string[], units: readonly SourceUnit[]): UnitId[] {
  const used = new Set<number>();
  let last = -1;
  return hashes.map((hash) => {
    let at = units.findIndex((u, i) => i > last && !used.has(i) && u.hash === hash);
    if (at < 0) at = units.findIndex((u, i) => !used.has(i) && u.hash === hash);
    if (at < 0) return "";
    used.add(at);
    last = at;
    return units[at]!.id;
  });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A block number the model copied into its own text ("[P1] One row per check…"): not content, removed. */
const REF_TAG = /\s*\[(?:[TLCP])\d{1,3}\]\s?/g;

/** A node's own strings with block numbers removed (its label, title, text, cells, items). */
function withoutRefTags(n: Record<string, unknown>): { node: Record<string, unknown>; changed: boolean } {
  let changed = false;
  const clean = (v: unknown): unknown => {
    if (typeof v === "string") {
      const out = v.replace(REF_TAG, (m, offset: number) => (offset === 0 ? "" : " ")).replace(/ {2,}/g, " ");
      if (out !== v) changed = true;
      return out;
    }
    if (Array.isArray(v)) return v.map(clean);
    if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
    return v;
  };
  const node = { ...n, ...(typeof n.title === "string" ? { title: clean(n.title) } : {}), ...(isObject(n.content) ? { content: clean(n.content) } : {}) };
  return { node, changed };
}

/** A node's source reference, however it is spelled: `ref`, `sourceRef`, `source_ref`, or `content.ref`. */
function refOf(n: Record<string, unknown>): string {
  for (const v of [n.ref, n.sourceRef, n.source_ref, isObject(n.content) ? n.content.ref : undefined]) if (typeof v === "string" && v.trim()) return v;
  return "";
}

/** Whether a node carries content of its own (then a stray `ref` on it is ignored). */
function hasOwnContent(n: Record<string, unknown>): boolean {
  return isObject(n.content) && Object.keys(n.content).some((k) => k !== "ref");
}

const norm = (s: string) => s.replace(/\*\*|`/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The source table a retyped table is a shortened copy of: most of its rows' keys (first cells) are that table's
 * row keys, and its columns are among that table's. Null when it is its own table (a merge, a transposition).
 */
function shortenedFrom(content: Record<string, unknown>, tables: readonly SourceBlock[]): SourceBlock | null {
  const columns = Array.isArray(content.columns) ? content.columns.filter((c): c is string => typeof c === "string") : [];
  const rows = Array.isArray(content.rows) ? content.rows.filter(Array.isArray) : [];
  const keys = rows.map((r) => norm(String(r[0] ?? ""))).filter(Boolean);
  if (!keys.length) return null;
  for (const t of tables) {
    const src = t.node.content as { columns: string[]; rows: string[][] };
    const srcKeys = new Set(src.rows.map((r) => norm(r[0] ?? "")).filter(Boolean));
    const srcColumns = new Set(src.columns.map(norm));
    const matched = keys.filter((k) => srcKeys.has(k)).length;
    if (matched < Math.max(2, Math.ceil(keys.length * 0.8))) continue;
    if (!columns.every((c) => !norm(c) || srcColumns.has(norm(c)))) continue;
    const shorter = columns.length < src.columns.length || rows.length < src.rows.length || JSON.stringify(rows).length < JSON.stringify(src.rows).length * 0.9;
    if (shorter) return t;
  }
  return null;
}

/**
 * A section's raw reply with every `{"type":"source","ref":…}` node expanded into its verbatim block (keeping the
 * node's id, title, importance and links), and every shortened copy of a source table repaired to the full table.
 * Unknown references are dropped (the safety net then restores what they meant). Returns what it did, for warnings.
 */
export function expandSourceRefs(raw: unknown, blocks: readonly SourceBlock[]): { raw: unknown; expanded: number; repaired: number; unknown: string[] } {
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return { raw, expanded: 0, repaired: 0, unknown: [] };
  const byRef = new Map(blocks.map((b) => [b.ref.toUpperCase(), b] as const));
  const tables = blocks.filter((b) => b.kind === "table");
  let expanded = 0;
  let repaired = 0;
  const unknown: string[] = [];
  const nodes: unknown[] = [];
  for (const n of raw.nodes) {
    if (!isObject(n)) {
      nodes.push(n);
      continue;
    }
    // A reference: `{"type":"source","ref":"T1"}` as asked — or, as models also write it, a node of any type with a
    // `ref` and no content of its own (`{"type":"table","ref":"T1"}`; the live run of 2026-09-29 lost six such
    // nodes in validation). The block decides what it expands into.
    const ref = refOf(n);
    if (n.type === "source" || (ref && !hasOwnContent(n))) {
      const block = byRef.get(ref.replace(/[[\]\s]/g, "").toUpperCase());
      if (!block) {
        unknown.push(ref || "?");
        continue;
      }
      const { type: _t, ref: _r, sourceRef: _s, source_ref: _sr, content: _c, ...common } = n;
      nodes.push({ ...common, ...block.node });
      expanded++;
      continue;
    }
    if (n.type === "table" && isObject(n.content)) {
      const source = shortenedFrom(n.content, tables);
      if (source) {
        nodes.push({ ...n, content: source.node.content });
        repaired++;
        continue;
      }
    }
    // The model's own text, with any block number it copied into it removed (the live run of 2026-09-30).
    nodes.push(withoutRefTags(n).node);
  }
  return { raw: { ...raw, nodes }, expanded, repaired, unknown };
}
