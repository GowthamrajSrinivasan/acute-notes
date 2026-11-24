# Intelligent update engine: pending items

**Date:** 2026-11-22 · **For:** the product owner and engineers picking up the work ·
**Source of truth:** [intelligent-update-engine-plan.md](../intelligent-update-engine-plan.md) (§14, §15.4, §16.4, §16.5, §17.4, §17.5).
Item numbers are the plan's own (1–37, E1–E6, U1–U6), so they cross-reference.

The intelligent update engine makes new content update the notes and cards already on a canvas instead of adding a second copy.

**Where it stands (commits `14809a2`, `e69bb8a`, `ee5aa24`, `020d942` on `main`):**
- **§17 shipped.** "Merge into existing notes" (the default) now updates existing cards in place. Each new statement is matched to the statement it is about (`src/ai/merge/statementMatch.ts`, task `match_statements`, decision model preferred, deterministic fallback without AI). The AI consistency check runs on its own after an accepted change; there is no manual "Check now".
- **§17.5: the consistency panel and chip are off by default** (`NEXT_PUBLIC_CONSISTENCY_PANEL`). While off, no check runs after a commit and the AI check sends nothing. The code is kept; `=on` brings it back. So every Stage 4f / consistency / AI-check item below (#1–6, #29–37, E1–E6, U5, U6) is **dormant** until the panel is turned back on. Items that wait for pilot data (#2, #3, #29) get no new data while it is off.
- **Accuracy:** strict recall 77.5% was **accepted** (§16.5). 85% is enhancement E1, not a gate.
- **Done 2026-11-22:** U1 (plan §17.6). **Stage 5 wiring (#17–#19, #24) built 2026-11-22** behind `ACUTE_EMBEDDINGS` / `NEXT_PUBLIC_SEMANTIC_PLACEMENT`, off by default (plan §18). Another session also has uncommitted "changed card" work in `src/ai/reconcile/update.ts` and `src/ai/reconcile/cardMatch.ts` (see #27).

**Needs** uses three words: **offline** (engineering work, no model calls), **decision** (product owner or reviewer), **paid** (a model run that needs approval first).

---

## 1. Update flow (product-facing)

| # | Item | Needs | Status |
|---|---|---|---|
| U1 | Shared-ChatGPT-chat imports and economy imports still append new content and still open "Needs your call" choices. They should update in place like "Merge into existing notes". | Decision (made) + offline | **Done 2026-11-22** (plan §17.6). The real-Jev chat-update recording (paid, opt-in) was never made; it will include the new requests when it is |
| U2 | Code blocks, tables and quotes in new content are filed whole (appended), not matched statement by statement. Needs table-row and list-aware matching. | Offline | **Done 2026-11-23** (plan §17.7): tables merge into the existing table by key column; lists covered by a test; code and quotes stay whole by design |
| U3 | Whether a section is drawn as cards or a table is the outline model's choice on the first Visualize; later updates keep that choice and never revisit it. | Decision (whether to change it at all) | Open (no action planned in the plan) |
| U4 | `match_statements` adds one decision-model call per merge that touches existing notes, and has no typed (Jev) recording yet. Its cost is unmeasured. | Paid (measure on the chat-import cost benchmark) | Open |
| 13 | `classify.ts` rule 2 raises a spurious conflict on user-worded cards after two source moves. Safe, but noise; tracked as a `test.fail` "known gap" in `stage1Gate.local.spec.ts`. | Offline | **Fixed 2026-11-24** (plan §19.4): a user-worded card counts as edited for "source silent"; gate spec 10/10 on committed code |
| 34 | **A reload right after Accept loses the accepted change and the last edits** (found 2026-11-24 by gate 4c, committed code): deferred writes (400 ms debounce, Yjs buffer) aren't awaited on `pagehide`; the source moves on, the canvas doesn't. | Offline (save path; `commitOnCanvas.ts` has other sessions' work) | **Fixed 2026-11-24** (plan §19.5): Accept saves at once (`saveAfterAccept.ts`, `CanvasSession.flush`); gate 4c 10/10 with its immediate reload. Promote and knowledge review actions (other lanes) can call `saveNow()` too |
| 16 | Router destinations must be canvas elements only. The off-canvas document bug found live in Stage 2 was fixed and tested (§10); §14 asks only to re-verify it stays closed. | Offline check | **Confirmed 2026-11-24** (plan §19.3): Stage 2 test still passes; the semantic path tested too |

## 2. Stage 5: meaning-based targeting (semantic locate and anchor)

| # | Item | Needs | Status |
|---|---|---|---|
| 17 | 5a: wire the local embedding model (MiniLM-L6 behind `EmbeddingProvider`; the hashed embedder is still the default). Untested: the `sharp` advisory, running in a worker, Next/Electron bundling. Open question Q2: web build uses the model or the hashed embedder. Multilingual (MiniLM-L12, 364 MB RAM) later. | Offline + a bundling decision | **Wired 2026-11-22, switch off by default** (plan §18): server route + browser provider, `sharp` fixed. Left: Electron packaging/bundled weights, IndexedDB vectors |
| 18 | 5b card-level (item-level) index and 5c router descent with early exits. Prototypes only (`itemIndex.ts`, `descent.ts`). On dev, correct placement rose from 13% to 25–32%; the "belongs nowhere" thresholds were read off dev and are likely optimistic. | Offline | **Wired 2026-11-22, switch off by default** (plan §18). Left: selection/open-frame context, MCP `suggest_placement`, held-out score (#21) |
| 19 | 5d anchor actions: append, insert after an item, add a table row, each as a `patch_block`. This is the gap behind the 2% "into the card" rate. | Offline | **Built 2026-11-22** (plan §18): `after_item`, `append`, `table_row`, `cell` as reviewed `patch_block` inserts. Left: header-only cell changes, mixed prose+list cards |
| 20 | 5e one "relate" call: picks the operation, target item and evidence; never edits content. Needed for duplicates (no deterministic signal) and update actions. | Paid (a written proposal, then approval) | Open |
| 21 | 5f held-out set: 4 label differences wait for a separate reviewer (this lane never reads them). Score the held-out set once per decision and record each use. | Decision (the reviewer) | Open |
| 22 | Latency and perceived-speed rules R1–R22: proposed, not built or measured. R21 "learn to skip" is deferred because it changes routing weights and risks a feedback loop. | Offline, alongside 5a–5e | Open |
| 23 | §13.8 Q4: should consistency checking eventually move into the relate call? | Decision (after Phase 2) | Open |
| 24 | "Belongs nowhere" framing: make it the dialog's first suggestion while still offering the top card; never create a new section silently. | Offline, with the 5c wiring | **Built 2026-11-22** with the 5c wiring (plan §18) |
| 14 | Impact discovery is word-overlap only, so it makes false matches (e.g. "timeouts" vs "retries five times"). The meaning-based version waits for Stage 5 embeddings; also review its gating once it runs on real canvases. | Offline, after #17/#18 | Open (blocked on Stage 5) |
| 15 | Router weight tuning: wait for real canvases and the 5f locate set. `route_content` is non-deterministic, so it stays a preselection the user confirms. | Real-canvas data + 5f | Open (blocked) |

## 3. Consistency check and AI check (dormant while the panel is off)

| # | Item | Needs | Status |
|---|---|---|---|
| U6 | If the panel comes back, frame titles must never be paired as statements (the "only a document title" records in the user's screenshot). | Offline | Dormant; do first if the panel returns |
| U5 | A pair the AI check could not send (no connection, budget used) waits for the next accepted change or the next panel open; there is no manual retry. | Decision (whether that is enough) | Dormant |
| E1 | Strict recall 77.5% → 85%. 5 date-context guard holdbacks (y05, y24, y49, y65, y83: the AI said "contradicts", the guard held them at "possible") need a time-overlap guard; 3 exception/subgroup/narrower-scope misses (y31, y61, y86) need prompt work; 1 numeric-cap misread (y12). Measure on a fresh sealed set (unseen6); never tune on unseen5. | Offline + paid (unseen6 recording) | Dormant; enhancement, not a gate |
| E2 | Decide the reference labels for the ambiguous pairs y20 and y45 (currently counted as false conflicts). | Decision | Dormant |
| E3 / 34 | Wider coverage: manual edits, content already present at opt-in, and old-vs-old card pairs are never queued for checking. | Offline (Phase 2 design) | Dormant |
| E4 / 30 | More models: only gpt-oss-120b is measured on the direct path; other chat-completions connections (some may reject `reasoning_effort`) are untested. The panel warns on other models. | Decision + paid (one bounded run per model) | Dormant |
| E5 / 35 | No server-side daily cap; clearing site data resets the per-device budget. | Offline (if the pilot shows a need) | Dormant |
| E5 / 36 | The server accepts `maxTokens` ≤ 1,300 and a prompt ≤ 8,000 characters (~3,800 tokens), looser than the client's 2,800-token reservation. Tighten it to match. | Offline | Dormant |
| 1 | Direct-path reservations under-count prompt tokens by 6–39 per call (characters ÷ 4 misses the chat-template margin), so the reservation is not a true upper bound. `REQUEST_OVERHEAD.direct_http` (64) exists but is not wired. Re-pin the frozen reliability/guard-smoke tests to byte copies first. | Offline | Dormant |
| 2 | Long-term execution reliability: one 6-call day measured, so the p95 rests on 6 samples, and queue time can't be separated from latency. | Pilot data, or a separately approved paid run | Dormant (no pilot data while off) |
| 3 | Dynamic batching (other than 10 pairs per call). | Data from #2 | Dormant |
| 4 | Raising the 90,000-token daily cap (about 39 full calls a day). Kept by every review so far. | Decision (product owner) | Dormant |
| 6 | Recorder clean-up for future sets: placeholder "expected compatible" text in rules-only `routing.md` lines, and the reservation lacks the margin from #1. Fix only in a new recorder version, never a frozen one. | Offline, before the next set's code freeze | Dormant |
| 29 | Live recall on real canvases: retrieval (top 20 cards per claim) and the 10-pairs-per-check budget are unmeasured on real notes. | Pilot data | Dormant (no pilot data while off) |
| 31 | The queue holds at most 200 pairs per canvas (oldest dropped, now counted and shown); there is no UI to see or clear individual queued pairs. | Offline, if needed | Dormant |

## 4. Copilot SDK path

Stage 4f uses direct HTTP, so most of these matter for the other AI tasks or if the SDK route comes back. **#7 is not dormant: it affects every AI task that goes through a Copilot BYOK connection today.**

| # | Item | Needs | Status |
|---|---|---|---|
| 7 | **No output cap and temperature 1 on all BYOK tasks.** Measured on the wire: the SDK sends no `max_tokens` and `temperature: 1` for BYOK requests. Only guarded single-attempt calls get overrides; Visualize, Ask AI and update/merge calls over Copilot BYOK run uncapped and not at the caller's temperature. | Offline design, then a decision (e.g. apply the overrides to all BYOK requests) | **Done 2026-11-23 for chat-completions, responses-API and Anthropic BYOK** (plan §19, §19.1; Azure still through the SDK): direct call with the task's cap and temperature. Left: Anthropic / Azure / responses-API BYOK; a live check (paid) |
| 8 | SDK internal retries: unguarded calls are retried up to 5 times on 429/5xx (up to 6 billable requests). Is that acceptable for interactive tasks? | Decision | **Partly done 2026-11-23** (plan §19, §19.1): chat-completions, responses-API and Anthropic BYOK now at most 2 requests; Azure and Copilot subscription calls still the SDK's |
| 9 | SDK reservation for the consistency check: `requestOverhead.ts` (~2,311 tokens) is an unused prototype; under 2,800 per call no check fits the SDK path. Options: "customize" mode (unmeasured) or an SDK-only budget; "replace" is not approved. | Decision + offline measurement | Dormant (SDK route not in use) |
| 10 | WebSocket model transports: the guard refuses them, but this is only unit-tested, not exercised end to end. | Offline, if a WebSocket provider is used | Dormant |
| 11 | SDK upgrades: the guard uses the experimental `requestHandler` hook; `sdkPin.test.ts` fails on any version change until the retry, wire-field and live checks are rerun and `retryGuardVerification.json` is updated. | Offline + paid (live part), on every upgrade | Recurring |
| 12 | Copilot subscription connections allow no output cap, so the consistency check never runs there (`output_cap_unavailable`). The user-facing wording should say so plainly. | Offline (UI copy) | Dormant (panel off) |

## 5. Tests, repository and process

| # | Item | Needs | Status |
|---|---|---|---|
| 27 | `src/ai/reconcile/update.ts` is LF in the worktree but CRLF in git (byte-exact policy since `5d68cb1`), so its owner's next commit shows a whole-file diff. Relevant now: another session has uncommitted changes in `update.ts` / `cardMatch.ts`. | That session, when it commits | Open |
| 28 | The update-engine rows in `knowledge-notes-lanes.md` are stale (still describe the state before §15–§17). | Offline, when the file is free | **Done 2026-11-24** (plan §19.3) |
| 5 | Intermittent test timeouts: 5-second timeouts and performance budgets fail under full parallel load; serial runs are clean (§17.3 saw 8 such failures, all passing alone). | Offline (test infrastructure) | Open |
| 32 | The in-app consistency test needs a flags-on dev server (one Next dev server per folder; Turbopack rejects a linked `node_modules`, so a copy runs with `--webpack`). | Offline (test infrastructure) | Dormant |
| E6 / 37 | `consistency.local.spec.ts` assumed the UI switch off and failed with it on. Since §17.5 it (and `aiCheck.local.spec.ts`) needs a panel-on server URL and is skipped otherwise. | Offline | Dormant |
| 25 | Long paths: the longest tracked path is 133 characters; clones in deep Windows folders need `core.longpaths=true`. Consider shorter experiment paths. | Decision (knowledge-notes lane) | Open |
| 26 | Intermediate commits from the 2026-11-15 lane-split sequence may not build; only the final tree was verified. History is not rewritten. | None | Recorded only |
| 33 | Windows: vitest fails every file ("reading 'config'") when started from a lower-case `c:` working directory; run from `C:`. | None | Recorded only |

---

## Suggested order

1. ~~**Stage 5 leftovers**~~ **done 2026-11-24 (plan §18.2):** selection/open-frame context, vectors kept in IndexedDB, MiniLM-L6 bundled in a desktop build with semantic placement on (and the desktop server's CommonJS start fixed). Left: an Electron package run; MCP `suggest_placement` (another lane). Land #27 (line endings) with the session's `update.ts` commit.
2. **#7 done for chat-completions BYOK (plan §19).** Live smoke passed 2026-11-23 (3/3 on AICredits, one request per call, cap and temperature honoured; plan §19). AI e2e suite on BYOK run 2026-11-23: 28 passed / 11 failed; A/B rerun on committed code cleared #7 (direct on 8/8, off 7/8; plan §19). Anthropic and responses-API BYOK now direct too (plan §19.1, offline; Azure stays on the SDK). Next there: one approved live Anthropic call. The full run's other failures are followed up in plan §19.2 (ChatGPT share pages changed shape: parser fixed, the importer's user agent gets only a preview page — a decision).
3. **U4, cost of `match_statements`:** one approved paid run on the chat-import cost benchmark, after U1, since U1 sends more merges through statement matching. **Prep done 2026-11-24 (plan §19.3):** the spec reads saved transcripts (`CHAT_SHARE_TRANSCRIPTS`); the first pages were saved signed in (rendered only, no conversation data); waiting for the three pages saved from a private, signed-out window.
4. ~~U2, table-row and list-aware matching~~ — done 2026-11-23 (plan §17.7).
5. ~~**Quick clean-ups:** #28 (lanes file) and #16 (confirm the off-canvas fix).~~ Done 2026-11-24 (plan §19.3). Leave the dormant consistency items until the panel is turned back on, and if it is, start with U6.
