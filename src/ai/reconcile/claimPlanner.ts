/**
 * Claim-level planning (intelligent-update-engine-plan Stage 1c): turns a whole-block update of an existing card into
 * the smallest `patch_block` that gives the same result — one edit per changed sentence, everything else in the card
 * (marks, links, block ids, props) left as it is — after classifying what each change means (Stage 1a, `intent.ts`).
 *
 * Three outcomes:
 * - `patch`: every changed sentence is localised, and applying the edits to the card reproduces the proposed content
 *   exactly (same fingerprint, so the next update sees the card as current);
 * - `escalate`: a change contradicts the card, or is too unclear to apply — a decision, never an automatic write;
 * - `rewrite`: the change isn't claim-shaped (blocks or sentences added or removed, a table, a formatting change), so
 *   the whole-block update stands, as before.
 *
 * Source-anchored only: it plans from a card's own content to what its node now proposes. Pure; no renderer, no I/O.
 */
import { applyClaimEdits, blockPlainText, targetPlainText, type ClaimEdit, type UpdateIntent } from "@/ai/changes/claimPatch";
import type { ConflictItem, ProposedChange } from "@/ai/changes/changeSet";
import { canonicalContent, fingerprintContent } from "@/ai/content/fingerprint";
import { sentenceSpans, wordOverlap } from "@/ai/fidelity/sourceUnits";
import type { ContentBlock, RichContent, TableContent } from "@/domain/types";
import type { ExistingObject } from "./classify";
import { classifyClaimChange, ESCALATED_INTENTS, SUPERSEDE_OVERLAP } from "./intent";

export type ClaimPlan =
  | { kind: "patch"; edits: ClaimEdit[] }
  | { kind: "escalate"; intent: Extract<UpdateIntent, "CONTRADICTS" | "UNCLEAR">; detail: string }
  | { kind: "rewrite"; reason: string };

/** Plans the claim-level edits that take `current` to `proposed` (see module doc). */
export function planClaimPatch(current: RichContent, proposed: RichContent, titles: { current?: string; proposed?: string } = {}): ClaimPlan {
  if ((titles.proposed ?? titles.current) !== titles.current) return { kind: "rewrite", reason: "the title changed" };
  if (current.length !== proposed.length) return { kind: "rewrite", reason: "blocks were added or removed" };
  const edits: ClaimEdit[] = [];
  let escalation: Extract<ClaimPlan, { kind: "escalate" }> | null = null;
  for (let i = 0; i < current.length; i++) {
    const before = current[i]!;
    const after = proposed[i]!;
    if (canonicalContent([before]) === canonicalContent([after])) continue;
    if (before.type !== after.type) return { kind: "rewrite", reason: `block ${i + 1} changed type` };
    if (canonicalContent(before.children ?? []) !== canonicalContent(after.children ?? [])) return { kind: "rewrite", reason: `block ${i + 1}'s nested blocks changed` };
    // Stage 1d: a table's changed cells, an image's changed caption — the rest of the block as it was.
    if (before.type === "table" || before.type === "image") {
      const planned = before.type === "table" ? tableEdits(before, after, i) : captionEdits(before, after, i);
      if ("rewrite" in planned) return { kind: "rewrite", reason: planned.rewrite };
      edits.push(...planned.edits);
      escalation ??= planned.escalation ?? null;
      continue;
    }
    const was = blockPlainText(before);
    const now = blockPlainText(after);
    if (was === null || now === null) return { kind: "rewrite", reason: `a ${before.type} block isn't edited in place` };
    if (was === now) return { kind: "rewrite", reason: `only block ${i + 1}'s formatting changed` };
    const planned = sentenceEdits(was, now, i, before.id);
    if ("rewrite" in planned) return { kind: "rewrite", reason: planned.rewrite };
    edits.push(...planned.edits);
    escalation ??= planned.escalation ?? null;
  }
  if (escalation) return escalation;
  if (!edits.length) return { kind: "rewrite", reason: "nothing to edit in place" };
  // The patch must land exactly where the whole-block update would: same canonical content, so the baseline stays true.
  const applied = applyClaimEdits(current, edits);
  if (!applied.ok) return { kind: "rewrite", reason: applied.detail };
  if (fingerprintContent(applied.content, titles.current) !== fingerprintContent(proposed, titles.proposed ?? titles.current)) {
    return { kind: "rewrite", reason: "the edits wouldn't reproduce the proposed formatting" };
  }
  return { kind: "patch", edits };
}

type Span = { start: number; end: number };

/** More sentences changed, added or removed than this in one block (or over half of a block of four or more) is a rewrite, not claim edits. */
export const MAX_SENTENCE_EDITS = 4;
type SentenceOp = { kind: "same" | "change"; o: number; n: number } | { kind: "remove"; o: number } | { kind: "insert"; n: number };

/**
 * Lines up a block's sentences before and after (Stage 1 gaps: sentences added or removed). Identical sentences anchor
 * the alignment (longest common subsequence); between two anchors, an equal number of sentences pair in order (each a
 * changed claim), otherwise a sentence pairs with the first later one that still reads as the same claim
 * (`SUPERSEDE_OVERLAP` of its words) — the rest are sentences the source removed or added. Ops in `after` order.
 */
export function alignSentences(before: readonly string[], after: readonly string[]): SentenceOp[] {
  const m = before.length;
  const n = after.length;
  const lcs = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let a = m - 1; a >= 0; a--) for (let b = n - 1; b >= 0; b--) lcs[a]![b] = before[a] === after[b] ? lcs[a + 1]![b + 1]! + 1 : Math.max(lcs[a + 1]![b]!, lcs[a]![b + 1]!);
  const ops: SentenceOp[] = [];
  const gap = (o0: number, o1: number, n0: number, n1: number) => {
    const olds = Array.from({ length: o1 - o0 }, (_, k) => o0 + k);
    const news = Array.from({ length: n1 - n0 }, (_, k) => n0 + k);
    const pairOf = new Map<number, number>();
    if (olds.length === news.length) olds.forEach((o, k) => pairOf.set(news[k]!, o));
    else {
      let from = 0;
      for (const o of olds) {
        const k = news.findIndex((nn, idx) => idx >= from && wordOverlap(before[o]!, after[nn]!) >= SUPERSEDE_OVERLAP);
        if (k < 0) continue;
        pairOf.set(news[k]!, o);
        from = k + 1;
      }
    }
    const paired = new Set(pairOf.values());
    for (const o of olds) if (!paired.has(o)) ops.push({ kind: "remove", o });
    for (const nn of news) ops.push(pairOf.has(nn) ? { kind: "change", o: pairOf.get(nn)!, n: nn } : { kind: "insert", n: nn });
  };
  let a = 0;
  let b = 0;
  let o0 = 0;
  let n0 = 0;
  while (a < m && b < n) {
    if (before[a] === after[b]) {
      gap(o0, a, n0, b);
      ops.push({ kind: "same", o: a, n: b });
      o0 = ++a;
      n0 = ++b;
    } else if (lcs[a + 1]![b]! >= lcs[a]![b + 1]!) a++;
    else b++;
  }
  gap(o0, m, n0, n);
  return ops;
}

/**
 * One block's claim edits from its sentences: a changed sentence is a word-level edit inside it (classified first); a
 * removed one is an edit that removes exactly it (and the space beside it); added ones are inserted next to an
 * unchanged neighbour, as an edit of that neighbour's last word (or first word) that keeps it and adds them. Falls back
 * to a rewrite when an insertion has no unchanged neighbour, or the block's only sentence goes.
 */
function sentenceEdits(was: string, now: string, blockIndex: number, blockId: string | undefined): { edits: ClaimEdit[]; escalation?: Extract<ClaimPlan, { kind: "escalate" }> } | { rewrite: string } {
  const os = sentenceSpans(was, { start: 0, end: was.length });
  const ns = sentenceSpans(now, { start: 0, end: now.length });
  const ops = alignSentences(
    os.map((s) => was.slice(s.start, s.end)),
    ns.map((s) => now.slice(s.start, s.end)),
  );
  // A rewrite of the block, not a few claims: the whole-block update stands (and nothing is classified sentence by sentence).
  const touched = ops.filter((op) => op.kind !== "same").length;
  const size = Math.max(os.length, ns.length);
  if (touched > MAX_SENTENCE_EDITS || (size >= 4 && touched * 2 > size)) return { rewrite: `block ${blockIndex + 1} changed in ${touched} of its ${size} sentences` };
  const at = (range: Span, replacement: string, intent?: UpdateIntent): ClaimEdit => ({
    blockIndex,
    ...(blockId ? { blockId } : {}),
    match: { range, text: was.slice(range.start, range.end) },
    replacement,
    ...(intent ? { intent } : {}),
  });
  const edits: ClaimEdit[] = [];
  let escalation: Extract<ClaimPlan, { kind: "escalate" }> | undefined;
  const oldOfNew = new Map(ops.flatMap((op) => (op.kind === "same" || op.kind === "change" ? [[op.n, op] as const] : [])));
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]!;
    if (op.kind === "same") continue;
    if (op.kind === "change") {
      const o = os[op.o]!;
      const oldText = was.slice(o.start, o.end);
      const newText = now.slice(ns[op.n]!.start, ns[op.n]!.end);
      const verdict = classifyClaimChange(oldText, newText);
      if (ESCALATED_INTENTS.has(verdict.intent)) {
        escalation ??= { kind: "escalate", intent: verdict.intent as "CONTRADICTS" | "UNCLEAR", detail: `“${oldText}” → “${newText}” (${verdict.detail})` };
        continue;
      }
      const hunk = wordHunk(oldText, newText);
      edits.push(at({ start: o.start + hunk.start, end: o.start + hunk.end }, hunk.replacement, verdict.intent));
    } else if (op.kind === "remove") {
      const s = os[op.o]!;
      const next = os[op.o + 1];
      const prev = os[op.o - 1];
      if (next) edits.push(at({ start: s.start, end: next.start }, ""));
      else if (prev) edits.push(at({ start: prev.end, end: s.end }, ""));
      else return { rewrite: `block ${blockIndex + 1}'s only sentence was removed` };
    } else {
      // A run of added sentences, kept together: inserted after the unchanged sentence before them, or before the one after.
      let last = k;
      while (ops[last + 1]?.kind === "insert") last++;
      const first = op.n;
      const end = (ops[last] as { n: number }).n;
      const inserted = now.slice(ns[first]!.start, ns[end]!.end);
      const intent = classifyClaimChange(null, inserted).intent;
      const before = oldOfNew.get(first - 1);
      const after = oldOfNew.get(end + 1);
      if (before?.kind === "same") {
        const p = os[before.o]!;
        const token = p.start + Math.max(0, was.slice(p.start, p.end).search(/\S+$/));
        edits.push(at({ start: token, end: p.end }, was.slice(token, p.end) + now.slice(ns[first - 1]!.end, ns[end]!.end), intent));
      } else if (after?.kind === "same") {
        const q = os[after.o]!;
        const word = was.slice(q.start, q.end).search(/\s/);
        const tokenEnd = word < 0 ? q.end : q.start + word;
        edits.push(at({ start: q.start, end: tokenEnd }, now.slice(ns[first]!.start, ns[end + 1]!.start) + was.slice(q.start, tokenEnd), intent));
      } else return { rewrite: `block ${blockIndex + 1} gained a sentence with no unchanged neighbour to place it by` };
      k = last;
    }
  }
  return { edits, ...(escalation ? { escalation } : {}) };
}

type Planned = { edits: ClaimEdit[]; escalation?: Extract<ClaimPlan, { kind: "escalate" }> } | { rewrite: string };

/** One changed target (a cell, a caption) as a word-level edit, classified on `context` (its row, or the caption itself). */
function targetEdit(target: Pick<ClaimEdit, "blockIndex" | "blockId" | "cell" | "caption">, was: string, now: string, context: { before: string; after: string }): { edit: ClaimEdit } | { escalation: Extract<ClaimPlan, { kind: "escalate" }> } | null {
  if (!was || !now) return null; // filled in or emptied: nothing to anchor a word-level edit on
  const verdict = classifyClaimChange(context.before, context.after);
  if (ESCALATED_INTENTS.has(verdict.intent)) {
    return { escalation: { kind: "escalate", intent: verdict.intent as "CONTRADICTS" | "UNCLEAR", detail: `“${context.before}” → “${context.after}” (${verdict.detail})` } };
  }
  const hunk = wordHunk(was, now);
  return { edit: { ...target, match: { range: { start: hunk.start, end: hunk.end }, text: was.slice(hunk.start, hunk.end) }, replacement: hunk.replacement, intent: verdict.intent } };
}

/**
 * A table's changed cells as cell edits (Stage 1d, the plan's `update_cell`): the same rows, columns and header rows on
 * both sides, else a rewrite. A cell is classified with its whole row as context ("Retries | 5" → "Retries | 3"), since
 * a cell alone ("5" → "3") has no words to tell a superseded value from a rewrite.
 */
function tableEdits(before: ContentBlock, after: ContentBlock, blockIndex: number): Planned {
  const a = before.content as TableContent | undefined;
  const b = after.content as TableContent | undefined;
  if (a?.type !== "tableContent" || b?.type !== "tableContent") return { rewrite: `block ${blockIndex + 1} isn't a table on both sides` };
  if (a.rows.length !== b.rows.length || (a.headerRows ?? 0) !== (b.headerRows ?? 0)) return { rewrite: `block ${blockIndex + 1} gained or lost rows` };
  const cellOf = (block: ContentBlock, row: number, col: number) => targetPlainText(block, { cell: { row, col } });
  const edits: ClaimEdit[] = [];
  let escalation: Extract<ClaimPlan, { kind: "escalate" }> | undefined;
  let cells = 0;
  for (let row = 0; row < a.rows.length; row++) {
    const width = a.rows[row]!.cells.length;
    if (width !== b.rows[row]!.cells.length) return { rewrite: `block ${blockIndex + 1} gained or lost columns` };
    const rowBefore = Array.from({ length: width }, (_, col) => cellOf(before, row, col) ?? "");
    for (let col = 0; col < width; col++) {
      cells++;
      const was = cellOf(before, row, col);
      const now = cellOf(after, row, col);
      if (was === null || now === null) return { rewrite: `a cell of block ${blockIndex + 1} isn't edited in place` };
      if (was === now) continue;
      const rowAfter = rowBefore.map((t, k) => (k === col ? now : t));
      const planned = targetEdit({ blockIndex, ...(before.id ? { blockId: before.id } : {}), cell: { row, col } }, was, now, { before: rowBefore.join(" | "), after: rowAfter.join(" | ") });
      if (!planned) return { rewrite: `row ${row + 1}, column ${col + 1} was filled in or emptied` };
      if ("escalation" in planned) escalation ??= planned.escalation;
      else edits.push(planned.edit);
    }
  }
  if (edits.length > MAX_SENTENCE_EDITS && edits.length * 2 > cells) return { rewrite: `block ${blockIndex + 1} changed in ${edits.length} of its ${cells} cells` };
  return { edits, ...(escalation ? { escalation } : {}) };
}

/** An image's changed caption as a caption edit (Stage 1d, the plan's `update_caption`); any other change to the image is a rewrite. */
function captionEdits(before: ContentBlock, after: ContentBlock, blockIndex: number): Planned {
  const { caption: was, ...restBefore } = before.props ?? {};
  const { caption: now, ...restAfter } = after.props ?? {};
  if (JSON.stringify(restBefore) !== JSON.stringify(restAfter)) return { rewrite: `block ${blockIndex + 1}'s image changed` };
  if (typeof was !== "string" || typeof now !== "string") return { rewrite: `block ${blockIndex + 1} has no caption to edit` };
  const planned = targetEdit({ blockIndex, ...(before.id ? { blockId: before.id } : {}), caption: true }, was, now, { before: was, after: now });
  if (!planned) return { rewrite: `block ${blockIndex + 1}'s caption was added or removed` };
  return "escalation" in planned ? { edits: [], escalation: planned.escalation } : { edits: [planned.edit] };
}

/**
 * A clean update of an existing card, made claim-level where it can be: a `patch_block` when the planner localises
 * it, an escalated conflict when the change contradicts the card (or is too unclear to apply), the update unchanged
 * otherwise (no content to plan from, a shape, a rewrite).
 */
export function claimLevelUpdate(
  update: Extract<ProposedChange, { kind: "update_block" | "update_shape" }>,
  object: Pick<ExistingObject, "objectId" | "stableNodeKey" | "current" | "rich">,
): { change: ProposedChange } | { conflict: ConflictItem } {
  if (update.kind !== "update_block" || !object.rich || object.current === null) return { change: update };
  const plan = planClaimPatch(object.rich.content, update.content, { current: object.rich.title, proposed: update.title });
  if (plan.kind === "rewrite") return { change: update };
  if (plan.kind === "escalate") {
    return {
      conflict: {
        target: object.objectId,
        stableNodeKey: object.stableNodeKey,
        apply: update,
        keep: { kind: "rebaseline", target: object.objectId, stableNodeKey: object.stableNodeKey },
        escalation: { intent: plan.intent, detail: plan.detail.slice(0, 500) },
      },
    };
  }
  return {
    change: {
      kind: "patch_block",
      target: object.objectId,
      expectedFingerprint: object.current,
      edits: plan.edits,
      ...(update.stableNodeKey ? { stableNodeKey: update.stableNodeKey } : {}),
      ...(update.sourceRefs ? { sourceRefs: update.sourceRefs } : {}),
    },
  };
}

const WORD = /[\p{L}\p{N}_]/u;

/**
 * The changed stretch of one sentence, widened to whole words: `[start, end)` of `before` and what replaces it. A pure
 * insertion takes the word before it along (or the word after, at the start), so an edit always matches some text.
 */
export function wordHunk(before: string, after: string): { start: number; end: number; replacement: string } {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let q = 0;
  while (q < before.length - p && q < after.length - p && before[before.length - 1 - q] === after[after.length - 1 - q]) q++;
  let start = p;
  let end = before.length - q;
  while (start > 0 && WORD.test(before[start - 1]!)) start--;
  while (end < before.length && WORD.test(before[end]!)) end++;
  if (start === end) {
    if (start > 0) {
      while (start > 0 && !WORD.test(before[start - 1]!)) start--;
      while (start > 0 && WORD.test(before[start - 1]!)) start--;
    } else {
      while (end < before.length && WORD.test(before[end]!)) end++;
      while (end < before.length && !WORD.test(before[end]!)) end++;
    }
  }
  // The same prefix and suffix, so the new text's stretch has the same bounds measured from each end.
  return { start, end, replacement: after.slice(start, after.length - (before.length - end)) };
}

// ---------------------------------------------------------------------------
// Cards changed since AI wrote them (Stage 1e)

/** Words of context an edit carries from the source's wording to find its place in the user's (up to this many characters). */
const CONTEXT_CHARS = 30;

/**
 * Places the source's own edits (planned from what AI last wrote, `base`, to what the source says now) onto the card's
 * current text, which the user may have reworded: each edit by its words of context first, then by its text alone, and
 * only where it lands on exactly one place. Null when any edit can't be placed so — the card then gets a decision, never a
 * best guess.
 */
export function placeEditsOnto(base: RichContent, edits: readonly ClaimEdit[], current: RichContent): ClaimEdit[] | null {
  const texts = current.map((b) => blockPlainText(b));
  const placed: ClaimEdit[] = [];
  for (const e of edits) {
    if (!("range" in e.match)) return null;
    if (e.cell || e.caption) {
      // A cell or a caption is placed within the same cell or caption of the card (Stage 1d).
      const source = targetPlainText(base[e.blockIndex], e);
      const mine = targetPlainText(current[e.blockIndex], e);
      if (source === null || mine === null) return null;
      const { start, end } = e.match.range;
      const before = wholeWords(source.slice(Math.max(0, start - CONTEXT_CHARS), start), "start");
      const after = wholeWords(source.slice(end, end + CONTEXT_CHARS), "end");
      const text = e.match.text;
      const anchored = (before || after) && onlyPlace([mine], before + text + after);
      if (!anchored && !onlyPlace([mine], text)) return null;
      const block = current[e.blockIndex]!;
      placed.push({
        blockIndex: e.blockIndex,
        ...(block.id ? { blockId: block.id } : {}),
        ...(e.cell ? { cell: e.cell } : { caption: true as const }),
        match: anchored ? { anchor: { before, text, after } } : { exactText: text },
        replacement: e.replacement,
        ...(e.intent ? { intent: e.intent } : {}),
      });
      continue;
    }
    const source = blockPlainText(base[e.blockIndex]!);
    if (source === null) return null;
    const { start, end } = e.match.range;
    const before = wholeWords(source.slice(Math.max(0, start - CONTEXT_CHARS), start), "start");
    const after = wholeWords(source.slice(end, end + CONTEXT_CHARS), "end");
    const text = e.match.text;
    const anchored = (before || after) && onlyPlace(texts, before + text + after);
    const where = anchored ?? onlyPlace(texts, text);
    if (!where) return null;
    const block = current[where.block]!;
    placed.push({
      blockIndex: where.block,
      ...(block.id ? { blockId: block.id } : {}),
      match: anchored ? { anchor: { before, text, after } } : { exactText: text },
      replacement: e.replacement,
      ...(e.intent ? { intent: e.intent } : {}),
    });
  }
  return applyClaimEdits(current, placed).ok ? placed : null;
}

/**
 * The update of a card changed since AI wrote it (Stage 1e): the source's new facts merged into the card's current
 * wording as a `patch_block` (`onEditedCard`), so the user's words, marks and links stay. Falls back to today's conflict
 * card (Apply / Keep mine) when the patch can't be placed exactly, when the card's earlier AI wording isn't known, or
 * when "Preserve edited cards" is on. A contradiction is escalated under every setting.
 */
export function editedCardUpdate(
  update: Extract<ProposedChange, { kind: "update_block" | "update_shape" }>,
  object: Pick<ExistingObject, "objectId" | "stableNodeKey" | "current" | "rich">,
  /** What AI last wrote for this card: the previous version's node, as the writer would have written it. */
  base: { content: RichContent; title?: string } | null,
  policy: { preserveEditedCards?: boolean; claimPatches?: boolean } = {},
): { change: ProposedChange } | { conflict: ConflictItem } {
  const conflict = (escalation?: ConflictItem["escalation"]) => ({
    conflict: {
      target: object.objectId,
      stableNodeKey: object.stableNodeKey,
      apply: update,
      keep: { kind: "rebaseline" as const, target: object.objectId, stableNodeKey: object.stableNodeKey },
      ...(escalation ? { escalation } : {}),
    },
  });
  if (update.kind !== "update_block" || !base) return conflict();
  const plan = planClaimPatch(base.content, update.content, { current: base.title, proposed: update.title });
  if (plan.kind === "escalate") return conflict({ intent: plan.intent, detail: plan.detail.slice(0, 500) });
  if (policy.preserveEditedCards || policy.claimPatches === false || plan.kind !== "patch" || !object.rich || object.current === null) return conflict();
  const edits = placeEditsOnto(base.content, plan.edits, object.rich.content);
  if (!edits) return conflict();
  return {
    change: {
      kind: "patch_block",
      target: object.objectId,
      expectedFingerprint: object.current,
      edits,
      onEditedCard: true,
      ...(update.stableNodeKey ? { stableNodeKey: update.stableNodeKey } : {}),
      ...(update.sourceRefs ? { sourceRefs: update.sourceRefs } : {}),
    },
  };
}

/** `text` trimmed to whole words at the cut end (`start`: it was cut at its start), so context never ends mid-word. */
function wholeWords(text: string, cut: "start" | "end"): string {
  if (text.length < CONTEXT_CHARS) return text; // the block's own edge: nothing was cut
  const i = cut === "start" ? text.search(/\s/) : text.search(/\s\S*$/);
  if (i < 0) return "";
  return cut === "start" ? text.slice(i) : text.slice(0, i);
}

/** The one place `needle` occurs across the blocks' texts (overlaps counted); null for none or several. */
function onlyPlace(texts: readonly (string | null)[], needle: string): { block: number; at: number } | null {
  let found: { block: number; at: number } | null = null;
  for (let b = 0; b < texts.length; b++) {
    const t = texts[b];
    if (t === null || t === undefined) continue;
    for (let i = t.indexOf(needle); i !== -1; i = t.indexOf(needle, i + 1)) {
      if (found) return null;
      found = { block: b, at: i };
    }
  }
  return found;
}
