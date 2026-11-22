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
 *   AI check at all. Even then the user must opt in; checks then run after accepted changes (plan §17), and only while the
 *   consistency panel itself is on (`isConsistencyPanelEnabled`).
 * Both need the AI feature itself on.
 */
export function isConsistencyAICheckEnabled(): boolean {
  return isAIFeatureEnabled() && process.env.CONSISTENCY_AI_CHECK === "on";
}

/**
 * The consistency panel and its chip (Stage 4d–4f): **off by default** (product owner, 2026-11-22, plan §17.5). Changes are reviewed
 * where they are proposed (the review bar), and an update now lands on the card it revises, so a separate conflicts list is not shown.
 * While off, nothing is checked after a commit and the AI check sends nothing. `NEXT_PUBLIC_CONSISTENCY_PANEL=on` brings it back.
 */
export function isConsistencyPanelEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CONSISTENCY_PANEL === "on";
}

/**
 * Semantic placement (intelligent-update-engine-plan Stage 5, §18): "Where should this go?" ranks cards by meaning with a local
 * sentence-embedding model and proposes the exact anchor (after a list item, at a list's end, a table row or cell). **Off by
 * default**, behind two switches like the AI check's —
 * - `ACUTE_EMBEDDINGS` — **server-enforced**: `/api/ai/embed` answers 404 unless it names a local model
 *   (`local-model:minilm-l6`), the AI feature is on and the server isn't publicly exposed (text never leaves the user's own
 *   machine). Weights are read from `ACUTE_EMBEDDING_MODELS_DIR` (default: the spike's cache under `node_modules/.cache`);
 *   downloading them needs `ACUTE_EMBEDDINGS_DOWNLOAD=on` as well.
 * - `NEXT_PUBLIC_SEMANTIC_PLACEMENT` — a UI hint only (inlined at build): whether the dialog asks the route at all. With the
 *   route unavailable it falls back to today's router, silently.
 */
export function isLocalEmbeddingsEnabled(): boolean {
  return isAIFeatureEnabled() && (process.env.ACUTE_EMBEDDINGS ?? "").startsWith("local-model:");
}

/** UI hint for the client bundle (the literal `process.env.NEXT_PUBLIC_SEMANTIC_PLACEMENT` must stay as-is for Next.js to inline it). */
export function isSemanticPlacementUiEnabled(): boolean {
  return isAIFeatureEnabled() && process.env.NEXT_PUBLIC_SEMANTIC_PLACEMENT === "on";
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
