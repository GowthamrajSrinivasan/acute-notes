/**
 * Phase 7B, the MCP-first vertical slice (plan §10.2, MC1–MC11) as scripted MCP clients over `InMemoryTransport`:
 * a real change-set writer on an in-memory scene (Excalidraw stubbed under node), a real pending store with D40's
 * slots, and the change log written at each Accept, as the app does. No AI, no browser.
 */
import { describe, expect, it, vi, afterEach } from "vitest";

// Excalidraw can't load under node. A skeleton's `label` becomes a bound text element, as the real conversion does.
vi.mock("@excalidraw/excalidraw", () => {
  let n = 0;
  const base = { angle: 0, opacity: 100, groupIds: [], frameId: null, isDeleted: false, locked: false, strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeWidth: 1, strokeStyle: "solid", version: 1, versionNonce: 1 };
  return {
    CaptureUpdateAction: { NEVER: "NEVER", IMMEDIATELY: "IMMEDIATELY" },
    newElementWith: (el: { version?: number }, patch: object) => ({ ...el, ...patch, version: (el.version ?? 1) + 1 }),
    restoreElements: (els: unknown[]) => els,
    convertToExcalidrawElements: (skeletons: Record<string, unknown>[]) =>
      skeletons.flatMap((s) => {
        const { label, ...rest } = s as { label?: { text: string }; id?: string };
        const id = (rest.id as string) ?? `gen${n++}`;
        const shape = { ...base, ...rest, id, boundElements: label ? [{ id: `${id}_label`, type: "text" }] : null };
        if (!label) return [shape];
        return [shape, { ...base, id: `${id}_label`, type: "text", text: label.text, originalText: label.text, containerId: id, x: 0, y: 0, width: 50, height: 20 }];
      }),
  };
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as Y from "yjs";
import { changeRecord, diffScenes } from "@/ai/changes/agentState";
import { PendingChanges, sessionSlot } from "@/ai/changes/pendingChanges";
import { withDecisions } from "@/ai/reconcile/conflicts";
import { changeSetCanvas } from "@/components/canvas/changeSetWriter";
import type { SceneElement } from "@/domain/canvas/adapter";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { canvasDocId } from "@/sync/docIds";
import { createAcuteMcpServer } from "../server";
import type { LiveCanvasActions } from ".";
import { MESSAGES } from "./writeTools";

const WS = "ws_1";
type El = Record<string, unknown> & { id: string; type: string; isDeleted?: boolean; version?: number };

const base = { angle: 0, opacity: 100, groupIds: [], isDeleted: false, locked: false, strokeColor: "#000", backgroundColor: "transparent", strokeWidth: 1, strokeStyle: "solid", version: 1, x: 0, y: 0, width: 160, height: 80 };
/** The architecture canvas (persisted, not open): L1 "Payments" with a Webhook and a Ledger, the Webhook keyed. */
const ARCH: El[] = [
  { ...base, id: "fa", type: "frame", name: "Payments", width: 900, height: 400, customData: { acuteDiagram: { type: "architecture", interactive: true } } },
  { ...base, id: "hook", type: "rectangle", frameId: "fa", customData: { acuteNode: { kind: "backend", key: "pay.webhook", sources: [{ path: "src/webhook.ts" }] } } },
  { ...base, id: "hook_t", type: "text", text: "Webhook", originalText: "Webhook", containerId: "hook", frameId: "fa" },
  { ...base, id: "ledger", type: "rectangle", frameId: "fa", x: 300, customData: { acuteNode: { kind: "database", key: "pay.ledger" } } },
  { ...base, id: "ledger_t", type: "text", text: "Ledger", originalText: "Ledger", containerId: "ledger", frameId: "fa" },
];

async function writeScene(services: PersistenceServices, canvasId: string, elements: readonly object[]) {
  const doc = new Y.Doc();
  doc.transact(() => {
    const m = doc.getMap("elements");
    for (const e of elements) m.set((e as { id: string }).id, e);
  });
  await services.yupdates.append(canvasDocId(canvasId), Y.encodeStateAsUpdate(doc));
}

/** The open canvas: an in-memory scene, D40's pending store, and Accept as the review bar does it (logging included). */
class OpenCanvas {
  readonly canvasId = "cv_state";
  scene: El[] = [];
  readonly pending = new PendingChanges();
  constructor(readonly services: PersistenceServices) {}
  readonly api = {
    getSceneElementsIncludingDeleted: () => this.scene,
    getSceneElements: () => this.scene.filter((e) => !e.isDeleted),
    updateScene: (u: { elements?: El[] }) => {
      if (u.elements) this.scene = u.elements;
    },
    getAppState: () => ({ scrollX: 0, scrollY: 0, width: 1200, height: 800, zoom: { value: 1 } }),
  };
  readonly live: LiveCanvasActions = {
    workspaceId: WS,
    canvasId: this.canvasId,
    elements: () => this.api.getSceneElements() as unknown as SceneElement[],
    renderContext: () => ({ existing: this.api.getSceneElements().map((e) => ({ x: Number(e.x), y: Number(e.y), width: Number(e.width), height: Number(e.height) })), viewport: { x: 0, y: 0, width: 1200, height: 800 } }),
    isReviewing: (session) => this.pending.inSlot(this.canvasId, sessionSlot(session)) !== null,
    propose: (set) => void this.pending.propose(this.canvasId, set),
  };

  /** Accept the selected set (with conflict decisions), as the user does; writes its change record. */
  async accept(decisions: ReadonlyMap<string, "apply" | "keep"> = new Map()) {
    const set = this.pending.get(this.canvasId);
    if (!set) throw new Error("nothing to accept");
    const effective = withDecisions(set, decisions);
    const before = this.scene;
    changeSetCanvas(this.api as never, { workspaceId: WS, canvasId: this.canvasId }).write(effective, effective.changes);
    this.pending.settle(this.canvasId, set.operationId);
    const record = changeRecord({ id: `chg_${set.operationId}`, workspaceId: WS, canvasId: this.canvasId, set, at: Date.now(), outcome: "accepted", diff: diffScenes(before as never, this.scene as never), result: "applied" });
    await this.services.agentState.putChange(record);
    for (const id of record.reverts ?? []) {
      const original = await this.services.agentState.getChange(id);
      if (original) await this.services.agentState.putChange({ ...original, revertedBy: record.id });
    }
    if (set.session) {
      const s = await this.services.agentState.getSession(set.session);
      await this.services.agentState.putSession({ ...(s ?? { id: set.session, workspaceId: WS, startedAt: Date.now(), changeIds: [] }), changeIds: [...(s?.changeIds ?? []), record.id], lastWriteAt: Date.now() });
    }
    return record;
  }

  node(label: string): El | undefined {
    const t = this.scene.find((e) => e.type === "text" && e.text === label && !e.isDeleted);
    return t && this.scene.find((e) => e.id === t.containerId);
  }
}

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

async function setup() {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_arch", "cv_state"], createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_arch", workspaceId: WS, title: "Architecture", createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_state", workspaceId: WS, title: "Project state", createdAt: 1, updatedAt: 2 });
  await writeScene(services, "cv_arch", ARCH);
  return { services, canvas: new OpenCanvas(services) };
}

async function agent(services: PersistenceServices, canvas: OpenCanvas, name: string, extra: { allowWrites?: boolean } = {}) {
  const server = createAcuteMcpServer({
    services,
    workspaceId: WS,
    getCurrentContext: async () => null,
    getLiveCanvas: () => canvas.live,
    agentState: services.agentState,
    toolPolicy: { allowWrites: extra.allowWrites ?? true },
    parseMarkdown: (md) => [{ type: "paragraph", content: md }],
  });
  const client = new Client({ name, version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close(), () => server.close());
  const call = async (tool: string, args: Record<string, unknown> = {}) => (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
  const ok = async <T = Record<string, unknown>>(tool: string, args: Record<string, unknown> = {}): Promise<T> => {
    const res = await call(tool, args);
    expect(res.isError, `${tool}: ${(res.content as { text: string }[])[0]?.text}`).toBeFalsy();
    return res.structuredContent as T;
  };
  return { client, call, ok };
}

describe("the MCP-first vertical slice (plan §10.2)", () => {
  it("MC1–MC10: bootstrap → decide → negotiate → progress → sync → a second session sees the warning → history → revert", async () => {
    const { services, canvas } = await setup();
    // MC1: an agent connects over the existing server; no pairing step beyond the token (the transport stands in).
    const claude = await agent(services, canvas, "Claude Code");

    // Before any project: the bootstrap says so instead of inventing one.
    const empty = await claude.ok<{ project: { missing: string } }>("get_session_context", {});
    expect(empty.project.missing).toMatch(/no project yet/);

    // The user asked for a project: create it from the service template (structure only).
    const created = await claude.ok<{ status: string; keys: string[] }>("create_project", { name: "Acme API", style: "service", focus: "Auth", reason: "The user asked to set up the project" });
    expect(created.status).toBe("proposed");
    await canvas.accept();
    const projectKey = created.keys[0]!;
    expect(await claude.ok("get_project", {})).toMatchObject({ project: { key: projectKey, label: "Acme API", style: "service", focus: "Auth" } });

    // MC5 (part): a milestone with two items.
    await claude.ok("update_progress", { milestones: [{ label: "Auth", order: 1 }], add: [{ label: "Login flow", milestone: "Auth", order: 1 }, { label: "Token rotation", milestone: "Auth", order: 2 }], reason: "The plan the user described" });
    await canvas.accept();

    // MC2: bootstrap with no task falls back (no open-tab focus here) and still returns the project and its items.
    const boot = await claude.ok<{ retrieval_mode: string; degraded_reason?: string; project: { key: string }; chars: number; budget: number }>("get_session_context", {});
    expect(boot).toMatchObject({ retrieval_mode: "none", project: { key: projectKey } });
    expect(boot.chars).toBeLessThanOrEqual(boot.budget);

    // MC3: a decision with two options and no choice is proposed, accepted, and read back as proposed.
    const decided = await claude.ok<{ keys: string[] }>("record_decision", {
      statement: "Dedup store for webhooks",
      reason: "Duplicate deliveries double-charge",
      options: [{ label: "Redis", tradeoffs: "fast, another service" }, { label: "Postgres", tradeoffs: "already there" }],
      refs: ["pay.webhook"],
    });
    expect(canvas.pending.get("cv_state")?.agent).toBe("Claude Code");
    await canvas.accept();
    const decisionKey = decided.keys[0]!;
    const before = await claude.ok<{ decisions: { key: string; status: string; chosen?: string }[] }>("get_decisions", {});
    expect(before.decisions.find((d) => d.key === decisionKey)).toMatchObject({ status: "proposed" });

    // MC4: the user chooses an option in the panel (a canvas command: the node's own fields change) and adds a preference.
    const decision = canvas.node("Dedup store for webhooks")!;
    canvas.scene = canvas.scene.map((e) =>
      e.id === decision.id ? { ...e, version: (e.version ?? 1) + 1, customData: { ...(e.customData as object), acuteNode: { ...((e.customData as { acuteNode: object }).acuteNode), chosen: "Postgres", status: "accepted" } } } : e,
    );
    await claude.ok("annotate", { target: decisionKey, text: "Prefer what we already run", intent: "preference", reason: "The user's comment" });
    await canvas.accept();
    const after = await claude.ok<{ decisions: { key: string; status: string; chosen?: string; rejected?: string[]; annotations: { label: string; intent?: string }[] }[] }>("get_decisions", {});
    expect(after.decisions.find((d) => d.key === decisionKey)).toMatchObject({ status: "accepted", chosen: "Postgres", rejected: ["Redis"], annotations: [{ label: "Prefer what we already run", intent: "preference" }] });

    // MC5: one item done, the next marked up next; the plan reads it back in order.
    const plan0 = await claude.ok<{ milestones: { items: { key: string; label: string }[] }[] }>("get_implementation_plan", {});
    const [login, rotation] = plan0.milestones[0]!.items;
    await claude.ok("update_progress", { items: [{ key: login!.key, status: "done" }, { key: rotation!.key, status: "in_progress", next: true }], reason: "Login shipped" });
    await canvas.accept();
    expect(await claude.ok("get_implementation_plan", {})).toMatchObject({ milestones: [{ label: "Auth", items: [{ label: "Login flow", status: "done" }, { label: "Token rotation", status: "in_progress", next: true }] }] });

    // MC6: one sync_session call: a constraint and a progress change become one proposal; summary and next are stored.
    const synced = await claude.ok<{ status: string; stored: boolean; keys: string[] }>("sync_session", {
      summary: "Login shipped; dedup store chosen",
      changed: [{ path: "src/auth/login.ts", what: "new login flow" }],
      decisions: [{ statement: "Never retry card_declined", kind: "constraint", reason: "Fraud rules", refs: ["pay.webhook"] }],
      progress: [{ key: rotation!.key, status: "in_progress" }],
      next: ["Wire Postgres dedup into the webhook"],
    });
    expect(synced).toMatchObject({ status: "proposed", stored: true });
    const syncRecord = await canvas.accept();
    const constraintKey = synced.keys[0]!;

    // MC7: what the Project view reads is the canvas itself: the constraint and the progress are there now.
    expect(canvas.node("Never retry card_declined")).toBeDefined();

    // MC10: a second, independent session sees the decision and the warning on the same node, and where the last one left off.
    const codex = await agent(services, canvas, "Codex");
    const ctx = await codex.ok<{ retrieval_mode: string; warnings: { items: { key: string; statement: string; reason?: string }[] }; decisions: { items: { key: string }[] }; project: { lastNext?: string[] } }>("get_session_context", { keys: ["pay.webhook"] });
    expect(ctx.retrieval_mode).toBe("keys");
    expect(ctx.warnings.items).toEqual([expect.objectContaining({ key: constraintKey, statement: "Never retry card_declined", reason: "Fraud rules" })]);
    expect(ctx.decisions.items.map((d) => d.key)).toEqual(expect.arrayContaining([decisionKey, constraintKey]));
    expect(ctx.project.lastNext).toEqual(["Wire Postgres dedup into the webhook"]);
    const about = await codex.ok<{ warnings: { key: string }[] }>("get_decisions", { about: "pay.webhook" });
    expect(about.warnings.map((w) => w.key)).toEqual([constraintKey]);
    const impact = await codex.ok<{ modified: { ref: string }[]; warnings: { key: string }[] }>("get_lens_impact", { changedPaths: ["src/webhook.ts"] });
    expect(impact.modified.map((m) => m.ref)).toEqual(["pay.webhook"]);
    expect(impact.warnings.map((w) => w.key)).toEqual([constraintKey]);

    // MC8: the history lists the sessions' changes with agent, time and reason.
    const recent = await codex.ok<{ changes: { id: string; agent?: string; reason?: string; at: number }[] }>("get_recent_changes", {});
    expect(recent.changes[0]).toMatchObject({ id: syncRecord.id, agent: "Claude Code", reason: "Login shipped; dedup store chosen" });
    const history = await codex.ok<{ sessions: { summary?: string; next?: string[] }[] }>("get_session_history", {});
    expect(history.sessions.some((s) => s.summary === "Login shipped; dedup store chosen")).toBe(true);
    const review = await codex.ok<{ during: { kind: string; label: string }[] }>("get_session_review", { changeIds: [syncRecord.id] });
    expect(review.during).toEqual([expect.objectContaining({ kind: "constraint", label: "Never retry card_declined" })]);

    // MC9: revert the sync: the constraint goes, the item's change is undone; accepting marks the record reverted.
    await codex.ok("revert_agent_changes", { changeIds: [syncRecord.id], reason: "The user wants the constraint discussed first" });
    await canvas.accept();
    expect(canvas.node("Never retry card_declined")).toBeUndefined();
    expect((await services.agentState.getChange(syncRecord.id))?.revertedBy).toBeTruthy();
    const ctx2 = await codex.ok<{ warnings: { items: unknown[] } }>("get_session_context", { keys: ["pay.webhook"] });
    expect(ctx2.warnings.items).toEqual([]);
  });

  it("D40: a session's next write waits for its previous proposal; another session's proposal on the same object is refused", async () => {
    const { services, canvas } = await setup();
    const a = await agent(services, canvas, "Claude Code");
    await a.ok("create_project", { name: "Acme", style: "modular", reason: "asked" });
    await canvas.accept();
    await a.ok("log_finding", { kind: "risk", statement: "Webhook has no rate limit", reason: "Seen in the code", severity: "high", refs: ["pay.webhook"] });
    const again = await a.call("log_finding", { kind: "finding", statement: "x", reason: "y" });
    expect(again.isError).toBe(true);
    expect((again.content as { text: string }[])[0]!.text).toBe(MESSAGES.reviewing);
    // Read-back (I3): the risk appears once accepted.
    await canvas.accept();
    expect(await a.ok("get_open_questions", { include: ["risk"] })).toMatchObject({ items: [{ kind: "risk", label: "Webhook has no rate limit", severity: "high", refs: ["pay.webhook"] }] });
  });

  it("refuses to write where the project doesn't live, and to guess between projects (D39)", async () => {
    const { services, canvas } = await setup();
    const a = await agent(services, canvas, "Codex");
    const none = await a.call("record_decision", { statement: "x", reason: "y" });
    expect((none.content as { text: string }[])[0]!.text).toMatch(/no project yet/);
    await a.ok("create_project", { name: "One", style: "modular", reason: "asked" });
    await canvas.accept();
    await a.ok("create_project", { name: "Two", style: "feature", reason: "asked" });
    await canvas.accept();
    const several = await a.call("record_decision", { statement: "x", reason: "y" });
    expect((several.content as { text: string }[])[0]!.text).toMatch(/2 projects .*pass `project`/);
  });

  it("writes off: project writes are refused, reads work, and the setup artifact is the read-only variant", async () => {
    const { services, canvas } = await setup();
    const a = await agent(services, canvas, "Codex", { allowWrites: false });
    const refused = await a.call("create_project", { name: "X", style: "modular", reason: "asked" });
    expect((refused.content as { text: string }[])[0]!.text).toBe(MESSAGES.writesDisabled);
    expect((await a.call("sync_session", { summary: "s" })).isError).toBe(true);
    expect((await a.call("list_projects")).isError).toBeFalsy();
    const setupRead = await a.client.readResource({ uri: "acute://setup/instructions/codex" });
    const artifact = JSON.parse((setupRead.contents[0] as { text: string }).text) as { content: string; generatedFrom: { writesAllowed: boolean } };
    expect(artifact.generatedFrom.writesAllowed).toBe(false);
    expect(artifact.content).toContain("### Read-only workspace");
    expect(artifact.content).not.toContain("`record_decision`");
  });
});

describe("MC11 over the server: the setup artifact names only what this server serves", () => {
  it("for each client, every backticked tool or prompt in it is registered, and (a)–(f) hold", async () => {
    const { services, canvas } = await setup();
    const a = await agent(services, canvas, "Claude Code");
    const tools = new Set((await a.client.listTools()).tools.map((t) => t.name));
    const prompts = new Set((await a.client.listPrompts()).prompts.map((p) => p.name));
    for (const client of ["claude", "codex", "cursor"]) {
      const res = await a.client.readResource({ uri: `acute://setup/instructions/${client}` });
      const artifact = JSON.parse((res.contents[0] as { text: string }).text) as { content: string; targetPath: string };
      for (const [, name] of artifact.content.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
        if (name === "retrieval_mode") continue;
        expect(tools.has(name!) || prompts.has(name!), `${client}: ${name}`).toBe(true);
      }
      for (const heading of ["### What it is", "### When to use it", "### Start of a session", "### What to record", "### End of a session", "### When Acute and the code disagree", "### Never fabricate project state"]) {
        expect(artifact.content, `${client}: ${heading}`).toContain(heading);
      }
    }
    const prompt = await a.client.getPrompt({ name: "setup_project_instructions", arguments: { client: "cursor" } });
    expect((prompt.messages[0]!.content as { text: string }).text).toContain(".cursor/rules/acute-notes.mdc");
  });
});

describe("Phase 7C: core object tools on the change-set path (D50, D62)", () => {
  /** Two shapes joined by a labelled `depends_on` arrow, on the open canvas. */
  function seedObjects(canvas: OpenCanvas) {
    canvas.scene = [
      { ...base, id: "s1", type: "rectangle", x: 0, y: 0, boundElements: [{ id: "s1_t", type: "text" }, { id: "ar", type: "arrow" }] },
      { ...base, id: "s1_t", type: "text", text: "API", originalText: "API", containerId: "s1" },
      { ...base, id: "s2", type: "rectangle", x: 400, y: 0, boundElements: [{ id: "s2_t", type: "text" }, { id: "ar", type: "arrow" }] },
      { ...base, id: "s2_t", type: "text", text: "DB", originalText: "DB", containerId: "s2" },
      { ...base, id: "ar", type: "arrow", x: 160, y: 40, points: [[0, 0], [240, 0]], startBinding: { elementId: "s1" }, endBinding: { elementId: "s2" }, boundElements: [{ id: "ar_t", type: "text" }], customData: { acuteRelation: "depends_on" } },
      { ...base, id: "ar_t", type: "text", text: "reads", originalText: "reads", containerId: "ar" },
    ];
  }
  const byId = (canvas: OpenCanvas, id: string) => canvas.scene.find((e) => e.id === id)!;

  it("delete_object → Accept → the agent log → revert_agent_changes → Accept restores the object with its id and its arrow; never auto-accepted", async () => {
    const { services, canvas } = await setup();
    seedObjects(canvas);
    const a = await agent(services, canvas, "Codex");
    expect(await a.ok("delete_object", { objectIds: ["s2"] })).toMatchObject({ status: "proposed" });
    const record = await canvas.accept();
    expect(byId(canvas, "s2").isDeleted).toBe(true);
    expect(byId(canvas, "s2_t").isDeleted).toBe(true);
    expect((await a.ok<{ changes: { id: string; revertible: boolean }[] }>("get_recent_changes")).changes[0]).toMatchObject({ id: record.id, revertible: true });
    await a.ok("revert_agent_changes", { changeIds: [record.id], reason: "Deleted by mistake" });
    await canvas.accept();
    expect(byId(canvas, "s2")).toMatchObject({ id: "s2", isDeleted: false, boundElements: [{ id: "s2_t", type: "text" }, { id: "ar", type: "arrow" }] });
    expect(byId(canvas, "s2_t").isDeleted).toBe(false);
    expect(byId(canvas, "ar")).toMatchObject({ isDeleted: false, endBinding: { elementId: "s2" } });
  });

  it("update_connection changes the relation (and its line style), the label and the explanation; get_block reads it back; a revert undoes it", async () => {
    const { services, canvas } = await setup();
    seedObjects(canvas);
    const a = await agent(services, canvas, "Codex");
    await a.ok("update_connection", { connectionId: "ar", relation: "blocks", label: "waits on", explanation: "Migration order" });
    const record = await canvas.accept();
    expect(byId(canvas, "ar").customData).toMatchObject({ acuteRelation: "blocks", acuteEdge: { explanation: "Migration order" } });
    expect(byId(canvas, "ar_t")).toMatchObject({ text: "waits on", originalText: "waits on" });
    const block = await a.ok<{ outgoing: { arrowId: string; type?: string; label?: string; explanation?: string }[] }>("get_block", { id: "s1" });
    expect(block.outgoing).toEqual([{ arrowId: "ar", type: "blocks", label: "waits on", explanation: "Migration order", to: "s2" }]);
    // Clearing the label removes its text element.
    await a.ok("update_connection", { connectionId: "ar", label: null });
    await canvas.accept();
    expect(byId(canvas, "ar_t").isDeleted).toBe(true);
    await a.ok("revert_agent_changes", { changeIds: [record.id], reason: "Wrong relation" });
    const plan = canvas.pending.get("cv_state")!;
    // The label was changed again since: that comes back as a conflict, never overwritten (D30).
    expect(plan.conflicts?.map((c) => c.target)).toEqual(["ar_t"]);
  });

  it("delete_connection removes an arrow and its label, and refuses what isn't a connection", async () => {
    const { services, canvas } = await setup();
    seedObjects(canvas);
    const a = await agent(services, canvas, "Codex");
    expect((await a.call("delete_connection", { connectionIds: ["s1"] })).isError).toBe(true);
    await a.ok("delete_connection", { connectionIds: ["ar"] });
    await canvas.accept();
    expect(byId(canvas, "ar").isDeleted).toBe(true);
    expect(byId(canvas, "ar_t").isDeleted).toBe(true);
    expect(byId(canvas, "s1").isDeleted).toBe(false);
  });

  it("group_blocks frames existing objects with their labels; list_blocks shows the section; a revert takes the frame away", async () => {
    const { services, canvas } = await setup();
    seedObjects(canvas);
    const a = await agent(services, canvas, "Codex");
    await a.ok("group_blocks", { objectIds: ["s1", "s2"], title: "Storage" });
    const record = await canvas.accept();
    const frame = canvas.scene.find((e) => e.type === "frame" && e.name === "Storage")!;
    expect(frame).toBeDefined();
    for (const id of ["s1", "s1_t", "s2", "s2_t"]) expect(byId(canvas, id).frameId, id).toBe(frame.id);
    const listed = await a.ok<{ blocks: { id: string; kind: string; section?: string; title?: string }[] }>("list_blocks", {});
    expect(listed.blocks.find((b) => b.id === "s1")).toMatchObject({ kind: "rectangle", section: frame.id, title: "API" });
    expect(listed.blocks.find((b) => b.id === frame.id)).toMatchObject({ kind: "frame", title: "Storage" });
    // Frames can't nest: a grouped object can't join another section.
    expect((await a.call("group_blocks", { objectIds: ["s1"], title: "Again" })).isError).toBe(true);
    await a.ok("revert_agent_changes", { changeIds: [record.id], reason: "Not a real grouping" });
    await canvas.accept();
    expect(byId(canvas, frame.id).isDeleted).toBe(true);
    for (const id of ["s1", "s2"]) expect(byId(canvas, id).frameId ?? null, id).toBeNull();
  });

  it("writes off: the object writes are refused; the reads still work", async () => {
    const { services, canvas } = await setup();
    seedObjects(canvas);
    const a = await agent(services, canvas, "Codex", { allowWrites: false });
    for (const [tool, args] of [["update_connection", { connectionId: "ar", label: "x" }], ["delete_connection", { connectionIds: ["ar"] }], ["group_blocks", { objectIds: ["s1"], title: "t" }]] as const) {
      const res = await a.call(tool, args);
      expect((res.content as { text: string }[])[0]!.text, tool).toBe(MESSAGES.writesDisabled);
    }
    expect(await a.ok("get_block", { id: "s2" })).toMatchObject({ id: "s2", title: "DB" });
  });
});
