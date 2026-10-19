/** RFC 8414 authorization-server metadata. 404 unless MCP and OAuth are both enabled. */
import { authorizationServerMetadata } from "@/mcp/bridge/oauthHttp";

export const GET = () => authorizationServerMetadata();
