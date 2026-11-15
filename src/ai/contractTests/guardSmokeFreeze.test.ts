/** The live retry-guard smoke test is frozen before its one approved paid run (plan §12.30–12.32); its outputs are pinned. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIR = join(ROOT, "evaluation", "update-engine", "guard-smoke");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("live retry-guard smoke test — frozen harness", () => {
  it("FREEZE.json itself is unchanged, and every frozen file still has its hash", () => {
    expect(sha(join(DIR, "FREEZE.json"))).toBe("9519a18558b4a567fcc12aced271ea65c180f1e89793124faeb320dee8f769a7");
    const freeze = JSON.parse(readFileSync(join(DIR, "FREEZE.json"), "utf8")) as { files: Record<string, string> };
    expect(Object.keys(freeze.files)).toHaveLength(15);
    for (const [f, h] of Object.entries(freeze.files)) expect([f, sha(join(ROOT, f))]).toEqual([f, h]);
  });
  it("the one approved live run (2026-11-15, PASS) is preserved byte for byte — never rerun or overwritten (plan §12.32)", () => {
    const run = join(DIR, "runs", "2026-11-15-guard-smoke");
    const outputs: [string, string][] = [
      ["report.md", "be7028e235e7b6b4e8943826e59a399232a11b0e122d071142216b9e0353742c"],
      ["result.json", "3a93098fcf4dbdf8125e5b47d0e3c0448784c27d0411419d0a16cbc5031578b4"],
      ["started.json", "69d84f919cd2312000502fad720259d6a291ffbc9f9b8ebe2d625ddd10ecfba1"],
    ];
    for (const [f, h] of outputs) expect([f, sha(join(run, f))]).toEqual([f, h]);
    expect(readdirSync(join(DIR, "runs"))).toEqual(["2026-11-15-guard-smoke"]);
    expect(existsSync(join(DIR, "runs"))).toBe(true);
  });
});
