/** Dynamic client registration (RFC 7591). 404 unless MCP and OAuth are both enabled. */
import { registerClient } from "@/mcp/bridge/oauthHttp";

export const POST = (req: Request) => registerClient(req);
