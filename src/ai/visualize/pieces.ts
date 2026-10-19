/**
 * Large sections are generated in pieces. A section's plan is one JSON reply, and on a loaded or slow model a section
 * of a few thousand characters took past the call's timeout (a 6.4k-character part ran 270s against a 180s limit,
 * 2026-10-08), which leaves the section showing only its own structure. Over `SPLIT_SECTION_CHARS` a section's text is
 * cut at block boundaries into pieces of about `PIECE_TARGET_CHARS`; the pieces are generated in parallel (each placing
 * only its own content) and merged into one reply, and the section's takeaway and analysis are then written once for
 * the whole section by the analysis step (`analysisPatch.ts`). A table is never cut, nor a code block.
 */
import { mergeUnitPlans } from "@/ai/reconcile/keys";

/** A section longer than this is generated in pieces. */
export const SPLIT_SECTION_CHARS = 4_500;
/** Pieces are packed up to about this size. */
export const PIECE_TARGET_CHARS = 3_000;

const FENCE = /^\s*(```|~~~)/;
const isTableLine = (l: string) => /^\s*\|/.test(l);

/** The text as blocks that must stay whole: a fenced code block, a table, or a run of lines between blank lines. */
function blocks(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (current.length) out.push(current.join("\n"));
    current = [];
  };
  for (const line of text.split("\n")) {
    const f = FENCE.exec(line)?.[1];
    if (fence) {
      current.push(line);
      if (f === fence) {
        fence = null;
        flush();
      }
      continue;
    }
    if (f) {
      flush();
      fence = f;
      current.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A table starts a block of its own, so a paragraph above it isn't glued to it.
    if (current.length && isTableLine(line) !== isTableLine(current[current.length - 1]!)) flush();
    current.push(line);
  }
  flush();
  return out;
}

/** A block over `max` that isn't a table or code: cut at line boundaries (a single longer line is cut by length). */
function cutLong(block: string, max: number): string[] {
  if (block.length <= max || isTableLine(block) || FENCE.test(block)) return [block];
  const parts: string[] = [];
  let current = "";
  for (const line of block.split("\n")) {
    for (const piece of line.length > max ? (line.match(new RegExp(`[\\s\\S]{1,${max}}`, "g")) ?? [line]) : [line]) {
      if (current && current.length + 1 + piece.length > max) {
        parts.push(current);
        current = piece;
      } else current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * The pieces of a section's text, in order; a single piece (the text as it is) when it is within `SPLIT_SECTION_CHARS`.
 * Joining the pieces with a blank line gives back the text's blocks, every one of them once.
 */
export function splitIntoPieces(text: string, options: { threshold?: number; target?: number } = {}): string[] {
  const { threshold = SPLIT_SECTION_CHARS, target = PIECE_TARGET_CHARS } = options;
  if (text.length <= threshold) return [text];
  const pieces: string[] = [];
  let current = "";
  for (const block of blocks(text).flatMap((b) => cutLong(b, target))) {
    if (current && current.length + 2 + block.length > target) {
      pieces.push(current);
      current = block;
    } else current = current ? `${current}\n\n${block}` : block;
  }
  if (current) pieces.push(current);
  // A tail much smaller than a piece is folded into the one before it: a call for a few lines isn't worth its latency.
  if (pieces.length > 1 && pieces[pieces.length - 1]!.length < target / 4) {
    const tail = pieces.pop()!;
    pieces[pieces.length - 1] = `${pieces[pieces.length - 1]}\n\n${tail}`;
  }
  return pieces.length ? pieces : [text];
}

/** The pieces' raw replies as one raw plan: ids and stable keys kept apart per piece, relationships following their nodes. */
export function mergePieceReplies(replies: readonly unknown[]): unknown {
  return mergeUnitPlans(
    "sectioned",
    replies.map((raw, i) => ({ unitKey: `part ${i + 1}`, raw })),
  );
}
