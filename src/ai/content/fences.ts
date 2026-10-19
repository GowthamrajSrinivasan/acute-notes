/**
 * Fenced code blocks in Markdown text, line by line. Pure; shared by the paragraph splitting of an update (`reconcile/paragraphs.ts`) and the
 * page chunking of the plan's overflow (`visual-plan/repair.ts`), so neither cuts through a code block.
 */
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

/**
 * Which lines of `lines` belong to a fenced code block (its opening and closing fence lines included). A fence closes on a line holding only
 * fence characters of the same kind, at least as many as opened it; one that never closes runs to the end, as in Markdown.
 */
export function fenceMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = [];
  let open: { ch: string; len: number } | null = null;
  for (const line of lines) {
    if (open) {
      mask.push(true);
      const t = line.trim();
      if (t.length >= open.len && t[0] === open.ch && /^(`+|~+)$/.test(t)) open = null;
      continue;
    }
    const m = FENCE_OPEN.exec(line);
    if (m) open = { ch: m[1]![0]!, len: m[1]!.length };
    mask.push(!!m);
  }
  return mask;
}
