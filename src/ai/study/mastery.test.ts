/**
 * Study Mode Phase 1 (study-mode-implementation-plan §3, issue B): the weak rule, mastery, bands and the weak ranking,
 * with a fixed `now` so every result is reproducible.
 */
import { describe, expect, it } from "vitest";
import { bandOf, FLAG_UNVERIFIED, HALF_LIFE_MS, isWeak, masteryOf, rankWeak, weakBecause, type Attempt, type StudyRecord } from "./mastery";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const q = (daysAgo: number, correct: 0 | 1, flags = 0): Attempt => [NOW - daysAgo * DAY, "q", correct, flags];
const f = (daysAgo: number, correct: 0 | 1): Attempt => [NOW - daysAgo * DAY, "f", correct, 0];
const rec = (attempts: Attempt[], extra: Partial<StudyRecord> = {}): StudyRecord => ({ attempts, ...extra });

describe("Study Phase 1 — the weak rule (design, unchanged)", () => {
  it("(a) ≥ 2 fresh attempts with accuracy < 0.6 over the last 5", () => {
    expect(weakBecause(rec([q(5, 1), q(4, 0), q(3, 0), q(2, 1), q(1, 1)]))).toBeNull(); // 3/5 = 0.6, not below
    expect(weakBecause(rec([q(6, 1), q(5, 1), q(4, 0), q(3, 0), q(2, 0), q(1, 1)]))).toBe("low_accuracy"); // last 5: 2/5
  });

  it("(b) the last fresh attempt was wrong — even with one attempt", () => {
    expect(weakBecause(rec([q(1, 0)]))).toBe("last_wrong");
    expect(weakBecause(rec([q(3, 1), q(2, 1), q(1, 0)]))).toBe("last_wrong");
  });

  it("only fresh attempts count; stale-only is not weak; retired is never weak", () => {
    const stale = rec([q(10, 0), q(9, 0)], { freshSince: NOW - 5 * DAY });
    expect(isWeak(stale)).toBe(false);
    expect(weakBecause(rec([q(10, 0), q(9, 0), q(1, 1)], { freshSince: NOW - 5 * DAY }))).toBeNull();
    expect(isWeak(rec([q(2, 0), q(1, 0)], { state: "retired" }))).toBe(false);
    expect(isWeak(rec([]))).toBe(false);
  });
});

describe("Study Phase 1 — mastery", () => {
  it("starts at the 0.5 prior; one answer never reads as 0 or 1", () => {
    expect(masteryOf(rec([]), NOW)).toEqual({ m: 0.5, n: 0 });
    expect(masteryOf(rec([q(0, 1)]), NOW).m).toBeCloseTo(0.75, 10);
    expect(masteryOf(rec([q(0, 0)]), NOW).m).toBeCloseTo(0.25, 10);
  });

  it("halves an attempt's weight every 14 days; a flashcard self-grade counts half", () => {
    expect(masteryOf(rec([[NOW - HALF_LIFE_MS, "q", 1, 0]]), NOW).n).toBeCloseTo(0.5, 10);
    expect(masteryOf(rec([f(0, 1)]), NOW).n).toBeCloseTo(0.5, 10);
    expect(masteryOf(rec([f(0, 1)]), NOW).m).toBeCloseTo((0.5 + 0.5) / 1.5, 10);
  });

  it("is reproducible: the same attempts and now give the same number", () => {
    const r = rec([q(3, 1), f(2, 0), q(1, 1)]);
    expect(masteryOf(r, NOW)).toEqual(masteryOf(structuredClone(r), NOW));
  });
});

describe("Study Phase 1 — bands", () => {
  const strongQuiz = [q(4, 1), q(3, 1), q(2, 1), q(1, 1), q(0, 1)];

  it("new below 2 fresh attempts, weak by the rule, strong at m ≥ 0.85 with evidence ≥ 3, else learning", () => {
    expect(bandOf(rec([q(0, 1)]), NOW)).toBe("new");
    expect(bandOf(rec([q(1, 1), q(0, 0)]), NOW)).toBe("weak");
    expect(bandOf(rec(strongQuiz), NOW)).toBe("strong");
    expect(bandOf(rec([q(1, 1), q(0, 1)]), NOW)).toBe("learning"); // evidence 2 < 3
  });

  it("issue B: flashcard self-grades alone never make a concept strong, but can make it weak", () => {
    const flash = [f(4, 1), f(3, 1), f(2, 1), f(1, 1), f(0, 1), f(0, 1), f(0, 1), f(0, 1)];
    expect(masteryOf(rec(flash), NOW).m).toBeGreaterThan(0.85);
    expect(bandOf(rec(flash), NOW)).toBe("learning");
    expect(bandOf(rec([f(1, 1), f(0, 0)]), NOW)).toBe("weak");
  });

  it("issue A: a card under review, a needs_review concept or an unverified answer caps the band at learning", () => {
    expect(bandOf(rec(strongQuiz), NOW, true)).toBe("learning");
    expect(bandOf(rec(strongQuiz, { state: "needs_review" }), NOW)).toBe("learning");
    expect(bandOf(rec([...strongQuiz.slice(0, 4), q(0, 1, FLAG_UNVERIFIED)]), NOW)).toBe("learning");
    expect(bandOf(rec([q(1, 1), q(0, 0)]), NOW, true)).toBe("weak"); // the cap never hides weakness
  });
});

describe("Study Phase 1 — the weak ranking", () => {
  it("low accuracy before last-wrong, then lower mastery, more recent, more units, then the key", () => {
    const records: Record<string, StudyRecord> = {
      "c:s:u1": rec([q(2, 1), q(1, 1), q(0, 0)]), // last_wrong
      "c:s:u2": rec([q(2, 0), q(1, 0), q(0, 1)]), // low_accuracy, m higher
      "c:s:u3": rec([q(2, 0), q(1, 0), q(0, 0)]), // low_accuracy, m lowest
      "c:s:u4": rec([q(1, 1), q(0, 1)]), // not weak
      "c:s:u5+u6": rec([q(5, 1), q(0, 0)], { units: ["u5", "u6"] }), // last_wrong, same m as u7, more units
      "c:s:u7": rec([q(5, 1), q(0, 0)], { units: ["u7"] }),
    };
    expect(rankWeak(records, NOW).map((w) => w.key)).toEqual(["c:s:u3", "c:s:u2", "c:s:u5+u6", "c:s:u7", "c:s:u1"]);
  });
});
