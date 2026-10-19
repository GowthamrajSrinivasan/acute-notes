/** The pairing-code approval page and its form handler. 404 unless MCP and OAuth are both enabled. */
import { authorizeGet, authorizePost } from "@/mcp/bridge/oauthHttp";

export const GET = (req: Request) => authorizeGet(req);
export const POST = (req: Request) => authorizePost(req);
