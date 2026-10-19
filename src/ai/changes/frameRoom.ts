/**
 * Room for a grown section frame: a frame that grows to fit its content after it mounts (a card fitting its text)
 * would cover the frames beside and below it. The frames it now reaches are pushed — right when they were to its
 * right, down when they were below it — just far enough to keep the gap they had, and so on along the chain. A
 * frame pushed down takes the rest of its row with it (frames whose top lined up with its own), so a row of sections
 * stays a row. Frames only move whole; nothing inside one changes.
 *
 * Pure and deterministic: boxes in, moves out.
 */
import type { Box } from "./changeSet";
import type { RoutedBox } from "./routing";

/** The gap kept when two frames were closer than this (or already touching) before the growth. */
export const MIN_FRAME_GAP = 48;

const overlapsAlong = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/** How far each frame moves (only the ones that move), for `grownId` grown from `before` to its box in `frames`. */
export function roomForGrownFrame(frames: readonly RoutedBox[], grownId: string, before: Box): Map<string, { dx: number; dy: number }> {
  const original = new Map(frames.map((f) => [f.id, { ...f }] as const));
  original.set(grownId, { id: grownId, ...before });
  const now = new Map(frames.map((f) => [f.id, { ...f }] as const));
  const moves = new Map<string, { dx: number; dy: number }>();
  const move = (id: string, dx: number, dy: number) => {
    const b = now.get(id)!;
    now.set(id, { ...b, x: b.x + dx, y: b.y + dy });
    const m = moves.get(id) ?? { dx: 0, dy: 0 };
    moves.set(id, { dx: m.dx + dx, dy: m.dy + dy });
  };
  const queue = [grownId];
  for (let guard = 0; queue.length && guard < 500; guard += 1) {
    const id = queue.shift()!;
    const p = now.get(id)!;
    const pb = original.get(id)!;
    for (const f of frames) {
      if (f.id === id) continue;
      const fb = original.get(f.id)!;
      const cur = now.get(f.id)!;
      if (fb.x >= pb.x + pb.width - 0.5 && overlapsAlong(p.y, p.y + p.height, cur.y, cur.y + cur.height)) {
        const gap = Math.max(MIN_FRAME_GAP, fb.x - (pb.x + pb.width));
        const need = p.x + p.width + gap - cur.x;
        if (need > 0.5) {
          move(f.id, need, 0);
          queue.push(f.id);
        }
      } else if (fb.y >= pb.y + pb.height - 0.5 && overlapsAlong(p.x, p.x + p.width, cur.x, cur.x + cur.width)) {
        const gap = Math.max(MIN_FRAME_GAP, fb.y - (pb.y + pb.height));
        const need = p.y + p.height + gap - cur.y;
        if (need > 0.5) {
          // The whole row moves down together, so its sections stay side by side.
          for (const r of frames) {
            const rb = original.get(r.id)!;
            if (r.id === id || Math.abs(rb.y - fb.y) > 0.5) continue;
            const lift = cur.y + need - now.get(r.id)!.y;
            if (lift > 0.5) {
              move(r.id, 0, lift);
              queue.push(r.id);
            }
          }
        }
      }
    }
  }
  return moves;
}
