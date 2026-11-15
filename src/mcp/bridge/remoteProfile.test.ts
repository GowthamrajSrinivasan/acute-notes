/**
 * Remote tool profiles at the relay and the HTTP layer (2026-11-15). The relay refuses a `tools/call` for a tool the
 * session's profile doesn't list before the tab sees it, and filters `tools/list`; `handleClientRequest` picks the
 * profile from `MCP_REMOTE_PROFILE` (only "full" is full). The tab's own filter is in `../tools/remoteProfile.test.ts`.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { createAcuteMcpServer } from "../server";
import { REMOTE_PROFILE_TOOLS, type RemoteProfile } from "../tools/remoteProfile";
import { handleClientRequest } from "./http";
import type { BridgeFrame } from "./protocol";
import { McpRelay, type Caller } from "./relay";
import { createMcpServices, type McpServices } from "./store";
import { startTabBridge } from "./tabBridge";

const init = (id = 1) => ({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });

/** A tab that lists `delete_object` and `get_canvas`, and answers every call with a success it records. */
function listingTab(relay: McpRelay) {
  const frames: Extract<BridgeFrame, { type: "message" }>[] = [];
  let bridgeId = "";
  relay.attachTab((f: BridgeFrame) => {
    if (f.type === "hello") bridgeId = f.bridgeId;
    if (f.type !== "message") return;
    frames.push(f);
    if ("method" in f.message && "id" in f.message) {
      const { id, method } = f.message;
      const result = method === "tools/list" ? { tools: [{ name: "delete_object" }, { name: "get_canvas" }, { name: "brand_new_tool" }] } : { ok: method };
      queueMicrotask(() => relay.fromTab(bridgeId, f.sessionId, { jsonrpc: "2.0", id, result }));
    }
  }, vi.fn());
  return { calls: () => frames.filter((f) => "method" in f.message && f.message.method === "tools/call"), frames };
}

async function session(relay: McpRelay, caller: Caller) {
  const first = await relay.fromClient(init(), null, caller);
  return first.headers!["mcp-session-id"]!;
}

describe("relay: remote tool profile", () => {
  it("refuses a disabled tool's tools/call with a JSON-RPC error, before the tab sees it", async () => {
    const relay = new McpRelay();
    const tab = listingTab(relay);
    const caller: Caller = { credentialId: "secret-1", remote: true, scope: "propose", profile: "restricted" };
    const id = await session(relay, caller);
    for (const name of ["delete_object", "delete_connection", "revert_agent_changes", "sync_session", "get_weak_concepts", "brand_new_tool"]) {
      const reply = await relay.fromClient({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: {} } }, id, caller);
      expect(reply.body, name).toEqual({ jsonrpc: "2.0", id: 9, error: { code: -32602, message: `Tool ${name} is not available to remote MCP sessions.` } });
    }
    expect(tab.calls()).toEqual([]);
    const allowed = await relay.fromClient({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "update_block", arguments: {} } }, id, caller);
    expect(allowed.body).toEqual({ jsonrpc: "2.0", id: 10, result: { ok: "tools/call" } });
    expect(tab.calls()).toHaveLength(1);
  });

  it("filters a remote tools/list to the profile; local sessions are untouched", async () => {
    const relay = new McpRelay();
    const tab = listingTab(relay);
    const remote: Caller = { credentialId: "secret-1", remote: true, scope: "propose" }; // no profile given → restricted
    const rid = await session(relay, remote);
    const listed = await relay.fromClient({ jsonrpc: "2.0", id: 2, method: "tools/list" }, rid, remote);
    expect(listed.body).toEqual({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "get_canvas" }] } });
    expect(tab.frames.every((f) => f.profile === "restricted")).toBe(true);

    const local: Caller = { credentialId: "bearer-1", remote: false, scope: "propose" };
    const lid = await session(relay, local);
    const all = await relay.fromClient({ jsonrpc: "2.0", id: 3, method: "tools/list" }, lid, local);
    expect(all.body).toEqual({ jsonrpc: "2.0", id: 3, result: { tools: [{ name: "delete_object" }, { name: "get_canvas" }, { name: "brand_new_tool" }] } });
    expect((await relay.fromClient({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "delete_object" } }, lid, local)).body).toEqual({ jsonrpc: "2.0", id: 4, result: { ok: "tools/call" } });
    expect(tab.frames.filter((f) => !f.remote).every((f) => !("profile" in f))).toBe(true);
  });

  it("an unknown profile on the caller is restricted; full allows the full set", async () => {
    const relay = new McpRelay();
    listingTab(relay);
    const odd: Caller = { credentialId: "secret-1", remote: true, scope: "propose", profile: "everything" as RemoteProfile };
    const oid = await session(relay, odd);
    expect((await relay.fromClient({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "delete_object" } }, oid, odd)).body).toMatchObject({ error: { code: -32602 } });
    const full: Caller = { credentialId: "secret-2", remote: true, scope: "propose", profile: "full" };
    const fid = await session(relay, full);
    expect((await relay.fromClient({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "delete_object" } }, fid, full)).body).toMatchObject({ result: { ok: "tools/call" } });
  });
});

// ---- Through the HTTP handler, with the real tab server ------------------------------------------------------------

const HOST = "notes.example.com";
const BASE = `https://${HOST}`;
let services: McpServices;
let stopTab: (() => void) | null = null;

function serverFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);
    headers.set("host", url.host);
    const req = new Request(url, { ...init, headers });
    return handleClientRequest(req, { token: decodeURIComponent(url.pathname.slice("/api/mcp/s/".length)), kinds: ["secret-url"] }, services);
  }) as typeof fetch;
}

function bridgeFetch(workspaceId: string): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const relay = services.relays.relayFor(workspaceId);
    if (init?.method === "POST") {
      const reply = JSON.parse(String(init.body)) as { bridgeId: string; sessionId: string; message: unknown };
      return new Response(null, { status: relay.fromTab(reply.bridgeId, reply.sessionId, reply.message) ? 204 : 409 });
    }
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const attached = relay.attachTab((f) => controller.enqueue(encoder.encode(`${JSON.stringify(f)}\n`)), () => controller.close());
          init?.signal?.addEventListener("abort", () => {
            attached.detach();
            try {
              controller.close();
            } catch {
              // closed
            }
          });
        },
      }),
    );
  }) as typeof fetch;
}

async function serveWorkspace(workspaceId: string, seen: (string | undefined)[]) {
  const memory = createMemoryServices();
  await memory.workspaces.put({ id: workspaceId, name: "Notes", canvasIds: [], createdAt: 1, updatedAt: 1 } as never);
  const statuses: string[] = [];
  stopTab = startTabBridge({
    workspaceId,
    ownerSecret: "o".repeat(64),
    fetch: bridgeFetch(workspaceId),
    createServer: ({ sessionId, remote, scope, profile }) => {
      seen.push(profile);
      return createAcuteMcpServer({ services: memory, workspaceId, sessionId, remote, ...(profile ? { remoteProfile: profile } : {}), getCurrentContext: async () => null, toolPolicy: () => ({ allowWrites: scope === "propose" }) });
    },
    onStatus: (s) => statuses.push(s),
  });
  await vi.waitFor(() => expect(statuses).toContain("connected"));
}

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubEnv("MCP_ALLOWED_HOSTS", HOST);
  services = createMcpServices();
});
afterEach(() => {
  stopTab?.();
  stopTab = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("secret URL session: profile from MCP_REMOTE_PROFILE", () => {
  for (const [setting, expected] of [
    [undefined, "restricted"],
    ["bogus", "restricted"],
    ["full", "full"],
  ] as const) {
    it(`MCP_REMOTE_PROFILE=${setting ?? "(unset)"} → ${expected}`, async () => {
      if (setting) vi.stubEnv("MCP_REMOTE_PROFILE", setting);
      const seen: (string | undefined)[] = [];
      await serveWorkspace("ws_a", seen);
      const secret = services.credentials.issue("ws_a", { kind: "secret-url", scope: "propose" });
      const client = new Client({ name: "chatgpt-like", version: "1.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp/s/${secret.token}`), { fetch: serverFetch() }));
      try {
        expect(seen).toEqual([expected]);
        const tools = (await client.listTools()).tools.map((t) => t.name).sort();
        expect(tools).toEqual([...REMOTE_PROFILE_TOOLS[expected]].sort());
        if (expected === "restricted") {
          await expect(client.callTool({ name: "delete_object", arguments: { ids: ["x"] } })).rejects.toThrow(/Tool delete_object is not available to remote MCP sessions/);
        }
      } finally {
        await client.close();
      }
    });
  }
});
