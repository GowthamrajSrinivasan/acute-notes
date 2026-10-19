/**
 * A small line diff for a conflict card's "View diff" (F39): the user's
 * current content vs the proposed content, as canonical Markdown lines. Just
 * enough for a current-vs-proposed comparison — not a diff viewer or a
 * version history (out of scope, §3.2).
 */

export type DiffLine = { op: "same" | "add" | "del"; text: string };

/** Longest-common-subsequence line diff; `before` lines missing from `after` are "del", new ones "add". */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // Bounded: conflict cards compare one block, so this stays tiny; very long inputs fall back to "all changed".
  if (a.length * b.length > 250_000) return [...a.map((text) => ({ op: "del" as const, text })), ...b.map((text) => ({ op: "add" as const, text }))];
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ op: "del", text: a[i++]! });
    else out.push({ op: "add", text: b[j++]! });
  }
  while (i < a.length) out.push({ op: "del", text: a[i++]! });
  while (j < b.length) out.push({ op: "add", text: b[j++]! });
  return out;
}
