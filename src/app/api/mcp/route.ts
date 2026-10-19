/**
 * The MCP endpoint external clients connect to (F20/F21), e.g.
 * `claude mcp add --transport http acute-notes http://localhost:3000/api/mcp --header "Authorization: Bearer <token>"`.
 * Streamable HTTP with JSON responses; every message is relayed to the browser tab serving the credential's
 * workspace (`src/mcp/bridge`). Accepts a bearer credential issued by the app (⋮ → MCP access) or, when the OAuth flag
 * is on, an OAuth access token. Gated by `MCP_FEATURE`, independent of the AI flag.
 */
import type { NextRequest } from "next/server";
import { bearerOf, handleClientRequest } from "@/mcp/bridge/http";

const auth = (req: NextRequest) => ({ token: bearerOf(req), kinds: ["bearer", "oauth"] as const });

export const POST = (req: NextRequest) => handleClientRequest(req, auth(req));
export const GET = (req: NextRequest) => handleClientRequest(req, auth(req));
export const DELETE = (req: NextRequest) => handleClientRequest(req, auth(req));
