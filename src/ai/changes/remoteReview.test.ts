/**
 * Remote MCP sessions can never bypass proposal review: not through the session auto-accept, not through the
 * repo-map auto-accept, and not through the tools — even when the user has switched auto-accept on elsewhere.
 */
import { describe, expect, it } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { createAcuteMcpServer } from "@/mcp/server";
import { sessionAutoAccept } from "./autoAccept";
import { PendingChanges } from "./pendingChanges";
import { MAX_AGE_MS, PENDING_KEY, restorePendingProposals } from "./pendingPersistence";
import type { ChangeSet } from "./changeSet";

describe("auto-accept and remote sessions", () => {
  it("ignores every attempt to turn auto-accept on for a remote session, while local sessions still can", () => {
    sessionAutoAccept.markRemote("remote-1");
    sessionAutoAccept.enableSession("canvas-1", "remote-1");
    sessionAutoAccept.enable("map-1", "remote-1", "canvas-1");
    expect(sessionAutoAccept.isRemote("remote-1")).toBe(true);
    expect(sessionAutoAccept.isSessionOn("canvas-1", "remote-1")).toBe(false);
    expect(sessionAutoAccept.isOn("map-1", "remote-1")).toBe(false);
    expect(sessionAutoAccept.sessionsOnCanvas("canvas-1")).toEqual([]);

    sessionAutoAccept.enableSession("canvas-1", "local-1");
    expect(sessionAutoAccept.isSessionOn("canvas-1", "local-1")).toBe(true);
    sessionAutoAccept.disableSession("canvas-1", "local-1");
  });

  it("a session switched on before it was known to be remote is switched off by marking it", () => {
    sessionAutoAccept.enableSession("canvas-2", "late-1");
    expect(sessionAutoAccept.isSessionOn("canvas-2", "late-1")).toBe(true);
    sessionAutoAccept.markRemote("late-1");
    expect(sessionAutoAccept.isSessionOn("canvas-2", "late-1")).toBe(false);
    sessionAutoAccept.disableSession("canvas-2", "late-1");
  });

  it("createAcuteMcpServer marks a remote connection's session and withholds the repo-map tools", async () => {
    const services = createMemoryServices();
    const remote = createAcuteMcpServer({ services, workspaceId: "ws_1", sessionId: "remote-2", remote: true, repoMap: { services: { store: services.repoMaps, contentSources: services.contentSources } } });
    const local = createAcuteMcpServer({ services, workspaceId: "ws_1", sessionId: "local-2", repoMap: { services: { store: services.repoMaps, contentSources: services.contentSources } } });
    expect(sessionAutoAccept.isRemote("remote-2")).toBe(true);
    expect(sessionAutoAccept.isRemote("local-2")).toBe(false);
    const tools = (s: typeof remote) => Object.keys((s as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
    expect(tools(remote)).not.toContain("begin_repo_map");
    expect(tools(local)).toContain("begin_repo_map");
  });
});

const block = (key: string) => ({ kind: "create_block", key, blockType: "text", content: [{ type: "paragraph", content: key }], box: { x: 0, y: 0, width: 100, height: 50 } });
const proposal = (operationId: string, createdBy: "mcp" | "ai" = "mcp", session = "remote-1") => ({ operationId, title: `Proposal ${operationId}`, metadata: { createdBy }, session, changes: [block(operationId)] });

/** A minimal in-memory `meta` store. */
function meta(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: async <T>(k: string) => data.get(k) as T | undefined,
    set: async (k: string, v: unknown) => void data.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k: string) => void data.delete(k),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const saved = (store: ReturnType<typeof meta>) => (store.data.get(PENDING_KEY) as { canvasId: string; set: ChangeSet; savedAt: number }[] | undefined) ?? [];

describe("proposals survive a reload", () => {
  it("mirrors MCP proposals (only) into the local store, and puts them back under review after a 'reload'", async () => {
    const store = meta();
    const before = new PendingChanges();
    await restorePendingProposals(store, before);
    before.propose("canvas-1", proposal("op_mcp", "mcp", "remote-1"));
    before.propose("canvas-2", proposal("op_ai", "ai", "app")); // the app's own AI preview stays memory-only
    await settle();
    expect(saved(store).map((i) => [i.canvasId, i.set.operationId])).toEqual([["canvas-1", "op_mcp"]]);

    // "Reload": a fresh store of pending changes, same local database.
    const after = new PendingChanges();
    expect(await restorePendingProposals(store, after)).toBe(1);
    expect(after.list("canvas-1").map((s) => s.operationId)).toEqual(["op_mcp"]);
    expect(after.list("canvas-2")).toEqual([]);
    expect(after.get("canvas-1")?.session).toBe("remote-1");
    expect(await restorePendingProposals(store, after)).toBe(0); // once per instance
  });

  it("a restored proposal still waits for the user: accepting or rejecting it clears it from storage", async () => {
    const store = meta();
    const first = new PendingChanges();
    await restorePendingProposals(store, first);
    first.propose("cv", proposal("op_r"));
    await settle();

    const second = new PendingChanges();
    await restorePendingProposals(store, second);
    expect(second.list("cv")).toHaveLength(1);
    second.settle("cv", "op_r"); // the user's decision
    await settle();
    expect(store.data.has(PENDING_KEY)).toBe(false);
    const third = new PendingChanges();
    expect(await restorePendingProposals(store, third)).toBe(0);
  });

  it("keeps the original timestamp across reloads, so the age limit counts from when it was proposed", async () => {
    const store = meta();
    let now = 1_000;
    const a = new PendingChanges();
    await restorePendingProposals(store, a, () => now);
    a.propose("cv", proposal("op_t"));
    await settle();
    now += 5000;
    const b = new PendingChanges();
    await restorePendingProposals(store, b, () => now);
    await settle();
    expect(saved(store)[0]?.savedAt).toBe(1_000);
  });

  it("drops proposals older than the age limit and anything that no longer validates", async () => {
    const now = 10 * MAX_AGE_MS;
    const store = meta({
      [PENDING_KEY]: [
        { canvasId: "c1", set: proposal("op_old"), savedAt: now - MAX_AGE_MS - 1 },
        { canvasId: "c2", set: { nonsense: true }, savedAt: now },
        { canvasId: "c3", set: proposal("op_g3"), savedAt: now - 1000 },
      ],
    });
    const pending = new PendingChanges();
    expect(await restorePendingProposals(store, pending, () => now)).toBe(1);
    expect(pending.list("c3").map((s) => s.operationId)).toEqual(["op_g3"]);
    expect(pending.list("c1")).toEqual([]);
    expect(pending.list("c2")).toEqual([]);
    await settle();
    expect(saved(store)).toHaveLength(1); // the discarded ones are gone from storage
  });

  it("restores a proposal that conflicts with one already under review by dropping it, not forcing it in", async () => {
    const store = meta({ [PENDING_KEY]: [{ canvasId: "cv", set: { operationId: "op_x", title: "x", metadata: { createdBy: "mcp" }, session: "remote-2", changes: [{ kind: "move", target: "shared", to: { x: 1, y: 1 } }] }, savedAt: Date.now() }] });
    const pending = new PendingChanges();
    pending.propose("cv", { operationId: "op_live", title: "live", metadata: { createdBy: "mcp" }, session: "remote-3", changes: [{ kind: "move", target: "shared", to: { x: 2, y: 2 } }] });
    expect(await restorePendingProposals(store, pending)).toBe(0);
    expect(pending.list("cv").map((s) => s.operationId)).toEqual(["op_live"]);
  });
});
