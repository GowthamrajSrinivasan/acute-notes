/**
 * The server half of the MCP bridge (see `protocol.ts`): a relay between
 * external MCP clients (Streamable HTTP, JSON responses only) and the one
 * browser tab currently serving **one workspace**. It holds no workspace data
 * and runs no MCP server itself — the tab does, over its own IndexedDB data, so
 * the live selection/current context and F21's reviewable proposals stay in
 * the app.
 *
 * - One `McpRelay` per workspace (`RelayStore`, `./store.ts`); a workspace's
 *   relay never sees another workspace's tab, sessions or requests. Who may
 *   talk to it is decided before a call gets here (`credentials.ts`).
 * - The newest tab of a workspace wins, and every session of the previous one
 *   is dropped (clients re-initialize, per spec). Other workspaces are untouched.
 * - Each session is bound to the credential that opened it: another credential
 *   (even for the same workspace) can't use its session id.
 * - Server → client streams (GET) aren't offered: every reply is the JSON
 *   response to its POST.
 *
 * Framework-free (the routes adapt it), so it is unit-tested directly.
 */
import { randomUUID } from "node:crypto";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { BridgeFrame, McpScope } from "./protocol";

/** How long a client request waits for the tab's reply. */
export const REPLY_TIMEOUT_MS = 30_000;
/** How often the bridge stream is pinged. */
export const PING_INTERVAL_MS = 15_000;

/** Server-defined JSON-RPC error codes. */
export const RELAY_ERRORS = { notConnected: -32001, timeout: -32002, sessionNotFound: -32003 } as const;

export const NOT_CONNECTED_MESSAGE =
  "Acute-Notes isn't connected. Open it in a browser and turn on MCP access for the workspace (⋮ → MCP access).";

export interface ClientReply {
  status: number;
  /** JSON body, if any. */
  body?: unknown;
  headers?: Record<string, string>;
}

/** Who is calling, as decided by authentication (never by the request body). */
export interface Caller {
  credentialId: string;
  /** True unless this is a local bearer token on this machine's loopback; remote sessions can never auto-accept. */
  remote: boolean;
  scope: McpScope;
}

interface Tab {
  id: string;
  send(frame: BridgeFrame): void;
  close(): void;
}

interface Session {
  credentialId: string;
  remote: boolean;
  scope: McpScope;
}

interface Pending {
  resolve(message: JSONRPCMessage): void;
  timer: ReturnType<typeof setTimeout>;
}

type Id = string | number;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hasId = (m: Record<string, unknown>): m is Record<string, unknown> & { id: Id } => typeof m.id === "string" || typeof m.id === "number";
const rpcError = (id: Id | null, code: number, message: string) => ({ jsonrpc: "2.0" as const, id, error: { code, message } });

export class McpRelay {
  private tab: Tab | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Pending>();

  /** Whether a tab is serving this workspace now. */
  get connected(): boolean {
    return this.tab !== null;
  }

  /**
   * A tab opens the bridge. `send` writes one frame to its stream, `close` ends it.
   * Returns the bridge id and the function to call when the stream goes away.
   */
  attachTab(send: (frame: BridgeFrame) => void, close: () => void): { bridgeId: string; detach(): void } {
    const previous = this.tab;
    if (previous) {
      previous.send({ type: "replaced" });
      previous.close();
    }
    this.dropSessions();
    const tab: Tab = { id: randomUUID(), send, close };
    this.tab = tab;
    send({ type: "hello", bridgeId: tab.id });
    return {
      bridgeId: tab.id,
      detach: () => {
        if (this.tab !== tab) return;
        this.tab = null;
        this.dropSessions();
      },
    };
  }

  /** A reply from the tab. False when it comes from a tab that is no longer the current one. */
  fromTab(bridgeId: string, sessionId: string, message: unknown): boolean {
    if (!this.tab || this.tab.id !== bridgeId || !isObject(message) || !hasId(message)) return false;
    if (!("result" in message) && !("error" in message)) return true; // a server → client request: no stream to deliver it on
    const key = pendingKey(sessionId, message.id);
    const waiting = this.pending.get(key);
    if (!waiting) return true;
    this.pending.delete(key);
    clearTimeout(waiting.timer);
    waiting.resolve(message as JSONRPCMessage);
    return true;
  }

  /** One POSTed client message (already authenticated as `caller`). */
  async fromClient(body: unknown, sessionHeader: string | null, caller: Caller): Promise<ClientReply> {
    if (!isObject(body) || body.jsonrpc !== "2.0") {
      return { status: 400, body: rpcError(null, -32600, "Expected one JSON-RPC 2.0 message (batches aren't supported).") };
    }
    const id = hasId(body) ? body.id : null;
    const isRequest = typeof body.method === "string" && id !== null;
    const tab = this.tab;
    if (!tab) return { status: 503, body: rpcError(id, RELAY_ERRORS.notConnected, NOT_CONNECTED_MESSAGE) };

    let sessionId: string;
    if (body.method === "initialize") {
      sessionId = randomUUID();
      this.sessions.set(sessionId, { credentialId: caller.credentialId, remote: caller.remote, scope: caller.scope });
    } else if (!sessionHeader) {
      // Not an initialize and no session: a legacy-protocol request can't proceed (HTTP 400 per the Streamable HTTP
      // spec). Newer clients probe with a stateless \`server/discover\` first and read exactly this plain 400 as "this
      // server speaks the legacy protocol, fall back to initialize"; a 404 reads as "no such endpoint" (seen in the
      // real ChatGPT spike).
      return { status: 400, body: rpcError(id, -32600, "Bad Request: send initialize first and include its Mcp-Session-Id header.") };
    } else {
      const session = this.sessions.get(sessionHeader);
      if (!session || session.credentialId !== caller.credentialId) {
        return { status: 404, body: rpcError(id, RELAY_ERRORS.sessionNotFound, "Session not found; initialize a new one.") };
      }
      sessionId = sessionHeader;
    }

    const headers = { "mcp-session-id": sessionId };
    const session = this.sessions.get(sessionId)!;
    if (!isRequest) {
      tab.send({ type: "message", sessionId, message: body as JSONRPCMessage, remote: session.remote, scope: session.scope });
      return { status: 202, headers };
    }
    const reply = await this.forward(tab, sessionId, id!, body as JSONRPCMessage, session);
    if (body.method === "initialize" && "error" in reply) this.sessions.delete(sessionId);
    return { status: 200, body: reply, headers };
  }

  /** The client ended its session (HTTP DELETE). Only the credential that opened it may end it. */
  endSession(sessionId: string | null, credentialId: string): boolean {
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!sessionId || !session || session.credentialId !== credentialId) return false;
    this.sessions.delete(sessionId);
    this.tab?.send({ type: "close", sessionId });
    return true;
  }

  /** A credential was revoked: its sessions end now (the tab is told), and their waiting requests fail. */
  dropCredential(credentialId: string): void {
    for (const [sessionId, session] of [...this.sessions]) {
      if (session.credentialId !== credentialId) continue;
      this.sessions.delete(sessionId);
      this.tab?.send({ type: "close", sessionId });
      this.failPending(sessionId);
    }
  }

  private forward(tab: Tab, sessionId: string, id: Id, message: JSONRPCMessage, session: Session): Promise<JSONRPCMessage> {
    return new Promise((resolve) => {
      const key = pendingKey(sessionId, id);
      const timer = setTimeout(() => {
        this.pending.delete(key);
        resolve(rpcError(id, RELAY_ERRORS.timeout, "Acute-Notes didn't answer in time.") as JSONRPCMessage);
      }, REPLY_TIMEOUT_MS);
      this.pending.set(key, { resolve, timer });
      tab.send({ type: "message", sessionId, message, remote: session.remote, scope: session.scope });
    });
  }

  private failPending(sessionId: string): void {
    for (const [key, waiting] of [...this.pending]) {
      if (!key.startsWith(`${sessionId}\u0000`)) continue;
      clearTimeout(waiting.timer);
      this.pending.delete(key);
      waiting.resolve(rpcError(JSON.parse(key.slice(key.indexOf("\u0000") + 1)) as Id, RELAY_ERRORS.notConnected, NOT_CONNECTED_MESSAGE) as JSONRPCMessage);
    }
  }

  /** Every session ends with the tab that served it; their waiting requests fail at once. */
  private dropSessions(): void {
    this.sessions.clear();
    for (const [key, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      const id = JSON.parse(key.slice(key.indexOf("\u0000") + 1)) as Id;
      waiting.resolve(rpcError(id, RELAY_ERRORS.notConnected, NOT_CONNECTED_MESSAGE) as JSONRPCMessage);
    }
    this.pending.clear();
  }
}

function pendingKey(sessionId: string, id: Id): string {
  return `${sessionId}\u0000${JSON.stringify(id)}`;
}

/** The host names that mean this machine. */
function isLoopbackName(name: string): boolean {
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

function hostName(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
}

/** Whether `host` (a Host header) names this machine: DNS-rebinding protection for the client endpoint. */
export function isLoopbackHost(host: string | null): boolean {
  return !!host && isLoopbackName(hostName(host));
}

/**
 * The public hosts this deployment answers on besides loopback: `MCP_ALLOWED_HOSTS`, a comma-separated list of exact
 * host names (a tunnel's, or the hosted app's own). No wildcards, and never derived from a request.
 */
export function configuredHosts(): string[] {
  return (process.env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** Loopback, or exactly one of the configured public hosts (port ignored). */
export function isAllowedHost(host: string | null): boolean {
  if (!host) return false;
  if (isLoopbackHost(host)) return true;
  return configuredHosts().includes(hostName(host).toLowerCase());
}

/** A browser Origin, if present, must be an allowed host too (clients like Claude Code and ChatGPT send none). */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  try {
    return isAllowedHost(new URL(origin).host);
  } catch {
    return false;
  }
}
