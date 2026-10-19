# ChatGPT custom MCP connector — compatibility plan

> **Superseded by `chatgpt-mcp-architecture-and-test-plan.md` (2026-10-10).** Kept for history; where they differ, the newer doc wins.

Goal: ChatGPT ("Add custom MCP server": Server URL + Authentication = OAuth | No authentication | OAuth or no authentication) can use a running Acute-Notes workspace via `/api/mcp`, without weakening the loopback-only default.

## Current state (verified in code)
- `src/app/api/mcp/route.ts`: Streamable HTTP, JSON responses, POST/DELETE only (GET -> 405), relayed to an open tab (`src/mcp/bridge/relay.ts`).
- Gates: `isLoopbackHost(Host)` + `isAllowedOrigin(Origin)` -> 403 otherwise; static bearer token (`relay.authorized`); 401 carries bare `WWW-Authenticate: Bearer`.
- Per-workspace on/off + read-only + token live in `src/mcp/bridge/access`; UI in `McpAccessDialog.tsx`.
- Desktop app serves on a fixed loopback port (`electron/main.cjs`); `window.acuteDesktop.mcpOrigin` gives the URL.

## Gaps vs. ChatGPT
| # | Gap | Why it matters |
|---|-----|----------------|
| G1 | Not publicly reachable | ChatGPT connects from OpenAI's cloud |
| G2 | Host/Origin loopback gate | Tunnel Host is `*.trycloudflare.com` etc. -> 403 |
| G3 | No OAuth | "OAuth" mode needs discovery + DCR/authorize/token; static bearer cannot be entered in the form |
| G4 | 401 lacks `resource_metadata` | Clients can't discover the auth server |
| G5 | Tab must be open | 503 when no tab; ChatGPT shows a generic failure |
| G6 | Tool surface unverified for ChatGPT | ChatGPT requires valid JSON Schemas, tool annotations (readOnlyHint) and, for some modes, `search`/`fetch` tools |

## Decision: which auth mode to support
Recommend **"OAuth"** (and so also "OAuth or no authentication") as the supported path; do NOT support "No authentication" as the default.
- "No authentication" on a public tunnel means the URL alone grants read access. If offered at all, it must be an explicit, time-limited, read-only toggle, with an unguessable secret path (`/api/mcp/s/<random>`), off by default. Treat as stopgap/phase 0 only.
- OAuth works with token-less client config, which is exactly what the ChatGPT form offers.

## Phases

### Phase 0 — spike (no product change)
1. Run `cloudflared tunnel --url http://127.0.0.1:<port>`; try "No authentication" with temporary host allow-list to confirm ChatGPT's handshake (`initialize`, `tools/list`, `tools/call`) works against our JSON-response Streamable HTTP. Record the exact requests ChatGPT sends (headers, protocol version, session handling).
2. Check current ChatGPT docs (developer mode, plan availability, required tools/annotations). Don't rely on memory — requirements change.

### Phase 1 — Remote exposure opt-in (G1, G2)
1. New per-workspace setting "Allow remote access (tunnel)" in `McpAccessDialog`, off by default, with a risk warning.
2. Setting holds an allowed public host (user pastes tunnel URL; we validate https + store). `isLoopbackHost` becomes `isAllowedHost(host)`: loopback OR the configured host. Same for `isAllowedOrigin`. Never wildcard.
3. Public base URL (not request Host) used to build all OAuth metadata URLs, to avoid Host-header spoofing.
4. Dialog shows the ChatGPT Server URL `https://<host>/api/mcp` and the Authentication choice to pick.
5. Optional later: built-in tunnel helper in the desktop app (spawn bundled cloudflared) — out of scope for v1; document manual steps first.

### Phase 2 — OAuth 2.1 authorization server (G3, G4)
Minimal, single-user, in-app. Endpoints (new routes under `src/app/`):
- `/.well-known/oauth-protected-resource` (RFC 9728) -> `{ resource, authorization_servers }`
- `/.well-known/oauth-authorization-server` (RFC 8414) -> issuer, endpoints, `code_challenge_methods_supported: ["S256"]`, `registration_endpoint`
- `POST /oauth/register` — Dynamic Client Registration (RFC 7591); store client_id + redirect_uris; allow only ChatGPT's redirect URIs (confirm in spike, e.g. chatgpt.com / platform.openai.com callbacks).
- `GET /oauth/authorize` — PKCE (S256) required. Shows an **approval page inside Acute**: "ChatGPT wants to read <workspace>" with Approve/Deny. Approval needs the owner: because the page is reached via the public tunnel, gate it by a one-time pairing code displayed in the Acute app (⋮ -> MCP access) that the owner types in. This prevents a stranger who finds the URL from authorizing themselves.
- `POST /oauth/token` — authorization_code + refresh_token grants; short-lived access tokens (≈1h), rotating refresh tokens, bound to workspace and to the `resource`.
- 401 from `/api/mcp` returns `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource"`.
- `relay.authorized` accepts either the legacy static token (local clients keep working unchanged) or a valid OAuth access token. Respect existing `readOnly` and "MCP off" switches at token-check time.
- Persistence: token store in the app's server-side data (not in the tab); revoke list; "New token" also revokes OAuth grants. Add "Connected apps" list with Revoke in the dialog.
- Scopes: `mcp:read`, `mcp:propose` (maps to read-only vs. propose-changes).

### Phase 3 — Protocol/tool compatibility (G6)
1. Review `src/mcp/tools/*` JSON Schemas (strict, no unsupported keywords), tool descriptions, and add `annotations` (`readOnlyHint`, `destructiveHint: false`).
2. If ChatGPT needs `search` and `fetch` tools for its modes, add thin wrappers over existing project tools (return `{ids|results}` per its spec; verify current spec first).
3. Make sure CORS/preflight (`OPTIONS`) is handled for the allowed ChatGPT origin if requested; keep `Origin` validation against the configured list.
4. Confirm behaviour with `Mcp-Session-Id`, protocol-version header, and notifications (202 with no body).
5. Keep proposals-for-review model: write tools must still only create canvas proposals.

### Phase 4 — Availability (G5)
1. When no tab/desktop window is serving, return a clear tool-level error message ChatGPT can show ("Open Acute-Notes and keep it running"). Desktop: keep relay alive when window is hidden/tray.
2. Status line in the dialog: tunnel host reachable, last ChatGPT connection time.

### Phase 5 — Security hardening (required before enabling by default anywhere)
- Remote access off by default and auto-expires (e.g. 8h) unless user opts to persist.
- Rate limiting on `/oauth/*` and `/api/mcp`; lockout on repeated bad pairing codes.
- Redirect-URI exact match; PKCE mandatory; tokens hashed at rest; no tokens in logs.
- Audit log of remote tool calls surfaced in the dialog.
- Threat model note: tunnel provider sees traffic; notes content leaves the machine to ChatGPT/OpenAI by design — state this in the dialog warning.

## Tests
- Unit: host allow-list, token validation, PKCE verification, DCR redirect-URI allow-list, refresh rotation/revocation.
- Route tests: 401 metadata header, discovery documents, full authorize->token->`tools/list` flow using a fake client; 403 for non-allowed Host.
- e2e (local, `e2e/local/`): extend `lensMcp.local.spec.ts` with an OAuth-client flow. No AI runs / contract tests unless explicitly requested.
- Manual: real ChatGPT connector through a tunnel for each auth mode (OAuth, No auth if kept, OAuth-or-none).

## Decisions (owner, 2026-10-10) — these override the recommendations above
D1. **Support both "No authentication" and OAuth** (so all three ChatGPT dropdown options work). "No authentication" is not an unguarded endpoint: it uses an unguessable per-workspace secret URL (`/api/mcp/s/<random>`), shown in the dialog with the warning that the URL *is* the credential. Regenerating it ("New token") revokes it. OAuth remains the stronger path and is what "OAuth or no authentication" negotiates first. Rate limiting and the auto-expiry (Phase 5) apply to secret-URL mode too.
D2. **Two targets: desktop app and the published app on Firebase App Hosting.** Phase 1's "remote access" is a no-op on the hosted app (already public, so the allowed host = its own domain); on desktop it needs a tunnel. See "Hosted-app implications".
D3. **Tunnel helper: do not bundle.** Only bundle one if ChatGPT's own guidelines require/recommend it. As far as I know, OpenAI's docs only suggest a tunnel (e.g. ngrok) for local dev and require a public HTTPS URL; they don't mandate a specific tool. Verify in the Phase 0 spike; until then, document the manual cloudflared/ngrok steps in the dialog.
D4. **ChatGPT gets complete read access and write access (propose-changes mode).** Scopes `mcp:read` + `mcp:propose` granted together by default; read-only stays available as a toggle. "Write" keeps the existing safety model: changes arrive as proposals the user reviews on the canvas (see "Write access" below).

## Hosted-app implications (Firebase App Hosting) — needs a design decision before Phase 1
Earlier decisions (memory: hosted deployment DEFERRED; no accounts v1; Firestore; no hosted Copilot) mean this phase also un-defers part of hosting. Problems to solve:
1. **The relay is in-memory and tab-bound.** `getMcpRelay()` keeps the connected tab's state in one server process. App Hosting runs on Cloud Run, which can run several instances and scale to zero, so the MCP POST may land on a different instance than the tab's SSE bridge. Options: (a) pin `maxInstances: 1` + `minInstances: 1` (cheapest, fine for v1, costs idle money); (b) move relay mailboxes to Firestore/Pub-Sub. Recommend (a) for v1.
2. **No accounts.** On the hosted app, workspace data lives in the visitor's browser, so "the workspace" exists only while their tab is open, and the secret URL/OAuth grant must be tied to that browser's workspace. Without accounts, an OAuth approval has no user identity to authenticate: the pairing-code approval (Phase 2) must be shown in the visitor's own tab, which works but must be keyed per tab/workspace, not per server.
3. **Multi-tenant isolation.** Many visitors share one server, so relay, tokens, secret URLs and OAuth clients must be keyed by workspace/tab, never global. The current single `getMcpRelay()` singleton assumes one owner and must become a per-owner registry. This is the largest code change.
4. **Origin/host rules.** Replace the loopback check with: loopback (desktop/dev) OR the configured public host (hosted: its own domain from config; desktop: tunnel host). Build OAuth metadata from the configured base URL, never the request Host.
5. **Persistence of OAuth state** (clients, grants, refresh tokens) must survive restarts: Firestore on hosted, local server data on desktop; one storage interface, two adapters.
6. **Abuse/cost:** public endpoints on a public app need rate limiting and per-workspace quotas; `aiFeatureDisabledResponse()` gating must still apply (no hosted Copilot).

## Write access (D4) — what "complete" means
- Expose every existing read tool plus all propose/write tools in `src/mcp/tools/*` to ChatGPT, with `readOnlyHint: false` on the write tools (ChatGPT shows a confirmation for these; keep their descriptions explicit about what changes).
- Changes are still *proposed* and appear on the canvas for the owner to accept/reject (existing F20/F21 behaviour, `src/ai/changes`). ChatGPT never mutates the workspace directly. If you want direct, unreviewed writes, say so; it is a separate, riskier decision, particularly with secret-URL mode on a public host.
- Because secret-URL mode has weaker identity, write mode over it should require the review step (no auto-accept) and be rate-limited.

## Remaining open questions
1. Hosted relay: pin to a single instance (recommended for v1) or move to Firestore-backed relay?
2. Confirm "write access" = proposals reviewed on the canvas, not direct writes.
3. Hosted app has no accounts: acceptable that each visitor's MCP access works only while their tab is open?

## Order of work
Phase 0 -> 1 -> 2 -> 3 -> 4 -> 5 (5's rate limiting/expiry ships with 1 and 2, not after). Nothing is committed (project rule).
