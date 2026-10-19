/** RFC 9728 protected-resource metadata (also under the resource's path). 404 unless MCP and OAuth are both enabled. */
import { protectedResourceMetadata } from "@/mcp/bridge/oauthHttp";

export const GET = () => protectedResourceMetadata();
