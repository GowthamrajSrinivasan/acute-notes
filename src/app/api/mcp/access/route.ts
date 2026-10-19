/**
 * The workspace owner's credential management (⋮ → MCP access), used only by the app's own pages: claim a workspace,
 * get its server-issued bearer credential, create/revoke secret URLs, list and revoke OAuth grants, and read a pairing
 * code for the OAuth approval page. Every action needs the workspace's owner secret and acts on that workspace only.
 * Gated by `MCP_FEATURE` (the pairing code additionally by `MCP_OAUTH_FEATURE`).
 */
import type { NextRequest } from "next/server";
import { isMcpOAuthEnabled } from "@/config/features";
import { ownerFrom, ownerGate, ownerKey, requireOwner } from "@/mcp/bridge/owner";
import { getMcpServices } from "@/mcp/bridge/store";
import type { McpScope } from "@/mcp/bridge/protocol";

const MAX_SECRET_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const noStore = { "cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

export async function POST(req: NextRequest): Promise<Response> {
  const services = getMcpServices();
  const refused = ownerGate(req, services);
  if (refused) return refused;
  let body: Record<string, unknown>;
  try {
    const parsed = (await req.json()) as unknown;
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const owner = ownerFrom(req, body);
  const action = body.action;
  const denied = requireOwner(req, owner, services);
  if (denied) return denied;
  // Everything below acts on this owner's namespace only (see `ownerKey`).
  const workspaceId = ownerKey(owner!);
  const { credentials, oauth } = services;

  const state = () => ({
    credentials: credentials.list(workspaceId),
    grants: oauth.grantsOf(workspaceId),
    oauthEnabled: isMcpOAuthEnabled(),
  });

  switch (action) {
    case "ensure": {
      const have = typeof body.bearerId === "string" ? body.bearerId : null;
      const bearer = have && credentials.isValid(workspaceId, have) ? null : credentials.issue(workspaceId, { kind: "bearer", scope: "propose", ttlMs: null });
      return json({ bearer: bearer ? { id: bearer.id, token: bearer.token } : null, ...state() });
    }
    case "rotate-bearer": {
      credentials.revokeAll(workspaceId, ["bearer"]);
      const bearer = credentials.issue(workspaceId, { kind: "bearer", scope: "propose", ttlMs: null });
      return json({ bearer: { id: bearer.id, token: bearer.token }, ...state() });
    }
    case "issue-secret-url": {
      const scope: McpScope = body.scope === "read" ? "read" : "propose";
      const ttl = typeof body.ttlMs === "number" && body.ttlMs > 0 ? Math.min(body.ttlMs, MAX_SECRET_URL_TTL_MS) : undefined;
      const credential = credentials.issue(workspaceId, { kind: "secret-url", scope, ...(ttl !== undefined ? { ttlMs: ttl } : {}) });
      return json({ secretUrl: { id: credential.id, token: credential.token, expiresAt: credential.expiresAt, scope }, ...state() });
    }
    case "revoke": {
      const id = typeof body.credentialId === "string" ? body.credentialId : null;
      const grant = typeof body.grantId === "string" ? body.grantId : null;
      const ok = id ? credentials.revoke(workspaceId, id) : grant ? oauth.revokeGrant(workspaceId, grant) : false;
      return json({ revoked: ok, ...state() }, ok ? 200 : 404);
    }
    case "revoke-all": {
      oauth.revokeWorkspace(workspaceId);
      credentials.revokeAll(workspaceId);
      return json({ ...state() });
    }
    case "list":
      return json(state());
    case "pairing-code": {
      if (!isMcpOAuthEnabled()) return new Response("Not Found", { status: 404 });
      return json(credentials.createPairingCode(workspaceId));
    }
    default:
      return json({ error: "unknown_action" }, 400);
  }
}
