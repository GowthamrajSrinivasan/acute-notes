/**
 * Plan §12.29: the four contradictions the screen excluded in the unseen4 recording (x04, x24, x71 — a statistic word on
 * one side only; x60 — "caps … at" not read as a limit), pinned as DEVELOPMENT evidence
 * (`evaluation/update-engine/consistency/regressions-unseen4.json`) with authored variants and counter-cases.
 * Never reported as an unseen score; the historical unseen4 result is unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { judgePair } from "./rules";
import { screenPair, statisticsDiffer } from "./screen";

const FILE = join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/update-engine/consistency/regressions-unseen4.json");
const pairs = (JSON.parse(readFileSync(FILE, "utf8")) as { pairs: { id: string; source: string; a: string; b: string; truth: string; expectedDecision: string; expectedExclusion?: string }[] }).pairs;
const p = (id: string) => pairs.find((x) => x.id === id)!;

describe("§12.29 — regressions from the fourth unseen set (development evidence)", () => {
  it("pins the four known misses, word for word from unseen4", () => {
    const u4 = (JSON.parse(readFileSync(join(FILE, "../unseen4/pairs.json"), "utf8")) as { pairs: { id: string; a: string; b: string }[] }).pairs;
    for (const id of ["x04", "x24", "x60", "x71"]) {
      const src = u4.find((x) => x.id === id)!;
      expect([p(id).a, p(id).b], id).toEqual([src.a, src.b]);
    }
  });

  it("every pinned pair reaches its intended decision (and exclusion)", () => {
    for (const x of pairs) {
      const s = screenPair(x.a, x.b);
      expect(s.decision, x.id).toBe(x.expectedDecision);
      if (x.expectedExclusion) expect(s.exclusion, x.id).toBe(x.expectedExclusion);
    }
  });

  it("the screen is symmetric on these pairs", () => {
    for (const x of pairs) expect(screenPair(x.b, x.a).decision, x.id).toBe(screenPair(x.a, x.b).decision);
  });

  it("a statistic word on one side only is no evidence of different metrics; both sides naming different ones is", () => {
    expect(statisticsDiffer(p("x04").a, p("x04").b)).toBe(false); // average ~ typically
    expect(statisticsDiffer(p("x24").a, p("x24").b)).toBe(false); // a cap is not a statistic
    expect(statisticsDiffer(p("x71").a, p("x71").b)).toBe(false); // "weekly" one side only
    expect(statisticsDiffer("Average latency is 120 ms.", "Peak latency is 900 ms.")).toBe(true);
    expect(statisticsDiffer("The app has 5,000 daily active users.", "The app has 20,000 monthly active users.")).toBe(true);
    // A frequency stated as the sentence's rate is not a metric qualifier.
    expect(statisticsDiffer("Backups run weekly.", "Backups run daily.")).toBe(false);
  });

  it("one-sided forwards say why, and never outrank a definite value clash", () => {
    const s = screenPair(p("x04").a, p("x04").b);
    expect(s.reason).toMatch(/statistic word on one side only/);
    const clash = screenPair("The Brook Lane depot packs 120 orders per hour for the Riverside account.", "The Brook Lane depot packs 80 orders per hour for the Riverside account.");
    if (clash.decision === "forward") expect(clash.priority).toBeGreaterThan(s.priority);
  });

  it("limit phrasing is read as a maximum: two different maxima are a near-miss, an observation inside one still agrees", () => {
    expect(judgePair(p("x60").a, p("x60").b).nearMiss?.kind).toBe("limit");
    expect(judgePair(p("v4-limits-to").a, p("v4-limits-to").b).nearMiss?.kind).toBe("limit");
    expect(judgePair(p("v4-restricts-to").a, p("v4-restricts-to").b).nearMiss?.kind).toBe("limit");
    expect(judgePair("Uploads have a cap of 25 MB.", "Uploads are capped at 100 MB.").nearMiss?.kind).toBe("limit");
    // An observation above a stated cap still clashes; one inside it still agrees.
    expect(judgePair("The Fernhill rowing club caps its squad at 30 members.", "The Fernhill rowing club's squad has 36 members.").verdict).toBe("conflict");
    expect(judgePair(p("c4-observation-inside-cap").a, p("c4-observation-inside-cap").b).reason).toBe("the values agree");
  });

  it("'the limit to N' after an article is the limit's value, not a maximum of something else", () => {
    // Read as a maximum, 20 would sit inside it and the pair would be excluded as agreeing.
    expect(judgePair("The admin set the limit to 50 uploads per day.", "The upload limit is 20 uploads per day.").verdict).toBe("conflict");
  });
});
