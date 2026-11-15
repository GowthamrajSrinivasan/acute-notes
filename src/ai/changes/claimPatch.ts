/**
 * Claim-level patches (intelligent-update-engine-plan §4 Stage 1b): edits *inside* a block's rich text — "five" →
 * "three" — that leave every other word, mark, link and block id exactly as it was. The `patch_block` change
 * carries one or more of these edits, applied atomically.
 *
 * The contract is conditional. A patch applies only if all of these hold, and otherwise it is rejected whole —
 * reported, never a best-guess write (the planner runs again on the next update):
 * 1. the object's content is still what the patch was planned against (`expectedFingerprint`), and each edit's
 *    block is still there (its `blockId`, when both sides have one, matches);
 * 2. each edit's match identifies exactly one place in its block (`exactText`, `anchor` = text with context,
 *    or `range` + the text expected there);
 * 3. text outside the edited ranges keeps its formatting, and no link is cut or dropped (an edit lies wholly
 *    inside one link or wholly outside every link);
 * 4. no other claim is touched: each edit lies inside one sentence of its block (or removes exactly one whole sentence
 *    the source dropped, with the space beside it), and edits never overlap;
 * 5. anything ambiguous rejects the whole patch.
 *
 * Pure and renderer-agnostic, like the rest of `ai/changes`.
 */
import { sentenceSpans } from "@/ai/fidelity/sourceUnits";
import type { ContentBlock, InlineContent, InlineStyles, RichContent, TableCell, TableContent } from "@/domain/types";

/**
 * What new information means for the claim it touches (§2 item 0, reviewer refinement A), decided before an edit
 * operation is chosen and kept separate from it: a contradiction does not imply an overwrite.
 */
export const UPDATE_INTENTS = ["NEW", "SUPERSEDES", "EXTENDS", "CONTRADICTS", "DUPLICATE", "UNCLEAR"] as const;
export type UpdateIntent = (typeof UPDATE_INTENTS)[number];

/** Where an edit applies inside its block's plain text (the concatenated text of its inline content). */
export type ClaimMatch =
  | { exactText: string }
  /** `before` + `text` + `after` occurs exactly once; `text` is replaced. */
  | { anchor: { before: string; text: string; after: string } }
  /** Offsets into the block's plain text, with the text expected there (a mismatch means the block changed). */
  | { range: { start: number; end: number }; text: string };

export interface ClaimEdit {
  /** The block's index in the object's content (top level). */
  blockIndex: number;
  /** The block's id when the planner saw one; checked only when the live block has one too (snapshots gain ids once mounted). */
  blockId?: string;
  /**
   * Where in the block the edit applies (Stage 1d, the plan's `update_cell` / `update_caption`): one cell of a table
   * (`row`, `col` from 0, header rows included), or an image's caption. Absent: the block's own inline text. The match
   * and its offsets count within that target's plain text, and every rule applies to it as to a block's text.
   */
  cell?: { row: number; col: number };
  caption?: true;
  match: ClaimMatch;
  replacement: string;
  /** What the change means (`UpdateIntent`), for the review; never changes how the edit applies. */
  intent?: UpdateIntent;
}

export const MAX_CLAIM_EDITS = 50;
export const MAX_CLAIM_TEXT = 5_000;

export type PatchRejection = "stale" | "not_found" | "ambiguous" | "overlap" | "crosses_claim" | "crosses_link" | "unsupported";

export type PatchOutcome = { ok: true; content: RichContent } | { ok: false; reason: PatchRejection; detail: string };

/** The live content a `patch_block` is checked against at accept time. */
export interface PatchTarget {
  content: RichContent;
  /** `fingerprintOf` the object's content now (a page's includes its title). */
  fingerprint: string;
  /** A page's title (a patch never changes it). */
  title?: string;
}

/** Resolves a patch against the object's content as it is now (rule 1, then `applyClaimEdits`). */
export function resolvePatch(patch: { expectedFingerprint: string; edits: readonly ClaimEdit[] }, live: PatchTarget | null | undefined): PatchOutcome {
  if (!live) return { ok: false, reason: "stale", detail: "the object's content isn't loaded" };
  if (live.fingerprint !== patch.expectedFingerprint) return { ok: false, reason: "stale", detail: "the object changed after the update was planned" };
  return applyClaimEdits(live.content, patch.edits);
}

/** A block's own text, as an edit's offsets count it. Null for a block whose content isn't inline text (a table, code). */
export function blockPlainText(block: ContentBlock): string | null {
  const runs = runsOf(block);
  return runs && runs.map((r) => r.text).join("");
}

/** The plain text an edit's offsets count in: the block's own text, the cell's, or the caption's. Null when that target isn't there. */
export function targetPlainText(block: ContentBlock | undefined, edit: Pick<ClaimEdit, "cell" | "caption">): string | null {
  if (!block) return null;
  try {
    const runs = targetRuns(block, edit);
    return "reason" in runs ? null : runs.map((r) => r.text).join("");
  } catch (err) {
    if (err instanceof UnsupportedInline) return null;
    throw err;
  }
}

/**
 * Applies every edit, or none (rules 2–5). Blocks without edits are returned as they were (same objects); an edited
 * block keeps its id, props and children, and only its inline content changes.
 */
export function applyClaimEdits(content: RichContent, edits: readonly ClaimEdit[]): PatchOutcome {
  if (!edits.length) return { ok: false, reason: "not_found", detail: "the patch has no edits" };
  const byBlock = new Map<number, ClaimEdit[]>();
  for (const e of edits) byBlock.set(e.blockIndex, [...(byBlock.get(e.blockIndex) ?? []), e]);
  const out = [...content];
  for (const [index, blockEdits] of byBlock) {
    const block = content[index];
    if (!block) return { ok: false, reason: "stale", detail: `block ${index + 1} is gone` };
    for (const e of blockEdits) {
      if (e.blockId && block.id && e.blockId !== block.id) return { ok: false, reason: "stale", detail: `block ${index + 1} is a different block now` };
    }
    // Each target (the text, a cell, the caption) takes its own edits, in turn, on the block as the previous one left it.
    const byTarget = new Map<string, ClaimEdit[]>();
    for (const e of blockEdits) byTarget.set(targetKey(e), [...(byTarget.get(targetKey(e)) ?? []), e]);
    let next = block;
    for (const group of byTarget.values()) {
      const applied = applyToTarget(next, group);
      if (!applied.ok) return applied;
      next = applied.block;
    }
    out[index] = next;
  }
  return { ok: true, content: out };
}

const VERBS: Record<UpdateIntent, string> = { NEW: "adds", SUPERSEDES: "replaces", EXTENDS: "extends", CONTRADICTS: "contradicts", DUPLICATE: "repeats", UNCLEAR: "rewrites" };

/**
 * An edit as the review shows it: "replaces “five” → “three”", "adds “Backoff doubles each time.”" (an edit that keeps
 * its matched words and adds to them shows only what it adds), "removes “…”"; a cell's or caption's edit says where.
 */
export function describeClaimEdit(edit: ClaimEdit): string {
  const before = "exactText" in edit.match ? edit.match.exactText : "anchor" in edit.match ? edit.match.anchor.text : edit.match.text;
  const clip = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
  const where = edit.cell ? `row ${edit.cell.row + 1}, column ${edit.cell.col + 1}: ` : edit.caption ? "caption: " : "";
  const after = edit.replacement;
  if (!after) return `${where}removes “${clip(before.trim())}”`;
  // Kept whole and added to, at a word boundary: only the addition is news.
  if (after.length > before.length && after.startsWith(before) && /^[\s,;:]/.test(after.slice(before.length))) return `${where}adds “${clip(after.slice(before.length).replace(/^[\s,;:]+/, ""))}”`;
  if (after.length > before.length && after.endsWith(before) && /\s$/.test(after.slice(0, after.length - before.length))) return `${where}adds “${clip(after.slice(0, after.length - before.length).trim())}”`;
  return `${where}${edit.intent ? `${VERBS[edit.intent]} ` : ""}“${clip(before)}” → “${clip(after)}”`;
}

// ---------------------------------------------------------------------------

/** One stretch of same-styled text; `link` groups the runs of one link (its index in the block). */
interface Run {
  text: string;
  styles: InlineStyles;
  link?: { group: number; href: string };
}

/** Block types whose inline content is prose an edit may change. */
const TEXT_BLOCKS: ReadonlySet<string> = new Set(["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "toggleListItem"]);

function runsOf(block: ContentBlock): Run[] | null {
  if (!TEXT_BLOCKS.has(block.type)) return null;
  const c = block.content;
  if (c === undefined) return [];
  if (typeof c !== "string" && !Array.isArray(c)) return null;
  return inlineRuns(c);
}

class UnsupportedInline extends Error {}

type Failure = Extract<PatchOutcome, { ok: false }>;

const targetKey = (e: Pick<ClaimEdit, "cell" | "caption">) => (e.cell ? `cell:${e.cell.row}:${e.cell.col}` : e.caption ? "caption" : "text");

function isTable(c: ContentBlock["content"]): c is TableContent {
  return typeof c === "object" && c !== null && !Array.isArray(c) && (c as TableContent).type === "tableContent";
}

/** A cell's inline content, whichever form BlockNote stored it in. */
function cellInline(cell: TableCell): InlineContent[] | string {
  return typeof cell === "string" || Array.isArray(cell) ? cell : cell.content;
}

function inlineRuns(c: InlineContent[] | string): Run[] {
  if (typeof c === "string") return c ? [{ text: c, styles: {} }] : [];
  const runs: Run[] = [];
  c.forEach((item: InlineContent, group) => {
    if (item.type === "text") runs.push({ text: item.text, styles: item.styles ?? {} });
    else if (item.type === "link") for (const t of item.content) runs.push({ text: t.text, styles: t.styles ?? {}, link: { group, href: item.href } });
    else throw new UnsupportedInline();
  });
  return runs;
}

/** The runs of an edit's target in `block`, or why there are none. */
function targetRuns(block: ContentBlock, e: Pick<ClaimEdit, "cell" | "caption">): Run[] | Failure {
  if (e.cell) {
    if (block.type !== "table" || !isTable(block.content)) return { ok: false, reason: "unsupported", detail: `a ${block.type} block has no cells` };
    const cell = block.content.rows[e.cell.row]?.cells[e.cell.col];
    if (cell === undefined) return { ok: false, reason: "stale", detail: `row ${e.cell.row + 1}, column ${e.cell.col + 1} is gone` };
    return inlineRuns(cellInline(cell));
  }
  if (e.caption) {
    const caption = block.props?.caption;
    if (block.type !== "image" || typeof caption !== "string") return { ok: false, reason: "unsupported", detail: "the block has no caption" };
    return caption ? [{ text: caption, styles: {} }] : [];
  }
  const runs = runsOf(block);
  return runs ?? { ok: false, reason: "unsupported", detail: `a ${block.type} block isn't edited in place` };
}

/** Applies one target's edits (all or none) and puts the result back where it came from. */
function applyToTarget(block: ContentBlock, edits: readonly ClaimEdit[]): { ok: true; block: ContentBlock } | Failure {
  const e = edits[0]!;
  let runs: Run[] | Failure;
  try {
    runs = targetRuns(block, e);
  } catch (err) {
    if (err instanceof UnsupportedInline) return { ok: false, reason: "unsupported", detail: "the block has inline content a patch can't edit" };
    throw err;
  }
  if ("reason" in runs) return runs;
  const edited = editRuns(runs, edits);
  if (!edited.ok) return edited;
  if (e.cell) {
    const table = block.content as TableContent;
    const { row, col } = e.cell;
    const old = table.rows[row]!.cells[col]!;
    const inline = rebuildInline(edited.runs, typeof cellInline(old) === "string");
    const cell: TableCell = typeof old === "string" || Array.isArray(old) ? inline : { ...old, content: typeof inline === "string" ? [{ type: "text", text: inline, styles: {} }] : inline };
    const rows = table.rows.map((r, i) => (i === row ? { ...r, cells: r.cells.map((c, j) => (j === col ? cell : c)) } : r));
    return { ok: true, block: { ...block, content: { ...table, rows } } };
  }
  if (e.caption) return { ok: true, block: { ...block, props: { ...block.props, caption: edited.runs.map((r) => r.text).join("") } } };
  return { ok: true, block: { ...block, content: rebuild(block, edited.runs) } };
}

/** Rules 2–5 on one target's runs. */
function editRuns(original: Run[], edits: readonly ClaimEdit[]): { ok: true; runs: Run[] } | Failure {
  let runs = original;
  const text = runs.map((r) => r.text).join("");

  // Rule 2: every edit lands on exactly one place.
  const ranges: { start: number; end: number; replacement: string }[] = [];
  for (const e of edits) {
    const found = locate(e.match, text);
    if ("reason" in found) return { ok: false, ...found };
    ranges.push({ ...found, replacement: e.replacement });
  }
  ranges.sort((a, b) => a.start - b.start);
  // Rule 5: overlapping edits are ambiguous (which one wins?).
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i]!.start < ranges[i - 1]!.end) return { ok: false, reason: "overlap", detail: "two edits change the same words" };
  }
  // Rule 4: an edit stays inside one sentence, so it can't take a neighbouring claim with it.
  const sentences = sentenceSpans(text, { start: 0, end: text.length });
  for (const r of ranges) {
    if (!sentences.some((s) => s.start <= r.start && r.end <= s.end) && !removesOneSentence(text, sentences, r)) {
      return { ok: false, reason: "crosses_claim", detail: `“${text.slice(r.start, r.end)}” runs across more than one sentence` };
    }
  }
  // Rule 3: links stay whole.
  const linksBefore = new Set(runs.flatMap((r) => (r.link && r.text ? [r.link.group] : [])));
  for (const r of [...ranges].reverse()) {
    const next = replaceRange(runs, r.start, r.end, r.replacement);
    if (!next) return { ok: false, reason: "crosses_link", detail: `“${text.slice(r.start, r.end)}” runs across a link's edge` };
    runs = next;
  }
  const linksAfter = new Set(runs.flatMap((r) => (r.link && r.text ? [r.link.group] : [])));
  if (linksAfter.size !== linksBefore.size) return { ok: false, reason: "crosses_link", detail: "the edit would remove a link" };
  return { ok: true, runs };
}

/**
 * Rule 4's one exception (Stage 1 gaps): an edit that removes exactly one whole sentence — the source dropped that claim —
 * with the space that separates it from the next sentence (or, for the last one, from the one before). Nothing else of
 * any other sentence goes with it, so no unrelated claim is lost.
 */
function removesOneSentence(text: string, sentences: readonly { start: number; end: number }[], r: { start: number; end: number; replacement: string }): boolean {
  if (r.replacement !== "") return false;
  const blank = (a: number, b: number) => a <= b && /^\s*$/.test(text.slice(a, b));
  return sentences.some((s, k) => {
    const next = sentences[k + 1];
    const prev = sentences[k - 1];
    if (next && r.start === s.start && r.end === next.start && blank(s.end, next.start)) return true;
    return !next && !!prev && r.start === prev.end && r.end === s.end && blank(prev.end, s.start);
  });
}

function locate(match: ClaimMatch, text: string): { start: number; end: number } | { reason: PatchRejection; detail: string } {
  if ("range" in match) {
    const { start, end } = match.range;
    if (start < 0 || end <= start || end > text.length || text.slice(start, end) !== match.text) return { reason: "stale", detail: `“${match.text}” isn't where the patch expects it` };
    return { start, end };
  }
  const [needle, offset, target] = "exactText" in match ? [match.exactText, 0, match.exactText] : [match.anchor.before + match.anchor.text + match.anchor.after, match.anchor.before.length, match.anchor.text];
  if (!target) return { reason: "not_found", detail: "an edit matches no text" };
  const at = occurrences(text, needle);
  if (!at.length) return { reason: "not_found", detail: `“${target}” isn't in the block` };
  if (at.length > 1) return { reason: "ambiguous", detail: `“${target}” occurs ${at.length} times in the block` };
  return { start: at[0]! + offset, end: at[0]! + offset + target.length };
}

/** Every start of `needle` in `text`, overlapping ones included (an overlap is still two candidates). */
function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/**
 * Replaces `[start, end)` in the runs. The new text takes the style (and link) of the run it starts in; runs before
 * and after the range keep theirs. Null when the range would cut a link: it must lie wholly inside one link or
 * wholly outside every link.
 */
function replaceRange(runs: readonly Run[], start: number, end: number, replacement: string): Run[] | null {
  const spans: { run: Run; from: number; to: number }[] = [];
  let at = 0;
  for (const run of runs) {
    spans.push({ run, from: at, to: at + run.text.length });
    at += run.text.length;
  }
  const touched = spans.filter((s) => s.to > start && s.from < end);
  if (!touched.length) return null;
  const groups = new Set(touched.map((s) => s.run.link?.group ?? -1));
  if (groups.size > 1) return null;
  const group = [...groups][0]!;
  if (group !== -1) {
    // Inside one link: the range may not reach past either end of it.
    const linkSpans = spans.filter((s) => s.run.link?.group === group);
    if (start < linkSpans[0]!.from || end > linkSpans[linkSpans.length - 1]!.to) return null;
  }
  const first = touched[0]!;
  const last = touched[touched.length - 1]!;
  const out: Run[] = [];
  for (const s of spans) {
    if (s === first) {
      const head = s.run.text.slice(0, start - s.from);
      const tail = s === last ? s.run.text.slice(end - s.from) : "";
      out.push({ ...s.run, text: head + replacement + tail });
    } else if (s === last) out.push({ ...s.run, text: s.run.text.slice(end - s.from) });
    else if (s.to <= start || s.from >= end) out.push(s.run);
    // Runs wholly inside the range are replaced text: gone.
  }
  return out.filter((r) => r.text.length > 0);
}

function rebuild(block: ContentBlock, runs: readonly Run[]): ContentBlock["content"] {
  return rebuildInline(runs, typeof block.content === "string");
}

function rebuildInline(runs: readonly Run[], wasString: boolean): InlineContent[] | string {
  // Content that was a plain string stays one while nothing in it is styled.
  if (wasString && runs.every((r) => !r.link && !Object.keys(r.styles).length)) return runs.map((r) => r.text).join("");
  const out: InlineContent[] = [];
  for (const r of runs) {
    const piece = { type: "text" as const, text: r.text, styles: r.styles };
    const prev = out[out.length - 1];
    if (!r.link) out.push(piece);
    else if (prev?.type === "link" && linkGroupOf.get(prev) === r.link.group) prev.content.push(piece);
    else {
      const link: InlineContent = { type: "link", href: r.link.href, content: [piece] };
      linkGroupOf.set(link, r.link.group);
      out.push(link);
    }
  }
  return out;
}

/** Which link a rebuilt link item came from (two adjacent links with the same href stay two links). */
const linkGroupOf = new WeakMap<object, number>();
