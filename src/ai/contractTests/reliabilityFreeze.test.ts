/**
 * The execution-reliability harness is frozen before its one approved paid run (plan §12.29 P2). Pinned here as well
 * as in FREEZE.json, so a consistent edit to both still fails. After the run, its outputs are pinned too.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIR = join(ROOT, "evaluation", "update-engine", "consistency", "reliability");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("execution-reliability check — frozen harness", () => {
  it("FREEZE.json itself is unchanged", () => {
    expect(sha(join(DIR, "FREEZE.json"))).toBe("53f46b1b64b2a46d4305c85d3819be26b0f6fd3e49f1227fd30bdc30a7ce1d4f");
  });
  it("every frozen file still has its hash (harness, runner, wire counter, execution core, workload)", () => {
    const freeze = JSON.parse(readFileSync(join(DIR, "FREEZE.json"), "utf8")) as { files: Record<string, string> };
    expect(Object.keys(freeze.files)).toHaveLength(11);
    for (const [f, h] of Object.entries(freeze.files)) expect([f, sha(join(ROOT, f))]).toEqual([f, h]);
  });
  it("the one approved run (2026-11-15, PASS) is preserved byte for byte — never rerun or overwritten (plan §12.29)", () => {
    const run = join(DIR, "runs", "2026-11-15-reliability");
    const outputs: [string, string][] = [
      ["calls.json", "0af0fad7d6e6dffdbfc2d62a9acda74fee0efc63eb8a6788a7ff46d3d9f71ece"],
      ["exchanges.json", "987a15a639b5fb4ba1b0bef57fe65dda9a7845042d0073658aa440358231f330"],
      ["pair-outcomes.json", "f4e5fce46ebbc1965ed95c5bcd87c09d0c21b2ba3adcf1d9212a390c141386a8"],
      ["report.md", "969e8902f60046fbd81f3419a063b6ed07b7771fc71ddfd3366fc8547d53e0da"],
      ["result.json", "185dc1ef3140a4c180d66f96f5d9c550e941de7cc9bfc55d2946938372509425"],
      ["started.json", "2b6d1751c0e7c1dcbc24200a3217361462fdaa2f6df6de208a7ba8f651a8fc9d"],
    ];
    for (const [f, h] of outputs) expect([f, sha(join(run, f))]).toEqual([f, h]);
    expect(readdirSync(join(DIR, "runs"))).toEqual(["2026-11-15-reliability"]);
  });
});
