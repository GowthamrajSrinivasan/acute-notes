/**
 * Shared test timing helpers (Wave F3): a few perf-budget tests asserted a single hard millisecond threshold
 * against one sample, which flips red under full-suite load (shared CPU) without the code getting any slower.
 * `median` turns repeated samples into one robust number; `time` is the one-shot stopwatch every caller already
 * used ad hoc.
 */
export function time(fn: () => void): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

export function median(ms: readonly number[]): number {
  const sorted = [...ms].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}
