/**
 * Remote tool profiles (2026-11-15): a remote session sees and can call only the tools its profile names; local
 * sessions are unchanged. This file covers the tab's server (`createAcuteMcpServer`); the relay and HTTP layer are
 * covered in `../bridge/remoteProfile.test.ts`.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { RichContent } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { createAcuteMcpServer, type AcuteMcpServerDeps } from "../server";
import { WRITE_ANNOTATIONS } from "./common";
import type { LiveCanvasActions } from "./liveCanvas";
import { FULL_ONLY_WRITE_TOOLS, REMOTE_EXCLUDED_TOOLS, REMOTE_PROFILE_TOOLS, remoteToolAllowed, resolveRemoteProfile, sessionToolAllowed } from "./remoteProfile";
import { LENS_READ_TOOLS, LENS_WRITE_TOOLS, OBJECT_READ_TOOLS, OBJECT_WRITE_TOOLS, PROJECT_READ_TOOLS, PROJECT_WRITE_TOOLS, READ_TOOL_NAMES, WRITE_TOOL_NAMES } from ".";

const WS = "ws_1";

/** The exact `restricted` inventory (sorted). Changing it is a reviewed decision: update `.ai/docs/mcp-remote-profile-2026-11-15.md` too. */
const RESTRICTED_SNAPSHOT = [
  "annotate",
  "create_block",
  "create_connection",
  "create_page",
  "create_project",
  "create_table",
  "create_todo",
  "focus_lens",
  "get_block",
  "get_canvas",
  "get_consistency",
  "get_decisions",
  "get_implementation_plan",
  "get_lens",
  "get_lens_impact",
  "get_open_questions",
  "get_page",
  "get_project",
  "get_recent_changes",
  "get_related_objects",
  "get_selected_content",
  "get_session_context",
  "get_session_history",
  "get_session_review",
  "group_blocks",
  "list_blocks",
  "list_projects",
  "log_finding",
  "move_object",
  "render_visual_plan",
  "search_workspace",
  "suggest_placement",
  "trace_lens_path",
  "update_block",
];

/** Every tool a local session is served (no repo-map/ingest options given here). */
const LOCAL_ALL = [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES, ...PROJECT_READ_TOOLS, ...PROJECT_WRITE_TOOLS, ...OBJECT_READ_TOOLS, ...OBJECT_WRITE_TOOLS, ...LENS_READ_TOOLS, ...LENS_WRITE_TOOLS].sort();
/** `full`: everything local except the tools no remote profile serves yet (`get_weak_concepts`, pending remote verification). */
const FULL_REMOTE = LOCAL_ALL.filter((t) => !(REMOTE_EXCLUDED_TOOLS as readonly string[]).includes(t));

const box = { x: 0, y: 0, width: 200, height: 100 };
const SCENE = [
  { id: "r1", type: "rectangle", version: 1, index: "a0", ...box, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#000", backgroundColor: "transparent", strokeWidth: 1, strokeStyle: "solid" },
] as unknown as SceneElement[];

function fakeLive() {
  const proposed: ChangeSet[] = [];
  const live: LiveCanvasActions = {
    workspaceId: WS,
    canvasId: "cv_1",
    elements: () => SCENE,
    renderContext: () => ({ existing: SCENE.map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height })), viewport: { x: 0, y: 0, width: 1200, height: 800 } }),
    isReviewing: () => false,
    propose: (set) => void proposed.push(set),
  };
  return { live, proposed };
}

async function seed(): Promise<PersistenceServices> {
  const services = createMemoryServices();
  await services.workspaces.put({ id: WS, name: "Team", canvasIds: ["cv_1"], createdAt: 1, updatedAt: 2 });
  await services.canvases.put({ id: "cv_1", workspaceId: WS, title: "Payments", createdAt: 1, updatedAt: 2 });
  return services;
}

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

const stubMarkdown = (md: string): RichContent => [{ type: "paragraph", content: md }];

async function open(services: PersistenceServices, extra: Partial<AcuteMcpServerDeps> = {}) {
  const fake = fakeLive();
  const server = createAcuteMcpServer({ services, workspaceId: WS, getCurrentContext: async () => null, getLiveCanvas: () => fake.live, parseMarkdown: stubMarkdown, agentState: services.agentState, sessionId: `s-${Math.random()}`, ...extra });
  const client = new Client({ name: "remote-test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  closers.push(() => client.close(), () => server.close());
  return { server, client, proposed: fake.proposed };
}

const names = async (client: Client) => (await client.listTools()).tools.map((t) => t.name).sort();
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult;
const text = (r: CallToolResult) => (r.content as { text: string }[])[0]!.text;

/** Plausible arguments, so a refusal can't be blamed on validation. */
const ARGS: Record<string, Record<string, unknown>> = {
  delete_object: { ids: ["r1"] },
  delete_connection: { connectionIds: ["a1"] },
  revert_agent_changes: { session: "s-any", reason: "undo" },
  update_connection: { connectionId: "a1", label: "x" },
  update_knowledge: { node: "D1", transition: "supersede", reason: "x" },
  update_progress: { items: [] },
  record_decision: { title: "Use X", reason: "x" },
  sync_session: { summary: "did things", next: "more" },
  link_lens_detail: { lensKey: "L1" },
};

describe("remote profile selection", () => {
  it("is restricted unless the setting is exactly 'full' (case and spaces ignored)", () => {
    for (const v of [undefined, null, "", "restricted", "ful", "FULL-ish", "open", "true", 1, {}]) expect(resolveRemoteProfile(v)).toBe("restricted");
    for (const v of ["full", "FULL", " Full "]) expect(resolveRemoteProfile(v)).toBe("full");
    expect(remoteToolAllowed("bogus", "delete_object")).toBe(false);
    expect(remoteToolAllowed("full", "delete_object")).toBe(true);
    expect(sessionToolAllowed({ remote: false }, "anything_new")).toBe(true);
    expect(sessionToolAllowed({ remote: true }, "anything_new")).toBe(false);
  });

  it("restricted is a strict subset of full; full is what remote sessions were served before the gate, minus get_weak_concepts", () => {
    expect(REMOTE_PROFILE_TOOLS.restricted.every((t) => REMOTE_PROFILE_TOOLS.full.includes(t))).toBe(true);
    expect([...REMOTE_PROFILE_TOOLS.full].sort()).toEqual(FULL_REMOTE);
    for (const p of ["restricted", "full"]) expect(remoteToolAllowed(p, "get_weak_concepts")).toBe(false);
    expect([...REMOTE_PROFILE_TOOLS.restricted].sort()).toEqual(RESTRICTED_SNAPSHOT);
  });
});

describe("the tab's server under a remote profile", () => {
  it("restricted tools/list is exactly the allowlist", async () => {
    const { client } = await open(await seed(), { remote: true });
    expect(await names(client)).toEqual(RESTRICTED_SNAPSHOT);
  });

  it("an unknown profile value is restricted", async () => {
    const { client } = await open(await seed(), { remote: true, remoteProfile: "everything" as never });
    expect(await names(client)).toEqual(RESTRICTED_SNAPSHOT);
  });

  it("full (explicit) serves every remote-reachable tool; a local session still sees the full set, whatever profile is passed", async () => {
    const full = await open(await seed(), { remote: true, remoteProfile: "full" });
    expect(await names(full.client)).toEqual(FULL_REMOTE);
    const local = await open(await seed(), { remoteProfile: "restricted" });
    expect(await names(local.client)).toEqual(LOCAL_ALL);
  });

  it("restricted doesn't advertise any destructive tool except update_block (baseline-checked at Accept)", async () => {
    const { client } = await open(await seed(), { remote: true });
    const destructive = (await client.listTools()).tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
    expect(destructive).toEqual(["update_block"]);
  });

  it("a direct tools/call of each disabled tool fails and writes nothing", async () => {
    const services = await seed();
    const { client, proposed } = await open(services, { remote: true });
    expect(FULL_ONLY_WRITE_TOOLS).toEqual(expect.arrayContaining(["delete_object", "delete_connection", "revert_agent_changes", "sync_session"]));
    for (const tool of [...FULL_ONLY_WRITE_TOOLS, ...REMOTE_EXCLUDED_TOOLS]) {
      const res = await call(client, tool, ARGS[tool] ?? {});
      expect(res.isError, tool).toBe(true);
      expect(text(res), tool).toBe(`MCP error -32602: Tool ${tool} not found`);
    }
    expect(proposed).toEqual([]);
    expect(await services.agentState.listSessions(WS)).toEqual([]);
    expect(await services.agentState.listChanges(WS)).toEqual([]);
  });

  it("an allowed write still proposes for review", async () => {
    const { client, proposed } = await open(await seed(), { remote: true });
    const res = await call(client, "create_block", { markdown: "Hello" });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ status: "proposed" });
    expect(proposed).toHaveLength(1);
  });

  it("a newly registered write tool not in the allowlist is hidden and uncallable for remote sessions, served to local ones", async () => {
    const register = (server: ReturnType<typeof createAcuteMcpServer>, ran: { n: number }) =>
      server.registerTool("dummy_new_write", { title: "Dummy", description: "A new, unreviewed write tool.", inputSchema: { x: z.string().optional() }, annotations: WRITE_ANNOTATIONS }, async () => {
        ran.n++;
        return { content: [{ type: "text" as const, text: "wrote" }] };
      });

    const remoteRan = { n: 0 };
    const remote = await open(await seed(), { remote: true, remoteProfile: "full" });
    register(remote.server, remoteRan);
    expect(await names(remote.client)).not.toContain("dummy_new_write");
    const res = await call(remote.client, "dummy_new_write", {});
    expect(res.isError).toBe(true);
    expect(text(res)).toBe("MCP error -32602: Tool dummy_new_write not found");
    expect(remoteRan.n).toBe(0);

    const localRan = { n: 0 };
    const local = await open(await seed());
    register(local.server, localRan);
    await vi.waitFor(async () => expect(await names(local.client)).toContain("dummy_new_write"));
    expect((await call(local.client, "dummy_new_write", {})).isError).toBeFalsy();
    expect(localRan.n).toBe(1);
  });

  it("acute://context/current lists only the profile's tools as available", async () => {
    const services = await seed();
    const ctx = { workspace: { id: WS } } as never;
    const { client } = await open(services, { remote: true, getCurrentContext: async () => ctx });
    const res = await client.readResource({ uri: "acute://context/current" });
    const payload = JSON.parse((res.contents[0] as { text: string }).text) as { availableTools: string[] };
    expect([...payload.availableTools].sort()).toEqual(RESTRICTED_SNAPSHOT);
  });
});
