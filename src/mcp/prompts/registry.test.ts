import { PROJECT_PROMPT_NAMES } from "../tools/projectResources";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { canvasDocId } from "@/sync/docIds";
import { CURRENT_CONTEXT_VERSION, type CurrentContext } from "../context/currentContext";
import { createAcuteMcpServer } from "../server";
import { PROMPT_NAMES, PROMPTS } from "./registry";

const WS = "ws_1";

async function seed() {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_1"], createdAt: 1, updatedAt: 1 });
  await services.workspaces.put({ id: "ws_2", name: "Private", canvasIds: ["cv_2"], createdAt: 1, updatedAt: 1 });
  await services.canvases.put({ id: "cv_1", workspaceId: WS, title: "Payments", createdAt: 1, updatedAt: 1 });
  await services.canvases.put({ id: "cv_2", workspaceId: "ws_2", title: "Diary", createdAt: 1, updatedAt: 1 });
  const doc = new Y.Doc();
  doc.getMap("elements").set("n1", {
    id: "n1",
    type: "text",
    version: 1,
    index: "a0",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    angle: 0,
    locked: false,
    opacity: 100,
    isDeleted: false,
    groupIds: [],
    strokeColor: "#000",
    backgroundColor: "transparent",
    strokeWidth: 1,
    strokeStyle: "solid",
    text: "Retry payments twice",
    originalText: "Retry payments twice",
  });
  await services.yupdates.append(canvasDocId("cv_1"), Y.encodeStateAsUpdate(doc));
  return services;
}

const context = (): CurrentContext => ({
  uri: "acute://context/current",
  version: CURRENT_CONTEXT_VERSION,
  generatedAt: 1,
  workspace: { id: WS, name: "Team" },
  canvas: { id: "cv_1", title: "Payments" },
  selection: [],
  nearby: [],
  openPage: null,
  relations: [],
  recentChanges: [],
  availableTools: [],
  truncated: false,
});

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

async function connect(opts: { open?: boolean; writes?: boolean } = {}) {
  const services = await seed();
  const server = createAcuteMcpServer({
    services,
    workspaceId: WS,
    getCurrentContext: async () => (opts.open === false ? null : context()),
    getLiveCanvas: () => null,
    toolPolicy: () => ({ allowWrites: opts.writes ?? true }),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close());
  return client;
}

type Message = { role: string; content: { type: string; text?: string; resource?: { uri: string; text: string } } };
const texts = (messages: Message[]) => messages.map((m) => m.content.text ?? "").join("\n");

describe("MCP prompts (§13.13)", () => {
  it("lists the registry, each with a title, a description and only optional arguments", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    // The §13.13 registry first, then Phase 7B's session-loop and setup prompts (plan §7.3).
    expect(prompts.map((p) => p.name)).toEqual([...PROMPT_NAMES, ...PROJECT_PROMPT_NAMES]);
    expect(PROMPT_NAMES).toEqual(["review_canvas", "summarize_investigation", "action_plan", "find_missing_scenarios", "explain_architecture", "review_code", "meeting_notes"]);
    for (const p of prompts) {
      expect(p.title && p.description).toBeTruthy();
      expect((p.arguments ?? []).every((a) => !a.required)).toBe(true); // none at all is fine too
    }
    expect(prompts.find((p) => p.name === "review_canvas")!.arguments!.map((a) => a.name).sort()).toEqual(["canvasId", "focus"]);
    expect(prompts.find((p) => p.name === "action_plan")!.arguments!.map((a) => a.name)).toEqual(["focus"]);
  });

  it("a canvas prompt embeds the open canvas's bounded payload, then names its one action", async () => {
    const client = await connect();
    const res = await client.getPrompt({ name: "review_canvas", arguments: { focus: "retries" } });
    const messages = res.messages as Message[];
    expect(messages[0]!.content).toMatchObject({ type: "resource", resource: { uri: "acute://canvas/cv_1" } });
    expect(messages[0]!.content.resource!.text).toContain("Retry payments twice");
    const text = texts(messages);
    expect(text).toContain("focusing on retries");
    expect(text).toContain("create_block");
    expect(text).toContain("single tool call");
  });

  it("a current-context prompt embeds acute://context/current; the explicit action is the prompt's own write tool", async () => {
    const client = await connect();
    for (const def of PROMPTS) {
      const messages = (await client.getPrompt({ name: def.name, arguments: {} })).messages as Message[];
      expect(messages[0]!.content.resource!.uri).toBe(def.context === "current" ? "acute://context/current" : "acute://canvas/cv_1");
      expect(texts(messages)).toContain(def.output);
    }
  });

  it("with writes off, asks for an answer in the chat and names no write tool", async () => {
    const client = await connect({ writes: false });
    for (const def of PROMPTS) {
      const text = texts((await client.getPrompt({ name: def.name, arguments: {} })).messages as Message[]);
      expect(text).toContain("read-only for MCP clients");
      expect(text).not.toContain(def.output);
    }
  });

  it("no open canvas, or a canvas of another workspace: no context is embedded, and the prompt says what to do", async () => {
    const closed = await connect({ open: false });
    const none = (await closed.getPrompt({ name: "action_plan", arguments: {} })).messages as Message[];
    expect(none).toHaveLength(1);
    expect(texts(none)).toContain("No canvas of this workspace is open");

    const client = await connect();
    const other = (await client.getPrompt({ name: "explain_architecture", arguments: { canvasId: "cv_2" } })).messages as Message[];
    expect(other).toHaveLength(1);
    expect(texts(other)).toContain("no canvas cv_2 in this workspace");
    expect(JSON.stringify(other)).not.toContain("Diary");
  });

  it("is deterministic", async () => {
    const client = await connect();
    const a = await client.getPrompt({ name: "find_missing_scenarios", arguments: { focus: "refunds" } });
    const b = await client.getPrompt({ name: "find_missing_scenarios", arguments: { focus: "refunds" } });
    expect(a).toEqual(b);
  });
});
