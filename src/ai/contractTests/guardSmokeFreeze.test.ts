/** The live retry-guard smoke test is frozen before its (not yet authorized) paid run (plan §12.30). */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIR = join(ROOT, "evaluation", "update-engine", "guard-smoke");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("live retry-guard smoke test — frozen harness", () => {
  it("FREEZE.json itself is unchanged, and every frozen file still has its hash", () => {
    expect(sha(join(DIR, "FREEZE.json"))).toBe("9bcd1453b98164b02d4785ee5e25ad06bf8840cc20fce9c0ec14b151c2ac833e");
    const freeze = JSON.parse(readFileSync(join(DIR, "FREEZE.json"), "utf8")) as { files: Record<string, string> };
    expect(Object.keys(freeze.files)).toHaveLength(15);
    for (const [f, h] of Object.entries(freeze.files)) expect([f, sha(join(ROOT, f))]).toEqual([f, h]);
  });
  it("no run exists yet (the paid run needs its own stated ceiling)", () => {
    expect(existsSync(join(DIR, "runs"))).toBe(false);
  });
});
