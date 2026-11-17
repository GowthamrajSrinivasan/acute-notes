/**
 * Phase 1 close-out: the AI consistency check is OFF by default — no queueing, no request, no tokens — and every
 * switch fails closed. Mocked: no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const meta = new Map<string, unknown>();
vi.mock("@/persistence", () => ({ getPersistence: () => ({ meta: { get: async (k: string) => meta.get(k), set: async (k: string, v: unknown) => void meta.set(k, v) } }) }));
const getDirectJudgeConnection = vi.fn(async () => ({ connectionId: "c", model: "m", provider: { type: "openai" as const, baseUrl: "https://x.test/v1", apiKey: "k" } }));
vi.mock("@/ai/connections", () => ({ getDirectJudgeConnection: () => getDirectJudgeConnection() }));

import { isConsistencyAICheckEnabled, isConsistencyAICheckUiEnabled } from "@/config/features";
import { OPT_IN_KEY } from "@/ai/consistency/aiCheck";
import { isAICheckActive, runAICheckNow, stillDisagree } from "./consistencyRunner";

const fetchSpy = vi.fn(async () => new Response("{}"));
beforeEach(() => {
  meta.clear();
  fetchSpy.mockClear();
  getDirectJudgeConnection.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "on");
  vi.stubEnv("NEXT_PUBLIC_CONSISTENCY_AI_CHECK", undefined as unknown as string);
  vi.stubEnv("CONSISTENCY_AI_CHECK", undefined as unknown as string);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const api = { getSceneElements: () => [] } as never;
const home = { workspaceId: "w", canvasId: "cv" } as never;

describe("AI consistency check — default OFF", () => {
  it("both switches are off when unset, and only exactly 'on' turns them on; both need the AI feature", () => {
    expect(isConsistencyAICheckEnabled()).toBe(false);
    expect(isConsistencyAICheckUiEnabled()).toBe(false);
    for (const v of ["off", "ON", "1", "true", ""]) {
      vi.stubEnv("CONSISTENCY_AI_CHECK", v);
      vi.stubEnv("NEXT_PUBLIC_CONSISTENCY_AI_CHECK", v);
      expect([isConsistencyAICheckEnabled(), isConsistencyAICheckUiEnabled()]).toEqual([false, false]);
    }
    vi.stubEnv("CONSISTENCY_AI_CHECK", "on");
    vi.stubEnv("NEXT_PUBLIC_CONSISTENCY_AI_CHECK", "on");
    expect([isConsistencyAICheckEnabled(), isConsistencyAICheckUiEnabled()]).toEqual([true, true]);
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "off");
    expect([isConsistencyAICheckEnabled(), isConsistencyAICheckUiEnabled()]).toEqual([false, false]);
  });

  it("with the build switch off, even an opted-in device is inactive: a manual run sends nothing and resolves no connection", async () => {
    meta.set(OPT_IN_KEY, true);
    expect(await isAICheckActive()).toBe(false);
    expect(await runAICheckNow(api, home)).toMatchObject({ status: "ai_off", sent: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getDirectJudgeConnection).not.toHaveBeenCalled();
    expect([...meta.keys()].filter((k) => k.startsWith("consistency.aiQueue") || k.startsWith("consistency.judge"))).toEqual([]);
  });

  it("with the build switch on, the device must still opt in (default off): nothing is sent before it does", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONSISTENCY_AI_CHECK", "on");
    expect(await isAICheckActive()).toBe(false);
    expect((await runAICheckNow(api, home)).status).toBe("ai_off");
    expect(fetchSpy).not.toHaveBeenCalled();
    meta.set(OPT_IN_KEY, true);
    expect(await isAICheckActive()).toBe(true);
  });
});

describe("re-checking an AI-raised record", () => {
  it("a near-miss the AI raised stays open while the screen still forwards it; a rule-raised one follows the rules", () => {
    const a = "Backups run every night at 2 a.m.";
    const b = "Backups run once a week on Sunday.";
    expect(stillDisagree(a, b, { evidence: { by: "ai", reason: "", at: 0 } })).toBe(true);
    expect(stillDisagree(a, b, { evidence: { by: "rule", reason: "", at: 0 } })).toBe(false);
    expect(stillDisagree(a, "The office is in Berlin.", { evidence: { by: "ai", reason: "", at: 0 } })).toBe(false);
  });
});
