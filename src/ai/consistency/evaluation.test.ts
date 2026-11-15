/**
 * Stage 4d against the evaluation set (§12.5, §12.9 D). The dev split carries the gates for the rules alone; the held-out
 * split is only reported — it must never be used to tune (its SHA-256 is pinned below, as recorded in plan §12.12).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluate, formatReport, type EvalPair } from "./evaluation";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/update-engine/consistency");
const load = (file: string) => (JSON.parse(readFileSync(join(DIR, file), "utf8")) as { pairs: EvalPair[] }).pairs;
const HELDOUT_SHA256 = "9114c001350a2da346bbb7522fd6b540ee68eea194b2ae9684240d8958fe9488";

describe("Stage 4d — the rules on the evaluation set", () => {
  it("dev split: rule precision ≥ 0.9 and context false positives ≤ 0.1 (the rules' own gates)", () => {
    const r = evaluate(load("dev.json"));
    console.log(formatReport("dev", r));
    expect(r.rulePrecision).toBeGreaterThanOrEqual(0.9);
    expect(r.contextFalsePositiveRate).toBeLessThanOrEqual(0.1);
    // Every dev verdict is pinned: the §12.19 refinements change routing, not one rule verdict on dev.
    expect(r.misses.map((m) => m.id)).toEqual(["d35", "d36", "d45", "d51"]);
  });

  it("held-out split: unchanged since it was fixed (never tuned on, no longer re-scored)", () => {
    expect(createHash("sha256").update(readFileSync(join(DIR, "heldout.json"))).digest("hex")).toBe(HELDOUT_SHA256);
    // Its scores are not printed: they were reported once (plan §12.12, §12.15, §12.17); the rules have changed since, and
    // re-scoring it on every run would turn it into a tuning set (§12.19).
  });
});
