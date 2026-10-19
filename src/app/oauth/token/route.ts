/** The token endpoint: authorization_code (PKCE S256) and rotating refresh_token grants. 404 unless MCP and OAuth are both enabled. */
import { token } from "@/mcp/bridge/oauthHttp";

export const POST = (req: Request) => token(req);
