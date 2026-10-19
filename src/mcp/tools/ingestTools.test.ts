/**
 * The MCP content-import tools: the guards (off until the user allows it, local sessions only, preview before spend, proposals only, never
 * auto-accepted) and the hand-off to the shared ingest service. One test runs the whole pipeline through MCP with the mock model.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { AUTO_ACCEPT_TOOLS } from "@/ai/changes/autoAccept";
import type { IngestRequest, IngestResult } from "@/ai/ingest/ingest";
import type { ChatTranscript, ChatTurn } from "@/ai/import/chatShare/types";
import { context, firstRun, modelReply, parse, runtimeWith } from "@/testUtils/reconcileHarness";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { createAcuteMcpServer, type AcuteMcpServerDeps } from "../server";
import type { LiveCanvasActions } from "./liveCanvas";
import { MESSAGES } from "./writeTools";

const hooks = vi.hoisted(() => ({
  targets: [] as { sourceId: string; label: string; updatedAt: number }[],
  override: null as null | ((request: unknown) => Promise<unknown>),
  requests: [] as unknown[],
}));
vi.mock("@/ai/ingest/targets", () => ({ findMergeTargets: async () => hooks.targets }));
vi.mock("@/ai/ingest/ingest", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/ai/ingest/ingest")>();
  return {
    ...real,
    ingestContent: (request: IngestRequest, ...rest: unknown[]) => {
      hooks.requests.push(request);
      return hooks.override ? hooks.override(request) : (real.ingestContent as (...a: unknown[]) => Promise<IngestResult>)(request, ...rest);
    },
  };
});

const WS = "ws_1";
let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
  hooks.targets = [];
  hooks.override = null;
  hooks.requests = [];
});

function fakeLive(over: Partial<LiveCanvasActions> = {}) {
  const proposed: ChangeSet[] = [];
  const live: LiveCanvasActions = { workspaceId: WS, canvasId: "cv_1", elements: () => [], renderContext: () => context, isReviewing: () => false, propose: (set) => void proposed.push(set), ...over };
  return { live, proposed };
}

async function connect(extra: Partial<AcuteMcpServerDeps> = {}, options: { allowed?: boolean; fetch?: never; client?: string; live?: LiveCanvasActions | null } = {}) {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_1"], createdAt: 1, updatedAt: 2 });
  const rt = runtimeWith(modelReply);
  const live = options.live === undefined ? fakeLive().live : options.live;
  const server = createAcuteMcpServer({
    services,
    workspaceId: WS,
    getCurrentContext: async () => null,
    getLiveCanvas: () => live,
    parseMarkdown: parse,
    ingest: { runtime: rt.runtime, contentSources: services.contentSources, allowed: () => options.allowed ?? true, ...(options.fetch ? { fetch: options.fetch } : {}) },
    ...extra,
  });
  const client = new Client({ name: options.client ?? "Test Client", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close(), () => server.close());
  return { client, rt };
}

const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult;
const text = (r: CallToolResult) => (r.content as { text: string }[]).map((c) => c.text).join(" ");
const structured = (r: CallToolResult) => r.structuredContent as Record<string, unknown>;

const TEXT = "# Plan\n\nWe ship the first version in March.\n\nThe budget is fixed.";

describe("which sessions get the tools, and when", () => {
  it("only when the app provides the pipeline, and never to a remote session", async () => {
    const { client } = await connect();
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(expect.arrayContaining(["find_import_targets", "import_content"]));
    const remote = await connect({ remote: true });
    expect((await remote.client.listTools()).tools.map((t) => t.name)).not.toContain("import_content");
    const without = await connect({ ingest: undefined });
    expect((await without.client.listTools()).tools.map((t) => t.name)).not.toContain("import_content");
  });

  it("is off until the user allows it: a refusal that says where, before any AI or preview; the read tool still works", async () => {
    const { client, rt } = await connect({}, { allowed: false });
    const res = await call(client, "import_content", { text: TEXT, confirm: true });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("MCP access");
    expect(rt.spy).not.toHaveBeenCalled();
    expect((await call(client, "find_import_targets")).isError).toBeFalsy();
  });

  it("is never auto-accepted, and a read-only workspace refuses it", async () => {
    expect(AUTO_ACCEPT_TOOLS.has("import_content")).toBe(false);
    const { client } = await connect({ toolPolicy: () => ({ allowWrites: false }) });
    const res = await call(client, "import_content", { text: TEXT, confirm: true });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe(MESSAGES.writesDisabled);
  });
});

describe("arguments", () => {
  it("needs the content, from text or share links but not both; refuses too much", async () => {
    const { client } = await connect();
    expect(text(await call(client, "import_content", {}))).toContain("Give the content");
    expect(text(await call(client, "import_content", { text: "x", shareLinks: ["https://chatgpt.com/share/6ac75678-829c-83ee-aaf4-badd93c19df4"] }))).toContain("not both");
    const big = await call(client, "import_content", { text: "x".repeat(200_001) });
    expect(big.isError).toBe(true);
  });

  it("merge and update need notes on the canvas; an unknown target names what is available", async () => {
    const { client } = await connect();
    const none = await call(client, "import_content", { text: TEXT, mode: "merge" });
    expect(text(none)).toContain("no notes on the open canvas");
    hooks.targets = [{ sourceId: "src_1", label: "Notes", updatedAt: 1 }];
    const unknown = await call(client, "import_content", { text: TEXT, mode: "update", targetSourceId: "src_9" });
    expect(unknown.isError).toBe(true);
    expect(text(unknown)).toContain("src_1");
  });

  it("no open canvas, or another canvas id, is refused", async () => {
    const closed = await connect({}, { live: null });
    expect(text(await call(closed.client, "import_content", { text: TEXT }))).toBe(MESSAGES.noCanvas);
    const { client } = await connect();
    expect(text(await call(client, "import_content", { text: TEXT, canvasId: "cv_other" }))).toContain("isn't the open canvas");
  });
});

describe("preview before spend", () => {
  it("without confirm nothing runs: no model call, no pipeline, no proposal; it says what would happen and a rough cost", async () => {
    const live = fakeLive();
    const { client, rt } = await connect({}, { live: live.live });
    hooks.targets = [{ sourceId: "src_1", label: "Roblox notes", updatedAt: 1 }];
    const res = await call(client, "import_content", { text: TEXT });
    expect(res.isError).toBeFalsy();
    const out = structured(res);
    expect(out).toMatchObject({ status: "preview", mode: "merge", economy: true, target: { sourceId: "src_1", label: "Roblox notes" }, characters: TEXT.length });
    expect((out.estimateUsd as { low: number; high: number }).high).toBeGreaterThanOrEqual((out.estimateUsd as { low: number }).low);
    expect(text(res)).toContain("confirm: true");
    expect(hooks.requests).toEqual([]);
    expect(rt.spy).not.toHaveBeenCalled();
    expect(live.proposed).toEqual([]);
  });

  it("with no notes yet the default is new notes; economy only applies to a merge", async () => {
    const { client } = await connect();
    const res = structured(await call(client, "import_content", { text: TEXT }));
    expect(res).toMatchObject({ status: "preview", mode: "new", economy: false });
  });
});

describe("running it", () => {
  it("new notes, through the real pipeline with the mock model: a proposal for review, attributed to the client, never written", async () => {
    const live = fakeLive();
    const { client } = await connect({}, { live: live.live, client: "Claude Code" });
    const res = await call(client, "import_content", { text: TEXT, confirm: true });
    expect(res.isError, text(res)).toBeFalsy();
    expect(structured(res)).toMatchObject({ status: "proposed", mode: "new", canvasId: "cv_1" });
    expect(live.proposed).toHaveLength(1);
    const set = live.proposed[0]!;
    expect(set.metadata).toMatchObject({ createdBy: "mcp", task: "import_content", provider: "Claude Code" });
    expect(set.title).toContain("Claude Code");
    expect(set.changes.length).toBeGreaterThan(0);
  }, 60_000);

  it("merge into the newest notes with economy on unless the client turns it off, with the content as given", async () => {
    const real = await firstRun(TEXT);
    hooks.targets = [
      { sourceId: "src_new", label: "Newest", updatedAt: 9 },
      { sourceId: "src_old", label: "Older", updatedAt: 1 },
    ];
    hooks.override = async () => ({ changeSet: real, notices: ["something was left out"], choices: [] });
    const live = fakeLive();
    const { client } = await connect({}, { live: live.live });
    const res = await call(client, "import_content", { text: "new words", confirm: true });
    expect(res.isError, text(res)).toBeFalsy();
    expect(hooks.requests[0]).toEqual({ mode: "merge", sourceId: "src_new", text: "new words", economy: true });
    expect(structured(res).warnings).toContain("something was left out");
    await call(client, "import_content", { text: "again", mode: "merge", targetSourceId: "src_old", economy: false, confirm: true });
    expect(hooks.requests[1]).toEqual({ mode: "merge", sourceId: "src_old", text: "again", economy: false });
  }, 60_000);

  it("conflicts with the user's notes are not applied and are named for the user: each waits as a \"Needs your call\" choice", async () => {
    hooks.targets = [{ sourceId: "src_1", label: "Notes", updatedAt: 1 }];
    hooks.override = async () => ({ changeSet: await firstRun(TEXT), notices: [], choices: ["Pricing: the Pro plan costs 12 dollars"] });
    const { client } = await connect();
    const res = await call(client, "import_content", { text: "Pro now costs 15 dollars.", confirm: true });
    expect(res.isError, text(res)).toBeFalsy();
    expect(structured(res).needsYourCall).toEqual(["Pricing: the Pro plan costs 12 dollars"]);
    expect((structured(res).warnings as string[]).join(" ")).toContain("Needs your call");
    expect(text(res)).toContain("Needs your call");
  }, 60_000);

  it("update names its notes and carries no economy", async () => {
    hooks.targets = [{ sourceId: "src_1", label: "Notes", updatedAt: 1 }];
    hooks.override = async () => ({ changeSet: await firstRun(TEXT), notices: [], choices: [] });
    const { client } = await connect();
    await call(client, "import_content", { text: "edited", mode: "update", confirm: true });
    expect(hooks.requests[0]).toEqual({ mode: "update", sourceId: "src_1", text: "edited" });
  }, 60_000);

  it("content already on the canvas is reported as nothing to import, not an error and not a proposal", async () => {
    hooks.override = async () => ({ changeSet: null, notices: ["Everything in it is already in your notes."], choices: [] });
    const live = fakeLive();
    const { client } = await connect({}, { live: live.live });
    const res = await call(client, "import_content", { text: TEXT, confirm: true });
    expect(res.isError).toBeFalsy();
    expect(structured(res)).toMatchObject({ status: "unchanged", notices: ["Everything in it is already in your notes."] });
    expect(live.proposed).toEqual([]);
  }, 60_000);

  it("a change set already under review is never replaced: the import is refused", async () => {
    hooks.override = async () => ({ changeSet: await firstRun(TEXT), notices: [], choices: [] });
    const { client } = await connect({}, { live: fakeLive({ isReviewing: () => true }).live });
    const res = await call(client, "import_content", { text: TEXT, confirm: true });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe(MESSAGES.reviewing);
  }, 60_000);
});

describe("shared chat links", () => {
  const turn = (id: string, index: number, role: ChatTurn["role"], markdown: string): ChatTurn => ({ id, index, role, markdown, hash: `${role}:${markdown}` });
  const transcript: ChatTranscript = { provider: "chatgpt", url: "https://chatgpt.com/share/6ac75678-829c-83ee-aaf4-badd93c19df4", shareId: "6ac75678-829c-83ee-aaf4-badd93c19df4", conversationId: "c1", title: "Plan", turns: [turn("t1", 0, "user", "What is the plan?"), turn("t2", 1, "assistant", "Ship in March.")] };
  const fetchStub = (async (_u: string, init: { body: string }) => {
    const { url } = JSON.parse(init.body) as { url: string };
    return url === transcript.url ? { ok: true, json: async () => ({ transcript }) } : { ok: false, json: async () => ({ error: "That chat could not be found." }) };
  }) as never;

  it("the links are read by the same shared-chat service as the dialog and the Markdown goes to the pipeline; links that fail are said", async () => {
    hooks.override = async () => ({ changeSet: await firstRun(TEXT), notices: [], choices: [] });
    const { client } = await connect({}, { fetch: fetchStub });
    const res = await call(client, "import_content", {
      shareLinks: [transcript.url, "https://chatgpt.com/share/6ac756a0-6a40-83ee-85f7-30bc59bbe977", "https://example.com/nope"],
      confirm: true,
    });
    expect(res.isError, text(res)).toBeFalsy();
    const request = hooks.requests[0] as { text: string };
    expect(request.text).toContain("What is the plan?");
    expect(request.text).toContain("Ship in March.");
    const warnings = structured(res).warnings as string[];
    expect(warnings.join(" ")).toContain("Could not read https://chatgpt.com/share/6ac756a0");
    expect(warnings.join(" ")).toContain("example.com");
  }, 60_000);

  it("nothing readable is an error that says why, with no preview or spend", async () => {
    const { client, rt } = await connect({}, { fetch: fetchStub });
    const res = await call(client, "import_content", { shareLinks: ["https://chatgpt.com/share/6ac756a0-6a40-83ee-85f7-30bc59bbe977"] });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Nothing could be read");
    expect(rt.spy).not.toHaveBeenCalled();
  });
});

describe("find_import_targets", () => {
  it("lists the notes the content can go into", async () => {
    hooks.targets = [{ sourceId: "src_1", label: "Notes", updatedAt: 1 }];
    const { client } = await connect();
    const res = await call(client, "find_import_targets");
    expect(structured(res)).toEqual({ canvasId: "cv_1", targets: [{ sourceId: "src_1", label: "Notes", updatedAt: 1 }] });
  });
});
