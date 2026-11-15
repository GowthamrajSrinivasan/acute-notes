/**
 * Study Mode Phase 1 (`.ai/docs/study-mode-implementation-plan.md` §3, issue B): weak concepts and mastery. Pure:
 * everything comes from stored attempts and an injected `now`, so a result can always be reproduced.
 *
 * - Only **fresh** attempts count (`at ≥ freshSince`); older ones stay in history as stale.
 * - **Weak** (the design's rule, unchanged): not retired, and either (a) ≥ 2 fresh attempts with accuracy < 0.6 over the
 *   last 5, or (b) the last fresh attempt was wrong. (a) ranks above (b).
 * - **Mastery** (display and ranking only; never a decision about content):
 *   `m = (Σ wᵢ·cᵢ + 0.5) / (Σ wᵢ + 1)`, `wᵢ = k(kind) · 0.5^((now − atᵢ) / 14 days)`, k(quiz) = 1, k(flashcard) = 0.5.
 *   The pseudo-attempt at 0.5 is the prior, so one answer never reads as 0 % or 100 %.
 * - **Bands:** `new` (< 2 fresh attempts), `weak`, `learning`, `strong` (m ≥ 0.85 and evidence ≥ 3, **and at least
 *   one fresh quiz answer** — issue B: self-graded flashcards alone can make a concept weak, never strong).
 *   A concept from a card under review, or in `needs_review`, is capped at `learning`.
 * - No spaced-repetition scheduler in v1.
 */

export type AttemptKind = "q" | "f";
/** One answer: when, quiz or flashcard self-grade, right (1) or wrong (0), flags (bit0 unverified card, bit1 stale). */
export type Attempt = readonly [at: number, kind: AttemptKind, correct: 0 | 1, flags: number];

export const FLAG_UNVERIFIED = 1;

export interface StudyRecord {
  attempts: readonly Attempt[];
  /** Attempts before this are stale (the source changed since). */
  freshSince?: number;
  state?: "source_changed" | "needs_review" | "retired";
  /** Units the concept covers (for the ranking's tiebreak). */
  units?: readonly string[];
}

export const WEAK_RULE = { version: 1, minAttempts: 2, window: 5, threshold: 0.6 } as const;
export const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
const KIND_WEIGHT: Record<AttemptKind, number> = { q: 1, f: 0.5 };

export type Band = "new" | "weak" | "learning" | "strong";
export type WeakBecause = "low_accuracy" | "last_wrong";

/** Fresh attempts, oldest first. */
export function freshAttempts(r: StudyRecord): Attempt[] {
  return r.attempts.filter((a) => a[0] >= (r.freshSince ?? Number.NEGATIVE_INFINITY)).sort((x, y) => x[0] - y[0]);
}

/** Why a concept is weak, or null. */
export function weakBecause(r: StudyRecord): WeakBecause | null {
  if (r.state === "retired") return null;
  const fresh = freshAttempts(r);
  if (!fresh.length) return null;
  if (fresh.length >= WEAK_RULE.minAttempts) {
    const last = fresh.slice(-WEAK_RULE.window);
    if (last.reduce((s, a) => s + a[2], 0) / last.length < WEAK_RULE.threshold) return "low_accuracy";
  }
  return fresh[fresh.length - 1]![2] === 0 ? "last_wrong" : null;
}

export const isWeak = (r: StudyRecord) => weakBecause(r) !== null;

/** Mastery m (0–1) and evidence n, over fresh attempts. */
export function masteryOf(r: StudyRecord, now: number): { m: number; n: number } {
  let num = 0.5;
  let den = 1;
  for (const [at, kind, correct] of freshAttempts(r)) {
    const w = KIND_WEIGHT[kind] * 0.5 ** (Math.max(0, now - at) / HALF_LIFE_MS);
    num += w * correct;
    den += w;
  }
  return { m: num / den, n: den - 1 };
}

/** The display band. `underReview`: the card teaching it has an open review (caps the band at `learning`). */
export function bandOf(r: StudyRecord, now: number, underReview = false): Band {
  const fresh = freshAttempts(r);
  if (isWeak(r)) return "weak";
  if (fresh.length < WEAK_RULE.minAttempts) return "new";
  const { m, n } = masteryOf(r, now);
  const capped = underReview || r.state === "needs_review" || fresh.some((a) => (a[3] & FLAG_UNVERIFIED) !== 0);
  const quizzed = fresh.some((a) => a[1] === "q");
  return m >= 0.85 && n >= 3 && quizzed && !capped ? "strong" : "learning";
}

export interface WeakItem {
  key: string;
  because: WeakBecause;
  m: number;
  lastAt: number;
  units: number;
}

/** Weak concepts, best first: low accuracy before last-wrong, then lower mastery, more recent, more units, key. */
export function rankWeak(records: Readonly<Record<string, StudyRecord>>, now: number): WeakItem[] {
  const out: WeakItem[] = [];
  for (const [key, r] of Object.entries(records)) {
    const because = weakBecause(r);
    if (!because) continue;
    const fresh = freshAttempts(r);
    out.push({ key, because, m: masteryOf(r, now).m, lastAt: fresh[fresh.length - 1]![0], units: r.units?.length ?? 0 });
  }
  const rank = (b: WeakBecause) => (b === "low_accuracy" ? 0 : 1);
  return out.sort((a, b) => rank(a.because) - rank(b.because) || a.m - b.m || b.lastAt - a.lastAt || b.units - a.units || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
