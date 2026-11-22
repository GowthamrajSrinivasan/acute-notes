/**
 * Tables update in place (update engine plan §17.7, U2): a markdown table filed under a topic that already holds a table about the
 * same thing (overlapping header) is merged into that table, row by row, instead of being appended as a second table.
 *
 * - **Key column:** the incoming table's first column when the existing table has it; else the shared column whose values overlap
 *   most between the two tables. Its values must be unique in the existing table, or nothing is merged (the table is filed whole).
 * - **Rows:** same key and some cell different → those cells are replaced in place (the row stays where it is); same key and
 *   nothing different → a repeat, left out; a new key → a new row at the end of the EXISTING table. An empty incoming cell never
 *   blanks an existing one.
 * - **Columns the incoming table adds** are added to the existing table, at its end, with empty cells in the rows that don't say
 *   anything about them. A column the incoming table lacks is left as it is.
 * - Rows that don't change keep their exact text, so the update that follows sees only the rows that did.
 *
 * Deterministic and pure: no model is asked about rows.
 */

/** A parsed markdown table: its header, its separator line as written, and its rows (cells trimmed, plus each row's own text). */
export interface MdTable {
  header: string[];
  /** The header row as written. */
  headerLine: string;
  separator: string;
  rows: { cells: string[]; line: string }[];
}

/** A table in the notes' text: where it is (`end` is the end of its last row, without the line break). */
export interface PlacedTable extends MdTable {
  start: number;
  end: number;
}

const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const isRow = (line: string) => /^\s*\|/.test(line);

/** The cells of one table row: split on unescaped pipes, outer pipes dropped, each cell trimmed. */
export function rowCells(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return body.split(/(?<!\\)\|/).map((c) => c.trim());
}

const rowLine = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
const norm = (s: string) => s.toLowerCase().replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

/** A block that is exactly one markdown table (header, separator, rows), or null. */
export function parseTable(block: string): MdTable | null {
  const lines = block.replace(/\r\n/g, "\n").trim().split("\n");
  if (lines.length < 2 || !lines.every(isRow) || !SEPARATOR.test(lines[1]!)) return null;
  const header = rowCells(lines[0]!);
  if (!header.length || header.every((h) => !h)) return null;
  return { header, headerLine: lines[0]!.trim(), separator: lines[1]!.trim(), rows: lines.slice(2).map((line) => ({ cells: rowCells(line), line: line.trim() })) };
}

/** The tables written in `text` between `from` and `to` (never inside a fenced code block). */
export function tablesIn(text: string, from: number, to: number): PlacedTable[] {
  const out: PlacedTable[] = [];
  let fenced = false;
  let at = from;
  let run: { start: number; end: number; lines: string[] } | null = null;
  const close = () => {
    if (run) {
      const t = parseTable(run.lines.join("\n"));
      if (t) out.push({ ...t, start: run.start, end: run.end });
    }
    run = null;
  };
  while (at < to) {
    const nl = text.indexOf("\n", at);
    const lineEnd = nl < 0 || nl > to ? to : nl;
    const line = text.slice(at, lineEnd).replace(/\r$/, "");
    if (/^\s*(```|~~~)/.test(line)) {
      close();
      fenced = !fenced;
    } else if (!fenced && isRow(line)) {
      if (!run) run = { start: at, end: lineEnd, lines: [] };
      run.lines.push(line);
      run.end = at + line.length;
    } else close();
    at = lineEnd + 1;
  }
  close();
  return out;
}

/** How alike two headers are: shared column names over the smaller header. */
function headerOverlap(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a.map(norm).filter(Boolean));
  const B = new Set(b.map(norm).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const x of A) if (B.has(x)) shared++;
  return shared / Math.min(A.size, B.size);
}

/** Below this header overlap two tables are about different things: the incoming one is filed whole. */
export const TABLE_HEADER_MIN_OVERLAP = 0.5;

/** The existing table an incoming one is about: the one with the most header overlap (at least the minimum), or null. */
export function tableFor(tables: readonly PlacedTable[], incoming: MdTable): PlacedTable | null {
  let best: PlacedTable | null = null;
  let score = 0;
  for (const t of tables) {
    const s = headerOverlap(t.header, incoming.header);
    if (s >= TABLE_HEADER_MIN_OVERLAP && s > score) [best, score] = [t, s];
  }
  return best;
}

/** What merging an incoming table into an existing one did. */
export interface TableMergeResult {
  /** The existing table as it now reads (header, separator and rows), or the same text when nothing changed. */
  table: MdTable;
  changed: boolean;
  replaced: { was: string; now: string }[];
  added: string[];
  repeated: number;
}

/** Merges `incoming` into `existing` (see the module doc), or null when no usable key column exists. */
export function mergeTables(existing: MdTable, incoming: MdTable): TableMergeResult | null {
  const exCols = existing.header.map(norm);
  // Incoming column → existing column (or a new column at the end).
  const added = incoming.header.map((h, i) => ({ h, i })).filter(({ h }) => norm(h) && !exCols.includes(norm(h)));
  const header = [...existing.header, ...added.map((a) => a.h)];
  const colOf = (i: number) => {
    const at = exCols.indexOf(norm(incoming.header[i] ?? ""));
    return at >= 0 ? at : existing.header.length + added.findIndex((a) => a.i === i);
  };
  const width = header.length;
  const pad = (cells: readonly string[]) => [...cells, ...Array<string>(Math.max(0, width - cells.length)).fill("")].slice(0, width);

  // The key: the incoming first column if the existing table has it, else the shared column whose values overlap most.
  const shared = incoming.header.map((_, i) => i).filter((i) => exCols.includes(norm(incoming.header[i] ?? "")));
  const valuesOf = (rows: MdTable["rows"], col: number) => rows.map((r) => norm(r.cells[col] ?? "")).filter(Boolean);
  const overlapOf = (i: number) => {
    const ex = new Set(valuesOf(existing.rows, exCols.indexOf(norm(incoming.header[i]!))));
    return valuesOf(incoming.rows, i).filter((v) => ex.has(v)).length;
  };
  const keyIn = shared.includes(0) ? 0 : shared.sort((a, b) => overlapOf(b) - overlapOf(a))[0];
  if (keyIn === undefined) return null;
  const keyEx = exCols.indexOf(norm(incoming.header[keyIn]!));
  const exKeys = valuesOf(existing.rows, keyEx);
  if (new Set(exKeys).size !== exKeys.length || exKeys.length !== existing.rows.length) return null;

  const rows = existing.rows.map((r) => ({ cells: pad(r.cells), line: r.line, touched: added.length > 0 }));
  const result: TableMergeResult = { table: existing, changed: false, replaced: [], added: [], repeated: 0 };
  for (const row of incoming.rows) {
    const key = norm(row.cells[keyIn] ?? "");
    const hit = key ? rows.find((r) => norm(r.cells[keyEx] ?? "") === key) : undefined;
    if (!hit) {
      if (row.cells.every((c) => !c)) continue;
      const cells = pad([]);
      row.cells.forEach((c, i) => (cells[colOf(i)] = c));
      rows.push({ cells, line: rowLine(cells), touched: true });
      result.added.push(rowLine(cells));
      continue;
    }
    const was = rowLine(hit.cells);
    let diff = false;
    row.cells.forEach((c, i) => {
      const col = colOf(i);
      if (c && norm(c) !== norm(hit.cells[col] ?? "")) {
        hit.cells[col] = c;
        diff = true;
      }
    });
    if (diff) {
      hit.touched = true;
      result.replaced.push({ was, now: rowLine(hit.cells) });
    } else result.repeated++;
  }
  result.changed = added.length > 0 || result.replaced.length > 0 || result.added.length > 0;
  if (!result.changed) return result;
  result.table = {
    header,
    headerLine: added.length ? rowLine(header) : existing.headerLine,
    separator: added.length ? `${existing.separator.replace(/\|?\s*$/, "")}${added.map(() => " | ---").join("")} |` : existing.separator,
    rows: rows.map((r) => ({ cells: r.cells, line: r.touched ? rowLine(r.cells) : r.line })),
  };
  return result;
}

/** The table's text: the header row rewritten only when columns were added, unchanged rows as they were written. */
export function tableText(t: MdTable): string {
  return [t.headerLine, t.separator, ...t.rows.map((r) => r.line)].join("\n");
}
