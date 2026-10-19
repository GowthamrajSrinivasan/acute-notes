/**
 * The bridge between the MCP relay (a Next route, `src/app/api/mcp`) and the
 * browser tab that actually serves MCP (F20/F21 over the tab's own workspace
 * data). External clients speak Streamable HTTP to the relay; the relay
 * forwards each JSON-RPC message to the tab over one long-lived NDJSON stream
 * (`GET /api/mcp/bridge`) and the tab posts its replies back
 * (`POST /api/mcp/bridge`). Shared by both ends; no runtime code.
 *
 * Everything is keyed by workspace: a tab serves one workspace's relay, a
 * client credential reaches only the workspace it was issued for, and the
 * workspace id is never taken from a client message.
 */
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/** What a credential allows: reading, or reading and proposing changes (for the owner's review). */
export type McpScope = "read" | "propose";

/** Relay → tab, one JSON object per line. */
export type BridgeFrame =
  /** First frame: the id the tab quotes on every reply. */
  | { type: "hello"; bridgeId: string }
  /**
   * A client message for one MCP session. `remote` is true for every session that did not come from this machine's
   * loopback with a local bearer token (secret URL, OAuth, any other host): such sessions can never auto-accept.
   */
  | { type: "message"; sessionId: string; message: JSONRPCMessage; remote: boolean; scope: McpScope }
  /** The client ended the session (HTTP DELETE, or its credential was revoked). */
  | { type: "close"; sessionId: string }
  /** Keeps the stream open through idle proxies/timeouts. */
  | { type: "ping" }
  /** Another tab took over serving this workspace; this one should stop until the user comes back to it. */
  | { type: "replaced" };

/** Tab → relay (`POST /api/mcp/bridge`). */
export interface BridgeReply {
  workspaceId: string;
  bridgeId: string;
  sessionId: string;
  message: JSONRPCMessage;
}

/** The workspace a tab serves, sent on both bridge requests. */
export const BRIDGE_WORKSPACE_HEADER = "x-acute-mcp-workspace";
/** The owner secret that proves the tab belongs to the workspace's owner (never sent to MCP clients). */
export const BRIDGE_OWNER_HEADER = "x-acute-mcp-owner";

/** The client-facing endpoint path (bearer credentials) and the secret-URL prefix. */
export const MCP_ENDPOINT_PATH = "/api/mcp";
export const MCP_SECRET_URL_PREFIX = "/api/mcp/s/";
