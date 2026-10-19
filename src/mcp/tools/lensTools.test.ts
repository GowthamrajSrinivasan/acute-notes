/**
 * Lens Phase 3's MCP tools (plan §7.1) as scripted MCP clients over `InMemoryTransport`, like `repoMap.test.ts` and
 * `projectTools.test.ts`: `get_lens` (tree, roots, around, paths, paging with a version-tied cursor — G2),
 * `get_canvas` paging, `trace_lens_path`, `focus_lens` (a stub tab host) and `link_lens_detail` through the real
 * change-set writer, Accept, the agent log and a revert; `acute://lens/{lensKey}`. No AI, no browser.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Excalidraw can't load under node; the writer only needs these (as in projectTools.test.ts).
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER", IMMEDIATELY: "IMMEDIATELY" },
  newElementWith: (el: { version?: number }, patch: object) => ({ ...el, ...patch, version: (el.version ?? 1) + 1 }),
  restoreElements: (els: unknown[]) => els,
  convertToExcalidrawElements: (skeletons: unknown[]) => skeletons,
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as Y from "yjs";
import { changeRecord, diffScenes } from "@/ai/changes/agentState";
import { PendingChanges, sessionSlot } from "@/ai/changes/pendingChanges";
import { changeSetCanvas } from "@/components/canvas/changeSetWriter";
import type { SceneElement } from "@/domain/canvas/adapter";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { canvasDocId } from "@/sync/docIds";
import { createAcuteMcpServer } from "../server";
import type { LiveCanvasActions } from ".";
import type { LensFocusHost, LensFocusRequest } from "./lensFocus";
import { MESSAGES } from "./writeTools";

const WS = "ws_1";
type El = Record<string, unknown> & { id: string; type: string; isDeleted?: boolean; version?: number };

const base = { angle: 0, opacity: 100, groupIds: [], isDeleted: false, locked: false, strokeColor: "#000", backgroundColor: "transparent", strokeWidth: 1, strokeStyle: "solid", version: 1, x: 0, y: 0, width: 160, height: 80 };
const frame = (id: string, name: string, diagram: Record<string, unknown> = {}): El => ({ ...base, id, type: "frame", name, width: 900, height: 400, customData: { acuteDiagram: { type: "architecture", interactive: true, ...diagram } } });
const node = (id: string, label: string, frameId: string, x: number, data: Record<string, unknown> = {}): El[] => [
  { ...base, id, type: "rectangle", frameId, x, customData: { acuteNode: { kind: "backend", key: id }, ...data } },
  { ...base, id: `${id}_t`, type: "text", text: label, originalText: label, containerId: id, frameId },
];
const arrow = (id: string, from: string, to: string, relation: string): El => ({ ...base, id, type: "arrow", startBinding: { elementId: from }, endBinding: { elementId: to }, customData: { acuteRelation: relation } });

/**
 * The open canvas "Architecture": L1 "Shop" (Checkout calls Payments, Payments writes Ledger, the Ledger's code
 * stamped by a repo map) and, linked from Payments, L2 "Payments detail" (Webhook flows to Handler, Webhook with an
 * implementation and a test source); plus an unlinked "Billing" frame (a second root).
 */
const ARCH: El[] = [
  frame("shop", "Shop"),
  ...node("checkout", "Checkout", "shop", 0),
  ...node("payments", "Payments", "shop", 300, { acuteNode: { kind: "backend", key: "payments", expandsTo: { frameKey: "pay-detail" } } }),
  ...node("ledger", "Ledger", "shop", 600, { acuteMeta: { ai: { createdBy: "mcp", sourceRefs: [{ provider: "repo", externalId: "src/ledger.ts#L3-9@abc1234" }] } } }),
  arrow("a1", "checkout", "payments", "calls"),
  arrow("a2", "payments", "ledger", "writes"),
  { ...frame("pd", "Payments detail", { lensKey: "pay-detail" }), x: 1200 },
  ...node("webhook", "Webhook", "pd", 1200, {
    acuteNode: { kind: "backend", key: "webhook", sources: [{ path: "src/webhook.ts" }, { path: "tests/webhook.test.ts", role: "test" }] },
  }),
  ...node("handler", "Handler", "pd", 1500),
  arrow("a3", "webhook", "handler", "flows_to"),
  { ...frame("billing", "Billing"), y: 800 },
  ...node("invoice", "Invoice", "billing", 0),
];
/** A persisted canvas "Ops": Monitor drills into "Payments detail" across canvases. */
const OPS: El[] = [
  frame("ops", "Ops"),
  ...node("monitor", "Monitor", "ops", 0, { acuteNode: { kind: "backend", key: "monitor", expandsTo: { frameKey: "pay-detail", canvasId: "cv_arch" } } }),
  ...node("pager", "Pager", "ops", 300),
  ...node("alerts", "Alerts", "ops", 600),
  arrow("a4", "pager", "monitor", "depends_on"),
  arrow("a5", "alerts", "pager", "calls"),
];

async function writeScene(services: PersistenceServices, canvasId: string, elements: readonly object[]) {
  const doc = new Y.Doc();
  // On top of what is stored, as another tab's edit would be: a write concurrent with the stored one would be settled
  // by Yjs's client-id order, so a changed element would keep its old version about half the time.
  for (const update of (await services.yupdates.load(canvasDocId(canvasId))).updates) Y.applyUpdate(doc, update);
  doc.transact(() => {
    const m = doc.getMap("elements");
    for (const e of elements) m.set((e as { id: string }).id, e);
  });
  await services.yupdates.append(canvasDocId(canvasId), Y.encodeStateAsUpdate(doc));
}

class OpenCanvas {
  readonly canvasId = "cv_arch";
  scene: El[] = ARCH.map((e) => ({ ...e }));
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
    renderContext: () => ({ existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } }),
    isReviewing: (session) => this.pending.inSlot(this.canvasId, sessionSlot(session)) !== null,
    propose: (set) => void this.pending.propose(this.canvasId, set),
  };
  async accept() {
    const set = this.pending.get(this.canvasId);
    if (!set) throw new Error("nothing to accept");
    const before = this.scene;
    changeSetCanvas(this.api as never, { workspaceId: WS, canvasId: this.canvasId }).write(set, set.changes);
    this.pending.settle(this.canvasId, set.operationId);
    const record = changeRecord({ id: `chg_${set.operationId}`, workspaceId: WS, canvasId: this.canvasId, set, at: Date.now(), outcome: "accepted", diff: diffScenes(before as never, this.scene as never), result: "applied" });
    await this.services.agentState.putChange(record);
    return record;
  }
  el(id: string) {
    return this.scene.find((e) => e.id === id)!;
  }
}

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

async function setup(options: { allowWrites?: boolean; host?: LensFocusHost | null } = {}) {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_arch", "cv_ops"], createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_arch", workspaceId: WS, title: "Architecture", createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_ops", workspaceId: WS, title: "Ops", createdAt: 1, updatedAt: 2 });
  await writeScene(services, "cv_ops", OPS);
  const canvas = new OpenCanvas(services);
  const server = createAcuteMcpServer({
    services,
    workspaceId: WS,
    getCurrentContext: async () => null,
    getLiveCanvas: () => canvas.live,
    getLensFocus: () => (options.host === undefined ? null : options.host),
    agentState: services.agentState,
    toolPolicy: { allowWrites: options.allowWrites ?? true },
    parseMarkdown: (md) => [{ type: "paragraph", content: md }],
  });
  const client = new Client({ name: "Claude Code", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close(), () => server.close());
  const call = async (tool: string, args: Record<string, unknown> = {}) => (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
  const ok = async <T = Record<string, unknown>>(tool: string, args: Record<string, unknown> = {}): Promise<T> => {
    const res = await call(tool, args);
    expect(res.isError, `${tool}: ${(res.content as { text: string }[])[0]?.text}`).toBeFalsy();
    return res.structuredContent as T;
  };
  const fails = async (tool: string, args: Record<string, unknown>, message: RegExp) => {
    const res = await call(tool, args);
    expect(res.isError, tool).toBe(true);
    expect((res.content as { text: string }[])[0]!.text).toMatch(message);
  };
  return { services, canvas, client, call, ok, fails };
}

interface LensPayload {
  kind: string;
  version: string;
  mode?: string;
  roots?: { key: string; canvasId: string }[];
  frames?: { key: string; level: number; levelName: string; parent?: string; canvasId: string }[];
  nodes: { key: string; label: string; frame: string; level: number; child?: { frame: string; canvasId: string }; source?: true; evidence?: Record<string, { path: string; origin: string }[]> }[];
  edges: { frame: string; from: string; to: string; relation?: string }[];
  page: { offset: number; limit: number; nextCursor?: string };
  counts: { frames: number; nodes: number; edges: number };
}

describe("get_lens (plan §7.1)", () => {
  it("lists the workspace's Lens roots when there's more than one, and a root's whole tree", async () => {
    const t = await setup();
    const roots = await t.ok<LensPayload>("get_lens");
    expect(roots.kind).toBe("lens-roots");
    expect(roots.roots!.map((r) => r.key).sort()).toEqual(["billing", "ops", "shop"]);

    const lens = await t.ok<LensPayload>("get_lens", { root: "shop" });
    expect(lens.mode).toBe("tree");
    expect(lens.frames!.map((f) => [f.key, f.level, f.levelName, f.parent])).toEqual([
      ["shop", 1, "L1 Architecture", undefined],
      ["pay-detail", 2, "L2 Component", "payments"],
    ]);
    expect(lens.nodes.map((n) => n.key)).toEqual(["checkout", "payments", "ledger", "webhook", "handler"]);
    const by = (k: string) => lens.nodes.find((n) => n.key === k)!;
    expect(by("payments").child).toEqual({ frame: "pay-detail", canvasId: "cv_arch", via: "expandsTo" });
    // Evidence by role (D48): the user's sources, and a repo map's code location (Phase 2's sourceRefs).
    expect(by("webhook").evidence).toEqual({ implementation: [{ path: "src/webhook.ts", origin: "user" }], test: [{ path: "tests/webhook.test.ts", origin: "user" }] });
    expect(by("ledger")).toMatchObject({ source: true, evidence: { implementation: [{ path: "src/ledger.ts", lines: [3, 9], commit: "abc1234", origin: "mcp" }] } });
    expect(lens.edges.map((e) => `${e.from} ${e.relation} ${e.to}`)).toEqual(["checkout calls payments", "payments writes ledger", "webhook flows_to handler"]);
    // A canvas title works as a root when it has one Lens root; a node as a root centres on it.
    expect((await t.ok<LensPayload>("get_lens", { root: "Ops" })).nodes.map((n) => n.key)).toEqual(["monitor", "pager", "alerts", "webhook", "handler"]);
    expect((await t.ok<LensPayload>("get_lens", { root: "handler" })).mode).toBe("around");
  });

  it("centres on a node with `around`: the levels above, its own, and its own detail below", async () => {
    const t = await setup();
    const handler = await t.ok<LensPayload & { around: { key: string; level: number } }>("get_lens", { around: "Handler" });
    expect(handler.around).toMatchObject({ key: "handler", level: 2 });
    expect(handler.frames!.map((f) => f.key)).toEqual(["shop", "pay-detail"]);
    expect((await t.ok<LensPayload>("get_lens", { around: "handler", up: 0 })).frames!.map((f) => f.key)).toEqual(["pay-detail"]);
    // Below a node: only its own child level, `down` deep.
    expect((await t.ok<LensPayload>("get_lens", { around: "payments", up: 0 })).frames!.map((f) => f.key)).toEqual(["shop", "pay-detail"]);
    expect((await t.ok<LensPayload>("get_lens", { around: "payments", up: 0, down: 0 })).frames!.map((f) => f.key)).toEqual(["shop"]);
    expect((await t.ok<LensPayload>("get_lens", { around: "checkout", up: 0 })).frames!.map((f) => f.key)).toEqual(["shop"]);
    await t.fails("get_lens", { around: "nothing-like-it" }, /No node "nothing-like-it"/);
    await t.fails("get_lens", { root: "shop", around: "handler" }, /not both/);
  });

  it("answers \"which nodes cite this file?\" with `paths`", async () => {
    const t = await setup();
    const ledger = await t.ok<LensPayload>("get_lens", { root: "shop", paths: ["src/ledger.ts"] });
    expect(ledger.nodes.map((n) => n.key)).toEqual(["ledger"]);
    expect(ledger.frames!.map((f) => f.key)).toEqual(["shop"]);
    expect((await t.ok<LensPayload>("get_lens", { root: "shop", paths: ["webhook.test.ts"] })).nodes.map((n) => n.key)).toEqual(["webhook"]);
    expect(await t.ok("get_lens", { root: "shop", paths: ["src/none.ts"] })).toMatchObject({ nodes: [], note: expect.stringMatching(/No node/) });
  });

  it("pages overview first, with a cursor tied to the scene version (G2)", async () => {
    const t = await setup();
    const p1 = await t.ok<LensPayload>("get_lens", { root: "shop", limit: 2 });
    expect(p1.frames).toHaveLength(2); // the overview: every level's outline
    expect(p1.nodes.map((n) => n.key)).toEqual(["checkout", "payments"]);
    expect(p1.counts).toEqual({ frames: 2, nodes: 5, edges: 3 });
    const p2 = await t.ok<LensPayload>("get_lens", { root: "shop", limit: 2, cursor: p1.page.nextCursor });
    expect(p2.frames).toBeUndefined();
    expect(p2.nodes.map((n) => n.key)).toEqual(["ledger", "webhook"]);
    const p3 = await t.ok<LensPayload>("get_lens", { root: "shop", limit: 2, cursor: p2.page.nextCursor });
    expect(p3.nodes.map((n) => n.key)).toEqual(["handler"]);
    expect(p3.page.nextCursor).toBeUndefined();
    // Each edge once, on the page holding its later end.
    expect([p1, p2, p3].map((p) => p.edges.length)).toEqual([1, 1, 1]);
    expect(p1.version).toBe(p3.version);

    // Another query can't continue this one; and after an edit, the cursor is refused rather than mixing versions.
    await t.fails("get_lens", { root: "shop", limit: 3, cursor: p1.page.nextCursor }, /different query/);
    t.canvas.scene = t.canvas.scene.map((e) => (e.id === "handler_t" ? { ...e, text: "Handler v2", originalText: "Handler v2", version: 2 } : e));
    await t.fails("get_lens", { root: "shop", limit: 2, cursor: p2.page.nextCursor }, /changed since the first page/);
  });

  it("serves acute://lens/{lensKey} with the same payload", async () => {
    const t = await setup();
    const res = await t.client.readResource({ uri: "acute://lens/shop" });
    const payload = JSON.parse((res.contents[0] as { text: string }).text) as LensPayload;
    expect(payload).toEqual(await t.ok("get_lens", { root: "shop" }));
    const listed = (await t.client.listResources()).resources.map((r) => r.uri);
    expect(listed).toEqual(expect.arrayContaining(["acute://lens/shop", "acute://lens/billing", "acute://lens/ops"]));
    await expect(t.client.readResource({ uri: "acute://lens/nothing" })).rejects.toThrow(/No frame, node or canvas/);
  });
});

describe("get_canvas paging (G2)", () => {
  it("pages objects with a version-tied cursor; relations once, on the page of their later end", async () => {
    const t = await setup();
    type Page = { objects: { id: string }[]; relations: { arrowId: string }[]; counts: { objects: number }; page: { offset: number; nextCursor?: string; version: string } };
    const first = await t.ok<Page>("get_canvas", { canvasId: "cv_ops" });
    expect(first.page.nextCursor).toBeUndefined(); // a small canvas: one page, as before
    const all = first.objects.map((o) => o.id);
    const p1 = await t.ok<Page>("get_canvas", { canvasId: "cv_ops", limit: 2 });
    const p2 = await t.ok<Page>("get_canvas", { canvasId: "cv_ops", limit: 2, cursor: p1.page.nextCursor });
    expect(all).toHaveLength(4);
    expect([...p1.objects, ...p2.objects].map((o) => o.id)).toEqual(all);
    expect(p2.page).toMatchObject({ offset: 2 });
    expect(p2.page.nextCursor).toBeUndefined();
    expect([...p1.relations, ...p2.relations].map((r) => r.arrowId).sort()).toEqual(first.relations.map((r) => r.arrowId).sort());
    expect(first.relations).toHaveLength(2);

    // The canvas changes (persisted from another tab): the old cursor is refused.
    await writeScene(t.services, "cv_ops", [{ ...OPS.find((e) => e.id === "pager_t"), text: "Pager v2", version: 2 }]);
    await t.fails("get_canvas", { canvasId: "cv_ops", limit: 2, cursor: p1.page.nextCursor }, /changed since the first page/);
    await t.fails("get_canvas", { canvasId: "cv_ops", cursor: "garbage" }, /isn't from this tool/);
  });
});

describe("trace_lens_path (plan §4)", () => {
  it("names every hop across levels and canvases", async () => {
    const t = await setup();
    const path = await t.ok<{ found: boolean; directed: boolean; stops: { label: string; canvasId: string }[]; hops: { text: string }[] }>("trace_lens_path", { from: "Checkout", to: "handler" });
    expect(path.found).toBe(true);
    expect(path.hops.map((h) => h.text)).toEqual(["Checkout calls Payments", "Payments contains Handler (zoom in, L1 → L2)"]);
    const across = await t.ok<typeof path>("trace_lens_path", { from: "alerts", to: "ledger" });
    expect(across.stops.map((s) => `${s.canvasId}:${s.label}`)).toEqual(["cv_ops:Alerts", "cv_ops:Pager", "cv_ops:Monitor", "cv_arch:Webhook", "cv_arch:Payments", "cv_arch:Ledger"]);
    expect(across.directed).toBe(true);
  });

  it("reports no path for a kind that can't connect them, and refuses ambiguous ends", async () => {
    const t = await setup();
    const none = await t.call("trace_lens_path", { from: "checkout", to: "ledger", kind: "data" });
    expect(none.isError).toBeFalsy();
    expect(none.structuredContent).toMatchObject({ found: false, kind: "data" });
    expect((none.content as { text: string }[])[0]!.text).toMatch(/Try kind "any"/);
    await t.fails("trace_lens_path", { from: "e", to: "ledger" }, /from: "e" names \d+ nodes; use one's key\. Candidates:/);
  });
});

describe("focus_lens (tab-only, D41)", () => {
  it("degrades without a tab", async () => {
    const t = await setup({ host: null });
    expect(await t.ok("focus_lens", { key: "handler" })).toEqual({ focused: false, reason: "no_tab" });
  });

  it("opens Lens at a node's level from the top, selects it and highlights keys — even with writes off", async () => {
    const requests: LensFocusRequest[] = [];
    const host: LensFocusHost = { workspaceId: WS, canvasId: "cv_arch", focus: (r) => void requests.push(r) };
    const t = await setup({ host, allowWrites: false });
    const out = await t.ok("focus_lens", { key: "Handler", highlight: ["webhook", "handler", "nope"] });
    expect(requests.at(-1)).toEqual({ root: { canvasId: "cv_arch", frameId: "shop" }, path: ["payments"], nodeKey: "handler", highlight: ["webhook", "handler"] });
    expect(out).toMatchObject({ focused: true, level: 2, frame: "pay-detail", node: "handler", unresolved: ["nope"] });

    // `level` zooms out to an ancestor (selecting the node drilled through), or into a node's own detail.
    await t.ok("focus_lens", { key: "handler", level: 1 });
    expect(requests.at(-1)).toMatchObject({ path: [], nodeKey: "payments" });
    await t.ok("focus_lens", { key: "payments", level: 2 });
    expect(requests.at(-1)).toMatchObject({ path: ["payments"], nodeKey: null });
    // A frame on another canvas: opened from its own root there.
    await t.ok("focus_lens", { key: "ops" });
    expect(requests.at(-1)).toMatchObject({ root: { canvasId: "cv_ops", frameId: "ops" }, path: [], nodeKey: null });
    // Nothing in the workspace changed.
    expect(t.canvas.pending.get("cv_arch")).toBeNull();
  });
});

describe("link_lens_detail (D43's set_lens)", () => {
  it("is refused with writes off", async () => {
    const t = await setup({ allowWrites: false });
    await t.fails("link_lens_detail", { links: [{ node: "checkout", frame: "billing" }] }, new RegExp(MESSAGES.writesDisabled.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("proposes drill links and levels for review; Accept writes them; Lens reads them; a revert undoes them", async () => {
    const t = await setup();
    const proposed = await t.ok<{ status: string; changes: Record<string, number>; warnings: string[] }>("link_lens_detail", {
      links: [{ node: "checkout", frame: "billing" }],
      levels: [{ frame: "billing", level: 3 }],
      reason: "Checkout's detail is the billing flow",
    });
    expect(proposed).toMatchObject({ status: "proposed", changes: { set_lens: 2 } });
    // Nothing changed before Accept (D6).
    expect((t.canvas.el("checkout").customData as { acuteNode: { expandsTo?: unknown } }).acuteNode.expandsTo).toBeUndefined();
    const record = await t.canvas.accept();
    expect(record.reason).toBe("Checkout's detail is the billing flow");
    const lens = await t.ok<LensPayload>("get_lens", { root: "shop" });
    expect(lens.nodes.find((n) => n.key === "checkout")!.child).toMatchObject({ frame: "billing" });
    expect(lens.frames!.find((f) => f.key === "billing")).toMatchObject({ level: 3, parent: "checkout" });

    // A link to a frame on another canvas carries its canvas; clearing removes it.
    await t.ok("link_lens_detail", { links: [{ node: "invoice", frame: "ops" }] });
    await t.canvas.accept();
    expect((t.canvas.el("invoice").customData as { acuteNode: { expandsTo: unknown } }).acuteNode.expandsTo).toEqual({ frameKey: "ops", canvasId: "cv_ops" });
    await t.ok("link_lens_detail", { links: [{ node: "invoice", frame: null }] });
    await t.canvas.accept();
    expect((t.canvas.el("invoice").customData as { acuteNode: { expandsTo?: unknown } }).acuteNode.expandsTo).toBeUndefined();

    // The first change reverts like any other (its inverse is a scene diff, D30).
    await t.ok("revert_agent_changes", { changeIds: [record.id], reason: "Wrong frame" });
    await t.canvas.accept();
    expect((t.canvas.el("checkout").customData as { acuteNode: { expandsTo?: unknown } }).acuteNode.expandsTo).toBeUndefined();
    expect((t.canvas.el("billing").customData as { acuteDiagram: { level?: number } }).acuteDiagram.level).toBeUndefined();
  });

  it("refuses what it can't link, and skips what's already so", async () => {
    const t = await setup();
    await t.fails("link_lens_detail", {}, /Nothing to change/);
    await t.fails("link_lens_detail", { links: [{ node: "monitor", frame: "billing" }] }, /on another canvas/);
    await t.fails("link_lens_detail", { links: [{ node: "shop", frame: "billing" }] }, /a frame, not a node/);
    await t.fails("link_lens_detail", { links: [{ node: "checkout", frame: "ledger" }] }, /a node, not a frame/);
    await t.fails("link_lens_detail", { links: [{ node: "checkout", frame: "shop" }] }, /its own frame/);
    await t.fails("link_lens_detail", { levels: [{ frame: "ops", level: 2 }] }, /on another canvas/);
    await t.fails("link_lens_detail", { links: [{ node: "payments", frame: "pay-detail" }] }, /Nothing to change.*already zooms into/);
    // A link that makes a loop is allowed (Lens stops at it), with a warning.
    const loop = await t.ok<{ warnings: string[] }>("link_lens_detail", { links: [{ node: "handler", frame: "shop" }] });
    expect(loop.warnings.join(" ")).toMatch(/drill loop/);
  });
});
