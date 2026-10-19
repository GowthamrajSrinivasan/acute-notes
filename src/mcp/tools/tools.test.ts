import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { parseChangeSet, type ChangeSet } from "@/ai/changes/changeSet";
import { canvasDocId } from "@/sync/docIds";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichContent } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { buildCurrentContext } from "../context/currentContext";
import { createAcuteMcpServer, type AcuteMcpServerDeps } from "../server";
import { getLiveCanvasActions, LENS_READ_TOOLS, LENS_WRITE_TOOLS, OBJECT_READ_TOOLS, OBJECT_WRITE_TOOLS, PROJECT_READ_TOOLS, PROJECT_WRITE_TOOLS, READ_TOOL_NAMES, registerLiveCanvasActions, WRITE_TOOL_NAMES, type LiveCanvasActions } from ".";
import { SEARCH_LIMITS } from "./search";
import { MESSAGES, sanitizeClientName } from "./writeTools";

const WS = "ws_1";
const OTHER = "ws_2";
const SECRETS = ["sk-live-SECRET", "ghp_TOKENVALUE", "hunter2"];

const record = (id: string, kind: DocumentRecord["kind"], snapshot: RichContent, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id,
  workspaceId: WS,
  kind,
  title: id,
  snapshot,
  createdAt: 1,
  updatedAt: 2,
  ...extra,
});
let z = 0;
const el = (id: string, type: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type,
    version: 1,
    index: `a${String(z++).padStart(5, "0")}`,
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    angle: 0,
    locked: false,
    opacity: 100,
    isDeleted: false,
    groupIds: [],
    strokeColor: "#000",
    backgroundColor: "transparent",
    strokeWidth: 1,
    strokeStyle: "solid",
    ...extra,
  }) as SceneElement & { version: number; index: string };
const embed = (id: string, blockType: string, documentId: string, extra: Record<string, unknown> = {}) =>
  el(id, "embeddable", { customData: { acute: { kind: "rich-block", blockType, documentId } }, ...extra });
const label = (id: string, containerId: string, text: string) => el(id, "text", { containerId, text, originalText: text });

async function writeScene(services: PersistenceServices, canvasId: string, elements: readonly object[]) {
  const doc = new Y.Doc();
  doc.transact(() => {
    const m = doc.getMap("elements");
    for (const e of elements) m.set((e as { id: string }).id, e);
  });
  await services.yupdates.append(canvasDocId(canvasId), Y.encodeStateAsUpdate(doc));
}

const SCENE = [
  embed("todo_1", "todo", "d_todo", { x: 0, y: 0, width: 200, height: 120 }),
  embed("table_1", "table", "d_table", { x: 400, y: 0, width: 240, height: 120 }),
  el("shape_1", "rectangle", { x: 0, y: 300, width: 160, height: 80, customData: { secret: SECRETS[2] } }),
  label("shape_1_label", "shape_1", "Payment gateway"),
  el("note_1", "text", { x: 400, y: 300, text: "Retry budget notes", originalText: "Retry budget notes" }),
  el("locked_1", "rectangle", { x: 800, y: 300, locked: true }),
  el("p_prev", "embeddable", { x: 800, y: 0, customData: { acute: { kind: "page-preview", pageId: "page_1" } } }),
  el("arrow_1", "arrow", { startBinding: { elementId: "todo_1" }, endBinding: { elementId: "table_1" }, customData: { acuteRelation: "depends_on" } }),
  label("arrow_1_label", "arrow_1", "needs data"),
  el("arrow_2", "arrow", { startBinding: { elementId: "shape_1" }, endBinding: { elementId: "todo_1" }, customData: { acuteRelation: "flows_to" } }),
  el("arrow_dangling", "arrow", { startBinding: { elementId: "todo_1" }, endBinding: null }),
  embed("todo_leak", "todo", "d_x"),
];

const DOCS: DocumentRecord[] = [
  record("d_todo", "block", [{ id: "i1", type: "checkListItem", props: { checked: false }, content: "Ship the retry fix" }], {
    title: "Launch",
    metadata: { ai: { createdBy: "ai", task: "summarize", apiKey: SECRETS[0] } as never },
  }),
  record("d_table", "block", [{ type: "table", content: { type: "tableContent", headerRows: 1, rows: [{ cells: ["Step", "Owner"] }, { cells: ["Retry payment", "Ana"] }] } }], {
    title: "Plan",
  }),
  record("page_1", "page", [{ type: "paragraph", content: "Retry design notes for payments" }], { title: "Design", canvasId: "cv_1" }),
  record("page_x", "page", [{ type: "paragraph", content: "Private retry diary" }], { workspaceId: OTHER, title: "Diary" }),
  record("d_x", "block", [{ type: "checkListItem", props: { checked: false }, content: "Private retry todo" }], { workspaceId: OTHER }),
];

async function seed() {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_1"], createdAt: 1, updatedAt: 2 });
  await services.workspaces.put({ id: OTHER, name: "Private", canvasIds: ["cv_2"], createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_1", workspaceId: WS, title: "Payments", createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_2", workspaceId: OTHER, title: "Diary", createdAt: 1, updatedAt: 2 });
  await services.meta.set("github.token", SECRETS[1]);
  for (const d of DOCS) await services.documents.put(d);
  await writeScene(services, "cv_1", SCENE);
  await writeScene(services, "cv_2", [embed("todo_x", "todo", "d_x"), el("x_shape", "rectangle")]);
  return services;
}

const docsById = new Map(DOCS.map((d) => [d.id, d] as const));
function context(selectedIds: string[]) {
  return buildCurrentContext({
    workspace: { id: WS, name: "Team" },
    canvas: { id: "cv_1", title: "Payments" },
    elements: SCENE,
    selectedIds,
    viewport: null,
    openPageId: "page_1",
    getDocument: (id) => docsById.get(id),
    recentChanges: [],
  });
}

/** A fake open canvas: records proposals; one proposal puts it under review, like the real PendingChanges. */
function fakeLive(overrides: Partial<LiveCanvasActions> = {}) {
  const proposed: ChangeSet[] = [];
  let reviewing = false;
  const live: LiveCanvasActions = {
    workspaceId: WS,
    canvasId: "cv_1",
    elements: () => SCENE,
    renderContext: () => ({ existing: SCENE.map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height })), viewport: { x: 0, y: 0, width: 1200, height: 800 } }),
    isReviewing: () => reviewing,
    propose: (set) => {
      proposed.push(set);
      reviewing = true;
    },
    ...overrides,
  };
  return {
    live,
    proposed,
    settle: () => {
      reviewing = false;
    },
  };
}

const stubMarkdown = (md: string): RichContent => [{ type: "paragraph", content: md }];

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

async function connect(services: PersistenceServices, extra: Partial<AcuteMcpServerDeps> = {}, clientName = "Test Client") {
  const server = createAcuteMcpServer({ services, workspaceId: WS, getCurrentContext: async () => null, getLiveCanvas: () => null, parseMarkdown: stubMarkdown, ...extra });
  const client = new Client({ name: clientName, version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close(), () => server.close());
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

/** A successful call: summary text, the same payload as JSON text, and structured content. */
async function ok<T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await call(client, name, args);
  expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
  expect(res.content).toHaveLength(2);
  const [summary, json] = res.content as { type: string; text: string }[];
  expect(summary!.type).toBe("text");
  expect(summary!.text.length).toBeGreaterThan(0);
  expect(summary!.text.length).toBeLessThan(1_000);
  expect(JSON.parse(json!.text)).toEqual(res.structuredContent);
  return res.structuredContent as T;
}

async function fails(client: Client, name: string, args: Record<string, unknown>, message: string | RegExp) {
  const res = await call(client, name, args);
  expect(res.isError).toBe(true);
  expect(res.structuredContent).toBeUndefined();
  const text = (res.content as { text: string }[])[0]!.text;
  if (typeof message === "string") expect(text).toBe(message);
  else expect(text).toMatch(message);
}

async function readResource(client: Client, uri: string) {
  const res = await client.readResource({ uri });
  return JSON.parse((res.contents[0] as { text: string }).text);
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("MCP tool surface (F21): listing", () => {
  it("lists the read and write tools, separated by annotations", async () => {
    const client = await connect(await seed());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES, ...PROJECT_READ_TOOLS, ...PROJECT_WRITE_TOOLS, ...OBJECT_READ_TOOLS, ...OBJECT_WRITE_TOOLS, ...LENS_READ_TOOLS, ...LENS_WRITE_TOOLS].sort());
    for (const t of tools) {
      const isRead = ([...READ_TOOL_NAMES, ...PROJECT_READ_TOOLS, ...OBJECT_READ_TOOLS, ...LENS_READ_TOOLS] as readonly string[]).includes(t.name);
      expect(t.annotations, t.name).toMatchObject({ readOnlyHint: isRead, destructiveHint: t.name === "delete_object" || t.name === "delete_connection", openWorldHint: false });
      expect(t.inputSchema.type, t.name).toBe("object");
      expect(t.description, t.name).toBeTruthy();
      if (!isRead) {
        expect(t.outputSchema, t.name).toBeDefined();
        expect(t.description).toMatch(/review/);
      }
    }
    // The one destructive tool says so, and that the user confirms it.
    expect(tools.find((t) => t.name === "delete_object")!.description).toMatch(/only after the user confirms it in the review/);
  });

  it("registers the open canvas's actions and unregisters only its own", () => {
    const a = fakeLive().live;
    const b = fakeLive().live;
    const offA = registerLiveCanvasActions(a);
    expect(getLiveCanvasActions()).toBe(a);
    const offB = registerLiveCanvasActions(b);
    offA();
    expect(getLiveCanvasActions()).toBe(b);
    offB();
    expect(getLiveCanvasActions()).toBeNull();
  });
});

describe("MCP tool surface (F21): read tools", () => {
  it("search_workspace finds pages, block text, table cells, todo items and labels in this workspace only", async () => {
    const client = await connect(await seed());
    const res = await ok<{ hits: { id: string; kind: string; uri?: string; canvasId?: string; snippet?: string }[]; total: number; truncated: boolean }>(
      client,
      "search_workspace",
      { query: "retry" },
    );
    const ids = res.hits.map((h) => h.id);
    expect(ids.sort()).toEqual(["note_1", "page_1", "table_1", "todo_1"]);
    expect(res.hits.find((h) => h.id === "table_1")).toMatchObject({ kind: "table", uri: "acute://table/table_1", canvasId: "cv_1" });
    expect(res.hits.find((h) => h.id === "page_1")).toMatchObject({ kind: "page", uri: "acute://page/page_1" });
    expect(res.hits.find((h) => h.id === "todo_1")!.snippet).toMatch(/retry/i);
    expect(JSON.stringify(res)).not.toMatch(/Private|Diary|todo_leak/);

    const labelled = await ok<{ hits: { id: string; kind: string }[] }>(client, "search_workspace", { query: "PAYMENT gateway" });
    expect(labelled.hits[0]).toMatchObject({ id: "shape_1", kind: "rectangle" });
    const canvasTitle = await ok<{ hits: { id: string; kind: string }[] }>(client, "search_workspace", { query: "payments" });
    expect(canvasTitle.hits.map((h) => h.id)).toEqual(expect.arrayContaining(["cv_1", "page_1"]));
    const onlyTables = await ok<{ hits: { id: string }[] }>(client, "search_workspace", { query: "retry", kinds: ["table"] });
    expect(onlyTables.hits.map((h) => h.id)).toEqual(["table_1"]);
    expect((await ok<{ total: number }>(client, "search_workspace", { query: "retry nonexistentword" })).total).toBe(0);
  });

  it("search_workspace is deterministic and bounded", async () => {
    const services = await seed();
    const many = Array.from({ length: 300 }, (_, i) => el(`n${i}`, "text", { text: `alpha ${"x".repeat(5000)}`, originalText: `alpha ${"x".repeat(5000)}` }));
    await writeScene(services, "cv_1", many);
    const client = await connect(services);
    const a = await call(client, "search_workspace", { query: "alpha" });
    const b = await call(client, "search_workspace", { query: "alpha" });
    expect(a.structuredContent).toEqual(b.structuredContent);
    const res = a.structuredContent as { hits: { snippet: string }[]; total: number; truncated: boolean };
    expect(res.hits).toHaveLength(SEARCH_LIMITS.defaultResults);
    expect(res.total).toBe(300);
    expect(res.truncated).toBe(true);
    expect(res.hits.every((h) => h.snippet.length < 80)).toBe(true);
    const capped = await ok<{ hits: unknown[] }>(client, "search_workspace", { query: "alpha", limit: 50 });
    expect(capped.hits).toHaveLength(50);
    expect(JSON.stringify(a).length).toBeLessThan(20_000);
    await fails(client, "search_workspace", { query: "alpha", limit: 51 }, /Input validation error/);
  });

  it("get_canvas and get_page return the same payloads as their resources", async () => {
    const client = await connect(await seed(), { getCurrentContext: async () => context([]) });
    expect(await ok(client, "get_canvas", { canvasId: "cv_1" })).toEqual(await readResource(client, "acute://canvas/cv_1"));
    expect(await ok(client, "get_canvas")).toEqual(await readResource(client, "acute://canvas/cv_1")); // the open canvas
    expect(await ok(client, "get_page", { pageId: "page_1" })).toEqual(await readResource(client, "acute://page/page_1"));
    await fails(client, "get_canvas", { canvasId: "cv_2" }, "Canvas not found: cv_2");
    await fails(client, "get_page", { pageId: "page_x" }, "Page not found: page_x");
    await fails(client, "get_page", { pageId: "d_todo" }, "Page not found: d_todo");
    const none = await connect(await seed());
    await fails(none, "get_canvas", {}, /no canvas of this workspace is open/);
  });

  it("get_selected_content returns the selection and relations among it, or available: false", async () => {
    const client = await connect(await seed(), { getCurrentContext: async () => context(["todo_1", "table_1"]) });
    const res = await ok<{ available: boolean; selection: { id: string; kind: string }[]; relations: unknown[]; openPage: { id: string } }>(client, "get_selected_content");
    expect(res.available).toBe(true);
    expect(res.selection.map((o) => [o.id, o.kind])).toEqual([
      ["todo_1", "todo"],
      ["table_1", "table"],
    ]);
    expect(res.relations).toEqual([{ from: "todo_1", to: "table_1", arrowId: "arrow_1", type: "depends_on", label: "needs data" }]);
    expect(res.openPage.id).toBe("page_1");
    expect(JSON.stringify(res)).not.toMatch(/apiKey|customData|SECRET/);

    const foreign = await connect(await seed(), { getCurrentContext: async () => ({ ...context(["todo_1"]), workspace: { id: OTHER, name: "Private" } }) });
    expect(await ok(foreign, "get_selected_content")).toEqual({ available: false });
    expect(await ok(await connect(await seed()), "get_selected_content")).toEqual({ available: false });
  });

  it("get_related_objects returns arrow-connected objects with direction, relation and label", async () => {
    const client = await connect(await seed());
    const res = await ok<{ object: { id: string }; canvasId: string; related: { direction: string; relation?: string; label?: string; arrowId: string; object: { id: string; kind: string } }[]; counts: { related: number } }>(
      client,
      "get_related_objects",
      { objectId: "todo_1" },
    );
    expect(res.object.id).toBe("todo_1");
    expect(res.canvasId).toBe("cv_1");
    expect(res.related.map((r) => ({ ...r, object: r.object.id }))).toEqual([
      { direction: "outgoing", arrowId: "arrow_1", relation: "depends_on", label: "needs data", object: "table_1" },
      { direction: "incoming", arrowId: "arrow_2", relation: "flows_to", object: "shape_1" },
    ]);
    expect(res.related[1]!.object.kind).toBe("rectangle");

    const filtered = await ok<{ related: unknown[]; counts: { related: number } }>(client, "get_related_objects", { objectId: "todo_1", relation: "flows_to" });
    expect(filtered.counts.related).toBe(1);
    const limited = await ok<{ related: unknown[]; counts: { related: number }; truncated: boolean }>(client, "get_related_objects", { objectId: "todo_1", limit: 1 });
    expect(limited).toMatchObject({ related: [expect.anything()], counts: { related: 2 }, truncated: true });
    expect((await ok<{ related: unknown[] }>(client, "get_related_objects", { objectId: "note_1" })).related).toEqual([]);

    await fails(client, "get_related_objects", { objectId: "x_shape" }, "Object not found: x_shape"); // another workspace's canvas
    await fails(client, "get_related_objects", { objectId: "todo_1", canvasId: "cv_2" }, "Object not found: todo_1");
    await fails(client, "get_related_objects", { objectId: "arrow_1" }, "Object not found: arrow_1");
    await fails(client, "get_related_objects", { objectId: "todo_1", relation: "loves" }, /Input validation error/);
  });

  it("never exposes credentials, settings or customData through read tools", async () => {
    const client = await connect(await seed(), { getCurrentContext: async () => context(["todo_1", "shape_1"]) });
    const outputs = await Promise.all([
      call(client, "search_workspace", { query: "retry" }),
      call(client, "search_workspace", { query: "payment" }),
      call(client, "get_canvas", {}),
      call(client, "get_page", { pageId: "page_1" }),
      call(client, "get_selected_content", {}),
      call(client, "get_related_objects", { objectId: "todo_1" }),
    ]);
    const all = JSON.stringify(outputs);
    for (const s of SECRETS) expect(all).not.toContain(s);
    expect(all).not.toMatch(/apiKey|customData|acuteMeta|"secret"/);
  });
});

describe("MCP tool surface (F21): write tools propose, never write", () => {
  type Proposed = { status: string; operationId: string; canvasId: string; title: string; summary: string; changes: Record<string, number>; warnings: string[] };

  async function proposeWith(name: string, args: Record<string, unknown>) {
    const fake = fakeLive();
    const client = await connect(await seed(), { getLiveCanvas: () => fake.live });
    const result = await ok<Proposed>(client, name, args);
    expect(fake.proposed).toHaveLength(1);
    const set = fake.proposed[0]!;
    // A valid F19 change set, from MCP, carrying the returned operation id.
    expect(parseChangeSet(set)).toEqual(set);
    expect(set.metadata).toMatchObject({ createdBy: "mcp", task: name, operationId: result.operationId, provider: "Test Client" });
    expect(result).toMatchObject({ status: "proposed", canvasId: "cv_1", operationId: set.operationId, title: set.title });
    expect(set.title).toMatch(/^Test Client: /);
    return { result, set, fake, client };
  }

  const liveBoxes = SCENE.filter((e) => e.type !== "arrow" && !(e.type === "text" && e.containerId));

  it("create_block renders a text block through the VisualPlan path, clear of existing objects", async () => {
    const { result, set } = await proposeWith("create_block", { markdown: "Retry **three** times", title: "Retries" });
    expect(result).toMatchObject({ summary: "1 block", changes: { create_block: 1 }, warnings: [] });
    const c = set.changes[0]!;
    expect(c).toMatchObject({ kind: "create_block", blockType: "text" });
    if (c.kind !== "create_block") throw new Error("unreachable");
    expect(c.content).toEqual([{ type: "heading", props: { level: 3 }, content: "Retries" }, { type: "paragraph", content: "Retry **three** times" }]);
    for (const b of liveBoxes) expect(overlaps(c.box, b), b.id).toBe(false);
    expect(set.metadata).toMatchObject({ template: "action_plan" });
  });

  it("create_page, create_table and create_todo map to their change kinds", async () => {
    const page = await proposeWith("create_page", { title: "Runbook", markdown: "Step one" });
    expect(page.set.changes).toEqual([expect.objectContaining({ kind: "create_page", title: "Runbook", content: [{ type: "paragraph", content: "Step one" }] })]);

    const table = await proposeWith("create_table", { columns: ["Step", "Owner"], rows: [["Retry", "Ana"], ["Alert"]] });
    expect(table.result.changes).toEqual({ create_block: 1 });
    const t = table.set.changes[0]!;
    expect(t).toMatchObject({ kind: "create_block", blockType: "table" });
    if (t.kind !== "create_block") throw new Error("unreachable");
    expect(t.content).toEqual([
      // Column widths as measured (short columns get the 80 px minimum).
      { type: "table", content: { type: "tableContent", headerRows: 1, columnWidths: [80, 80], rows: [{ cells: ["Step", "Owner"] }, { cells: ["Retry", "Ana"] }, { cells: ["Alert", ""] }] } },
    ]);

    const todo = await proposeWith("create_todo", { items: [{ text: "Ship" }, { text: "Test", checked: true }], title: "Launch" });
    const d = todo.set.changes[0]!;
    expect(d).toMatchObject({ kind: "create_block", blockType: "todo" });
    if (d.kind !== "create_block") throw new Error("unreachable");
    expect(d.content.slice(1)).toEqual([
      { type: "checkListItem", props: { checked: false }, content: "Ship" },
      { type: "checkListItem", props: { checked: true }, content: "Test" },
    ]);
  });

  it("create_connection and move_object propose connect and move on existing objects", async () => {
    const conn = await proposeWith("create_connection", { from: "shape_1", to: "table_1", relation: "flows_to", label: "then" });
    expect(conn.set.changes).toEqual([{ kind: "connect", key: "connection", from: { existing: "shape_1" }, to: { existing: "table_1" }, relation: "flows_to", label: "then" }]);
    expect(conn.result.summary).toBe("1 connection");

    const move = await proposeWith("move_object", { id: "note_1", x: 1200, y: -40.5 });
    expect(move.set.changes).toEqual([{ kind: "move", target: "note_1", to: { x: 1200, y: -40.5 } }]);
    expect(move.result.changes).toEqual({ move: 1 });
  });

  it("delete_object proposes removals the user confirms in the review — never applied directly — and refuses what it can't delete", async () => {
    const del = await proposeWith("delete_object", { objectIds: ["shape_1", "arrow_1", "shape_1"] });
    expect(del.set.changes).toEqual([
      { kind: "remove", target: "shape_1" },
      { kind: "remove", target: "arrow_1" },
    ]);
    expect(del.set.title).toBe("Test Client: Delete 2 objects");
    expect(del.result).toMatchObject({ status: "proposed", changes: { remove: 2 } });

    const fake = fakeLive();
    const client = await connect(await seed(), { getLiveCanvas: () => fake.live });
    // All or nothing: one bad id refuses the whole call.
    await fails(client, "delete_object", { objectIds: ["shape_1", "nope"] }, /Nothing was proposed\. nope: not on the open canvas/);
    await fails(client, "delete_object", { objectIds: ["shape_1_label"] }, /not on the open canvas/);
    await fails(client, "delete_object", { objectIds: ["locked_1"] }, /locked by the user/);
    await fails(client, "delete_object", { objectIds: [] }, /Input validation error/);
    await fails(client, "delete_object", { objectIds: Array.from({ length: 51 }, (_, i) => `x${i}`) }, /Input validation error/);
    expect(fake.proposed).toHaveLength(0);
  });

  it("a proposal reports its layout issues (Wave 1b item 4): moving a card onto a link is flagged, a clean one has none", async () => {
    const scene = [
      el("a", "rectangle", { x: 0, y: 0, width: 100, height: 60 }),
      el("b", "rectangle", { x: 600, y: 0, width: 100, height: 60 }),
      el("c", "rectangle", { x: 300, y: 400, width: 100, height: 60 }),
      el("arr", "arrow", { x: 106, y: 30, width: 488, height: 0, points: [[0, 0], [488, 0]], startBinding: { elementId: "a" }, endBinding: { elementId: "b" } }),
    ] as unknown as SceneElement[];
    const fake = fakeLive({ elements: () => scene });
    const client = await connect(await seed(), { getLiveCanvas: () => fake.live });
    const onPath = await call(client, "move_object", { id: "c", x: 300, y: 0 });
    expect(onPath.structuredContent).toMatchObject({ layout: { issues: [{ code: "link_through_card", severity: "fatal", subject: ["arr", "c"] }], counts: { throughCards: 1 } } });
    expect((onPath.content as { text: string }[])[0]!.text).toContain("Layout: 1 link crosses a card");
    fake.settle();
    const clear = await call(client, "move_object", { id: "c", x: 300, y: 600 });
    expect(clear.structuredContent).not.toHaveProperty("layout");
  });

  it("render_visual_plan validates (with warnings) and renders a whole plan", async () => {
    const plan = {
      version: 1,
      template: "flow",
      metadata: { title: "Checkout" },
      nodes: [
        { id: "a", type: "shape", role: "step", content: { shape: "rectangle", label: "Cart" } },
        { id: "b", type: "shape", role: "step", content: { shape: "rectangle", label: "Pay" } },
        { id: "bad", type: "todo", content: { items: [] } }, // flow doesn't use todo nodes → dropped with a warning
      ],
      relationships: [
        { from: "a", to: "b", type: "flows_to" },
        { from: "a", to: "ghost", type: "flows_to" },
      ],
    };
    const { result, set } = await proposeWith("render_visual_plan", { plan });
    expect(result.changes).toEqual({ create_shape: 2, connect: 1 });
    expect(result.summary).toBe("2 objects · 1 connection");
    expect(result.warnings.length).toBe(2);
    expect(set.title).toBe("Test Client: Checkout");
    expect(set.metadata).toMatchObject({ template: "flow" });
    for (const c of set.changes) if (c.kind === "create_shape") for (const b of liveBoxes) expect(overlaps(c.box, b), b.id).toBe(false);
  });

  it("update_block proposes new content for a block or page preview, without a stableNodeKey", async () => {
    const block = await proposeWith("update_block", { objectId: "todo_1", markdown: "- [ ] Ship the retry fix\n- [ ] Tell support" });
    expect(block.set.changes).toEqual([{ kind: "update_block", target: "todo_1", content: [{ type: "paragraph", content: "- [ ] Ship the retry fix\n- [ ] Tell support" }] }]);
    expect(block.set.changes[0]).not.toHaveProperty("stableNodeKey");
    expect(block.result).toMatchObject({ summary: "1 update", changes: { update_block: 1 }, title: "Test Client: Update block" });

    const page = await proposeWith("update_block", { objectId: "p_prev", markdown: "New notes", title: "Design v2" });
    expect(page.set.changes).toEqual([{ kind: "update_block", target: "p_prev", content: [{ type: "paragraph", content: "New notes" }], title: "Design v2" }]);
    expect(page.set.title).toBe("Test Client: Update page");
  });

  it("update_block refuses other kinds, missing targets, a block title and a canvas mismatch", async () => {
    const fake = fakeLive({ elements: () => [...SCENE, embed("gone", "text", "d_gone", { isDeleted: true })] });
    const client = await connect(await seed(), { getLiveCanvas: () => fake.live });
    for (const objectId of ["shape_1", "note_1", "arrow_1", "shape_1_label", "nope", "gone"]) {
      await fails(client, "update_block", { objectId, markdown: "x" }, new RegExp(`^No block or page preview with id ${objectId} on the open canvas`));
    }
    await fails(client, "update_block", { objectId: "todo_1", markdown: "x", title: "T" }, /applies only to page previews/);
    await fails(client, "update_block", { objectId: "todo_1", markdown: "x", canvasId: "cv_2" }, /isn't the open canvas/);
    await fails(client, "update_block", { objectId: "todo_1", markdown: "  " }, /Input validation error/);
    await fails(client, "update_block", { markdown: "x" }, /Input validation error/);
    expect(fake.proposed).toHaveLength(0);
    await ok(client, "update_block", { objectId: "todo_1", markdown: "x" });
    await fails(client, "update_block", { objectId: "table_1", markdown: "y" }, MESSAGES.reviewing);
    expect(fake.proposed).toHaveLength(1);
  });

  it("names the client in the review title, sanitized, falling back to MCP", async () => {
    expect(sanitizeClientName("  Claude\u0000 Code\n\t ")).toBe("Claude Code");
    expect(sanitizeClientName("\u202Eevil\u200B")).toBe("evil");
    expect(sanitizeClientName("x".repeat(100))).toHaveLength(40);
    expect(sanitizeClientName(" \u0007 ")).toBeUndefined();
    expect(sanitizeClientName(42)).toBeUndefined();

    const named = fakeLive();
    await ok(await connect(await seed(), { getLiveCanvas: () => named.live }, "Claude Code"), "create_todo", { items: [{ text: "x" }] });
    expect(named.proposed[0]!.title).toBe("Claude Code: Add to-do list");
    expect(named.proposed[0]!.metadata.provider).toBe("Claude Code");

    const anonymous = fakeLive();
    await ok(await connect(await seed(), { getLiveCanvas: () => anonymous.live }, " \u0000 "), "create_todo", { items: [{ text: "x" }] });
    expect(anonymous.proposed[0]!.title).toBe("MCP: Add to-do list");
    expect(anonymous.proposed[0]!.metadata).not.toHaveProperty("provider");
  });

  it("refuses while another change set is under review, and never replaces it", async () => {
    const fake = fakeLive();
    const client = await connect(await seed(), { getLiveCanvas: () => fake.live });
    await ok(client, "create_block", { markdown: "First" });
    for (const [name, args] of [
      ["create_block", { markdown: "Second" }],
      ["create_connection", { from: "shape_1", to: "table_1" }],
      ["move_object", { id: "note_1", x: 1, y: 1 }],
      ["render_visual_plan", { plan: { version: 1, template: "flow", nodes: [{ id: "a", type: "shape", content: { shape: "ellipse", label: "A" } }] } }],
    ] as const) {
      await fails(client, name, args, MESSAGES.reviewing);
    }
    expect(fake.proposed).toHaveLength(1);
    fake.settle();
    await ok(client, "create_block", { markdown: "After review" });
    expect(fake.proposed).toHaveLength(2);
  });

  it("refuses when a review starts while the proposal is being rendered", async () => {
    let checks = 0;
    const fake = fakeLive({ isReviewing: () => ++checks > 1 });
    const client = await connect(await seed(), { getLiveCanvas: () => fake.live });
    await fails(client, "create_block", { markdown: "Racing" }, MESSAGES.reviewing);
    expect(fake.proposed).toHaveLength(0);
  });

  it("refuses with no canvas open, another workspace's canvas, or a canvas that isn't open", async () => {
    const none = await connect(await seed());
    await fails(none, "create_block", { markdown: "x" }, MESSAGES.noCanvas);
    const foreign = fakeLive({ workspaceId: OTHER, canvasId: "cv_2" });
    const other = await connect(await seed(), { getLiveCanvas: () => foreign.live });
    await fails(other, "create_todo", { items: [{ text: "x" }] }, MESSAGES.noCanvas);
    await fails(other, "move_object", { id: "x_shape", x: 0, y: 0 }, MESSAGES.noCanvas);
    expect(foreign.proposed).toHaveLength(0);

    const fake = fakeLive();
    const client = await connect(await seed(), { getLiveCanvas: () => fake.live });
    await fails(client, "create_block", { markdown: "x", canvasId: "cv_9" }, /isn't the open canvas/);
    expect(fake.proposed).toHaveLength(0);
    await ok(client, "create_block", { markdown: "x", canvasId: "cv_1" });
  });

  it("uses the registered live canvas by default", async () => {
    const fake = fakeLive();
    const off = registerLiveCanvasActions(fake.live);
    try {
      const services = await seed();
      const server = createAcuteMcpServer({ services, workspaceId: WS, getCurrentContext: async () => null, parseMarkdown: stubMarkdown });
      const client = new Client({ name: "test", version: "1.0.0" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(a), client.connect(b)]);
      closers.push(() => client.close(), () => server.close());
      await ok(client, "move_object", { id: "note_1", x: 5, y: 5 });
      expect(fake.proposed).toHaveLength(1);
    } finally {
      off();
    }
  });

  it("blocks every write tool when the policy disallows writes, and reads the policy per call", async () => {
    const fake = fakeLive();
    let allowWrites = false;
    const client = await connect(await seed(), { getLiveCanvas: () => fake.live, toolPolicy: () => ({ allowWrites }) });
    const calls: [string, Record<string, unknown>][] = [
      ["create_block", { markdown: "x" }],
      ["create_page", { title: "P", markdown: "x" }],
      ["create_table", { columns: ["A"], rows: [] }],
      ["create_todo", { items: [{ text: "x" }] }],
      ["create_connection", { from: "shape_1", to: "table_1" }],
      ["move_object", { id: "note_1", x: 0, y: 0 }],
      ["update_block", { objectId: "todo_1", markdown: "x" }],
      ["render_visual_plan", { plan: { version: 1, template: "flow", nodes: [{ id: "a", type: "shape", content: { shape: "ellipse", label: "A" } }] } }],
      ["delete_object", { objectIds: ["note_1"] }],
    ];
    expect(calls.map((c) => c[0]).sort()).toEqual([...WRITE_TOOL_NAMES].sort());
    // Still listed (with their annotations) while writes are off: a call explains why it can't be made.
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(expect.arrayContaining([...WRITE_TOOL_NAMES]));
    for (const [name, args] of calls) await fails(client, name, args, MESSAGES.writesDisabled);
    expect(fake.proposed).toHaveLength(0);
    // Reads still work.
    await ok(client, "search_workspace", { query: "retry" });
    allowWrites = true;
    await ok(client, "create_block", { markdown: "x" });
    expect(fake.proposed).toHaveLength(1);

    const fixed = await connect(await seed(), { getLiveCanvas: () => fakeLive().live, toolPolicy: { allowWrites: false } });
    await fails(fixed, "create_block", { markdown: "x" }, MESSAGES.writesDisabled);
  });

  it("rejects bad input and bad references without proposing anything", async () => {
    const fake = fakeLive();
    const client = await connect(await seed(), { getLiveCanvas: () => fake.live });
    const invalid: [string, Record<string, unknown>][] = [
      ["create_block", {}],
      ["create_block", { markdown: "   " }],
      ["create_block", { markdown: "x".repeat(20_001) }],
      ["create_page", { title: "", markdown: "x" }],
      ["create_table", { columns: [], rows: [] }],
      ["create_todo", { items: [] }],
      ["create_todo", { items: [{ text: "x", checked: "yes" }] }],
      ["create_connection", { from: "shape_1", to: "table_1", relation: "loves" }],
      ["move_object", { id: "note_1", x: "left", y: 0 }],
      ["move_object", { id: "note_1", x: 1e9, y: 0 }],
      ["render_visual_plan", { plan: { version: 2, template: "flow", nodes: [] } }],
      ["render_visual_plan", { plan: { version: 1, template: "mind_palace", nodes: [{ id: "a" }] } }],
    ];
    for (const [name, args] of invalid) await fails(client, name, args, /Input validation error/);

    await fails(client, "create_connection", { from: "shape_1", to: "nope" }, "Object not found on the open canvas: nope");
    await fails(client, "create_connection", { from: "shape_1", to: "shape_1" }, "An object can't be connected to itself.");
    await fails(client, "create_connection", { from: "shape_1", to: "arrow_1" }, "Object not found on the open canvas: arrow_1");
    await fails(client, "create_connection", { from: "shape_1", to: "shape_1_label" }, "Object not found on the open canvas: shape_1_label");
    await fails(client, "move_object", { id: "locked_1", x: 0, y: 0 }, /locked/);
    await fails(client, "create_table", { columns: ["A"], rows: [["1", "2"]] }, /rows\.0 has 2 cells but there are only 1 columns/);
    await fails(
      client,
      "render_visual_plan",
      { plan: { version: 1, template: "flow", nodes: [{ id: "a", type: "todo", content: { items: [] } }] } },
      /The visual plan can't be rendered: .*no usable nodes/,
    );
    expect(fake.proposed).toHaveLength(0);
  });
});
