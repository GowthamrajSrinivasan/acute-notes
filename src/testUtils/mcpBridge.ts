/** Helpers for the MCP bridge tests: fake tabs and requests against `createMcpServices()`. */
import { vi } from "vitest";
import type { BridgeFrame } from "@/mcp/bridge/protocol";
import type { McpServices } from "@/mcp/bridge/store";

export const OWNER_A = "a".repeat(64);
export const OWNER_B = "b".repeat(64);

export const initialize = (id = 1) => ({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "chatgpt", version: "1" } } });

/** A tab serving `workspaceId` that answers every request with `{ tab: label, echo: method, params }` and records its frames. */
export function connectTab(services: McpServices, workspaceId: string, label = workspaceId) {
  const frames: BridgeFrame[] = [];
  let bridgeId = "";
  const relay = services.relays.relayFor(workspaceId);
  const attached = relay.attachTab(
    (f) => {
      frames.push(f);
      if (f.type === "hello") bridgeId = f.bridgeId;
      if (f.type === "message" && "method" in f.message && "id" in f.message) {
        const { id, method } = f.message;
        const params = "params" in f.message ? f.message.params : undefined;
        queueMicrotask(() => relay.fromTab(bridgeId, f.sessionId, { jsonrpc: "2.0", id, result: { tab: label, echo: method, params } }));
      }
    },
    () => {},
  );
  return { frames, attached, bridgeId: () => bridgeId, messages: () => frames.filter((f): f is Extract<BridgeFrame, { type: "message" }> => f.type === "message") };
}

export interface RequestOptions {
  method?: string;
  host?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** A request as a client reaches the server (Host header included, which `Request` leaves empty). */
export function request(path: string, { method = "POST", host = "localhost:3000", headers = {}, body }: RequestOptions = {}): Request {
  return new Request(`http://${host}${path}`, {
    method,
    headers: { host, "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** An owner call made by the app's own page (same-origin). */
export function ownerRequest(path: string, workspaceId: string, ownerSecret: string, body?: unknown, method = "POST"): Request {
  return request(path, {
    method,
    headers: { "sec-fetch-site": "same-origin", "x-acute-mcp-workspace": workspaceId, "x-acute-mcp-owner": ownerSecret },
    ...(body === undefined ? {} : { body }),
  });
}

/** Fails the test run if anything is logged that contains one of `secrets`. */
export function watchLogs(secrets: () => string[]) {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
  return {
    leaked(): string[] {
      const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")));
      return secrets().filter((secret) => logged.some((line) => line.includes(secret)));
    },
    restore() {
      for (const s of spies) s.mockRestore();
    },
  };
}
