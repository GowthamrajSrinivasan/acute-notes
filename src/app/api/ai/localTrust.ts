/**
 * Local-trust policy for the AI host's logged-in-user fallback (AI-host fallback gate, 2026-11-15; see
 * .ai/docs/chatgpt-mcp-architecture-and-test-plan.md). In `"local"` mode a request with no token and no BYOK connection
 * runs as this machine's own Copilot login — acceptable only for a request made on this machine. Anything that arrives
 * through a tunnel (ngrok), a reverse proxy, the LAN, or a page served from another origin is refused, whatever
 * `AI_HOST_MODE` says, so exposing the dev server can never spend the owner's AI login.
 *
 * "Demonstrably local" means every one of these holds:
 *   - `Host` names loopback (`localhost`, `127.0.0.1`, `[::1]`; any port);
 *   - `Origin` and `Referer`, when present, name loopback too (`Origin: null` is refused);
 *   - no proxy/tunnel header is present: `forwarded`, `x-real-ip`, `x-original-host`, `x-forwarded-server`, `via`,
 *     or any `ngrok-*` header;
 *   - `x-forwarded-for` / `x-forwarded-host`, when present, name loopback only. Next.js itself fills these on every
 *     request it serves (`x-forwarded-for` from the socket's remote address, `x-forwarded-host` from `Host`; see
 *     node_modules/next/dist/server/base-server.js) only when they are absent, so a tunnel's or proxy's own values
 *     survive and are checked here, and a direct LAN client is caught by its socket address.
 *
 * What it can't see: a raw TCP forwarder that adds no headers and lets the client choose `Host` (e.g. `ssh -R`). That
 * is why the MCP session gate also requires the dev server to listen on loopback only and writes `AI_HOST_MODE=server`.
 */

const PROXY_HEADERS = ["forwarded", "x-real-ip", "x-original-host", "x-forwarded-server", "via"] as const;

function isLoopbackName(name: string): boolean {
  const n = name.toLowerCase();
  return n === "localhost" || n === "127.0.0.1" || n === "[::1]";
}

/** A `Host`-style value (`name[:port]`, `[v6]:port`). */
function isLoopbackHostHeader(host: string): boolean {
  const h = host.trim();
  const name = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0]!;
  return isLoopbackName(name);
}

/** A socket/client address as Next.js or a proxy writes it into `x-forwarded-for`. */
function isLoopbackAddress(address: string): boolean {
  const a = address.trim().toLowerCase();
  return a === "::1" || a === "[::1]" || a === "localhost" || /^127(\.\d{1,3}){3}$/.test(a) || /^::ffff:127(\.\d{1,3}){3}$/.test(a);
}

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && isLoopbackName(url.hostname); // WHATWG keeps IPv6 brackets: "[::1]"
  } catch {
    return false;
  }
}

/** `null` when the request is demonstrably from this machine; otherwise why not (for the server log, not the client). */
export function nonLocalReason(headers: Headers): string | null {
  const host = headers.get("host");
  if (!host || !isLoopbackHostHeader(host)) return "host";
  const origin = headers.get("origin");
  if (origin !== null && !isLoopbackUrl(origin)) return "origin";
  const referer = headers.get("referer");
  if (referer !== null && !isLoopbackUrl(referer)) return "referer";
  for (const name of PROXY_HEADERS) if (headers.has(name)) return name;
  for (const [name] of headers) if (name.toLowerCase().startsWith("ngrok-")) return name.toLowerCase();
  const xff = headers.get("x-forwarded-for");
  if (xff !== null && !xff.split(",").every((part) => isLoopbackAddress(part))) return "x-forwarded-for";
  const xfh = headers.get("x-forwarded-host");
  if (xfh !== null && !xfh.split(",").every((part) => isLoopbackHostHeader(part))) return "x-forwarded-host";
  return null;
}

export const NON_LOCAL_MESSAGE =
  "This AI host only uses this machine's own AI login for requests made on this machine. This request came through a proxy, a tunnel or another host, so it must carry its own credentials (a GitHub token or its own provider key).";
