/**
 * The secret-URL MCP endpoint (ChatGPT's "No authentication" mode): `/api/mcp/s/<token>`. The URL itself is the
 * credential — a bearer secret issued by the app for one workspace, expiring and revocable. Same handling as
 * `/api/mcp` (`src/mcp/bridge/http.ts`); only the way the token arrives differs. Gated by `MCP_FEATURE`.
 */
import type { NextRequest } from "next/server";
import { handleClientRequest } from "@/mcp/bridge/http";

type Ctx = { params: Promise<{ token: string }> };

async function handle(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { token } = await params;
  return handleClientRequest(req, { token: token ?? null, kinds: ["secret-url"] });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
