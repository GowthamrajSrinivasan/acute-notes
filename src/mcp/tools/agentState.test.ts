/**
 * Agent State over MCP (Lens Phase 7A): every write is attributed (E3: agent, session, tool, time — AFFiNE #15467
 * shipped empty metadata on MCP writes), each MCP session stages in its own slot (D40), tool calls are counted per
 * session (D46), and auto-accept writes only what D44 allows. Scripted clients over `InMemoryTransport`, no AI.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { changeRecord } from "@/ai/changes/agentState";
import { sessionAutoAccept } from "@/ai/changes/autoAccept";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { PendingChanges, sessionSlot } from "@/ai/changes/pendingChanges";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { RichContent } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { createAcuteMcpServer } from "../server";
import { WRITE_TOOL_NAMES, type LiveCanvasActions, type ToolCallUsage } from ".";

const WS = "ws_1";
const el = (id: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ id, type, version: 1, x: 0, y: 0, width: 100, height: 60, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#000", backgroundColor: "transparent", strokeWidth: 1, strokeStyle: "solid", ...extra }) as SceneElement;
const SCENE = [
  el("s1", "rectangle", { x: 0, y: 300 }),
  el("s2", "rectangle", { x: 400, y: 300 }),
  el("b1", "embeddable", { x: 800, y: 0, customData: { acute: { kind: "rich-block", blockType: "text", documentId: "d1" } } }),
];

/** The open canvas over a real pending store (D40's slots), with an Accept that just settles the set. */
function liveCanvas(pending: PendingChanges) {
  const accepted: string[] = [];
  const live: LiveCanvasActions = {
    workspaceId: WS,
    canvasId: "cv_1",
    elements: () => SCENE,
    renderContext: () => ({ existing: SCENE.map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height })), viewport: { x: 0, y: 0, width: 1200, height: 800 } }),
    isReviewing: (session) => pending.inSlot("cv_1", sessionSlot(session)) !== null,
    propose: (set) => void pending.propose("cv_1", set),
    acceptSet: (operationId) => {
      accepted.push(operationId);
      pending.settle("cv_1", operationId);
      return true;
    },
  };
  return { live, accepted };
}

const stubMarkdown = (md: string): RichContent => [{ type: "paragraph", content: md }];
let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

async function connect(live: LiveCanvasActions, clientName: string, extra: { onToolCall?: (c: ToolCallUsage) => void } = {}) {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_1"], createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_1", workspaceId: WS, title: "Payments", createdAt: 1, updatedAt: 2 });
  const server = createAcuteMcpServer({ services, workspaceId: WS, getCurrentContext: async () => null, getLiveCanvas: () => live, parseMarkdown: stubMarkdown, ...extra });
  const client = new Client({ name: clientName, version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close(), () => server.close());
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  return (await client.callTool({ name, arguments: args })) as CallToolResult;
}
const text = (res: CallToolResult) => (res.content as { text: string }[])[0]!.text;

const ARGS: Record<(typeof WRITE_TOOL_NAMES)[number], Record<string, unknown>> = {
  create_block: { markdown: "Retry budget" },
  create_page: { title: "Design", markdown: "Notes" },
  create_table: { columns: ["Step"], rows: [["Retry"]] },
  create_todo: { items: [{ text: "Ship" }] },
  create_connection: { from: "s1", to: "s2", relation: "depends_on" },
  move_object: { id: "s1", x: 10, y: 10 },
  update_block: { objectId: "b1", markdown: "New text" },
  render_visual_plan: { plan: { version: 1, template: "flow", nodes: [{ id: "a", type: "text", content: { markdown: "Step" } }] } },
  delete_object: { objectIds: ["s2"] },
};

describe("every MCP write is attributed (E3, D32, D46)", () => {
  it("each write tool's proposal carries the client's name, this connection's session, the tool and its args; the record keeps them", async () => {
    const pending = new PendingChanges();
    const { live } = liveCanvas(pending);
    const client = await connect(live, "Codex");
    const sessions = new Set<string>();
    for (const tool of WRITE_TOOL_NAMES) {
      const res = await call(client, tool, ARGS[tool]);
      expect(res.isError, `${tool}: ${text(res)}`).toBeFalsy();
      const set = pending.get("cv_1")!;
      expect(set.agent, tool).toBe("Codex");
      expect(set.session, tool).toMatch(/^mcp_/);
      expect(set.metadata.task, tool).toBe(tool);
      expect(set.args, tool).toBeTruthy();
      expect(set.args!.length, tool).toBeLessThanOrEqual(2048);
      sessions.add(set.session!);
      const record = changeRecord({ id: "chg", workspaceId: WS, canvasId: "cv_1", set, at: 123, outcome: "rejected" });
      expect(record, tool).toMatchObject({ agent: "Codex", session: set.session, tool, at: 123 });
      pending.settle("cv_1", set.operationId);
    }
    // One connection, one session.
    expect(sessions.size).toBe(1);
  });

  it("a client that doesn't name itself is recorded without an agent, never with an empty one", async () => {
    const pending = new PendingChanges();
    const client = await connect(liveCanvas(pending).live, "\u0000 ​");
    await call(client, "create_block", ARGS.create_block);
    expect(pending.get("cv_1")!.agent).toBeUndefined();
    expect(pending.get("cv_1")!.session).toMatch(/^mcp_/);
  });
});

describe("two MCP sessions on one canvas (D40)", () => {
  it("each stages its own set; one that changes the same object as the other's is refused, naming it", async () => {
    const pending = new PendingChanges();
    const { live } = liveCanvas(pending);
    const claude = await connect(live, "Claude Code");
    const codex = await connect(live, "Codex");
    expect((await call(claude, "move_object", { id: "s1", x: 5, y: 5 })).isError).toBeFalsy();
    expect((await call(codex, "create_block", { markdown: "Beside it" })).isError).toBeFalsy();
    expect(pending.list("cv_1").map((s) => s.agent)).toEqual(["Claude Code", "Codex"]);
    expect(new Set(pending.list("cv_1").map((s) => s.session)).size).toBe(2);

    // Codex's set is waiting, so its own next proposal waits for the user…
    expect(text(await call(codex, "create_block", { markdown: "Again" }))).toMatch(/this session's previous proposal/);
    // …and Claude Code can't move what it is already moving, nor can Codex once its slot is free.
    pending.settle("cv_1", pending.list("cv_1")[1]!.operationId);
    const refused = await call(codex, "move_object", { id: "s1", x: 9, y: 9 });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/“Claude Code: Move object” is under review/);
  });
});

describe("tool-call usage per session (D46)", () => {
  it("every call is reported with its session, the client's name, the tool and the characters returned", async () => {
    const calls: ToolCallUsage[] = [];
    const pending = new PendingChanges();
    const client = await connect(liveCanvas(pending).live, "Codex", { onToolCall: (c) => calls.push(c) });
    await call(client, "search_workspace", { query: "retry" });
    await call(client, "create_block", ARGS.create_block);
    expect(calls.map((c) => c.tool)).toEqual(["search_workspace", "create_block"]);
    expect(new Set(calls.map((c) => c.session)).size).toBe(1);
    expect(calls.every((c) => c.agent === "Codex" && c.chars > 0)).toBe(true);
  });
});

describe("auto-accept for a session (D44)", () => {
  it("writes an eligible tool's set at once only while the user has it on, and never a removal", async () => {
    const pending = new PendingChanges();
    const { live, accepted } = liveCanvas(pending);
    const services = createMemoryServices();
    await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_1"], createdAt: 1, updatedAt: 2 });
    // The eligible tools are Phase 7B's Project writes; here two ordinary tools stand in for them.
    const { registerWriteTools } = await import("./writeTools");
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "t", version: "1" });
    registerWriteTools(server, { workspaceId: WS, liveCanvas: () => live, policy: () => ({ allowWrites: true }), parseMarkdown: stubMarkdown, clientName: () => "Codex", sessionId: () => "mcp_auto", autoAcceptTools: new Set(["create_block", "delete_object"]) });
    const client = new Client({ name: "Codex", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    closers.push(() => client.close(), () => server.close());

    // Off: proposed for review, as always.
    const off = await call(client, "create_block", ARGS.create_block);
    expect((off.structuredContent as { status: string }).status).toBe("proposed");
    pending.settle("cv_1", pending.get("cv_1")!.operationId);

    sessionAutoAccept.enableSession("cv_1", "mcp_auto");
    try {
      const on = await call(client, "create_block", ARGS.create_block);
      expect((on.structuredContent as { status: string }).status).toBe("applied");
      expect(text(on)).toMatch(/auto-accept/);
      expect(accepted).toHaveLength(1);
      expect(sessionAutoAccept.sessionsOnCanvas("cv_1")).toEqual([{ session: "mcp_auto", accepted: 1 }]);
      // A removal always waits for review, even for a listed tool in an auto-accept session.
      const del = await call(client, "delete_object", ARGS.delete_object);
      expect((del.structuredContent as { status: string }).status).toBe("proposed");
      expect(accepted).toHaveLength(1);
      expect(pending.get("cv_1")?.changes[0]?.kind).toBe("remove");
    } finally {
      sessionAutoAccept.disableSession("cv_1", "mcp_auto");
    }
    expect((pending.get("cv_1") as ChangeSet).session).toBe("mcp_auto");
  });
});

describe("auto-accept never applies to a remote client's session", () => {
  it("proposes, never applies, even for an eligible tool and a session the user switched on elsewhere", async () => {
    const pending = new PendingChanges();
    const { live, accepted } = liveCanvas(pending);
    const { registerWriteTools } = await import("./writeTools");
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "t", version: "1" });
    registerWriteTools(server, { workspaceId: WS, liveCanvas: () => live, policy: () => ({ allowWrites: true }), parseMarkdown: stubMarkdown, clientName: () => "ChatGPT", sessionId: () => "mcp_remote", autoAcceptTools: new Set(["create_block"]) });
    const client = new Client({ name: "ChatGPT", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    closers.push(() => client.close(), () => server.close());

    // The user had it on for this session id before the relay said the session is remote, and tries again afterwards.
    sessionAutoAccept.enableSession("cv_1", "mcp_remote");
    sessionAutoAccept.markRemote("mcp_remote");
    sessionAutoAccept.enableSession("cv_1", "mcp_remote");
    const res = await call(client, "create_block", ARGS.create_block);
    expect((res.structuredContent as { status: string }).status).toBe("proposed");
    expect(accepted).toEqual([]);
    expect(pending.get("cv_1")?.operationId).toBeTruthy(); // waiting for explicit review
    expect(text(res)).toMatch(/Nothing changes until they accept it/);
    sessionAutoAccept.disableSession("cv_1", "mcp_remote");
  });
});
