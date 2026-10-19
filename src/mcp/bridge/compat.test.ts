/**
 * Transport and OAuth compatibility, checked with the official MCP SDK's Streamable HTTP *client* (and its OAuth
 * client helpers) against our server stack: the real MCP server in a tab, the relay, the credential store and the
 * route handlers, all in memory. A spec-following client is the closest stand-in for ChatGPT's connector that an
 * automated test can be — it does NOT prove ChatGPT itself works (that needs the manual spike, S1–S9 in
 * `.ai/docs/chatgpt-mcp-architecture-and-test-plan.md`).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { createAcuteMcpServer } from "../server";
import { handleClientRequest, bearerOf } from "./http";
import { authorizationServerMetadata, authorizePost, protectedResourceMetadata, registerClient, token } from "./oauthHttp";
import { startTabBridge } from "./tabBridge";
import { createMcpServices, type McpServices } from "./store";

const HOST = "notes.example.com";
const BASE = `https://${HOST}`;
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const OWNER = "o".repeat(64);

let services: McpServices;
let stopTab: (() => void) | null = null;

/** The server's routes, as a `fetch` the SDK client can use. */
function serverFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = new Headers(init?.headers);
    headers.set("host", url.host);
    const req = new Request(url, { ...init, headers });
    const path = url.pathname;
    if (path === "/api/mcp") return handleClientRequest(req, { token: bearerOf(req), kinds: ["bearer", "oauth"] }, services);
    if (path.startsWith("/api/mcp/s/")) return handleClientRequest(req, { token: decodeURIComponent(path.slice("/api/mcp/s/".length)), kinds: ["secret-url"] }, services);
    if (path.startsWith("/.well-known/oauth-protected-resource")) return protectedResourceMetadata();
    if (path.startsWith("/.well-known/oauth-authorization-server")) return authorizationServerMetadata();
    if (path === "/oauth/register") return registerClient(req, services);
    if (path === "/oauth/token") return token(req, services);
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
}

/** The bridge route's two halves, played against the workspace's relay (as the tab's own fetch). */
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

async function serveWorkspace(workspaceId: string, onSession?: (s: { remote: boolean; scope: string }) => void) {
  const memory = createMemoryServices();
  await memory.workspaces.put({ id: workspaceId, name: "Notes", canvasIds: [], createdAt: 1, updatedAt: 1 } as never);
  const statuses: string[] = [];
  stopTab = startTabBridge({
    workspaceId,
    ownerSecret: OWNER,
    fetch: bridgeFetch(workspaceId),
    createServer: ({ sessionId, remote, scope }) => {
      onSession?.({ remote, scope });
      return createAcuteMcpServer({ services: memory, workspaceId, sessionId, remote, repoMap: { services: { store: memory.repoMaps, contentSources: memory.contentSources } }, getCurrentContext: async () => null, toolPolicy: () => ({ allowWrites: scope === "propose" }) });
    },
    onStatus: (s) => statuses.push(s),
  });
  await vi.waitFor(() => expect(statuses).toContain("connected"));
}

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubEnv("MCP_ALLOWED_HOSTS", HOST);
  vi.stubEnv("MCP_PUBLIC_BASE_URL", BASE);
  vi.stubEnv("MCP_OAUTH_FEATURE", "on");
  services = createMcpServices();
});
afterEach(() => {
  stopTab?.();
  stopTab = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const toolNames = async (client: Client) => (await client.listTools()).tools.map((t) => t.name);

describe("the SDK's Streamable HTTP client against a secret URL (ChatGPT 'No authentication')", () => {
  it("initializes, lists tools and resources, and reads this workspace — through JSON-only responses and a 405 on GET", async () => {
    const seen: { remote: boolean; scope: string }[] = [];
    await serveWorkspace("ws_a", (s) => seen.push(s));
    const secret = services.credentials.issue("ws_a", { kind: "secret-url", scope: "propose" });
    const client = new Client({ name: "chatgpt-like", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp/s/${secret.token}`), { fetch: serverFetch() }));
    try {
      const tools = await toolNames(client);
      expect(tools).toEqual(expect.arrayContaining(["search_workspace", "create_block"]));
      // Remote clients aren't offered the repo-map tools (their auto-accept path is per map session).
      expect(tools).not.toContain("begin_repo_map");
      const resource = await client.readResource({ uri: "acute://workspace/ws_a" });
      expect(resource.contents[0]?.uri).toBe("acute://workspace/ws_a");
      expect(seen).toEqual([{ remote: true, scope: "propose" }]);
    } finally {
      await client.close();
    }
  });

  it("a read-only credential is offered the tools but can't propose", async () => {
    await serveWorkspace("ws_a");
    const secret = services.credentials.issue("ws_a", { kind: "secret-url", scope: "read" });
    const client = new Client({ name: "chatgpt-like", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp/s/${secret.token}`), { fetch: serverFetch() }));
    try {
      const res = await client.callTool({ name: "create_block", arguments: { markdown: "hello" } });
      expect(res.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("revoking the secret URL ends the client's access immediately", async () => {
    await serveWorkspace("ws_a");
    const secret = services.credentials.issue("ws_a", { kind: "secret-url", scope: "propose" });
    const client = new Client({ name: "chatgpt-like", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp/s/${secret.token}`), { fetch: serverFetch() }));
    try {
      expect((await toolNames(client)).length).toBeGreaterThan(0);
      services.credentials.revoke("ws_a", secret.id);
      await expect(toolNames(client)).rejects.toThrow();
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  it("with the tab gone, the client gets a clear 'not connected' error rather than a hang", async () => {
    await serveWorkspace("ws_a");
    const secret = services.credentials.issue("ws_a", { kind: "secret-url", scope: "propose" });
    stopTab?.();
    stopTab = null;
    await vi.waitFor(() => expect(services.relays.existing("ws_a")?.connected).toBe(false));
    const client = new Client({ name: "chatgpt-like", version: "1.0.0" });
    await expect(client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp/s/${secret.token}`), { fetch: serverFetch() }))).rejects.toThrow(/503|isn't connected/i);
  });
});

describe("the SDK's Streamable HTTP client with a bearer token (local agents)", () => {
  it("works with the bearer credential and is marked local on loopback", async () => {
    const seen: { remote: boolean; scope: string }[] = [];
    await serveWorkspace("ws_a", (s) => seen.push(s));
    const bearer = services.credentials.issue("ws_a", { kind: "bearer", scope: "propose" });
    const fetchLoopback = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const headers = new Headers(init?.headers);
      headers.set("host", "localhost:3000");
      return handleClientRequest(new Request(url, { ...init, headers }), { token: bearerOf(new Request(url, { headers })), kinds: ["bearer", "oauth"] }, services);
    }) as typeof fetch;
    const client = new Client({ name: "claude-code", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), { fetch: fetchLoopback, requestInit: { headers: { authorization: `Bearer ${bearer.token}` } } }));
    try {
      expect(await toolNames(client)).toContain("begin_repo_map"); // local agents keep the full tool set
      expect(seen).toEqual([{ remote: false, scope: "propose" }]);
    } finally {
      await client.close();
    }
  });
});

describe("the SDK's OAuth client flow against our authorization server (ChatGPT 'OAuth')", () => {
  /** An in-memory OAuth client, standing in for ChatGPT's connector. */
  function makeProvider() {
    let info: OAuthClientInformationMixed | undefined;
    let tokens: OAuthTokens | undefined;
    let verifier = "";
    let authorizeUrl: URL | null = null;
    const provider: OAuthClientProvider = {
      get redirectUrl() {
        return REDIRECT;
      },
      get clientMetadata(): OAuthClientMetadata {
        return { client_name: "ChatGPT", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
      },
      state: () => "state-123",
      clientInformation: () => info,
      saveClientInformation: (i) => void (info = i),
      tokens: () => tokens,
      saveTokens: (t) => void (tokens = t),
      redirectToAuthorization: (url) => void (authorizeUrl = url),
      saveCodeVerifier: (v) => void (verifier = v),
      codeVerifier: () => verifier,
    };
    return { provider, authorizeUrl: () => authorizeUrl, tokens: () => tokens };
  }

  it("discovers, registers, runs PKCE with a pairing-code approval, and then calls tools with the access token", async () => {
    await serveWorkspace("ws_a");
    const { provider, authorizeUrl, tokens } = makeProvider();
    const serverUrl = `${BASE}/api/mcp`;
    const fetchFn = serverFetch();

    // 1. The unauthenticated request 401s with discovery; the client registers and asks to be sent to the authorize endpoint.
    const first = await auth(provider, { serverUrl, fetchFn });
    expect(first).toBe("REDIRECT");
    const url = authorizeUrl()!;
    expect(url.origin + url.pathname).toBe(`${BASE}/oauth/authorize`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource")).toBe(`${BASE}/api/mcp`);

    // 2. The owner approves in the page with the pairing code shown in their own Acute-Notes tab.
    const { code: pairing } = services.credentials.createPairingCode("ws_a");
    const fields = new URLSearchParams([...url.searchParams.entries(), ["pairing_code", pairing], ["decision", "approve"]]);
    const approval = await authorizePost(new Request(`${BASE}/oauth/authorize`, { method: "POST", headers: { host: HOST, "content-type": "application/x-www-form-urlencoded" }, body: fields.toString() }), services);
    expect(approval.status).toBe(302);
    const redirect = new URL(approval.headers.get("location")!);
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
    expect(redirect.searchParams.get("state")).toBe("state-123");
    expect(redirect.searchParams.get("iss")).toBe(BASE);

    // 3. The client finishes the exchange.
    expect(await auth(provider, { serverUrl, authorizationCode: redirect.searchParams.get("code")!, fetchFn })).toBe("AUTHORIZED");
    expect(tokens()?.access_token).toMatch(/^acm_/);
    expect(tokens()?.refresh_token).toMatch(/^acr_/);

    // 4. Tool calls with the OAuth token reach this workspace's tab.
    const client = new Client({ name: "chatgpt-like", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), { fetch: fetchFn, authProvider: provider }));
    try {
      expect(await toolNames(client)).toContain("search_workspace");
    } finally {
      await client.close();
    }
  });

  it("with OAuth off, the 401 carries no discovery pointer and the SDK flow can't start", async () => {
    vi.stubEnv("MCP_OAUTH_FEATURE", "off");
    await serveWorkspace("ws_a");
    const { provider } = makeProvider();
    await expect(auth(provider, { serverUrl: `${BASE}/api/mcp`, fetchFn: serverFetch() })).rejects.toThrow();
  });
});
