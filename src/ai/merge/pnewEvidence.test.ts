/**
 * Evidence, not behaviour: Jev's full topic distribution (including P("new")) on the 46 unsure layout D parts and 6 confident controls,
 * saved 2026-10-10 in `.ai/docs/decision-spike/data/jev-pnew-layoutd-2026-10-10.json`. Read offline, no model call. These tests pin the
 * numbers the evidence doc quotes ("New / uncertain" section), so the doc cannot drift from the data. No production rule uses P(new).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Row {
  control?: boolean;
  leaf: string;
  confidence: number;
  pNew: number;
  entropy: number;
  localCoverage: number;
  choiceLabel: string;
}
const rows = Object.values(JSON.parse(readFileSync(".ai/docs/decision-spike/data/jev-pnew-layoutd-2026-10-10.json", "utf8")) as Record<string, Row>);
const unsure = rows.filter((r) => !r.control);
const controls = rows.filter((r) => r.control);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const pNewOf = (heads: string[]) => heads.map((h) => unsure.find((r) => r.leaf.startsWith(h))!.pNew);

describe("Jev's P(new) on the layout D parts (evidence)", () => {
  it("52 recorded parts: the 46 that were unsure, and 6 confident controls", () => {
    expect(rows).toHaveLength(52);
    expect(unsure).toHaveLength(46);
    expect(controls).toHaveLength(6);
  });

  it("unsure mostly means torn between existing topics: P(new) is small, 'new' is the top choice on 4 of 46, and never reaches 0.5", () => {
    expect(median(unsure.map((r) => r.pNew))).toBe(0.03);
    expect(Math.max(...unsure.map((r) => r.pNew))).toBeLessThan(0.4);
    expect(unsure.filter((r) => r.choiceLabel === "(new)")).toHaveLength(4);
    expect(unsure.filter((r) => r.pNew >= 0.3)).toHaveLength(3);
    expect(Math.max(...controls.map((r) => r.pNew))).toBeLessThanOrEqual(0.04);
  });

  it("the 0.5 cut is inside the run-to-run noise: 6 of the 46 are at 0.5 or more in this run, and 1 control fell below it", () => {
    expect(unsure.filter((r) => r.confidence >= 0.5)).toHaveLength(6);
    expect(controls.filter((r) => r.confidence < 0.5)).toHaveLength(1);
  });

  it("P(new) is a ranking, not a classifier: against a heading-based manual review (11 parts on subjects chat 1 does not cover, 7 on subjects it does)", () => {
    const notCovered = pNewOf(["35 days", "The really powerful part", "But don't make themes", "This gives you an amazing", "Realistic timeline", "7. Now imagine I buy", "Now comes the really important part: testing", "The 35-day roadmap", "6. Then I discover", "The MVP I'd actually", "Here's what I would NOT build"]);
    const covered = pNewOf(["And this makes the Roblox analogy even stronger", "And this is where I think the Roblox analogy", "The real competitive moat", "And there is a Roblox-style upside", "I would call this a Block Contract", "But I'd actually use composition", "14. This is where the architecture"]);
    expect(notCovered.filter((p) => p >= 0.08)).toHaveLength(10);
    expect(notCovered.filter((p) => p <= 0.02)).toHaveLength(1);
    expect(Math.max(...covered)).toBeLessThanOrEqual(0.06);
  });

  it("the word-coverage signal does not separate them: it is weakly related to P(new) and overlaps in both groups", () => {
    const cov = (h: string) => unsure.find((r) => r.leaf.startsWith(h))!.localCoverage;
    expect(cov("35 days")).toBeLessThan(0.2); // a new subject, low coverage
    expect(cov("The real competitive moat")).toBeLessThan(0.3); // a covered subject, equally low
    expect(cov("Is it an Apple-level idea?")).toBeGreaterThan(0.3);
  });
});
