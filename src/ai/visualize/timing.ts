/**
 * Timings for a Visualize run, logged to the console (one `[acute-notes] Visualize timing` line per run) so the slow
 * step of a real document can be told apart: parsing, the outline call, the slowest section, a retry, the layout.
 * Measuring only: nothing here changes what a run produces.
 */
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const elapsedMs = (since: number) => Math.round(now() - since);
export const startTimer = now;

/** Named laps since the stopwatch started, each the time since the one before. */
export function stopwatch() {
  const start = now();
  let last = start;
  const laps: string[] = [];
  return {
    lap(name: string) {
      const t = now();
      laps.push(`${name} ${Math.round(t - last)}ms`);
      last = t;
    },
    /** `laps…, total Nms` */
    summary: () => `${laps.join(", ")}, total ${Math.round(now() - start)}ms`,
  };
}

export interface SectionTiming {
  label: string;
  chars: number;
  /** Generated as this many pieces in parallel (large sections). */
  pieces?: number;
  /** The first generation, including any wait for a free slot. */
  generateMs: number;
  /** The analysis check's retry: a small analysis-only call ("patch") or a full regeneration ("full"). */
  retry?: { kind: "patch" | "full"; ms: number };
  /** The content safety net. */
  netMs: number;
  totalMs: number;
}

export function logOutlinedTiming(outlineMs: number, sections: readonly SectionTiming[], totalMs: number): void {
  const rows = sections.map(
    (s) =>
      `  “${s.label}” (${s.chars} chars${s.pieces ? `, ${s.pieces} pieces` : ""}): generate ${s.generateMs}ms` +
      (s.retry ? `, retry (${s.retry.kind}) ${s.retry.ms}ms` : "") +
      `, safety net ${s.netMs}ms, section total ${s.totalMs}ms`,
  );
  const slowest = sections.length ? sections.reduce((a, b) => (b.totalMs > a.totalMs ? b : a)) : null;
  console.info(
    `[acute-notes] Visualize timing (outlined): outline ${outlineMs}ms, ${sections.length} section(s) in parallel` +
      (slowest ? ` (slowest “${slowest.label}” ${slowest.totalMs}ms)` : "") +
      `, total ${totalMs}ms\n${rows.join("\n")}`,
  );
}
