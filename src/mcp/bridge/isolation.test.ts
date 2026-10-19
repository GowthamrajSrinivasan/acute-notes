/**
 * The proof-of-concept's workspace-isolation and credential guarantees, driven through the same request handling the
 * routes use (`handleClientRequest`, `ownerGate`…) against in-memory services.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { connectTab, initialize, OWNER_A, OWNER_B, ownerRequest, request, watchLogs } from "@/testUtils/mcpBridge";
import { handleClientRequest, bearerOf } from "./http";
import { ownerKey } from "./owner";
import { createMcpServices, type McpServices } from "./store";

let services: McpServices;
beforeEach(() => {
  services = createMcpServices();
});
afterEach(() => vi.unstubAllEnvs());

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const call = (token: string, body: unknown, headers: Record<string, string> = {}, host?: string) =>
  handleClientRequest(request("/api/mcp", { headers: { ...bearer(token), ...headers }, ...(host ? { host } : {}), body }), { token, kinds: ["bearer", "oauth"] }, services);
const callSecret = (token: string, body: unknown, headers: Record<string, string> = {}, host?: string) =>
  handleClientRequest(request(`/api/mcp/s/${token}`, { headers, ...(host ? { host } : {}), body }), { token, kinds: ["secret-url"] }, services);
const json = async (res: Response) => (await res.json()) as { result?: { tab?: string; echo?: string; params?: unknown }; error?: { code: number; message: string } };

describe("a credential reaches only its own workspace", () => {
  it("routes a workspace A credential to A's tab, whatever the request body names", async () => {
    const tabA = connectTab(services, "ws_a");
    const tabB = connectTab(services, "ws_b");
    const a = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });

    const initialized = await call(a.token, initialize());
    expect(initialized.status).toBe(200);
    const session = initialized.headers.get("mcp-session-id")!;
    // Bodies, params and headers that name workspace B change nothing: the credential decides.
    const hostile = { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "acute://workspace/ws_b", workspaceId: "ws_b", _meta: { workspaceId: "ws_b" } } };
    const reply = await json(await call(a.token, hostile, { "mcp-session-id": session, "x-acute-mcp-workspace": "ws_b", "x-workspace-id": "ws_b" }));
    expect(reply.result?.tab).toBe("ws_a");
    expect(tabA.messages().length).toBe(2);
    expect(tabB.messages().length).toBe(0);
  });

  it("does not fall back to another workspace's tab when its own isn't connected", async () => {
    const tabB = connectTab(services, "ws_b");
    const a = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const res = await call(a.token, initialize());
    expect(res.status).toBe(503);
    expect(tabB.messages().length).toBe(0);
  });

  it("connecting a second workspace does not disconnect or disturb the first", async () => {
    const tabA = connectTab(services, "ws_a");
    const a = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const session = (await call(a.token, initialize())).headers.get("mcp-session-id")!;

    const tabB = connectTab(services, "ws_b"); // another workspace comes online
    const b = services.credentials.issue("ws_b", { kind: "bearer", scope: "propose" });
    expect((await call(b.token, initialize())).status).toBe(200);

    expect(tabA.frames.some((f) => f.type === "replaced")).toBe(false);
    expect(services.relays.existing("ws_a")?.connected).toBe(true);
    // A's existing session still works, and still reaches only A.
    const again = await json(await call(a.token, { jsonrpc: "2.0", id: 5, method: "tools/list" }, { "mcp-session-id": session }));
    expect(again.result?.tab).toBe("ws_a");
    expect(tabB.messages().every((m) => (m.message as { id?: number }).id !== 5)).toBe(true);
  });

  it("a second tab of the same workspace replaces the first, and only that workspace's sessions end", async () => {
    const first = connectTab(services, "ws_a", "first");
    const tabB = connectTab(services, "ws_b");
    const a = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const b = services.credentials.issue("ws_b", { kind: "bearer", scope: "propose" });
    const sessionA = (await call(a.token, initialize())).headers.get("mcp-session-id")!;
    const sessionB = (await call(b.token, initialize())).headers.get("mcp-session-id")!;
    connectTab(services, "ws_a", "second");
    expect(first.frames.at(-1)).toEqual({ type: "replaced" });
    expect((await call(a.token, { jsonrpc: "2.0", id: 3, method: "tools/list" }, { "mcp-session-id": sessionA })).status).toBe(404); // must re-initialize
    expect((await json(await call(b.token, { jsonrpc: "2.0", id: 3, method: "tools/list" }, { "mcp-session-id": sessionB }))).result?.tab).toBe("ws_b");
    expect(tabB.frames.some((f) => f.type === "replaced")).toBe(false);
  });

  it("a tab's reply is only accepted for its own workspace", async () => {
    const a = connectTab(services, "ws_a");
    const b = connectTab(services, "ws_b");
    const relayA = services.relays.existing("ws_a")!;
    // B's bridge id presented to A's relay (as a hostile tab posting with its own owner secret would) matches nothing.
    expect(relayA.fromTab(b.bridgeId(), "s", { jsonrpc: "2.0", id: 1, result: {} })).toBe(false);
    expect(relayA.fromTab(a.bridgeId(), "s", { jsonrpc: "2.0", id: 1, result: {} })).toBe(true);
  });

  it("another credential of the same workspace can't use or end a session it didn't open", async () => {
    connectTab(services, "ws_a");
    const one = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const two = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const session = (await call(one.token, initialize())).headers.get("mcp-session-id")!;
    expect((await call(two.token, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": session })).status).toBe(404);
    const del = await handleClientRequest(request("/api/mcp", { method: "DELETE", headers: { ...bearer(two.token), "mcp-session-id": session } }), { token: two.token, kinds: ["bearer"] }, services);
    expect(del.status).toBe(404);
  });
});

describe("credential kinds, scope and origin", () => {
  it("a bearer token isn't a secret URL and a secret URL isn't a bearer token", async () => {
    connectTab(services, "ws_a");
    const b = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const s = services.credentials.issue("ws_a", { kind: "secret-url", scope: "propose" });
    expect((await callSecret(b.token, initialize())).status).toBe(401);
    expect((await call(s.token, initialize())).status).toBe(401);
    expect((await callSecret(s.token, initialize())).status).toBe(200);
    expect((await call(b.token, initialize())).status).toBe(200);
  });

  it("marks sessions remote unless they are a local bearer on loopback, and carries the credential's scope", async () => {
    vi.stubEnv("MCP_ALLOWED_HOSTS", "tunnel.example.com");
    const tab = connectTab(services, "ws_a");
    const local = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const secret = services.credentials.issue("ws_a", { kind: "secret-url", scope: "read" });
    await call(local.token, initialize());
    await callSecret(secret.token, initialize(), {}, "tunnel.example.com");
    await call(local.token, initialize(), {}, "tunnel.example.com"); // a bearer token arriving through the tunnel is remote too
    expect(tab.messages().map((m) => [m.remote, m.scope])).toEqual([
      [false, "propose"],
      [true, "read"],
      [true, "propose"],
    ]);
  });

  it("refuses unknown hosts and browser origins, and never wildcards", async () => {
    connectTab(services, "ws_a");
    const a = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    expect((await call(a.token, initialize(), {}, "evil.example.com")).status).toBe(403);
    expect((await call(a.token, initialize(), { origin: "https://evil.example.com" })).status).toBe(403);
    vi.stubEnv("MCP_ALLOWED_HOSTS", "*");
    expect((await call(a.token, initialize(), {}, "evil.example.com")).status).toBe(403);
  });

  it("GET offers no stream (405) and malformed bodies are 400", async () => {
    connectTab(services, "ws_a");
    const a = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const get = await handleClientRequest(request("/api/mcp", { method: "GET", headers: bearer(a.token) }), { token: a.token, kinds: ["bearer"] }, services);
    expect(get.status).toBe(405);
    const bad = await handleClientRequest(new Request("http://localhost:3000/api/mcp", { method: "POST", headers: { host: "localhost:3000", ...bearer(a.token) }, body: "{nope" }), { token: a.token, kinds: ["bearer"] }, services);
    expect(bad.status).toBe(400);
  });
});

describe("revocation, expiry and rate limiting", () => {
  it("revoking a credential stops it at once and ends its live sessions in the tab", async () => {
    const tab = connectTab(services, "ws_a");
    const a = services.credentials.issue("ws_a", { kind: "secret-url", scope: "propose" });
    const session = (await callSecret(a.token, initialize())).headers.get("mcp-session-id")!;
    services.credentials.revoke("ws_a", a.id);
    expect((await callSecret(a.token, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": session })).status).toBe(401);
    expect(tab.frames.some((f) => f.type === "close" && f.sessionId === session)).toBe(true);
  });

  it("an expired secret URL stops working", async () => {
    let now = 0;
    services = createMcpServices(() => now);
    connectTab(services, "ws_a");
    const a = services.credentials.issue("ws_a", { kind: "secret-url", scope: "propose", ttlMs: 1000 });
    expect((await callSecret(a.token, initialize())).status).toBe(200);
    now = 1001;
    expect((await callSecret(a.token, initialize())).status).toBe(401);
  });

  it("rate-limits a credential", async () => {
    connectTab(services, "ws_a");
    const a = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await call(a.token, initialize(i))).status;
    expect(last).toBe(429);
  });

  it("blocks an address that keeps presenting bad tokens, even before it tries a good one", async () => {
    connectTab(services, "ws_a");
    const a = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const statuses: number[] = [];
    for (let i = 0; i < 23; i++) statuses.push((await call(`acm_${"x".repeat(43)}`, initialize(i), { "x-forwarded-for": "203.0.113.9" })).status);
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await call(a.token, initialize(), { "x-forwarded-for": "203.0.113.9" })).status).toBe(429);
    expect((await call(a.token, initialize(), { "x-forwarded-for": "198.51.100.1" })).status).toBe(200); // other addresses are unaffected
  });
});

describe("safe logging", () => {
  it("never logs a token, a secret URL, an owner secret or a pairing code", async () => {
    connectTab(services, "ws_a");
    const bearerCred = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const secret = services.credentials.issue("ws_a", { kind: "secret-url", scope: "propose" });
    const logs = watchLogs(() => [bearerCred.token, secret.token, OWNER_A]);
    try {
      await call(bearerCred.token, initialize());
      await callSecret(secret.token, initialize());
      await call(`${bearerCred.token}x`, initialize()); // a bad attempt
      await callSecret("acm_bad", initialize());
      expect(logs.leaked()).toEqual([]);
    } finally {
      logs.restore();
    }
  });

  it("error responses never echo the credential", async () => {
    connectTab(services, "ws_a");
    const secret = services.credentials.issue("ws_a", { kind: "secret-url", scope: "propose" });
    services.credentials.revoke("ws_a", secret.id);
    const res = await callSecret(secret.token, initialize());
    expect(await res.text()).not.toContain(secret.token);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("bearerOf", () => {
  it("reads only a well-formed Authorization: Bearer header", () => {
    const get = (value?: string) => bearerOf(new Request("http://x", value ? { headers: { authorization: value } } : {}));
    expect(get("Bearer abc")).toBe("abc");
    expect(get("bearer abc")).toBe("abc");
    expect(get("Basic abc")).toBeNull();
    expect(get("Bearer a b")).toBeNull();
    expect(get()).toBeNull();
  });
});

describe("owner routes (bridge + access)", () => {
  // The routes use the process-wide services; give each test a fresh set.
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).__acuteMcpServices;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__acuteMcpServices;
  });

  const keyOf = (workspaceId: string, secret: string) => ownerKey({ workspaceId, secret });
  const asNext = (req: Request) => new NextRequest(req.url, { method: req.method, headers: req.headers, ...(req.method === "GET" ? {} : ({ body: req.body, duplex: "half" } as object)) });
  const access = async (workspaceId: string, secret: string, body: unknown) => {
    const { POST } = await import("@/app/api/mcp/access/route");
    return POST(asNext(ownerRequest("/api/mcp/access", workspaceId, secret, body)));
  };

  it("returns a server-issued bearer credential that works only for this owner's workspace", async () => {
    const res = await access("ws_a", OWNER_A, { action: "ensure" });
    expect(res.status).toBe(200);
    const { bearer } = (await res.json()) as { bearer: { id: string; token: string } };
    expect(bearer.token).toMatch(/^acm_[A-Za-z0-9_-]{43}$/);
    const { getMcpServices } = await import("./store");
    expect(getMcpServices().credentials.authenticate(bearer.token)).toMatchObject({ workspaceId: keyOf("ws_a", OWNER_A), kind: "bearer" });
    // Asking again with the id it holds doesn't mint another.
    const again = (await (await access("ws_a", OWNER_A, { action: "ensure", bearerId: bearer.id })).json()) as { bearer: unknown };
    expect(again.bearer).toBeNull();
  });

  it("two browsers with the same workspace id get separate namespaces: neither can see, take over or lock out the other", async () => {
    const a = (await (await access("default", OWNER_A, { action: "ensure" })).json()) as { bearer: { id: string; token: string } };
    const b = (await (await access("default", OWNER_B, { action: "ensure" })).json()) as { bearer: { id: string; token: string }; credentials: { id: string }[] };
    expect(b.bearer.id).not.toBe(a.bearer.id);
    expect(b.credentials.map((x) => x.id)).toEqual([b.bearer.id]); // B sees only its own
    const { getMcpServices } = await import("./store");
    const live = getMcpServices();
    expect(live.credentials.authenticate(a.bearer.token)?.workspaceId).not.toBe(live.credentials.authenticate(b.bearer.token)?.workspaceId);
    // B can't revoke A's credential by naming its id, and A is unaffected by anything B does.
    expect((await access("default", OWNER_B, { action: "revoke", credentialId: a.bearer.id })).status).toBe(404);
    expect((await access("default", OWNER_B, { action: "revoke-all" })).status).toBe(200);
    expect(live.credentials.authenticate(a.bearer.token)).not.toBeNull();
    expect(live.credentials.authenticate(b.bearer.token)).toBeNull();
  });

  it("refuses requests without a well-formed owner secret", async () => {
    for (const secret of ["short", "x".repeat(300)]) expect((await access("ws_a", secret, { action: "ensure" })).status).toBe(403);
    const { POST } = await import("@/app/api/mcp/access/route");
    const missing = request("/api/mcp/access", { headers: { "sec-fetch-site": "same-origin", "x-acute-mcp-workspace": "ws_a" }, body: { action: "ensure" } });
    expect((await POST(asNext(missing))).status).toBe(403);
  });

  it("secret URLs are issued with a bounded lifetime and scope; the listing never shows tokens", async () => {
    await access("ws_a", OWNER_A, { action: "ensure" });
    const res = await access("ws_a", OWNER_A, { action: "issue-secret-url", scope: "read", ttlMs: 10 * 365 * 24 * 3600 * 1000 });
    const body = (await res.json()) as { secretUrl: { token: string; expiresAt: number; scope: string }; credentials: unknown[] };
    expect(body.secretUrl.scope).toBe("read");
    expect(body.secretUrl.expiresAt - Date.now()).toBeLessThanOrEqual(7 * 24 * 3600 * 1000 + 5000);
    const listed = await (await access("ws_a", OWNER_A, { action: "list" })).text();
    expect(listed).not.toContain(body.secretUrl.token);
  });

  it("owner routes refuse cross-site requests and unknown hosts", async () => {
    const { POST } = await import("@/app/api/mcp/access/route");
    const crossSite = request("/api/mcp/access", { headers: { "sec-fetch-site": "cross-site", "x-acute-mcp-workspace": "ws_a", "x-acute-mcp-owner": OWNER_A }, body: { action: "ensure" } });
    expect((await POST(asNext(crossSite))).status).toBe(403);
    const wrongHost = request("/api/mcp/access", { host: "evil.example.com", headers: { "sec-fetch-site": "same-origin", "x-acute-mcp-workspace": "ws_a", "x-acute-mcp-owner": OWNER_A }, body: { action: "ensure" } });
    expect((await POST(asNext(wrongHost))).status).toBe(403);
    expect((await POST(asNext(ownerRequest("/api/mcp/access", "ws_a", OWNER_A, { action: "ensure" })))).status).toBe(200);
  });

  it("the bridge attaches a tab only to its own owner namespace, and delivers replies only there", async () => {
    const bridge = await import("@/app/api/mcp/bridge/route");
    const { getMcpServices } = await import("./store");

    // A and B use the same workspace id; B attaching must not evict A.
    const aStream = bridge.GET(asNext(ownerRequest("/api/mcp/bridge", "ws_a", OWNER_A, undefined, "GET")));
    const bStream = bridge.GET(asNext(ownerRequest("/api/mcp/bridge", "ws_a", OWNER_B, undefined, "GET")));
    expect(aStream.status).toBe(200);
    expect(bStream.status).toBe(200);
    const live = getMcpServices();
    expect(live.relays.existing(keyOf("ws_a", OWNER_A))?.connected).toBe(true);
    expect(live.relays.existing(keyOf("ws_a", OWNER_B))?.connected).toBe(true);

    const readHello = async (res: Response) => {
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      reader.releaseLock();
      return (JSON.parse(new TextDecoder().decode(value).trim()) as { bridgeId: string }).bridgeId;
    };
    const idA = await readHello(aStream);
    const idB = await readHello(bStream);

    const post = (workspaceId: string, secret: string, bridgeId: string) =>
      bridge.POST(asNext(ownerRequest("/api/mcp/bridge", workspaceId, secret, { workspaceId, bridgeId, sessionId: "s", message: { jsonrpc: "2.0", id: 1, result: {} } })));
    expect((await post("ws_a", OWNER_A, idB)).status).toBe(409); // B's bridge id means nothing to A's relay
    expect((await post("ws_a", OWNER_B, idA)).status).toBe(409); // and A's means nothing to B's
    expect((await post("ws_a", OWNER_A, idA)).status).toBe(204);
    expect((await post("ws_a", OWNER_B, idB)).status).toBe(204);
    void aStream.body!.cancel();
    void bStream.body!.cancel();
  });

  it("a secret-URL request through the route reaches the right owner's workspace", async () => {
    const issued = (await (await access("ws_a", OWNER_A, { action: "ensure" })).json()) as { bearer: { token: string } };
    const secretBody = (await (await access("ws_a", OWNER_A, { action: "issue-secret-url" })).json()) as { secretUrl: { token: string } };
    const { getMcpServices } = await import("./store");
    const tab = connectTab(getMcpServices(), keyOf("ws_a", OWNER_A));
    const other = connectTab(getMcpServices(), keyOf("ws_a", OWNER_B));
    const route = await import("@/app/api/mcp/s/[token]/route");
    const res = await route.POST(asNext(request(`/api/mcp/s/${secretBody.secretUrl.token}`, { body: initialize() })), { params: Promise.resolve({ token: secretBody.secretUrl.token }) });
    expect(res.status).toBe(200);
    expect(tab.messages()[0]).toMatchObject({ remote: true, scope: "propose" });
    expect(other.messages()).toHaveLength(0);
    // The bearer token isn't accepted on the secret-URL route.
    const wrong = await route.POST(asNext(request(`/api/mcp/s/${issued.bearer.token}`, { body: initialize() })), { params: Promise.resolve({ token: issued.bearer.token }) });
    expect(wrong.status).toBe(401);
  });
});
