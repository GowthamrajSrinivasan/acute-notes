/**
 * The owner-facing side of the MCP routes: the app's own pages (a workspace's tab) talking to `/api/mcp/bridge` and
 * `/api/mcp/access`. Same-origin only, on an allowed host, and carrying the browser's owner secret — which only ever
 * travels between the owner's browser and this server, never to an MCP client.
 *
 * There is no "claim" of a workspace name. Workspace ids are not secret (every browser starts with one called
 * "default"), so everything the server keeps is namespaced by a hash of the owner secret *and* the workspace id
 * (`ownerKey`): two browsers with the same workspace id get entirely separate relays and credentials, and nobody can
 * squat on, or lock anyone out of, a name. Whoever holds the secret owns its namespace; nobody else can reach it.
 */
import { createHash } from "node:crypto";
import { mcpFeatureDisabledResponse } from "@/config/features";
import { BRIDGE_OWNER_HEADER, BRIDGE_WORKSPACE_HEADER } from "./protocol";
import { clientAddress } from "./http";
import { isAllowedHost } from "./relay";
import { getMcpServices, type McpServices } from "./store";

export interface Owner {
  workspaceId: string;
  secret: string;
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** Null when the request may proceed; otherwise the refusal (feature off → 404, wrong origin/host → 403, hammering → 429). */
export function ownerGate(req: Request, services: McpServices = getMcpServices()): Response | null {
  const disabled = mcpFeatureDisabledResponse();
  if (disabled) return disabled;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  const sameOrigin = req.headers.get("sec-fetch-site") === "same-origin" && (!origin || hostOf(origin) === host);
  if (!sameOrigin || !isAllowedHost(host)) return new Response("Forbidden", { status: 403 });
  if (services.limits.failures.blocked(clientAddress(req))) return new Response("Too Many Requests", { status: 429, headers: { "retry-after": "300" } });
  return null;
}

/** The workspace and owner secret a request claims, or null when either is missing. */
export function ownerFrom(req: Request, body?: { workspaceId?: unknown; ownerSecret?: unknown }): Owner | null {
  const workspaceId = req.headers.get(BRIDGE_WORKSPACE_HEADER) ?? (typeof body?.workspaceId === "string" ? body.workspaceId : null);
  const secret = req.headers.get(BRIDGE_OWNER_HEADER) ?? (typeof body?.ownerSecret === "string" ? body.ownerSecret : null);
  return workspaceId && secret ? { workspaceId, secret } : null;
}

/** Owner secrets (random, 32+ characters) are what separates one browser's namespace from another's. */
export const MIN_OWNER_SECRET_LENGTH = 32;

/** The server-side key for this owner's workspace: unguessable without the secret, and distinct per owner even for the same workspace id. */
export function ownerKey(owner: Owner): string {
  return `${createHash("sha256").update(owner.secret).digest("hex").slice(0, 32)}:${owner.workspaceId}`;
}

/** Refuses a request without a well-formed owner identity (counting the failure against the caller's address). */
export function requireOwner(req: Request, owner: Owner | null, services: McpServices): Response | null {
  if (owner && owner.secret.length >= MIN_OWNER_SECRET_LENGTH && owner.workspaceId.length > 0 && owner.workspaceId.length <= 200 && owner.secret.length <= 200) return null;
  services.limits.failures.hit(clientAddress(req));
  return new Response("Forbidden", { status: 403 });
}
