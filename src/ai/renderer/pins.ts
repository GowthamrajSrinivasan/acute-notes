/**
 * Pinned boxes inside one frame (organisation-layout plan §3.4.3, F3): Re-arrange lays a section out without the cards
 * the user placed, then this one deterministic sweep makes room for them. The laid-out boxes are read in rows (boxes
 * whose vertical extents overlap: a sub-topic's backdrop holds its cards in one row), top to bottom; a row that would
 * overlap a pinned box moves down past it, and every row below moves down with it. So nothing overlaps a pin, rows
 * keep their order and their shape (reading order is kept), and nothing moves where there is no pin in the way.
 *
 * The same idea as reflow's push sweep (`reflow.ts`), inside one frame. Pure: boxes in, boxes out.
 */
import type { Box } from "./types";

/** Clear space kept between a pinned box and a laid-out one (a grid row's gap). */
export const PIN_GAP = 32;

const near = (a: Box, b: Box, gap: number) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/** Laid-out boxes in rows: each row's ids, top to bottom (rows are boxes whose vertical extents overlap). */
export function rowsOf(boxes: ReadonlyMap<string, Box>): string[][] {
  const byTop = [...boxes].sort(([ia, a], [ib, b]) => a.y - b.y || a.x - b.x || (ia < ib ? -1 : ia > ib ? 1 : 0));
  const rows: { bottom: number; ids: string[] }[] = [];
  for (const [id, b] of byTop) {
    const row = rows.at(-1);
    if (row && b.y < row.bottom) {
      row.ids.push(id);
      row.bottom = Math.max(row.bottom, b.y + b.height);
    } else rows.push({ bottom: b.y + b.height, ids: [id] });
  }
  return rows.map((r) => r.ids);
}

/** `laid` moved down, row by row, until no box comes within `gap` of a pinned box. Boxes keep their size. */
export function resolvePins(laid: ReadonlyMap<string, Box>, pins: readonly Box[], gap = PIN_GAP): Map<string, Box> {
  const out = new Map<string, Box>();
  let shift = 0;
  for (const ids of rowsOf(laid)) {
    const at = (id: string): Box => ({ ...laid.get(id)!, y: laid.get(id)!.y + shift });
    // Each push lands below a pin's bottom, so y only grows and the loop ends once the row is clear of every pin.
    for (let guard = 0; guard <= pins.length; guard++) {
      let extra = 0;
      for (const id of ids) for (const p of pins) if (near(at(id), p, gap)) extra = Math.max(extra, p.y + p.height + gap - at(id).y);
      if (extra <= 0) break;
      shift += extra;
    }
    for (const id of ids) out.set(id, at(id));
  }
  return out;
}
