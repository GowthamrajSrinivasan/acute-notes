/**
 * A small, deterministic, hand-written parser for Mermaid gantt charts
 * (`gantt`) — no Mermaid library. Its own result type (`GanttGraph`), read by
 * `ganttToPlan.ts`: `MermaidGraph` has no date/duration field, and the
 * `timeline` layout does no date math at all, so this parser doesn't attempt
 * calendar math either — tasks are kept in source order (gantt source lists
 * them chronologically by convention) with their start/duration kept as
 * written.
 *
 * Supported:
 * - header `gantt`
 * - `title text`, `dateFormat text` (read, not deeply interpreted), `axisFormat text` (read past)
 * - `section Name`
 * - `Task name : [tag, ...] [id,] start, duration` — tags (`done`, `active`, `crit`, `milestone`) and an id are
 *   both optional and read past; `start` is a literal date or `after <id>`; a task naming only a duration
 *   (`Task : 5d`) is also read
 * - `excludes text`, `%%` comments/directives
 *
 * Anything else fails with a typed `syntax` error naming the line and column.
 */
import { cleanLabel, lineColumn, readFrontmatter, splitStatements } from "./source";
import type { GanttTask, MermaidConversionError, GanttGraph } from "./types";

export type GanttParseResult = { ok: true; graph: GanttGraph } | { ok: false; error: MermaidConversionError };

const TAGS = new Set(["done", "active", "crit", "milestone"]);
const DATE = /^\d{4}-\d{1,2}-\d{1,2}$/;
const DURATION = /^\d+(?:\.\d+)?[dwmy]$/i;
const AFTER = /^after\s+(\S+)$/i;

export function parseGantt(source: string): GanttParseResult {
  const front = readFrontmatter(source);
  const statements = splitStatements(source, front.bodyStart);
  const header = statements[0];
  if (!header || header.text !== "gantt") return fail(source, "expected a `gantt` header", header?.span.start ?? 0);

  let title = front.title;
  let section: string | undefined;
  let excluded = 0;
  const tasks: GanttTask[] = [];

  for (const st of statements.slice(1)) {
    const t = st.text;
    const titleMatch = /^title\s+(.*)$/.exec(t);
    if (titleMatch) {
      if (!title) title = cleanLabel(titleMatch[1]!);
      continue;
    }
    if (/^dateFormat\s+\S+$/.test(t) || /^axisFormat\s+\S+$/.test(t)) continue;
    if (/^excludes\s+\S+/.test(t)) {
      excluded++;
      continue;
    }
    const sectionMatch = /^section\s+(.*)$/.exec(t);
    if (sectionMatch) {
      section = cleanLabel(sectionMatch[1]!) || undefined;
      continue;
    }
    const taskMatch = /^(.+?)\s*:\s*(.*)$/.exec(t);
    if (taskMatch) {
      const label = cleanLabel(taskMatch[1]!);
      if (!label) return fail(source, "a task needs a name before `:`", st.span.start);
      const fields = taskMatch[2]!
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
      let start: string | undefined;
      let duration: string | undefined;
      for (const field of fields) {
        if (TAGS.has(field.toLowerCase())) continue; // done/active/crit/milestone: read past, not drawn
        if (AFTER.test(field) || DATE.test(field)) {
          start = field;
        } else if (DURATION.test(field)) {
          duration = field;
        }
        // An unrecognised field (an id used only for `after <id>` elsewhere) is read past — never rejects the task.
      }
      tasks.push({ label, ...(section ? { section } : {}), ...(start ? { start } : {}), ...(duration ? { duration } : {}), span: st.span });
      continue;
    }
    return fail(source, `can't read "${t.slice(0, 40)}"`, st.span.start);
  }

  if (!tasks.length) return { ok: false, error: { code: "no_nodes", kind: "gantt", message: "the diagram has no tasks to draw" } };
  const skipped: string[] = [];
  if (excluded) skipped.push(`${excluded} \`excludes\` line${excluded === 1 ? "" : "s"} skipped — excluded dates aren't drawn`);
  return { ok: true, graph: { kind: "gantt", ...(title ? { title } : {}), tasks, skipped } };
}

function fail(source: string, message: string, offset: number): { ok: false; error: MermaidConversionError } {
  const { line, column } = lineColumn(source, offset);
  return { ok: false, error: { code: "syntax", kind: "gantt", message: `line ${line}: ${message}`, line, column } };
}
