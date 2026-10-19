/**
 * Source lines with tabs expanded, so columns line up the way the drawing does,
 * while every column still maps back to its UTF-16 offset in the source.
 */
import type { Span } from "./types";

const TAB = 4;

export interface Line {
  /** 0-based line number. */
  row: number;
  /** The line with tabs expanded and no line terminator. */
  text: string;
  /** `offsets[col]` is the source offset of column `col`; `offsets[text.length]` is the line's end. */
  offsets: number[];
}

export function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  let row = 0;
  let start = 0;
  while (start <= source.length) {
    let end = source.indexOf("\n", start);
    if (end < 0) end = source.length;
    const rawEnd = end > start && source[end - 1] === "\r" ? end - 1 : end;
    let text = "";
    const offsets: number[] = [];
    for (let i = start; i < rawEnd; i++) {
      const ch = source[i]!;
      if (ch === "\t") {
        const n = TAB - (text.length % TAB);
        for (let k = 0; k < n; k++) offsets.push(i);
        text += " ".repeat(n);
      } else {
        offsets.push(i);
        text += ch;
      }
    }
    offsets.push(rawEnd);
    lines.push({ row, text, offsets });
    row++;
    if (end >= source.length) break;
    start = end + 1;
  }
  return lines;
}

/** The source span of columns `[from, to)` of a line (`to` exclusive; the last column's character is included whole). */
export function spanOf(line: Line, from: number, to: number): Span {
  const start = line.offsets[from] ?? line.offsets.at(-1)!;
  const last = line.offsets[Math.max(from, to - 1)] ?? start;
  return { start, end: Math.max(start, last + 1) };
}
