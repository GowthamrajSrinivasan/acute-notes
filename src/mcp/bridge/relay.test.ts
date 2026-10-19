import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { createAcuteMcpServer } from "../server";
import type { BridgeFrame } from "./protocol";
import { isAllowedHost, isAllowedOrigin, isLoopbackHost, McpRelay, NOT_CONNECTED_MESSAGE, RELAY_ERRORS, REPLY_TIMEOUT_MS, type Caller } from "./relay";
import { startTabBridge, type BridgeStatus } from "./tabBridge";

const CALLER: Caller = { credentialId: "cred-1", remote: false, scope: "propose" };
const init = (id = 1) => ({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });

/** A tab that answers every request with `{ echo: method }`. */
function echoTab(relay: McpRelay) {
  const frames: BridgeFrame[] = [];
  let bridgeId = "";
  const closed = vi.fn();
  const attached = relay.attachTab((f: BridgeFrame) => {
    frames.push(f);
    if (f.type === "hello") bridgeId = f.bridgeId;
    if (f.type === "message" && "method" in f.message && "id" in f.message) {
      const { id, method } = f.message;
      queueMicrotask(() => relay.fromTab(bridgeId, f.sessionId, { jsonrpc: "2.0", id, result: { echo: method } }));
    }
  }, closed);
  return { frames, closed, attached, bridgeId: () => bridgeId };
}

describe("McpRelay", () => {
  it("initialize opens a session; later requests need its id; notifications get 202", async () => {
    const relay = new McpRelay();
    const tab = echoTab(relay);
    const first = await relay.fromClient(init(), null, CALLER);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ jsonrpc: "2.0", id: 1, result: { echo: "initialize" } });
    const session = first.headers!["mcp-session-id"]!;
    expect(session).toBeTruthy();

    expect((await relay.fromClient({ jsonrpc: "2.0", method: "notifications/initialized" }, session, CALLER)).status).toBe(202);
    const list = await relay.fromClient({ jsonrpc: "2.0", id: "x", method: "tools/list" }, session, CALLER);
    expect(list.body).toEqual({ jsonrpc: "2.0", id: "x", result: { echo: "tools/list" } });
    expect(tab.frames.filter((f) => f.type === "message")).toHaveLength(3);

    const unknown = await relay.fromClient({ jsonrpc: "2.0", id: 2, method: "tools/list" }, "nope", CALLER);
    expect(unknown.status).toBe(404);
    expect(relay.endSession(session, CALLER.credentialId)).toBe(true);
    expect(tab.frames.at(-1)).toEqual({ type: "close", sessionId: session });
    expect((await relay.fromClient({ jsonrpc: "2.0", id: 3, method: "tools/list" }, session, CALLER)).status).toBe(404);
  });

  it("answers a stateless server/discover probe (no session, not initialize) with a plain 400, so a newer client falls back to initialize", async () => {
    const relay = new McpRelay();
    const tab = echoTab(relay);
    const discover = { jsonrpc: "2.0", id: "openai-mcp-discover", method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } };
    const res = await relay.fromClient(discover, null, CALLER);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ id: "openai-mcp-discover", error: { code: -32600 } });
    expect(tab.frames.filter((f) => f.type === "message")).toHaveLength(0); // never forwarded
    // An unknown session id is still the spec's 404.
    expect((await relay.fromClient({ jsonrpc: "2.0", id: 2, method: "tools/list" }, "stale", CALLER)).status).toBe(404);
  });

  it("passes each session's origin and scope to the tab on every message", async () => {
    const relay = new McpRelay();
    const tab = echoTab(relay);
    const remote: Caller = { credentialId: "secret-1", remote: true, scope: "read" };
    const first = await relay.fromClient(init(), null, remote);
    await relay.fromClient({ jsonrpc: "2.0", id: 2, method: "tools/list" }, first.headers!["mcp-session-id"]!, remote);
    const messages = tab.frames.filter((f): f is Extract<BridgeFrame, { type: "message" }> => f.type === "message");
    expect(messages.map((m) => [m.remote, m.scope])).toEqual([
      [true, "read"],
      [true, "read"],
    ]);
  });

  it("a session belongs to the credential that opened it", async () => {
    const relay = new McpRelay();
    echoTab(relay);
    const first = await relay.fromClient(init(), null, CALLER);
    const session = first.headers!["mcp-session-id"]!;
    const other: Caller = { ...CALLER, credentialId: "cred-2" };
    expect((await relay.fromClient({ jsonrpc: "2.0", id: 2, method: "tools/list" }, session, other)).status).toBe(404);
    expect(relay.endSession(session, "cred-2")).toBe(false);
    expect((await relay.fromClient({ jsonrpc: "2.0", id: 3, method: "tools/list" }, session, CALLER)).status).toBe(200);
  });

  it("revoking a credential ends its sessions and fails their waiting requests; other credentials are unaffected", async () => {
    const relay = new McpRelay();
    const frames: BridgeFrame[] = [];
    relay.attachTab((f) => frames.push(f), () => {}); // never answers
    const waiting = relay.fromClient(init(), null, CALLER);
    relay.dropCredential("someone-else"); // no effect
    expect(frames.some((f) => f.type === "close")).toBe(false);
    relay.dropCredential(CALLER.credentialId);
    expect((await waiting).body).toMatchObject({ error: { code: RELAY_ERRORS.notConnected } });
    expect(frames.some((f) => f.type === "close")).toBe(true);
  });

  it("with no tab, requests fail with a clear message; malformed bodies are 400", async () => {
    const relay = new McpRelay();
    const r = await relay.fromClient(init(), null, CALLER);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ error: { code: RELAY_ERRORS.notConnected, message: NOT_CONNECTED_MESSAGE } });
    echoTab(relay);
    expect((await relay.fromClient([init()], null, CALLER)).status).toBe(400);
    expect((await relay.fromClient({ id: 1, method: "x" }, null, CALLER)).status).toBe(400);
  });

  it("a newer tab replaces the old one: the old stream is told and closed, its sessions and waiting requests end", async () => {
    const relay = new McpRelay();
    const frames: BridgeFrame[] = [];
    const closed = vi.fn();
    relay.attachTab((f) => frames.push(f), closed); // never answers
    const waiting = relay.fromClient(init(), null, CALLER);
    const other = echoTab(relay);
    expect(frames.at(-1)).toEqual({ type: "replaced" });
    expect(closed).toHaveBeenCalled();
    expect((await waiting).body).toMatchObject({ error: { code: RELAY_ERRORS.notConnected } });
    // A late reply from the replaced tab is refused.
    expect(relay.fromTab("stale", "s", { jsonrpc: "2.0", id: 1, result: {} })).toBe(false);
    other.attached.detach();
    expect(relay.connected).toBe(false);
  });

  describe("timeouts", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it("a request the tab never answers times out", async () => {
      const relay = new McpRelay();
      relay.attachTab(() => {}, () => {});
      const pending = relay.fromClient(init(), null, CALLER);
      await vi.advanceTimersByTimeAsync(REPLY_TIMEOUT_MS + 1);
      expect((await pending).body).toMatchObject({ error: { code: RELAY_ERRORS.timeout } });
    });
  });
});

describe("host checks", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("loopback accepts only this machine's host names", () => {
    for (const h of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "localhost"]) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ["evil.test", "localhost.evil.test:3000", "10.0.0.2:3000", null]) expect(isLoopbackHost(h)).toBe(false);
  });

  it("allows a public host only when it is configured exactly (no wildcards, ports ignored)", () => {
    expect(isAllowedHost("abc.trycloudflare.com")).toBe(false);
    vi.stubEnv("MCP_ALLOWED_HOSTS", "abc.trycloudflare.com, Notes.Example.com");
    expect(isAllowedHost("abc.trycloudflare.com")).toBe(true);
    expect(isAllowedHost("notes.example.com:443")).toBe(true);
    expect(isAllowedHost("evil.trycloudflare.com")).toBe(false);
    expect(isAllowedHost("abc.trycloudflare.com.evil.test")).toBe(false);
    expect(isAllowedHost(null)).toBe(false);
    vi.stubEnv("MCP_ALLOWED_HOSTS", "*");
    expect(isAllowedHost("anything.test")).toBe(false);
  });

  it("an Origin, if present, must be an allowed host too", () => {
    expect(isAllowedOrigin(null)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("https://evil.test")).toBe(false);
    expect(isAllowedOrigin("null")).toBe(false);
    vi.stubEnv("MCP_ALLOWED_HOSTS", "notes.example.com");
    expect(isAllowedOrigin("https://notes.example.com")).toBe(true);
  });
});

describe("tab bridge ↔ relay, end to end with the real MCP server", () => {
  const listeners: Record<string, () => void> = {};
  beforeEach(() => {
    vi.stubGlobal("window", { addEventListener: (t: string, f: () => void) => (listeners[t] = f), removeEventListener: () => {} });
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** A fetch that plays the bridge route against `relay`. */
  function bridgeFetch(relay: McpRelay): typeof fetch {
    return (async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const reply = JSON.parse(String(init.body)) as { bridgeId: string; sessionId: string; message: unknown };
        return new Response(null, { status: relay.fromTab(reply.bridgeId, reply.sessionId, reply.message) ? 204 : 409 });
      }
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
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
      });
      return new Response(body);
    }) as typeof fetch;
  }

  it("a client initializes and lists this workspace's resources through the relay", async () => {
    const relay = new McpRelay();
    const services = createMemoryServices();
    await services.workspaces.put({ id: "ws_1", name: "Notes", createdAt: 1, updatedAt: 1 } as never);
    const statuses: BridgeStatus[] = [];
    const stop = startTabBridge({
      workspaceId: "ws_1",
      ownerSecret: "o".repeat(64),
      fetch: bridgeFetch(relay),
      createServer: () => createAcuteMcpServer({ services, workspaceId: "ws_1", getCurrentContext: async () => null }),
      onStatus: (s) => statuses.push(s),
    });
    await vi.waitFor(() => expect(statuses).toContain("connected"));

    const initialized = await relay.fromClient(init(), null, CALLER);
    expect(initialized.body).toMatchObject({ id: 1, result: { serverInfo: expect.any(Object), capabilities: { resources: expect.any(Object) } } });
    const session = initialized.headers!["mcp-session-id"]!;
    await relay.fromClient({ jsonrpc: "2.0", method: "notifications/initialized" }, session, CALLER);
    const templates = await relay.fromClient({ jsonrpc: "2.0", id: 2, method: "resources/templates/list" }, session, CALLER);
    const uris = (templates.body as { result: { resourceTemplates: { uriTemplate: string }[] } }).result.resourceTemplates.map((t) => t.uriTemplate);
    expect(uris).toContain("acute://workspace/{workspaceId}");

    stop();
    await vi.waitFor(() => expect(relay.connected).toBe(false));
  });
});
