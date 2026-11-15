/**
 * Keeps what Markdown can't say when a block's whole content is replaced from Markdown (MCP `update_block`; user
 * decision 2, 2026-11-15: "Preserve unrelated content and formatting").
 *
 * The proposal's content is parsed from the agent's Markdown, so on its own it would drop every block id and every
 * prop Markdown can't express (`textColor`, `backgroundColor`, `textAlignment`, inline colours). This lines the new
 * blocks up with the live ones, conservatively:
 *
 * - **Unchanged blocks** (the same Markdown, matched in order: a longest common subsequence) are the live blocks as
 *   they are: id, props, inline styles and children.
 * - **A block changed in place** (a run of changed blocks the same length on both sides, the same block type at the
 *   same position) keeps its id and its colour/alignment props, with the new content.
 * - Everything else (added, removed, retyped blocks) is the new content as parsed.
 *
 * The result always says exactly what the proposal says: its canonical Markdown equals the proposed content's, so its
 * `fingerprintContent` is the same and stale-target protection (`staleTarget.ts`) behaves as before. If that ever
 * fails to hold, the proposed content is returned unchanged.
 */
import { canonicalContent } from "@/ai/content/fingerprint";
import { contentToMarkdown } from "@/domain/content/markdown";
import type { ContentBlock, RichContent } from "@/domain/types";

/** Block props Markdown can't express and a block edited in place keeps (BlockNote's default block style props). */
const STYLE_PROPS = ["textColor", "backgroundColor", "textAlignment"] as const;
/** Above this many block pairs the alignment is skipped (the proposed content is used as parsed). */
const MAX_PAIRS = 250_000;

const markdownOf = (block: ContentBlock) => contentToMarkdown([block]).trim();

export function keepFormatting(live: RichContent | null | undefined, proposed: RichContent): RichContent {
  if (!live?.length || !proposed.length || live.length * proposed.length > MAX_PAIRS) return proposed;
  const a = live.map(markdownOf);
  const b = proposed.map(markdownOf);

  // Longest common subsequence of the blocks' Markdown: the unchanged blocks, in order.
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  }
  const out: ContentBlock[] = [];
  let i = 0;
  let j = 0;
  let gapLive = 0;
  let gapNew = 0;
  const flushGap = () => {
    const changedLive = live.slice(gapLive, i);
    const changedNew = proposed.slice(gapNew, j);
    const inPlace = changedLive.length === changedNew.length;
    changedNew.forEach((block, k) => out.push(inPlace ? restyled(changedLive[k]!, block) : block));
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flushGap();
      out.push(live[i]!);
      i++;
      j++;
      gapLive = i;
      gapNew = j;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  i = n;
  j = m;
  flushGap();

  // Never say anything other than the proposal.
  return canonicalContent(out) === canonicalContent(proposed) ? out : proposed;
}

/** A block edited in place: the new content, with the live block's id and style props, when it is the same type. */
function restyled(live: ContentBlock, next: ContentBlock): ContentBlock {
  if (live.type !== next.type) return next;
  const style = Object.fromEntries(STYLE_PROPS.flatMap((p) => (live.props?.[p] !== undefined ? [[p, live.props[p]!] as const] : [])));
  const block: ContentBlock = {
    ...next,
    ...(live.id ? { id: live.id } : {}),
    ...(Object.keys(style).length ? { props: { ...next.props, ...style } } : {}),
  };
  return markdownOf(block) === markdownOf(next) ? block : next;
}
