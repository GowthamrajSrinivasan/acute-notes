/**
 * A small, deterministic, hand-written parser for Mermaid pie charts (`pie`)
 * — no Mermaid library. A pie's label/value pairs don't fit `MermaidGraph`
 * either (there's no notion of an edge), so like `sequence.ts` it has its own
 * result type, read by `pieToPlan.ts` instead of the generic `toVisualPlan.ts`.
 *
 * Supported:
 * - header `pie`, with an optional `showData` and/or an inline `title text`, in either order, on the same line
 *   (Mermaid's own one-liner form, e.g. `pie title Pets`)
 * - `title text` on its own line too
 * - `"label" : value` lines, one per slice (a non-negative number, decimals allowed)
 * - `%%` comments/directives
 *
 * Anything else fails with a typed `syntax` error naming the line and column.
 */
import { cleanLabel, lineColumn, readFrontmatter, splitStatements } from "./source";
import type { MermaidConversionError, PieGraph } from "./types";

export type PieParseResult = { ok: true; graph: PieGraph } | { ok: false; error: MermaidConversionError };

const HEADER = /^pie(?:\s+(showData))?(?:\s+title\s+(.*))?$/;
const SLICE = /^"([^"]*)"\s*:\s*(\d+(?:\.\d+)?)$/;
const TITLE = /^title\s+(.*)$/;

export function parsePie(source: string): PieParseResult {
  const front = readFrontmatter(source);
  const statements = splitStatements(source, front.bodyStart);
  const header = statements[0];
  const hm = header && HEADER.exec(header.text);
  if (!header || !hm) return fail(source, "expected a `pie` header", header?.span.start ?? 0);

  let title = front.title ?? (hm[2] ? cleanLabel(hm[2]) : undefined);
  const slices: PieGraph["slices"] = [];
  for (const st of statements.slice(1)) {
    const t = st.text;
    const titleMatch = TITLE.exec(t);
    if (titleMatch) {
      if (!title) title = cleanLabel(titleMatch[1]!);
      continue;
    }
    const sliceMatch = SLICE.exec(t);
    if (sliceMatch) {
      slices.push({ label: cleanLabel(sliceMatch[1]!), value: Number(sliceMatch[2]), span: st.span });
      continue;
    }
    return fail(source, `can't read "${t.slice(0, 40)}"`, st.span.start);
  }

  if (!slices.length) return { ok: false, error: { code: "no_nodes", kind: "pie", message: "the diagram has no slices to draw" } };
  return { ok: true, graph: { kind: "pie", ...(title ? { title } : {}), showData: !!hm[1], slices } };
}

function fail(source: string, message: string, offset: number): { ok: false; error: MermaidConversionError } {
  const { line, column } = lineColumn(source, offset);
  return { ok: false, error: { code: "syntax", kind: "pie", message: `line ${line}: ${message}`, line, column } };
}
