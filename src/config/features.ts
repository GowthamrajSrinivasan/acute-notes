/**
 * Operator-level feature switches, fixed per build — not user settings.
 *
 * `NEXT_PUBLIC_AI_FEATURE` ("on" | "off") decides whether this build ships
 * AI at all: the built-in AI (Ask AI, Visualize, AI settings, markers,
 * provenance) and MCP access for external agents. Off means no AI UI, the
 * user-facing AI mode reads as Off, and the `/api/ai/*` and `/api/mcp/*`
 * routes answer 404. Anything other than "on" (including unset) is off, so
 * a misconfigured deploy fails closed.
 *
 * Set in `.env.development` (next dev) and `.env.production` (next build);
 * `.env.local` or the shell environment overrides both. Next.js inlines
 * `NEXT_PUBLIC_*` at build time, so changing it needs a rebuild / dev restart.
 */

/** Read on every call (not cached) so tests can stub the env. The literal `process.env.NEXT_PUBLIC_AI_FEATURE` must stay as-is for Next.js to inline it. */
export function isAIFeatureEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AI_FEATURE === "on";
}

/**
 * `NEXT_PUBLIC_TOPIC_MERGE` ("on" | "off"): Visualize offers "Merge into existing notes" when the canvas already has
 * notes (topic merge plan G2.2). On in development while it is being built; anything else is off.
 */
export function isTopicMergeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TOPIC_MERGE === "on";
}

/**
 * The AI consistency check (intelligent-update-engine-plan Stage 4f, Phase 1 close-out): **off by default**, behind two
 * switches like MCP's —
 * - `CONSISTENCY_AI_CHECK` ("on" | "off") — **server-enforced**: `/api/ai/judge` answers 404 unless it is exactly "on".
 *   Read at request time. Unset is off, so no request can reach a model;
 * - `NEXT_PUBLIC_CONSISTENCY_AI_CHECK` — a UI hint only (inlined at build): whether the consistency panel offers the
 *   AI check at all. Even then the user must opt in, and each check is started by hand; nothing runs on its own.
 * Both need the AI feature itself on.
 */
export function isConsistencyAICheckEnabled(): boolean {
  return isAIFeatureEnabled() && process.env.CONSISTENCY_AI_CHECK === "on";
}

/** UI hint for the client bundle (the literal `process.env.NEXT_PUBLIC_CONSISTENCY_AI_CHECK` must stay as-is for Next.js to inline it). */
export function isConsistencyAICheckUiEnabled(): boolean {
  return isAIFeatureEnabled() && process.env.NEXT_PUBLIC_CONSISTENCY_AI_CHECK === "on";
}

/** The response an AI route gives when this build has AI turned off: indistinguishable from a route that doesn't exist. */
export function aiFeatureDisabledResponse(): Response | null {
  return isAIFeatureEnabled() ? null : new Response("Not Found", { status: 404 });
}

/**
 * MCP is independent of the AI flag: it lets the user's own agents (ChatGPT, Claude, Codex…) use a workspace and needs
 * no Acute-hosted AI inference.
 *
 * `MCP_FEATURE` ("on" | "off") — **server-enforced**: every `/api/mcp/*` and OAuth route answers 404 unless it is
 * exactly "on", whatever the UI shows. Unset is off (fail closed). Read at request time from the server's environment.
 *
 * `NEXT_PUBLIC_MCP_FEATURE` — a UI hint only (inlined at build): whether this build shows the MCP access dialog and
 * runs the tab bridge. It never grants anything; the server flag above does the enforcing.
 *
 * `MCP_OAUTH_FEATURE` ("on" | "off") — the OAuth flow, separately switched, and also requires `MCP_PUBLIC_BASE_URL`
 * (the https origin clients reach this server on). Turning MCP on never turns OAuth on.
 */
export function isMcpFeatureEnabled(): boolean {
  return process.env.MCP_FEATURE === "on";
}

/** UI hint for the client bundle (the literal `process.env.NEXT_PUBLIC_MCP_FEATURE` must stay as-is for Next.js to inline it). */
export function isMcpUiEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MCP_FEATURE === "on";
}

export function isMcpOAuthEnabled(): boolean {
  return isMcpFeatureEnabled() && process.env.MCP_OAUTH_FEATURE === "on" && !!process.env.MCP_PUBLIC_BASE_URL;
}

/** The 404 an MCP route gives when MCP is off: indistinguishable from a route that doesn't exist. */
export function mcpFeatureDisabledResponse(): Response | null {
  return isMcpFeatureEnabled() ? null : new Response("Not Found", { status: 404 });
}

/** The 404 an OAuth route gives unless MCP, the OAuth flag and its configuration are all in place. */
export function mcpOAuthDisabledResponse(): Response | null {
  return isMcpOAuthEnabled() ? null : new Response("Not Found", { status: 404 });
}
