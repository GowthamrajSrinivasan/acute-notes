# ChatGPT MCP connector — audit, architecture and test plan

Status: **DRAFT for review. No code, deploy, Firebase change or commit has been made.** Supersedes the phase list in `chatgpt-mcp-compat-plan.md` (kept for history).
Date: 2026-10-10.

## 0. Owner decisions (binding)
1. Hosted relay: the single-instance in-memory relay is a **disposable proof of concept only**; production targets **Firestore-backed coordination**. Keep four things separate: persisted workspace state, browser connectivity, MCP sessions, pending proposals. No Firebase deploys/changes before this design and its security review are approved.
2. Write access: **read tools + propose tools only.** Every change appears as a reviewable proposal on the canvas and needs explicit user acceptance. No unreviewed writes in v1.
3. Hosted MCP requires the visitor's tab to stay open (v1). Disconnect/reconnect must be safe, pending proposals preserved, messages never routed across workspaces.
4. Secret URLs are bearer credentials: CSPRNG tokens, per-workspace authorization, revocation, rate limiting, safe logging. OAuth is a separate mode. Neither mode bypasses authorization or proposal review.
5. Spike before implementation; no support claimed from the UI alone.
6. Audit + architecture + test plan first; no deploy/prod/commit without approval.

## 1. Compatibility spike — what is known vs. still unverified
Sources: OpenAI's Apps SDK auth guide (fetched) and search results; the OpenAI developer-mode page and help-center article **could not be fetched (404/403)**, so anything from them is secondhand until a human or a retry confirms it.

### Verified from OpenAI's auth guide (https://developers.openai.com/plugins/build/auth)
- MCP server must serve `GET /.well-known/oauth-protected-resource` (`resource`, `authorization_servers`, optional `scopes_supported`).
- Authorization server metadata at `/.well-known/oauth-authorization-server` (or OIDC `openid-configuration`).
- Client registration: **CIMD preferred** (`client_id_metadata_document_supported: true`; token auth `none` or `private_key_jwt`); **DCR still supported** (`registration_endpoint`).
- **PKCE S256 mandatory** (`code_challenge_methods_supported: ["S256"]`).
- Redirect URI: stable `https://chatgpt.com/connector_platform_oauth_redirect` if the AS supports issuer identification, else `https://chatgpt.com/connector/oauth/{callback_id}`. Allow-list exactly.
- **Issuer identification (RFC 9207):** `authorization_response_iss_parameter_supported: true`, and return `iss` in every authorization response (success and error).
- ChatGPT appends `resource=<mcp url>` to authorize and token requests; the token's audience must be bound to it; the MCP server must verify signature/issuer, `exp`/`nbf`, audience, scopes on every request.
- Unauthenticated: `401` + `WWW-Authenticate: Bearer resource_metadata="…", scope="…"`. For per-tool OAuth UI, also per-tool `securitySchemes` and `_meta["mcp/www_authenticate"]` on the tool error.
- Mixed auth: tools may list both `{type:"noauth"}` and `{type:"oauth2",scopes}` (optional auth). The server must still enforce permissions regardless of what it declares.

### Secondhand (search results), must be re-verified
- Transports: Streamable HTTP and SSE; auth: OAuth or none (matches the 3-option dropdown you showed: OAuth / No authentication / OAuth or no authentication).
- Developer mode needs Plus/Pro/Business/Enterprise-class plan and must be enabled in Settings.
- Official docs reportedly say developer mode does **not** require `search`/`fetch` tools; third-party guides claim otherwise. Treat as unknown until a real connector is added.
- Write tools may trigger a ChatGPT confirmation prompt, governed by tool annotations/app permissions.
- Whether OpenAI recommends or requires any tunnel product: **no evidence found**; guides only say a public HTTPS URL is needed. D3 stands: do not bundle a tunnel.

### Spike checklist (run against a throwaway tunnel + a scratch server, not production)
| # | Question | Pass criteria |
|---|----------|---------------|
| S1 | Does ChatGPT accept our **JSON-response-only Streamable HTTP** (no GET stream, GET returns 405)? | `initialize`, `notifications/initialized` (202), `tools/list`, `tools/call` succeed; no "doesn't implement our specification" error |
| S2 | Does it need `search`/`fetch`? | Connector added without them, or exact error captured |
| S3 | **No authentication** mode against the secret URL | Handshake + a read call + a propose call work; capture headers ChatGPT sends |
| S4 | **OAuth** mode: DCR vs CIMD, redirect URI actually used, `iss`, `resource`, token refresh | Full link flow completes; refresh works; revoked grant -> 401 and re-link |
| S5 | **"OAuth or no authentication"**: which does ChatGPT choose, and does it need `securitySchemes`? | Documented observed behaviour; works with both |
| S6 | Pairing-code approval UX inside the OAuth browser redirect | Owner can approve from their own tab; stranger cannot |
| S7 | Write-tool confirmation prompts, `readOnlyHint`/`destructiveHint` effect | Recorded |
| S8 | Behaviour on 503 "tab not connected" and on 30 s timeout | Error text shown to user is intelligible |
| S9 | Tool-list refresh after reconnect | New session works without re-adding connector |

Exit criterion: a table in this doc with each of S1-S9 marked Verified/Failed with evidence (request logs with secrets redacted). "All three setup choices work" is claimed only if S3, S4 and S5 pass.

## 2. Audit of the existing MCP implementation
Files: `src/app/api/mcp/route.ts`, `src/app/api/mcp/bridge/route.ts`, `src/mcp/bridge/{relay,protocol,tabBridge,access}.ts`, `src/mcp/tools/*`, `src/ai/changes/*`, `electron/main.cjs`.

### How it works today
- External client -> `POST /api/mcp` (Streamable HTTP, JSON replies) -> **`McpRelay` singleton in server memory** -> NDJSON stream (`GET /api/mcp/bridge`) to **one browser tab** -> the tab runs the real MCP server (per client session) over its own IndexedDB data -> reply `POST /api/mcp/bridge` -> relay resolves the waiting request (30 s timeout).
- The relay holds no workspace data. Workspace data, selection context and proposals live in the tab.
- Access state (`mcp.access`: per-workspace on/off, per-workspace read-only, **one device-wide token**) lives in the tab's local `meta` store. The **tab generates the token and hands it to the server** when it opens the bridge; the server accepts any token >= 32 chars.

### Findings (F = finding; severity for a hosted multi-tenant deployment)
| ID | Finding | Impact |
|----|---------|--------|
| F1 | `getMcpRelay()` is a process-global singleton with one `tab`, one `sessions` Set, one `pending` Map | **Blocker for hosted.** Two visitors share one relay. |
| F2 | "Newest tab wins": `attachTab` replaces the current tab and drops all sessions | **Critical on hosted:** visitor B's tab evicts visitor A's, and B's token then authorizes requests that reach B's workspace; A's clients break. Anyone can DoS everyone. |
| F3 | Server trusts the tab-supplied token (any 32+ chars); no server-side identity of the tab | On hosted, anyone can register as "the tab". Needs a server-issued, owner-scoped credential. |
| F4 | One token for all of a device's workspaces; per-workspace on/off is checked only in the tab | A leaked token reaches any enabled workspace on that device; per-workspace revocation is impossible. Needs per-workspace credentials. |
| F5 | `isLoopbackHost`/`isAllowedOrigin` on both routes; bridge also requires `sec-fetch-site: same-origin` + loopback | Rejects tunnel and hosted hosts. Must become an explicit configured host allow-list (not wildcard), same for the bridge. |
| F6 | 401 is bare `WWW-Authenticate: Bearer`; no discovery docs; no OAuth | Needed for OAuth mode (section 1). |
| F7 | `bridgeId` (random UUID) is the only credential on bridge POST replies | Acceptable on loopback; on hosted must be bound to the authenticated tab session. |
| F8 | In-memory only: restart or a second instance loses tab + sessions; Cloud Run may run many instances | Why Firestore-backed coordination is the production target. |
| F9 | `getMcpAllowWrites` is read in the tab on every call, so read-only applies instantly | Good; keep. |
| F10 | **Write path can auto-apply:** `writeTools.ts` header says Project-profile writes in a session the user switched to auto-accept return `"applied"` (`AUTO_ACCEPT_TOOLS`: record_decision, log_finding, update_progress, update_knowledge, annotate, sync_session) | **Conflicts with decision 2.** Auto-accept is user-enabled and in-memory today, but remote ChatGPT sessions must be forced to "always review". |
| F11 | `delete_object` exists in `WRITE_TOOL_NAMES` (header comment still says "No delete tool") | Removal is propose-only but high-impact; ChatGPT should mark it `destructiveHint`; stale comment to fix. |
| F12 | Pending proposals are **in tab memory** (`PendingChanges`; auto-accept "held in memory only", 30 min idle expiry) | **Conflicts with decision 3** ("preserve pending proposals"): closing/reloading the tab loses them. |
| F13 | Proposals require a canvas of this workspace open; one change set per session slot; refused otherwise | ChatGPT must get clear tool errors; hosted visitor must have the canvas open. |
| F14 | No rate limiting, no audit log of remote calls, no safe-logging rule | Needed before any public exposure. `onToolCall` usage metering exists (D46) and can seed an audit log. |
| F15 | GET returns 405 (no server stream); batches rejected; notifications get 202 | Probably fine for ChatGPT; verify in S1. |
| F16 | `aiFeatureDisabledResponse()` gates both routes (feature flag) | Must be decided for hosted (earlier decision: no hosted Copilot; MCP is not Copilot, so a separate flag may be needed). |
| F17 | Tool annotations: `WRITE_ANNOTATIONS`/`DELETE_ANNOTATIONS` already exist in `tools/common.ts` | Likely reusable for ChatGPT's confirmation behaviour; verify in S7. |

## 3. Target architecture (production)
Four separate concerns, each with its own storage and failure behaviour:

| Concern | Owner / store | Lifetime | Notes |
|---------|---------------|----------|-------|
| **A. Workspace state** | Browser (IndexedDB), unchanged | User's data | Never copied to the server in v1. The server never sees notes except as tool results in transit. |
| **B. Browser connectivity** | Firestore `mcpConnections/{workspaceId}` (presence doc: `tabId`, `instanceId`, `lastSeen`, `leaseExpires`) | Seconds-minutes (heartbeat/lease) | Which tab currently serves this workspace; lease so a dead tab expires. |
| **C. MCP sessions** | Firestore `mcpSessions/{sessionId}` (`workspaceId`, `credentialId`, `createdAt`, `lastUsed`, `expires`) | Hours | Session id is bound to one workspace and one credential; a session can never be used on another workspace. |
| **D. Pending proposals** | **Tab IndexedDB** (the workspace owner's device), not Firestore | Until accepted/rejected/expired | Contain user content, so they stay with workspace state. Survive tab reload and reconnect. Firestore holds at most a metadata count/status if needed for tool errors. |

Plus two control-plane stores: `mcpCredentials/{workspaceId}/…` (hashed secret-URL tokens, revocation) and `oauthGrants/…` (clients, auth codes, hashed refresh tokens). All keyed by workspaceId; no global singletons.

### Message path (hosted production)
```
ChatGPT --HTTPS--> /api/mcp/s/<secret> | /api/mcp (OAuth bearer)
   -> authenticate credential -> resolve workspaceId (from the credential, never from the request body)
   -> rate limit (per credential + per IP)
   -> enqueue request in Firestore mailbox  mcpMailbox/{workspaceId}/requests/{reqId}
   -> tab (lease holder for that workspace) receives via bridge stream or Firestore listener
   -> tab runs the MCP server over local data, applies policy (read-only, propose-only)
   -> reply written to mcpMailbox/{workspaceId}/replies/{reqId}  (tab authenticated; workspaceId from its own lease)
   -> the instance that took the HTTP request waits on that doc (<= 30 s) and returns it
```
- Every Firestore path includes `workspaceId`; the HTTP handler derives it only from the verified credential; security rules/Admin-SDK code assert `reply.workspaceId == request.workspaceId == lease.workspaceId`. There is no code path that takes a workspaceId from the client message.
- Tab authentication: server-issued **tab session token** (random, stored hashed, bound to workspaceId and an owner browser key), replacing F3's tab-supplied token. Because there are no accounts, "owner" = the browser that created the workspace's MCP access; it holds an owner secret in local `meta` and presents it to create/rotate credentials.
- Reconnect: tab reacquires the lease with the same tab session; unexpired MCP sessions continue (the session lives in C, not in the tab); in-flight requests either complete or fail with the clear "not connected" error (RELAY_ERRORS.notConnected); **proposals are untouched** (D).
- Two tabs for one workspace: lease holder wins until expiry or explicit takeover; never evicts other workspaces (fixes F2).

### Desktop (unchanged shape, hardened)
Keep the in-process relay (single user, loopback). Replace singleton assumption with the same per-workspace keyed interface so both targets share code behind a `RelayStore` interface: `InMemoryRelayStore` (desktop, tests, the PoC) and `FirestoreRelayStore` (production). Tunnel is manual (documented), host allow-list holds the user's tunnel host.

### Auth modes (both enforce the same authorization and review)
- **Secret URL (No authentication in ChatGPT):** `/api/mcp/s/<token>`; token = 32 random bytes (base64url) from CSPRNG; **stored only as SHA-256 hash**; compared in constant time; one token per workspace per purpose (read/propose scope encoded server-side, not in the URL); revocable ("New secret URL"), expiring (default 8 h unless user opts to persist), listed with created/last-used. The URL is a bearer credential: warn in UI; never log full URL/path (log a short hash prefix); `Referrer-Policy: no-referrer`; never echo it in errors.
- **OAuth:** per section 1: discovery docs, DCR (+ CIMD later if needed), PKCE S256, `iss`, `resource`-bound audience, exact redirect allow-list, short-lived access tokens, rotating hashed refresh tokens, owner approval via a pairing code shown in the owner's own tab (S6). Grants are per workspace and revocable.
- **Mixed ("OAuth or no authentication"):** both credentials accepted; requests are resolved to the same workspaceId + scope model; no auth-mode-specific privilege. Per-tool `securitySchemes` only if S5 shows ChatGPT needs them.
- **Local legacy bearer token** keeps working for Claude Code/Cursor on loopback, behind the same per-workspace credential store.

### Authorization and review (both modes)
- Scope model: `read`, `propose`. Read-only workspace flag still turns `propose` off at call time (F9).
- **Remote sessions are never auto-accept** (fixes F10): remote-origin sessions are tagged `origin: "remote"`; `autoAcceptable` and `sessionAutoAccept.enable` refuse them, and a test asserts it. Every write tool returns `status: "proposed"` only.
- `delete_object` stays propose-only with destructive annotation (F11).
- Proposals persist in the tab's IndexedDB with `session`, `client`, `createdAt`, expiry (F12); on reconnect they re-appear for review; ChatGPT gets a status tool/resource to see whether its proposal was accepted/rejected (read-only).

### Abuse and ops controls
Rate limits (per credential, per workspace, per IP, token endpoint/pairing-code stricter, lockout on repeated bad codes); request size caps; reply timeout 30 s; per-workspace concurrent-request cap; audit log (tool name, workspace hash, credential id, outcome; no content, no secrets); auto-expiry of remote access; kill switch (feature flag) per deployment.

### Proof-of-concept option (decision 1)
`InMemoryRelayStore` with `maxInstances=1` on a **scratch/non-production** hosting target or locally behind a tunnel, only to run S1-S9. It must (a) key everything by workspaceId (no singleton) so it is not a throwaway in the risky way, and (b) not be promoted to production. No Firebase changes until approval.

## 4. Test plan
### Unit (vitest, `src/mcp/bridge/*.test.ts`, run alongside existing `relay.test.ts`)
- RelayStore contract tests run against **both** `InMemoryRelayStore` and a Firestore emulator-backed store (conformance suite pattern like `runPersistenceConformance`).
- **Isolation:** two workspaces connected at once; request for A never delivered to B's tab; reply from B's tab for A's request id rejected (409); session id from A rejected for B; credential for A cannot select B.
- **Eviction:** attach for workspace B never drops workspace A (regression for F2); same-workspace second tab follows lease rules.
- Credentials: CSPRNG length/entropy, hash-at-rest, constant-time compare, revocation immediate, expiry, rotation, last-used; wrong/short/empty tokens; token in path never logged (log capture test).
- Host/Origin allow-list: loopback ok; configured host ok; unknown host 403; no wildcard; spoofed `Host`/`X-Forwarded-Host` ignored for metadata URLs.
- OAuth: discovery documents shape; DCR redirect allow-list exact match; PKCE S256 required, plain rejected; code single-use; `iss` present on success and error; `resource`/audience binding; refresh rotation + reuse detection; revoked grant -> 401 with correct `WWW-Authenticate`.
- Review safety: remote session cannot enable auto-accept; every write tool result is `proposed`; read-only flips to refusal immediately; `delete_object` proposal requires review; proposal survives simulated tab reload (IndexedDB) and reconnect.
- Rate limiting and lockout; request/reply size caps; 30 s timeout path; not-connected 503 path.

### Route tests (Next routes, no browser)
- `/api/mcp` and `/api/mcp/s/<token>`: initialize -> 202 notification -> tools/list -> tools/call; 404 on unknown session; 401/403/429 matrix; 405 GET; DELETE ends session.
- Well-known endpoints and a fake OAuth client doing the full authorize -> token -> call -> refresh flow.

### E2E (local project `e2e/local/`, extending `lensMcp.local.spec.ts`; no AI/Claude runs unless explicitly requested)
- Two browser contexts as two visitors on a hosted-mode server: each connects, neither disturbs the other; proposals land only on the right canvas.
- Disconnect/reconnect: close tab with a pending proposal, reopen, proposal still pending; MCP session still valid or cleanly re-initializable.
- Secret URL revoke/rotate while a client is connected; OAuth grant revoke.

### Manual (spike S1-S9, then re-run before release)
Real ChatGPT connector through a tunnel, for each of: No authentication, OAuth, OAuth-or-none; plus a read call, a propose call, accept on canvas, reject, disconnect/reconnect, revoke. Evidence captured in section 1's table.

### Security review gate (before any Firebase change)
Threat model for: credential theft via URL leakage (logs, referrers, browser history), cross-workspace routing, DoS by tab eviction, OAuth mix-up/redirect abuse, pairing-code brute force, Firestore rules, data exposure to the tunnel provider/OpenAI. Review sign-off recorded here.

## 5. Order of work (each step needs its own approval where noted)
1. Retry/confirm unfetched OpenAI docs; run the spike S1-S9 on a local PoC (in-memory, per-workspace keyed). **Approval needed to start building the PoC.**
2. Finalize this design + threat model; security review. **Approval gate.**
3. Implement `RelayStore` interface + in-memory store, per-workspace credentials, host allow-list, remote-never-auto-accept, tab-persisted proposals (desktop-safe, no Firebase).
4. Secret-URL mode, then OAuth mode, then mixed.
5. Firestore store + rules + emulator tests. **Requires explicit approval before any Firebase resource is touched or deployed.**
6. Hardening, audit log, docs/UI, E2E, final manual run.

## 6. Open items / risks
- OpenAI docs partly unverified (section 1); behaviour may differ per plan and may change.
- No accounts on hosted: "owner" is a browser-held secret; losing browser data loses control of credentials (acceptable v1, document it).
- Cost/latency of Firestore mailbox polling vs listeners; evaluate in step 5 (30 s reply budget).
- Hosted exposure of a user's notes content to ChatGPT/OpenAI is by design; the dialog must say so.
- `aiFeatureDisabledResponse` semantics for hosted (F16) need a decision.
- Nothing is committed (project rule).

---

# 7. Local proof-of-concept — what was built and verified (2026-10-10)

Scope held to the approval: local, in-memory, disposable. **No Firestore relay, no deploy, no Firebase change, no commit.** Not evidence for production hosting; that is a separate go/no-go.

## 7.1 Decisions applied
- **Separate flags.** `NEXT_PUBLIC_AI_FEATURE` gates client AI only. `MCP_FEATURE` ("on" only; fail closed) is enforced by every `/api/mcp/*`, `/oauth/*` and `/.well-known/oauth-*` route regardless of UI. `NEXT_PUBLIC_MCP_FEATURE` is a UI hint only. `MCP_OAUTH_FEATURE` additionally needs `MCP_FEATURE=on` and `MCP_PUBLIC_BASE_URL`; enabling MCP never enables OAuth. `.env.production`: all three off. `.env.development`: MCP on, OAuth off. Desktop server defaults `MCP_FEATURE=on`.
- Public hosts are an exact allow-list: `MCP_ALLOWED_HOSTS` (no wildcards, never taken from a request). Extra OAuth redirect URIs: `MCP_OAUTH_REDIRECT_URIS` (exact).

## 7.2 Implemented (all under `src/mcp/bridge/` unless noted)
| Piece | File(s) |
|---|---|
| Server-issued, hashed, expiring, revocable credentials per workspace + owner secret + pairing codes | `credentials.ts` |
| `RelayStore` interface, `InMemoryRelayStore`, per-workspace relays (no singleton, no cross-workspace eviction) | `store.ts`, `relay.ts` |
| Shared client request pipeline (flag → host/origin → failure block → auth → rate limit → relay of the *credential's* workspace) | `http.ts`; routes `api/mcp/route.ts`, `api/mcp/s/[token]/route.ts` |
| Owner-only bridge + credential management | `owner.ts`, `api/mcp/bridge/route.ts`, `api/mcp/access/route.ts` |
| OAuth 2.1 server (DCR, PKCE S256, `iss`, `resource`, rotating refresh + reuse detection, pairing-code approval, grant revoke) | `oauth.ts`, `oauthHttp.ts`, `app/oauth/*`, `app/.well-known/*` |
| Remote sessions can never auto-accept; repo-map tools withheld from remote | `ai/changes/autoAccept.ts`, `mcp/server.ts`, `ChangeSetReview.tsx` |
| Proposals survive reload (local browser DB, session-produced sets only, 7-day cap) | `ai/changes/pendingPersistence.ts`, `pendingChanges.ts#all` |
| Tab bridge + host + access dialog use the above | `tabBridge.ts`, `access.ts`, `McpBridgeHost.tsx`, `McpAccessDialog.tsx` |

## 7.3 Isolation proof points
| Required proof | Result |
|---|---|
| Each workspace gets a server-issued CSPRNG credential | Verified (unit + live) |
| A credential reaches only its workspace, regardless of body/params/headers | Verified (unit; hostile `workspaceId` in body/headers/URIs) |
| Connecting a second workspace doesn't disconnect or disturb the first | Verified (unit + bridge route) |
| Remote sessions can't bypass review, even with auto-accept on elsewhere | Verified (unit, MCP-server-level, and live: secret-URL session got `proposed`) |
| Pending proposals survive a tab reload | Verified live in a real browser tab (2 proposals present after reload) and in unit tests |
| Real ChatGPT completes connection/authorization | **NOT verified** — see 7.4 |

## 7.4 S1–S9 results — honest status
No ChatGPT account/connector was available to this session and no tunnel was started (starting one publishes the dev server; that needs your approval). **No ChatGPT setup mode is verified.** "SDK" = the official MCP TypeScript SDK client (a spec-following stand-in, not ChatGPT).

| # | Question | Status | Evidence / what remains |
|---|---|---|---|
| S1 | JSON-only Streamable HTTP accepted | **Partly**: SDK client OK (automated, and live HTTP against `next dev`: initialize, 202 notification, tools/list, resources/read, tools/call, GET→405) | ChatGPT itself untested |
| S2 | `search`/`fetch` required? | **Unknown** | Docs reportedly say no; we expose `search_workspace`, not OpenAI-style `search`/`fetch`. Add a thin pair only if ChatGPT rejects the connector |
| S3 | "No authentication" via secret URL | **Partly**: SDK client OK live (41 tools, proposals created, repo-map withheld, revoke/expiry/rate-limit tested) | Needs real ChatGPT |
| S4 | "OAuth" | **Partly**: SDK's OAuth helper completes discovery → DCR → PKCE → pairing approval → token → tool calls (in memory, automated). Not run over live HTTP (flag off in dev) | Which of CIMD/DCR and which redirect URI ChatGPT really uses; `iss` handling; refresh in practice |
| S5 | "OAuth or no authentication" | **Unverified** | Both server paths exist; unknown which ChatGPT picks and whether per-tool `securitySchemes` are needed |
| S6 | Pairing-code approval UX | **Partly**: page + dialog built and unit-tested; not exercised in a browser with a real redirect | Manual run |
| S7 | Write-tool confirmation / annotations | **Unverified** | Tools carry existing write/delete annotations; effect in ChatGPT unknown |
| S8 | Error experience on 503 / timeout | **Partly**: clear JSON-RPC errors returned (SDK surfaces them) | How ChatGPT displays them |
| S9 | Reconnect without re-adding connector | **Partly**: reload keeps proposals; sessions end and must re-initialize (per spec) | ChatGPT's re-init behaviour; after a **server restart** credentials are gone (in-memory) and the tab re-issues new ones, so secret URLs/OAuth grants must be re-created |

## 7.5 Manual runbook for the real ChatGPT spike (needs your go-ahead: it exposes the dev server publicly)
1. Pick a throwaway workspace. In `.env.local` (not committed): `MCP_ALLOWED_HOSTS=<tunnel host>`, `MCP_PUBLIC_BASE_URL=https://<tunnel host>`, `MCP_OAUTH_FEATURE=on` (for S4–S6).
2. `npm run dev`; start a tunnel to it (ngrok is installed on this machine). The tunnel must preserve the public `Host` header.
3. App → ⋮ → MCP access → On; paste the tunnel address; **Create secret URL**.
4. ChatGPT → Settings → Apps → Advanced → Developer mode → add custom MCP server. Run in turn: *No authentication* with the secret URL (S3); *OAuth* with `https://<host>/api/mcp` and the pairing code (S4/S6); *OAuth or no authentication* (S5). For each: a read call, a create call (S7), accept/reject on canvas, reload the tab (S9), stop the tab (S8), revoke.
5. Record request logs (secrets redacted) in 7.4; tear the tunnel down.

## 7.6 Known limits / risks (do not hide)
- In-memory only: one process, state lost on restart; ownership is trust-on-first-use of a browser-held secret. Production design (Firestore leases, persisted claims) is unbuilt and unreviewed.
- Rate limits are per-process and keyed on `X-Forwarded-For` (spoofable unless the proxy sets it); real deployments need a trusted-proxy rule.
- Pairing code ≈ 40 bits, protected only by the failure limiter.
- Secret URLs are bearer secrets: anyone with the URL can read and propose until expiry/revoke; the dialog says so.
- Persisted proposals sit in the browser DB unencrypted, like workspace data.
- Repo-map tools are not offered to remote clients (v1 simplification). Open question: add a review-only variant?
- Pre-existing, unrelated: `src/domain/provenanceGuard.test.ts` fails 2 tests on `src/testUtils/repoMapWorld.ts` (file untouched by this work); `layoutDReuse` timed out once under load and passed on re-run.

## 7.7 Go / no-go for production architecture
**Not decided here.** Prerequisites: (1) real-ChatGPT S1–S9 evidence, (2) security review of §3 and 7.6, (3) your approval before any Firebase resource is created. Recommended next step: run 7.5.
