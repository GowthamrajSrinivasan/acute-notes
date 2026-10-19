import { PROJECT_READ_TOOLS } from "./tools/projectTools";
import { OBJECT_READ_TOOLS } from "./tools/objectTools";
import { LENS_READ_TOOLS } from "./tools/lensTools";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { canvasDocId } from "@/sync/docIds";
import type { DocumentRecord, RichContent } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import type { CurrentContext } from "./context/currentContext";
import { RESOURCE_LIMITS } from "./resources/serializers";
import { createAcuteMcpServer, RESOURCE_NOT_FOUND, type AcuteMcpServerDeps } from "./server";

const WS = "ws_1";
const OTHER = "ws_2";
const SECRETS = ["sk-live-SECRET", "ghp_TOKENVALUE", "oauth-REFRESH", "hunter2"];

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
const el = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  version: 1,
  index: `a${String(z++).padStart(4, "0")}`,
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
});
const embed = (id: string, blockType: string, documentId: string) => el(id, "embeddable", { customData: { acute: { kind: "rich-block", blockType, documentId } } });

async function writeScene(services: PersistenceServices, canvasId: string, elements: Record<string, unknown>[]) {
  const doc = new Y.Doc();
  doc.transact(() => {
    const m = doc.getMap("elements");
    for (const e of elements) m.set(e.id as string, e);
  });
  await services.yupdates.append(canvasDocId(canvasId), Y.encodeStateAsUpdate(doc));
}

async function seed() {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_1"], createdAt: 1, updatedAt: 2 });
  await services.workspaces.put({ id: OTHER, name: "Private", canvasIds: ["cv_2"], createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_1", workspaceId: WS, title: "Payments", createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_2", workspaceId: OTHER, title: "Diary", createdAt: 1, updatedAt: 2 });

  // Credentials and settings exist on the device, and secret-looking fields sit on the data itself.
  await services.aiConnections.put({ providerId: "byok", authType: "api_key", metadata: { apiKey: SECRETS[0], endpoint: "https://x" } });
  await services.meta.set("github.token", SECRETS[1]);
  await services.aiConversations.append({ id: "conv", workspaceId: WS } as never, [{ seq: 0, text: SECRETS[3] } as never]);

  await services.documents.put(
    record("d_todo", "block", [{ id: "i1", type: "checkListItem", props: { checked: true }, content: "Ship it" }], {
      title: "Launch",
      metadata: { ai: { createdBy: "ai", task: "summarize", apiKey: SECRETS[0], refreshToken: SECRETS[2] } as never },
    }),
  );
  await services.documents.put(record("d_table", "block", [{ type: "table", content: { type: "tableContent", headerRows: 1, rows: [{ cells: ["A", "B"] }, { cells: ["1", "2"] }] } }], { title: "Grid" }));
  await services.documents.put(record("page_1", "page", [{ type: "paragraph", content: "Design notes" }], { title: "Design", canvasId: "cv_1" }));
  await services.documents.put(record("page_x", "page", [{ type: "paragraph", content: "Private diary" }], { workspaceId: OTHER, title: "Diary page" }));
  await services.documents.put(record("d_x", "block", [{ type: "checkListItem", props: { checked: false }, content: "Private todo" }], { workspaceId: OTHER }));

  await writeScene(services, "cv_1", [
    embed("todo_1", "todo", "d_todo"),
    embed("table_1", "table", "d_table"),
    el("shape_1", "rectangle", { customData: { acuteMeta: { ai: { createdBy: "mcp", token: SECRETS[1] } }, secret: SECRETS[3] } }),
    el("p_prev", "embeddable", { customData: { acute: { kind: "page-preview", pageId: "page_1" } } }),
    el("arrow_1", "arrow", { startBinding: { elementId: "todo_1" }, endBinding: { elementId: "table_1" }, customData: { acuteRelation: "depends_on" } }),
    // A todo element on this canvas pointing at another workspace's document.
    embed("todo_leak", "todo", "d_x"),
  ]);
  await writeScene(services, "cv_2", [embed("todo_x", "todo", "d_x")]);
  return services;
}

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

async function connect(services: PersistenceServices, extra: Partial<AcuteMcpServerDeps> = {}) {
  const server = createAcuteMcpServer({ services, workspaceId: WS, getCurrentContext: async () => null, ...extra });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close(), () => server.close());
  return client;
}

async function read(client: Client, uri: string) {
  const res = await client.readResource({ uri });
  expect(res.contents).toHaveLength(1);
  const content = res.contents[0]!;
  expect(content).toMatchObject({ uri, mimeType: "application/json" });
  return JSON.parse((content as { text: string }).text);
}

describe("Acute-Notes MCP server (F20)", () => {
  it("advertises read-only resources and templates, and the F21 tools", async () => {
    const client = await connect(await seed());
    const caps = client.getServerCapabilities();
    expect(caps?.resources).toBeDefined();
    expect(caps?.tools).toBeDefined(); // F21; covered in tools/tools.test.ts
    const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate).sort();
    expect(templates).toEqual(
      [
        "acute://canvas/{canvasId}",
        "acute://page/{pageId}",
        "acute://table/{objectId}",
        "acute://todo/{objectId}",
        "acute://workspace/{workspaceId}",
        // Phase 7B (plan §7.3, D49): project-scoped resources and the agent setup artifact.
        "acute://project/{projectKey}",
        "acute://project/{projectKey}/changes",
        "acute://project/{projectKey}/decisions",
        "acute://project/{projectKey}/implementation-plan",
        "acute://project/{projectKey}/open-questions",
        "acute://project/{projectKey}/progress",
        "acute://setup/instructions/{client}",
        // Lens Phase 3 (plan §7.1): a Lens root's hierarchy.
        "acute://lens/{lensKey}",
      ].sort(),
    );
  });

  it("lists only this workspace's resources", async () => {
    const client = await connect(await seed());
    const uris = (await client.listResources()).resources.map((r) => r.uri).sort();
    expect(uris).toEqual([
      "acute://canvas/cv_1",
      "acute://context/current",
      "acute://page/page_1",
      "acute://setup/instructions/claude",
      "acute://setup/instructions/codex",
      "acute://setup/instructions/cursor",
      "acute://table/table_1",
      "acute://todo/todo_1",
      "acute://workspace/ws_1",
    ]);
  });

  it("reads each resource with stable ids, typed kinds and links", async () => {
    const client = await connect(await seed());
    const ws = await read(client, "acute://workspace/ws_1");
    expect(ws).toMatchObject({ kind: "workspace", id: WS, name: "Team", canvases: [{ id: "cv_1", uri: "acute://canvas/cv_1" }], pages: [{ id: "page_1", uri: "acute://page/page_1" }] });

    const canvas = await read(client, "acute://canvas/cv_1");
    expect(canvas.kind).toBe("canvas");
    expect(canvas.objects.map((o: { id: string; kind: string }) => [o.id, o.kind])).toEqual([
      ["todo_1", "todo"],
      ["table_1", "table"],
      ["shape_1", "rectangle"],
      ["p_prev", "page"],
      ["todo_leak", "todo"],
    ]);
    expect(canvas.objects[0]).toMatchObject({ uri: "acute://todo/todo_1", provenance: { createdBy: "ai", task: "summarize" } });
    expect(canvas.objects[3]).toMatchObject({ uri: "acute://page/page_1", title: "Design" });
    expect(canvas.relations).toEqual([{ from: "todo_1", to: "table_1", arrowId: "arrow_1", type: "depends_on" }]);

    expect(await read(client, "acute://page/page_1")).toMatchObject({ kind: "page", id: "page_1", title: "Design", markdown: "Design notes\n" });
    expect(await read(client, "acute://todo/todo_1")).toMatchObject({ kind: "todo", id: "todo_1", documentId: "d_todo", canvasId: "cv_1", items: [{ id: "i1", text: "Ship it", checked: true, depth: 0 }] });
    expect(await read(client, "acute://table/table_1")).toMatchObject({ kind: "table", id: "table_1", headerRows: 1, rows: [["A", "B"], ["1", "2"]] });
  });

  it("answers 'not found' for other workspaces, unknown ids and the wrong kind", async () => {
    const client = await connect(await seed());
    for (const uri of [
      "acute://workspace/ws_2",
      "acute://canvas/cv_2",
      "acute://page/page_x",
      "acute://page/d_todo", // a block, not a page
      "acute://todo/todo_x", // on another workspace's canvas
      "acute://todo/todo_leak", // this canvas, another workspace's document
      "acute://todo/table_1", // a table, not a todo
      "acute://table/nope",
    ]) {
      await expect(client.readResource({ uri }), uri).rejects.toMatchObject({ code: RESOURCE_NOT_FOUND });
    }
  });

  it("never exposes credentials, settings, conversations, customData or other workspaces' content", async () => {
    const client = await connect(await seed());
    const listed = (await client.listResources()).resources.map((r) => r.uri);
    const payloads = await Promise.all(listed.map((uri) => client.readResource({ uri })));
    const all = JSON.stringify([listed, payloads]);
    for (const s of SECRETS) expect(all).not.toContain(s);
    expect(all).not.toMatch(/apiKey|refreshToken|customData|acuteMeta|"token"|"secret"|endpoint/);
    expect(all).not.toMatch(/Private|Diary/);
  });

  it("serves the current context only for this workspace", async () => {
    const ctx = { uri: "acute://context/current", version: 1, workspace: { id: WS, name: "Team" }, selection: [] } as unknown as CurrentContext;
    const client = await connect(await seed(), { getCurrentContext: async () => ctx });
    expect(await read(client, "acute://context/current")).toMatchObject({ workspace: { id: WS } });
    // F21: the tools a client may call, per the tool policy.
    expect((await read(client, "acute://context/current")).availableTools).toContain("create_block");
    const readOnly = await connect(await seed(), { getCurrentContext: async () => ctx, toolPolicy: { allowWrites: false } });
    // Read-only: the read tools only — including Phase 7B's reads, never a write.
    expect((await read(readOnly, "acute://context/current")).availableTools).toEqual(["search_workspace", "get_canvas", "get_page", "get_selected_content", "get_related_objects", ...PROJECT_READ_TOOLS, ...OBJECT_READ_TOOLS, ...LENS_READ_TOOLS]);

    const foreign = await connect(await seed(), { getCurrentContext: async () => ({ ...ctx, workspace: { id: OTHER, name: "Private" } }) });
    expect(await read(foreign, "acute://context/current")).toEqual({ uri: "acute://context/current", version: 1, available: false });

    const none = await connect(await seed());
    expect(await read(none, "acute://context/current")).toMatchObject({ available: false });
  });

  it("stays bounded on a large canvas", async () => {
    const services = await seed();
    const big = Array.from({ length: RESOURCE_LIMITS.objects * 3 }, (_, i) => el(`r${i}`, "rectangle"));
    const labels = big.map((r) => el(`${r.id}_l`, "text", { containerId: r.id, text: "w".repeat(3000), originalText: "w".repeat(3000) }));
    await writeScene(services, "cv_1", [...big, ...labels]);
    const client = await connect(services);
    const res = await client.readResource({ uri: "acute://canvas/cv_1" });
    const text = (res.contents[0] as { text: string }).text;
    const canvas = JSON.parse(text);
    expect(canvas.objects).toHaveLength(RESOURCE_LIMITS.objects);
    expect(canvas.truncated).toBe(true);
    expect(text.length).toBeLessThan(150_000);
  });
});
