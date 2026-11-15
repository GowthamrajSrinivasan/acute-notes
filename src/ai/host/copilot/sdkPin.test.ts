/**
 * The Copilot SDK stays pinned to the version whose internal retries and single-attempt guard were verified (§12.29,
 * review 2026-11-15: "keep the SDK version pinned; on any upgrade, rerun the retry-guard regression before enabling model
 * calls"). An upgrade fails here until the spike is rerun and retryGuardVerification.json is updated.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = <T,>(p: string) => JSON.parse(readFileSync(join(ROOT, p), "utf8")) as T;
const verified = read<{ sdkVersion: string; guarded: Record<string, number> }>("src/ai/host/copilot/retryGuardVerification.json");

describe("Copilot SDK pin (§12.29)", () => {
  it("package.json declares the SDK as an exact version (no range)", () => {
    expect(read<{ dependencies: Record<string, string> }>("package.json").dependencies["@github/copilot-sdk"]).toBe(verified.sdkVersion);
  });
  it("the lockfile and the installed package are that version", () => {
    const lock = read<{ packages: Record<string, { version?: string; dependencies?: Record<string, string> }> }>("package-lock.json");
    expect(lock.packages[""]!.dependencies!["@github/copilot-sdk"]).toBe(verified.sdkVersion);
    expect(lock.packages["node_modules/@github/copilot-sdk"]!.version).toBe(verified.sdkVersion);
    expect(read<{ version: string }>("node_modules/@github/copilot-sdk/package.json").version).toBe(verified.sdkVersion);
  });
  it("the recorded verification shows one physical request per guarded call", () => {
    expect(verified.guarded).toEqual({ success: 1, http429: 1, http500: 1 });
  });
});
