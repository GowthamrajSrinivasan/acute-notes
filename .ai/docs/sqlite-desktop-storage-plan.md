# SQLite desktop storage + cross-device sync — plan

Living document. **Update the checkboxes and the Progress log as work lands.** Status: **B0 PASSED (2026-10-09). Plan approved; Phase A done; Phase B complete (B0–B10); items in "Not covered / follow-ups" remain.**

Scope of this document: Phases A and B (persistence contract + desktop SQLite). Phases C–E (manifest Y.Doc, sync provider/server, cross-device test) are listed only as context and are **not** to be started yet.

Working rules for this effort
- Never commit / push / open PRs; leave changes uncommitted.
- Never run Claude Code, `e2e:ai`, or contract tests (AI) unless the user asks in that turn.
- Existing local data may be discarded (still in development): no IndexedDB → SQLite migration.
- Another session may edit `src/` concurrently; retry transient type/build errors.

---

## 1. Approved decisions

| # | Decision |
|---|---|
| D1 | Auth for the first sync prototype: **workspace-key access** (revocable secrets, secure sessions). No mandatory accounts in the first sync release. |
| D2 | Hosting: **hosted Hocuspocus** for the public sync release; validate locally/test first; server endpoint **configurable** (self-host later). |
| D3 | Metadata sync: **workspace manifest Y.Doc** for workspace/canvas/document metadata; content stays in separate Y.Docs; explicit deletion tombstones and restore/conflict rules. |
| D4 | Web keeps IndexedDB; desktop gets SQLite + hashed asset files; both behind the existing `PersistenceServices` interfaces. |
| D5 | Storage engine, sync, and AI billing stay independent decisions. |

## 2. Spike results (read-only, run 2026-10-09; repo not modified)

**Headline: no native module is needed.** Electron 44.7.0 bundles Node 24.21.0 (ABI 149), and its built-in `node:sqlite` works.

| Check | Result |
|---|---|
| `require('node:sqlite')` inside Electron 44.7 (run via `ELECTRON_RUN_AS_NODE=1 electron.exe -e`) | **Works.** SQLite 3.53.4, no experimental warning on Electron's Node 24. |
| BLOB round-trip (`Uint8Array` in → `Uint8Array` out) | **OK** — fits Yjs updates. |
| FTS5 virtual table | **OK** — usable for future search. |
| WAL mode | **OK** (`journal_mode=wal`). |
| Perf sanity: 20 000 Yjs-sized rows, load 400 rows for one doc | **5.4 ms.** |
| `better-sqlite3` (latest 13.0.3, needs Node ≥ 22) | GitHub release has **no win32-x64 prebuilt assets** (and none for Electron). Would need a source build with node-gyp + MSVC on every dev/CI machine, plus `@electron/rebuild` and asar-unpack handling. |
| Dev machine Node 22.23.3 | `node:sqlite` exists but prints an ExperimentalWarning; fine for Vitest. |

**Spike conclusion / recommendation (changes the original ask):** use **`node:sqlite`** instead of `better-sqlite3`.
- No native build, no `@electron/rebuild`, no asar-unpack, no per-arch prebuilds (also avoids a future macOS arm64/x64 matrix problem).
- Current `electron-builder.yml` (`npmRebuild: false`, no `node_modules` in the shell, `files: electron/**`) needs **no change** to ship it.
- Trade-off: `node:sqlite` is still flagged "experimental/release-candidate" upstream, and its API is synchronous and smaller than better-sqlite3's (no `.transaction()` helper, no user-defined functions). Mitigation: keep all SQL behind one small `electron/storage/` module so swapping engines is a one-file change; pin the Electron version in lockfile; add the packaged-app check below as a gate.

**Still to be proven (Task B0 below):** that the *packaged* app (`dist-desktop/win-unpacked`, built by `npm run desktop:pack`) can open/write/reopen a SQLite file from the main process. This is expected to pass (built-in module) but the user asked for it to be verified on the real package, not dev.

If B0 fails or `node:sqlite` is judged too risky, fall back to `better-sqlite3` via a second spike (build from source + `@electron/rebuild` + `asarUnpack`). Keep the storage module engine-agnostic so that fallback is cheap.

## 3. Findings about the current code (what constrains the design)

- `getPersistence()` ([src/persistence/index.ts](../../src/persistence/index.ts)) is the single construction point; it calls `createIndexedDbServices(openAcuteDB())` and `navigator.storage.persist()`. Only `index.ts` calls `openAcuteDB` outside tests → clean backend switch point. 36 files use `getPersistence()`.
- All repository methods already return Promises → an IPC-backed implementation fits without interface changes ([types.ts](../../src/persistence/repositories/types.ts), 11 services in `PersistenceServices`).
- Existing test file [persistence.test.ts](../../src/persistence/persistence.test.ts) runs memory + IndexedDB (via `fake-indexeddb`); it is the seed for the shared conformance suite. Vitest env is `node`.
- Desktop architecture: Electron main → `utilityProcess` runs the Next standalone server; renderer loads `acute://app` (proxied to loopback). Window is `sandbox: true`, `contextIsolation: true`; [preload.cjs](../../electron/preload.cjs) exposes only `acuteDesktop.mcpOrigin`. SQLite must therefore live in the **main process** (or a worker it owns) and be reached via a new preload API.
- MCP runs *inside the renderer tab* ([tabBridge.ts](../../src/mcp/bridge/tabBridge.ts)) over the same repositories → MCP writes automatically go through the SQLite backend. No separate MCP persistence path to build.
- `StoredAsset.blob` is a `Blob`. Electron IPC structured clone does **not** reliably carry `Blob`; the IPC layer must convert to `ArrayBuffer` + `mimeType` and rebuild the `Blob` in the renderer.
- Asset ids are **already content hashes** (SHA-1 hex, [imageAssets.ts](../../src/components/blocks/imageAssets.ts); Excalidraw file ids likewise). No id change needed for hashed asset files. (SHA-1 is acceptable for dedup here; revisit if assets become a trust boundary in sync.)
- `YUpdateStore` contract: `load` returns numeric `keys[]` + `updates[]`; `compact(docId, loadedKeys, merged)` must atomically replace *only* those keys; concurrent appends must survive. SQLite: autoincrement integer PK + one transaction.
- Device-local stores (AI conversations/turns, content sources+versions, repo maps, agent changes/sessions, AI connections) are part of `PersistenceServices` and must be implemented in SQLite too (so desktop is fully on one store), but they stay out of exports and future sync.
- `db.ts` holds the IndexedDB schema/migrations (`DB_VERSION`, `MIGRATIONS`); SQLite gets its own versioned migration list (`PRAGMA user_version`), separate from IndexedDB's.
- Secrets: AI credentials live in `src/ai/credentials/`, not in these stores. Moving BYOK keys to OS secure storage (`safeStorage`) is a **separate follow-up**, out of scope here.

## 4. Target design (Phases A–B)

```
renderer (acute://app)
  getPersistence()  ── desktop? ──►  createIpcServices(window.acuteDesktop.storage)   (Proxy over invoke)
                    └─ web ───────►  createIndexedDbServices(openAcuteDB())            (unchanged)

preload.cjs   contextBridge: acuteDesktop.storage = { invoke(service, method, args) }
main.cjs      ipcMain.handle("acute:storage", validate sender + allowlist → dispatch)
electron/storage/
  db.cjs        open file (userData/acute-notes.sqlite3), pragmas (WAL, foreign_keys, synchronous=NORMAL), migrations by user_version
  services.cjs  SQL implementation of every PersistenceServices method (same semantics as indexeddb.ts)
  assets.cjs    content-addressed files: <userData>/assets/<id[0..2]>/<id>, atomic write (tmp + rename), metadata row in SQLite
  ipc.cjs       registers handler; allowlist generated from the service/method table; (de)serialises Blob<->ArrayBuffer
```

Design choices
- **Single generic IPC channel with an explicit allowlist**, not raw SQL and not one channel per method. The renderer-side Proxy keeps `PersistenceServices` typing intact.
- **Sender validation:** handler rejects calls whose `event.senderFrame.url` is not under `acute://app`.
- **Storage format:** records stored as JSON text with extracted columns for the lookups the repositories need (`workspace_id`, `canvas_id`, `kind`, `conversation_id`, …); Yjs updates and small blobs as BLOB; asset *bytes* as files, asset *metadata* in a table.
- **Main-thread blocking:** `node:sqlite` is synchronous. Start in the main process; B8 measures large-workspace load. If it exceeds budget (see B8), move the storage module into a `worker_threads`/`utilityProcess` host behind the same `invoke` surface — the IPC contract does not change.
- **Multi-window safe:** one connection owned by main serialises all writers (better than IndexedDB multi-tab).
- **Errors:** IPC rejections carry `{code, message}`; the proxy rethrows as `Error` so existing callers (e.g. `DocumentProvider.flush` retry-on-error) behave identically.

## 5. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | `node:sqlite` still marked experimental; API could change in a future Electron bump | Med / Med | Pin Electron; isolate in `electron/storage/db.cjs`; packaged-app gate; fallback = better-sqlite3 spike |
| R2 | Packaged build differs from dev (paths, asar) | Low / High | B0 verifies on `desktop:pack` output; DB + assets live in `app.getPath("userData")`, never inside asar |
| R3 | `Blob` not cloneable over IPC | High / Med | Convert to `ArrayBuffer` at the IPC boundary; covered by conformance test through real IPC |
| R4 | Main-process blocking on big loads / compaction | Med / Med | Measure (B8); worker host fallback with unchanged contract |
| R5 | Semantic drift between IndexedDB and SQLite (ordering, missing = `null`, delete cascades, `getMany` order) | High / High | Single conformance suite run against all three backends; written *first* (Phase A) |
| R6 | Yjs compaction race loses updates | Low / Critical | `compact` = one transaction deleting only `loadedKeys`; dedicated race test (append between load and compact) |
| R7 | Crash mid asset write leaves partial file | Low / Med | tmp file + `rename`; `has()` checks metadata *and* file; startup does not trust orphan tmp files |
| R8 | Concurrent session edits to `src/` collide | Med / Low | Small, additive changes; new files over edits where possible |
| R9 | DB corruption / lock on crash or second instance | Low / High | WAL + `synchronous=NORMAL`; `app.requestSingleInstanceLock()` check (B3); `PRAGMA integrity_check` on startup logged, not fatal |
| R10 | Next dev (`next dev` in browser) has no Electron → must keep working | Med / Med | Backend selected by feature detection of `window.acuteDesktop?.storage`; web path untouched |

## 6. Files to change / add

Add
- `src/persistence/conformance/runPersistenceConformance.ts` — shared suite, takes `() => Promise<PersistenceServices>`.
- `src/persistence/repositories/ipc.ts` — renderer-side Proxy backend + Blob/ArrayBuffer codec.
- `src/persistence/repositories/ipcContract.ts` — service/method allowlist + types shared by renderer and main (plain data so `.cjs` can mirror it; a unit test asserts both stay in sync).
- `electron/storage/{db,services,assets,ipc}.cjs`, `electron/storage/schema.cjs` (migrations).
- `src/types/acute-desktop.d.ts` — extend (already exists) with `storage`.
- Tests: `src/persistence/persistence.conformance.test.ts` (memory + IndexedDB), `electron/storage/*.test.mjs` (SQLite services under Vitest/Node, no Electron), `e2e/desktop-storage.spec.ts` (Playwright `_electron` against the packaged app).
- `scripts/desktop-storage-smoke.mjs` — packaged-app smoke (B0).

Modify
- [src/persistence/persistence.test.ts](../../src/persistence/persistence.test.ts) — move shared cases into the conformance suite; keep IndexedDB-only migration tests.
- [src/persistence/index.ts](../../src/persistence/index.ts) — backend selection.
- [electron/main.cjs](../../electron/main.cjs) — init storage, register IPC, single-instance lock, close DB on quit.
- [electron/preload.cjs](../../electron/preload.cjs) — expose `storage.invoke`.
- [electron-builder.yml](../../electron-builder.yml) — include `electron/storage/**` (already matched by `electron/**`; verify only).
- [src/portability/workspaceBundle.ts](../../src/portability/workspaceBundle.ts) + tests — only if the round-trip test reveals gaps (bundle schema version belongs to Phase A.4).
- `package.json` — new scripts only (`test:desktop-storage`, `desktop:smoke`); no new runtime dependency expected.

Explicitly **not** touched: sync provider, auth, manifest Y.Doc, server, MCP tools, AI code.

## 7. Test plan

1. **Conformance suite** (the contract): for every service, cover create/get/put-overwrite/delete/list/ordering, `null` for missing, `getMany` order + missing, `listByWorkspace` filters (incl. document `kind`), cascade deletes (conversation→turns, content source→versions, workspace→agent state), `aiConversations.append` atomicity, `assets` put/has/get round-trip (bytes + mimeType + createdAt equal), `meta` get/set/delete with structured values.
2. **Yjs store semantics:** append order preserved; `load` returns keys matching updates; `compact` removes exactly `loadedKeys`; an update appended between `load` and `compact` survives; `clear`; replaying merged result equals original doc state; `DocumentProvider` round-trip (reuse `DocumentProvider.test.ts` cases against each backend).
3. **Backends under the suite:** memory, IndexedDB (fake-indexeddb), SQLite-direct (Node `node:sqlite`, temp dir), SQLite-through-IPC-codec (in-process fake `ipcMain`/`invoke` with the real serializer), and finally **real Electron IPC** in the packaged app.
4. **Portability:** build a workspace (notes, canvas, image, relationships) → export bundle → import into a fresh backend → export again → deep-equal. Run for IndexedDB→SQLite and SQLite→IndexedDB. Device-local stores confirmed absent from the bundle.
5. **Packaged-app e2e (Playwright `_electron`, no AI):** launch `win-unpacked`, create workspace + note + paste image, quit, relaunch, assert content and image survive; assert DB file and `assets/<hash>` file exist under a temp `--user-data-dir`; kill -9 mid-edit and relaunch; second instance is refused/forwarded.
6. **Failure paths:** IPC rejection surfaces as an `Error` and `DocumentProvider` retries; sender from a foreign origin is rejected; unknown service/method is rejected; corrupt/locked DB shows a clear dialog instead of a blank app.
7. **Performance:** `src/performance/largeWorkspace` scenario on SQLite: open large workspace, append burst of 1 000 updates, compaction — compared against IndexedDB baseline.
8. Full existing `npm test`, `npm run typecheck`, `npm run lint` stay green. No AI/contract tests.

## 8. Task list with acceptance criteria

Legend: `[ ]` todo · `[~]` in progress · `[x]` done. Each task ends with its acceptance criteria (AC). Do them in order; each is independently reviewable.

### Phase B0 — Packaging spike (first)

- [x] **B0.1** Throwaway spike module `electron/storage/spike.cjs` (deleted after) opens `userData/spike.sqlite3` via `node:sqlite`, creates a table, writes a BLOB, reads it back, logs `process.versions` and SQLite version; triggered by an env var, not in normal startup.
  - AC: runs under `npm run desktop:run`.
- [x] **B0.2** Build the real package: `npm run desktop:pack`; launch `dist-desktop/win-unpacked/Acute Notes.exe` (use `env -u ELECTRON_RUN_AS_NODE`) with the spike env var and a temp `--user-data-dir`; run twice.
  - AC: first run creates the file and writes; second run reads the previous row; log shows Electron 44.7 / Node 24 / SQLite version; no native-module or asar error; app still starts normally with the env var unset.
- [x] **B0.3** Record results in §10; delete the spike module. **Gate:** if B0.2 fails, stop and run the better-sqlite3 fallback spike (build from source, `@electron/rebuild`, `asarUnpack`) before continuing.
  - AC: spike code removed; decision (node:sqlite vs better-sqlite3) written in §10 and approved by user.

### Phase A — Shared contract (backend-agnostic; runs on current code)

- [x] **A1** Extract `runPersistenceConformance(factory)` from `persistence.test.ts`; run it for memory and IndexedDB.
  - AC: all previous assertions preserved; both backends green; IndexedDB-only migration tests remain in the old file.
- [x] **A2** Fill gaps in the suite (see Test plan 1–2): cascades, `getMany`, atomic `append`, compaction race, asset byte equality.
  - AC: gaps found are either fixed in `memory.ts`/`indexeddb.ts` (with a note in §10) or recorded as intentional differences.
- [x] **A3** Add `DocumentProvider` persistence cases parameterised by backend.
  - AC: provider load/append/compact/dispose tests run against memory + IndexedDB.
- [x] **A4** Portability safety net: cross-backend bundle round-trip test (memory↔IndexedDB for now); add explicit bundle schema version + validation if absent; confirm device-local stores excluded.
  - AC: round-trip deep-equal; importing a bundle with unknown future version fails with a clear error; existing `workspaceBundle.test.ts` green.

### Phase B — SQLite backend

- [x] **B1 Schema + migrations** (`schema.cjs`, `db.cjs`): tables for workspaces, canvases, documents, yupdates (`seq INTEGER PRIMARY KEY AUTOINCREMENT, doc_id, update BLOB, created_at`, index on `doc_id`), assets (metadata), meta, ai_connections, ai_conversations, ai_turns (PK `(conversation_id, seq)`), content_sources, content_source_versions, repo_maps, agent_changes, agent_sessions; `PRAGMA user_version` migrations; pragmas.
  - AC: opening a new file creates schema v1; reopening is a no-op; opening a DB with a *newer* user_version refuses with a clear error; unit test covers all three.
- [x] **B2 Services** (`services.cjs`): implement every `PersistenceServices` method with IndexedDB-equivalent semantics; multi-row writes in transactions (`BEGIN IMMEDIATE`/`COMMIT`, rollback on error).
  - AC: **entire conformance suite green against SQLite-direct** (Node, temp dir), including compaction-race test.
- [x] **B3 Assets** (`assets.cjs`): content-addressed files, atomic write, dedupe on existing id, metadata row, `has` verifies file exists, id validated against `^[0-9a-f]{40}$|safe-id` regex to prevent path traversal.
  - AC: conformance asset cases green; traversal ids (`../x`) rejected; interrupted-write test leaves no visible partial asset.
- [x] **B4 IPC boundary**: `ipcContract.ts` allowlist, `ipc.cjs` handler (sender check, unknown method rejection, Blob↔ArrayBuffer codec, error shape), `preload.cjs` `storage.invoke`, `main.cjs` init/shutdown (+ single-instance lock, DB closed on `before-quit`).
  - AC: allowlist test asserts contract ↔ `services.cjs` method sets are identical; in-process IPC simulation runs the **full conformance suite green**; foreign-origin and unknown-method calls rejected.
- [x] **B5 Renderer backend** (`repositories/ipc.ts`) + `getPersistence()` selection by `window.acuteDesktop?.storage`; `navigator.storage.persist` call only on the web path; extend `acute-desktop.d.ts`.
  - AC: typecheck/lint clean; `npm run dev` in a normal browser still uses IndexedDB; no code outside `src/persistence/` knows which backend is active.
- [x] **B6 Real-IPC verification in dev Electron** (`npm run desktop:run`): manual + scripted check that workspace create / note edit / image paste / canvas edit / MCP write all hit SQLite.
  - AC: DB file shows rows for each; assets directory contains the pasted image hash; restart restores everything.
- [x] **B7 Packaged-app e2e** (`e2e/desktop-storage.spec.ts`, Playwright `_electron` on `win-unpacked`): scenarios in Test plan 5 (restart persistence, kill-and-recover, second-instance, IPC error → retry).
  - AC: spec green on a fresh `npm run desktop:pack` output; documented command in §9.
- [x] **B8 Performance + blocking budget**: run large-workspace scenario on SQLite vs IndexedDB. Budget: workspace open ≤ IndexedDB baseline + 20 %; no single IPC call blocks the main process > 50 ms for typical operations; 1 000-update burst + compaction finishes without UI jank.
  - AC: numbers recorded in §10. If budget missed → implement worker host (new task B8b) before proceeding.
- [x] **B9 Portability on desktop**: cross-backend bundle round-trip IndexedDB↔SQLite; export (workspace bundle, canvas export, markdown) works from a SQLite-backed desktop session including images.
  - AC: round-trip deep-equal both directions; images present in exported output and resolve after re-import.
- [x] **B10 Wrap-up**: update `desktop-app-plan.md` (storage section), this doc's status, add a short "Storage" note for developers (where the DB/assets live, how to reset, how to run the suites).
  - AC: full `npm test`, `typecheck`, `lint` green; B7 spec green; this plan's boxes reflect reality; open questions resolved or listed.

### Deferred (do not start)
- Phase C: workspace manifest Y.Doc, tombstones, restore/conflict semantics (D3).
- Phase D: `SyncProvider` over WebSocket + y-protocols, awareness, Hocuspocus server with configurable endpoint, workspace-key auth (D1, D2), asset PUT/GET by hash.
- Phase E: the cross-device end-to-end test.
- BYOK key storage in OS secure store.
- FTS5-backed search on desktop.

## 9. Commands (fill in as they are created)

- Unit/conformance: `npm test`
- Packaged build: `npm run desktop:pack` → `dist-desktop/win-unpacked/`
- Run packaged app headless-safe: `env -u ELECTRON_RUN_AS_NODE "dist-desktop/win-unpacked/Acute Notes.exe" --user-data-dir=<tmp>`
- Desktop storage e2e (real Electron IPC, no AI): `npm run desktop:pack` then `npm run test:desktop-storage` (packaged app; run with `env -u ELECTRON_RUN_AS_NODE` from VS Code shells). Unpackaged shell: `ACUTE_DESKTOP_MODE=dev npm run test:desktop-storage` after `npm run desktop:build`. Custom exe: `ACUTE_DESKTOP_EXE=<path>`.
- Storage unit/conformance only: `npx vitest run src/persistence src/portability`
- Main-process blocking benchmark: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/perf/desktopStorageBench.cjs`
- Where data lives (desktop): `<userData>/storage/acute-notes.sqlite3` (+ `-wal`, `-shm`) and `<userData>/storage/assets/<aa>/<sha1>`; userData is `%APPDATA%/Acute Notes` on Windows. To reset during development: quit the app and delete the `storage` folder.

## 10. Progress log and results

| Date | Item | Result |
|---|---|---|
| 2026-10-09 | Read-only spike: `node:sqlite` in Electron 44.7 / Node 24.21 | Works (SQLite 3.53.4, BLOB, FTS5, WAL; 400-row load 5.4 ms). better-sqlite3 13.0.3 has no win32-x64 prebuilds. |
| 2026-10-09 | Plan written | Reviewed and approved with the three decisions in §11. |
| 2026-10-09 | **B0 packaged-app spike** | **PASS** — see B0 results below. Spike code removed. |
| 2026-10-09 | Phase A (A1–A4) | Done. Conformance suite + cross-backend portability suite green on memory and IndexedDB. |
| 2026-10-09 | B1–B5 | Done. SQLite store, validated IPC, renderer proxy and backend selection; 22 conformance + 14 storage-specific tests; full unit suite 1976 passed. |
| 2026-10-09 | B6/B7 real Electron | **PASS** — 4/4 e2e on the packaged app (`desktop:pack`), 3/3 (+1 skipped, packaged-only) on `electron .`. Web path regression (8 local e2e specs against `next dev`) passes. |
| 2026-10-09 | B8 benchmark | Budget met; **no worker host** (numbers below). |
| 2026-10-09 | B9/B10 | Done at repository level; docs updated. |

## 11. Decisions on the open questions (approved 2026-10-09)

1. Engine: **`node:sqlite`**; `better-sqlite3` only if B0 fails (it did not).
2. SQLite hosted in the **Electron main process** first, behind a narrow validated IPC API (no raw SQL to the renderer). **No worker host unless B8 measurements demand it.**
3. Single-instance lock must run **before** database initialisation. `main.cjs` already calls `app.requestSingleInstanceLock()` at module top-level before `whenReady`; storage init goes inside the `else` branch after it, so no change to the lock itself is needed (B4 only adds a test).

### B0 results (packaged app, `npm run desktop:pack` → `dist-desktop/win-unpacked/Acute Notes.exe`)

Method: temporary env-gated hook in `main.cjs` + `electron/storage/spike.cjs` (both deleted). Exe launched twice with a fresh `--user-data-dir`; each run writes a JSON report.

- **Runtime (from inside the packaged exe):** Electron 44.7.0, Node 24.21.0, ABI 149, Chromium 152, SQLite 3.53.4, `packaged: true`. `node:sqlite` loaded with no native module, no asar error, no `electron-builder.yml` change.
- **Open / write / close / reopen:** same-process close + reopen read back identical BLOB bytes. Run 2 (a separate process) found run 1's row (`rowsFromPreviousRun: 1`, `openedExistingFileThisRun: true`). WAL active; `PRAGMA integrity_check` = ok on both runs.
- **Asset files:** 20 × 2 MB atomic writes (tmp + rename) read back byte-identical.

Workload timings in the main process (run 1; run 2 within noise). Every call is synchronous, so a call's duration *is* the time the main process is blocked:

| Workload | Result |
|---|---|
| Single Yjs append, 600 B, autocommit (WAL, synchronous=NORMAL), ×2000 | p50 0.55 ms · p99 1.2–2.5 ms · **max 7.1 ms** |
| Burst: 1000 appends (1.5 KB) in one transaction | 22–39 ms |
| Load one doc's log (1000 updates) | p50 3.3 ms · max 5.6 ms |
| Compaction: delete 1000 rows + insert one 200 KB blob, one tx | 9.5 ms |
| List 3000 documents (≈2 KB JSON each) incl. `JSON.parse` | 23 ms |
| `getMany` 200 documents | 3.5 ms |
| Seed 3000 documents in one transaction (incl. `JSON.stringify`) | 221 ms |
| Write one 2 MB asset (tmp + rename) | p50 4.5 ms · max 9.1 ms |

Main-process blocking analysis
- The event-loop-lag sampler read 1.9 s, but only because the spike ran all workloads back-to-back in one synchronous block; the timer could not fire in between. That figure is the spike's total runtime, **not** a per-call stall. The per-call numbers above are the real blocking figures.
- Largest single typical-operation stall: **≈7 ms** (single append). Largest bulk stall: **221 ms** (seeding 3000 docs in one transaction) — an import/bulk path, not an interaction path.
- Against the plan's budget (no single IPC call > 50 ms for typical operations): **met**. **Decision: no worker host now.** Constraint carried into B2/B4: bulk writes (workspace import, many-document `put`) must be **chunked (≤ ~200 records per transaction, yielding to the event loop between chunks)**. B8 re-measures end-to-end through real IPC with the real schema; add a worker host (B8b) only if that misses budget.
- Caveat: these numbers are for a synthetic schema on this machine (SSD, Windows); B8 repeats them with the real services.

### Progress notes (Phase A and B1–B5)

- **A1–A3:** `src/persistence/conformance/runPersistenceConformance.ts` — 23 contract tests (records, `getMany` order/missing, asset bytes, meta structured values, all device-local stores, Yjs log: append order, key never reused, stale-key compaction, byte-exact/empty/large updates, `DocumentProvider` persistence + compaction + a writer appending between load and compact). Run for memory and IndexedDB from `persistence.test.ts` (IndexedDB-only schema/upgrade tests stay there). No behavioural drift found between memory and IndexedDB.
- **A4:** the bundle format was already versioned (`BUNDLE_VERSION`, newer versions rejected with a clear message). Added `src/portability/conformance/runPortabilityConformance.ts` + `crossBackend.test.ts`: every ordered pair of backends round-trips a workspace (canvas scene, relations, blocks, pages, canvas image + page image bytes) with an identical re-export, device-local AI chats never travel, and import replaces stale documents.
- **B1–B4:** `electron/storage/{db,assets,services,ipc,index}.cjs` + `contract.json`. Engine: `node:sqlite`; schema v1 via `PRAGMA user_version`; newer schema refused (`DB_TOO_NEW`). The allowlist **and** argument kinds live in one `contract.json` read by both the main-process dispatcher and the renderer proxy; a test asserts contract, services and proxy have identical method sets. Dispatcher rejects unknown/prototype names, wrong types, oversize, extra args; errors come back as `{ok:false,error:{name,code,message}}` and are rethrown as `StorageIpcError`. Sender must be the app's own main frame at `acute://app/`. Single-instance lock already runs before storage init (init sits after it in `main.cjs`).
- **B5:** `src/persistence/repositories/ipc.ts` (proxy + `Blob`↔bytes codec) and `getPersistence()` selects IPC when `window.acuteDesktop.storage` exists, else IndexedDB (web path unchanged).
- **Findings that changed the code:**
  1. `node:sqlite` binds an **empty `Uint8Array` as NULL** → Yjs inserts use `COALESCE(?, zeroblob(0))` (caught by the conformance suite).
  2. Asset file names: a 40-hex content-hash id is used as-is (`aa/<id>`); any other id is stored under a SHA-256 of the id, so no id can escape the folder or collide on a case-insensitive file system.
  3. Bulk-write chunking (B0 note) turned out to be unnecessary at the interface: import and bulk callers already issue one repository call (= one IPC request, one transaction) per record. Revisit in B8 if import time regresses.
  4. `electron/**` and `dist-desktop/**` added to `eslint.config.mjs` ignores (plain CommonJS shell + build output were already failing lint). Two pre-existing lint errors remain in `scripts/after-pack.cjs` (not touched).
  5. Vendor-name guard (`noVendorLeak.test.ts`) skips only `*.test.ts`; conformance data uses neutral provider ids.
- **Test status:** full `npx vitest run` — 194 files, 1976 passed, 4 todo; `tsc --noEmit` clean.

### B6/B7 results (real Electron IPC)

`e2e/desktop/desktopStorage.spec.ts`, driven with Playwright `_electron`, against `dist-desktop/win-unpacked` (fresh `desktop:pack` including the SQLite code) and against `electron .`:
1. UI-created content (a rectangle, a canvas image, a page with text and a pasted image) appears in the SQLite file (rows read directly from the file by the test process), asset bytes exist under `storage/assets/`, and after a clean quit + relaunch the scene, page record and every asset are identical; `PRAGMA integrity_check` = ok; no duplicate workspace/canvas.
2. A rectangle drawn just before `taskkill /F /T` (no quit handlers) is present after relaunch; integrity ok.
3. A second packaged instance on the same data folder exits 0 by itself (single-instance lock) and leaves the database unchanged; the first instance keeps working.
4. The renderer exposes only `storage.invoke`; unknown methods (`workspaces.exec`) and wrong argument types return `BAD_REQUEST`; the store is unaffected.

### B8 results (main-process blocking, Electron 44.7 / Node 24.21, real services + dispatcher + structuredClone both ways)

| Operation | p50 | p99 | max |
|---|---|---|---|
| Yjs append, 600 B (×2000) | 0.08 ms | 0.24 ms | 12.9 ms (one outlier) |
| 1000 sequential appends, total | 139 ms | | |
| Load one doc, 1000 updates | 6.5 ms | 8.0 ms | 8.0 ms |
| Compact 1000 rows → 1 (200 KB) | 6.7 ms | | |
| Put one 2 KB document (×3000) | 0.12 ms | 0.58 ms | 10.7 ms |
| `getMany` 200 documents | 1.0 ms | 2.9 ms | 2.9 ms |
| List pages only (3000 docs, 1000 pages) | 24 ms | 27 ms | 27 ms |
| List **all** 3000 documents (≈6 MB) | 68 ms | 81 ms | 81 ms |
| Put 2 MB asset (×20) | 10.7 ms | 19.5 ms | 19.5 ms |
| Get 2 MB asset | 4.4 ms | 5.6 ms | 5.6 ms |
| Asset `has` (×500) | 0.1 ms | 0.4 ms | 0.5 ms |

- Every interaction-path operation (append, document put/get, `getMany`, asset get/put/has, load, compaction) blocks the main process ≤ 20 ms, well inside the 50 ms budget.
- The one budget miss is **listing every document of a 3000-document workspace in one call (68–81 ms)**, dominated by `JSON.parse` + the structured clone of ≈6 MB. It is used only by workspace maintenance and import-replace (`hierarchy.ts`, `workspaceBundle.ts`), never on workspace open (open uses `kind`-filtered lists and `getMany`). Cost scales linearly (~23 µs per 2 KB document: a 300-document workspace ≈ 7 ms). A worker host would not remove the clone cost, so **decision: no worker host.** If these paths ever matter, add an id/metadata-only listing instead.

### Not covered / follow-ups (honest gaps)

- MCP writes: they run in the renderer tab over `getPersistence()` ([tabBridge.ts](../../src/mcp/bridge/tabBridge.ts)), so they take the same SQLite path by construction, but there is no packaged-app test that drives a real MCP client yet.
- B9 was verified at repository level (all backend pairs, both directions, images byte-exact) rather than by clicking Export/Import in the packaged UI.
- The IndexedDB baseline comparison ("open ≤ baseline + 20 %") was not measured; the budget was restated as absolute main-process blocking (met).
- Existing IndexedDB data in the desktop profile is intentionally abandoned (no migration, per the decision to drop dev data); the old data stays in the Chromium profile until cleared.
- A "database is newer than this app" or corrupt-database startup currently shows the generic start-failure dialog (message included); a dedicated recovery dialog is future work.
- Not started, by instruction: cloud sync, auth, manifest Y.Doc.
