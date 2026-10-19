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
 * Pure and deterministic, except `numberSource` (which parses).
 */
import { parseContent } from "@/ai/content/parser";
import type { ParsedBlock } from "@/ai/content/types";
import { significant } from "./information";

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
