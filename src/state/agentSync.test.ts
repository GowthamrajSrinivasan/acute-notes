import { afterEach, describe, expect, it } from "vitest";
import { AGENT_SYNC_WINDOW_MS, agentSync, framesTouched } from "./agentSync";

afterEach(() => agentSync.reset());

type El = { id: string; type: string; version: number; isDeleted: boolean; frameId?: string | null };
const el = (id: string, version: number, extra: Partial<El> = {}): El => ({ id, type: "rectangle", version, isDeleted: false, ...extra });

describe("Agent Sync store (Lens plan §8.2)", () => {
  it("is on while an MCP write reached the canvas within the window", () => {
    expect(agentSync.isOn("c1")).toBe(false);
    agentSync.touch("c1", 1_000);
    expect(agentSync.lastWriteAt("c1")).toBe(1_000);
    expect(agentSync.isOn("c1", 1_000 + AGENT_SYNC_WINDOW_MS - 1)).toBe(true);
    expect(agentSync.isOn("c1", 1_000 + AGENT_SYNC_WINDOW_MS)).toBe(false);
    expect(agentSync.isOn("c2", 1_000)).toBe(false);
  });

  it("Pause counts the writes that arrive until resumed, per canvas", () => {
    agentSync.touch("c1");
    agentSync.pause("c1");
    expect(agentSync.heldWrites("c1")).toBe(0);
    agentSync.touch("c1");
    agentSync.touch("c1");
    agentSync.touch("c2");
    expect(agentSync.isPaused("c1")).toBe(true);
    expect(agentSync.heldWrites("c1")).toBe(2);
    expect(agentSync.heldWrites("c2")).toBe(0);
    agentSync.resume("c1");
    expect(agentSync.isPaused("c1")).toBe(false);
    expect(agentSync.heldWrites("c1")).toBe(0);
  });

  it("frames an accepted change touched stay unseen until viewed", () => {
    agentSync.markUnseen("c1", ["f1", "f2"]);
    expect([...agentSync.unseen("c1")]).toEqual(["f1", "f2"]);
    agentSync.markSeen("c1", "f1");
    expect([...agentSync.unseen("c1")]).toEqual(["f2"]);
    agentSync.markSeen("c1", "f2");
    expect(agentSync.unseen("c1").size).toBe(0);
  });

  it("framesTouched: each changed element's frame, a changed frame itself, never an untouched one", () => {
    const before = [el("f1", 1, { type: "frame" }), el("f2", 1, { type: "frame" }), el("a", 1, { frameId: "f1" }), el("b", 1, { frameId: "f2" }), el("gone", 1, { frameId: "f2" })];
    const after = [el("f1", 1, { type: "frame" }), el("f2", 1, { type: "frame" }), el("a", 2, { frameId: "f1" }), el("b", 1, { frameId: "f2" }), el("gone", 2, { frameId: "f2", isDeleted: true }), el("free", 1)];
    expect(framesTouched(before as never, after as never).sort()).toEqual(["f1", "f2"]);
    expect(framesTouched(before as never, before as never)).toEqual([]);
    expect(framesTouched([el("f3", 1, { type: "frame" })] as never, [el("f3", 2, { type: "frame" })] as never)).toEqual(["f3"]);
  });
});
