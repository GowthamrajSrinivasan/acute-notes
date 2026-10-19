/**
 * The tab half of the MCP bridge (see `protocol.ts`): opens the relay's
 * stream for this tab's workspace, runs one MCP server per client session here
 * in the tab (over this workspace's own data), and posts every reply back.
 * Reconnects with backoff when the stream drops; when another tab of the same
 * workspace takes over it stops until this tab is focused again, then takes
 * back over. The tab proves it belongs to the workspace's owner with the owner
 * secret on every request.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { BRIDGE_OWNER_HEADER, BRIDGE_WORKSPACE_HEADER, type BridgeFrame, type BridgeReply, type McpScope } from "./protocol";

export type BridgeStatus = "connecting" | "connected" | "replaced" | "offline";

/** What the relay says about the client that opened a session. */
export interface SessionInfo {
  sessionId: string;
  /** Not a trusted local client: its session can never auto-accept. */
  remote: boolean;
  scope: McpScope;
}

export interface TabBridgeOptions {
  workspaceId: string;
  ownerSecret: string;
  /** A fresh, unconnected server for one client session. */
  createServer(session: SessionInfo): McpServer;
  /** Called before each connection attempt (e.g. to claim the workspace with the server); a rejection counts as an offline attempt. */
  beforeConnect?(): Promise<void>;
  onStatus?(status: BridgeStatus): void;
  /** Defaults to the app's own `/api/mcp/bridge`. */
  endpoint?: string;
  fetch?: typeof fetch;
}

const MAX_BACKOFF_MS = 30_000;

/** A transport whose messages arrive from the bridge stream and whose sends are posted back to the relay. */
class RelayedTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(
    readonly sessionId: string,
    private readonly post: (sessionId: string, message: JSONRPCMessage) => Promise<void>,
  ) {}

  async start(): Promise<void> {}

  send(message: JSONRPCMessage): Promise<void> {
    return this.post(this.sessionId, message).catch((err: unknown) => this.onerror?.(err instanceof Error ? err : new Error(String(err))));
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  deliver(message: JSONRPCMessage): void {
    this.onmessage?.(message);
  }
}

/** Starts serving MCP from this tab; returns the function that stops it. */
export function startTabBridge(options: TabBridgeOptions): () => void {
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const endpoint = options.endpoint ?? "/api/mcp/bridge";
  const sessions = new Map<string, { server: McpServer; transport: RelayedTransport }>();
  let stopped = false;
  let controller: AbortController | null = null;
  let bridgeId: string | null = null;
  let backoff = 1000;
  let retry: ReturnType<typeof setTimeout> | null = null;
  /** The relay said another tab took over. */
  let replaced = false;
  const setStatus = (s: BridgeStatus) => options.onStatus?.(s);
  const identity = { [BRIDGE_WORKSPACE_HEADER]: options.workspaceId, [BRIDGE_OWNER_HEADER]: options.ownerSecret };

  const post = async (sessionId: string, message: JSONRPCMessage) => {
    if (!bridgeId) return;
    const body: BridgeReply = { workspaceId: options.workspaceId, bridgeId, sessionId, message };
    await doFetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...identity }, body: JSON.stringify(body) });
  };

  const closeSessions = () => {
    for (const { server } of sessions.values()) void server.close();
    sessions.clear();
  };

  const onFrame = async (frame: BridgeFrame) => {
    switch (frame.type) {
      case "hello":
        bridgeId = frame.bridgeId;
        backoff = 1000;
        setStatus("connected");
        return;
      case "message": {
        let session = sessions.get(frame.sessionId);
        if (!session) {
          const transport = new RelayedTransport(frame.sessionId, post);
          const server = options.createServer({ sessionId: frame.sessionId, remote: frame.remote, scope: frame.scope });
          await server.connect(transport);
          session = { server, transport };
          sessions.set(frame.sessionId, session);
        }
        session.transport.deliver(frame.message);
        return;
      }
      case "close":
        void sessions.get(frame.sessionId)?.server.close();
        sessions.delete(frame.sessionId);
        return;
      case "replaced":
        replaced = true;
        return;
      case "ping":
        return;
    }
  };

  const connect = async () => {
    if (stopped) return;
    replaced = false;
    setStatus("connecting");
    controller = new AbortController();
    try {
      await options.beforeConnect?.();
      const res = await doFetch(endpoint, { headers: identity, signal: controller.signal, cache: "no-store" });
      if (!res.ok || !res.body) throw new Error(`bridge refused (${res.status})`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffered = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += value;
        let newline: number;
        while ((newline = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          if (line) await onFrame(JSON.parse(line) as BridgeFrame);
        }
      }
    } catch {
      // dropped, refused or aborted: handled below
    }
    bridgeId = null;
    closeSessions();
    if (stopped) return;
    if (replaced) {
      // Another tab serves this workspace now; take over again when the user comes back to this one.
      setStatus("replaced");
      return;
    }
    setStatus("offline");
    retry = setTimeout(() => void connect(), backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  const onFocus = () => {
    if (replaced && !stopped && document.visibilityState === "visible") void connect();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
  void connect();

  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    controller?.abort();
    closeSessions();
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onFocus);
  };
}
