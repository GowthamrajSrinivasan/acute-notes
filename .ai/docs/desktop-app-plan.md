# Desktop app plan (Electron, Windows + macOS)

> **Status 2026-10-09:** Phases 0–3 done for Windows (Electron shell, custom protocol, packaging, installer).
> AI + MCP enabled (fixed port 47821). Mac dmg / CI, signing and auto-update remain. Current commands and
> gotchas: [installer/README.md](installer/README.md). Deviations from this plan: build uses `--webpack`
> (Turbopack prod build hangs), server copied by an `afterPack` hook, AI is on in the desktop build.

Goal: install Acute Notes as a desktop app on Windows and Mac, with the same
features as the web app (including AI/MCP route handlers) and a **stable
IndexedDB origin** so notes survive restarts, upgrades and port changes.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| E1 | Electron (not Tauri / static export) | `src/app/api/*` route handlers and the Copilot SDK (native `koffi` + bundled CLI) need a real Node runtime. |
| E2 | `output: "standalone"` Next server run as a child process on `127.0.0.1:<random free port>` | Smallest runtime payload; no change to app code. |
| E3 | **Custom protocol `acute://app`** registered as standard + secure + supportFetchAPI + stream, handled by `protocol.handle` which proxies to the local Next server | The renderer origin is `acute://app` forever, independent of port, so IndexedDB / localStorage / Cache never move. |
| E4 | Per-OS CI matrix builds (`windows-latest`, `macos-latest`) | Native binaries (koffi, Copilot CLI) are per-platform; Mac can't be cross-built from Windows. |
| E5 | Unsigned installers first; signing is a later phase | Lets you install and use it now. Expect SmartScreen / Gatekeeper warnings. |
| E6 | No hosted Copilot; AI uses the user's own GitHub login on their machine | Matches [hosted-deployment decisions](#) (deployment deferred, no hosted Copilot). |

## Architecture

```
Electron main process
 ├─ registerSchemesAsPrivileged(acute: standard, secure, fetch, stream, corsEnabled)
 ├─ spawn Next standalone server (utilityProcess.fork) -> 127.0.0.1:PORT
 ├─ protocol.handle("acute", req => fetch(`http://127.0.0.1:PORT${path}`, req))
 └─ BrowserWindow.loadURL("acute://app/")
Renderer (origin acute://app)  -> workers, fetch("/api/...") all same-origin
                                -> storage: window.acuteDesktop.storage.invoke -> ipcMain("acute:storage") -> node:sqlite
```

### Storage (SQLite, since the storage migration)

The desktop app no longer keeps notes in the renderer's IndexedDB. The main process owns one SQLite database
(`node:sqlite`, built into Electron — no native module) plus content-addressed image files under
`<userData>/storage/` (`acute-notes.sqlite3`, `assets/`). The renderer reaches it only through the validated IPC in
`electron/storage/` (allowlist and argument kinds in `contract.json`; no raw SQL). The web build keeps IndexedDB; both
sit behind the same `PersistenceServices` interfaces and pass the same conformance suite. Design, results and
decisions: [sqlite-desktop-storage-plan.md](sqlite-desktop-storage-plan.md). The storage module opens only after the
single-instance lock, so a second instance never touches the database.

Notes on the proxy handler:
- Pass `request.body` through with `duplex: "half"` and forward method/headers so
  `POST /api/ai/stream` (SSE/streaming) is not buffered.
- Rewrite `Origin`/`Host` to the loopback origin so Next's CSRF/origin checks
  (Server Actions, route handlers that compare Origin) pass.
- Restrict the proxy to the one loopback port; reject anything else.
- Navigation guard: `setWindowOpenHandler` / `will-navigate` open external
  `http(s)` links in the system browser (`shell.openExternal`).

## Phases

### Phase 0 — Spike (verify the risky bits first, ~½ day)
1. Add `output: "standalone"` and confirm `next build` produces `.next/standalone/server.js`
   and that `/api/ai/*` still loads `@github/copilot-sdk` + `koffi`
   (`serverExternalPackages` should be traced into standalone `node_modules`; check).
2. Minimal Electron main that loads `acute://app/` via proxy. Verify:
   - Page + `_next/static` assets load.
   - IndexedDB persists across restart **and** across a different Next port.
   - Web Workers (Markdown parser worker, F28) start from the custom scheme.
   - `/api/ai/stream` streams incrementally.
   - Excalidraw fonts (`public/fonts`) load.
3. Exit criteria: all five pass. If workers or streaming fail, fall back to
   fixed loopback port (E3 alternative) and record in this doc.

### Phase 1 — Electron shell
Files (new):
- `electron/main.cjs` — single-instance lock, port selection, spawn server, wait-for-ready
  (poll `GET /`), protocol registration, window state, menu, quit cleanup.
- `electron/preload.cjs` — empty/minimal (contextIsolation on, nodeIntegration off, sandbox on).
- `electron/server.cjs` (optional) — wrapper that sets `PORT`, `HOSTNAME=127.0.0.1`,
  `NODE_ENV=production`, then requires standalone `server.js`.

`package.json` changes:
- `"main": "electron/main.cjs"` (project is `"type": "module"`, so Electron files use `.cjs`).
- devDeps: `electron`, `electron-builder`.
- scripts: `desktop:dev` (next dev + electron pointing at it), `desktop:build`,
  `desktop:pack` (unpacked dir for quick testing), `desktop:dist` (installers).

`next.config.ts`: `output: "standalone"` (gate behind `ACUTE_DESKTOP=1` if the web
build should stay unchanged; `ACUTE_DIST_DIR` logic unaffected).

### Phase 2 — Packaging
`electron-builder.yml`:
- `files`: `electron/**`, `.next/standalone/**`, `.next/static/**` (copied to
  `standalone/.next/static`), `public/**` (copied to `standalone/public`).
  Use a `scripts/prepare-desktop.mjs` step to assemble this layout.
- `asarUnpack`: the standalone folder, `node_modules/koffi/**`, Copilot SDK runtime
  binaries (must be spawnable from disk).
- Targets: Windows `nsis` (x64; arm64 optional), macOS `dmg` + `zip` (arm64 + x64, or universal).
- `appId`, `productName: "Acute Notes"`, icons (`build/icon.ico`, `build/icon.icns`).
- Build env: `NEXT_PUBLIC_*` flags are baked at build time (see `.env.production`:
  `NEXT_PUBLIC_AI_FEATURE=off`). Decide whether the desktop build enables AI.

### Phase 3 — CI + first install
- GitHub Actions workflow: matrix `[windows-latest, macos-latest]` → `npm ci` →
  `npm run desktop:dist` → upload installers as artifacts.
- Local install path today: `npm run desktop:dist` on Windows gives a `.exe` installer;
  the Mac `.dmg` comes from the CI macOS runner (or a Mac).

### Phase 4 — Hardening (after you're using it)
- Data safety: in-app export/backup entry point (IndexedDB is per-install; losing
  the profile = losing notes). Consider an "Export all" menu item.
- Auto-update via `electron-updater` (needs a release host + signing).
- Code signing: Windows cert (SmartScreen), Apple Developer ID + notarization (Gatekeeper).
- Crash/log file in `app.getPath("logs")`; surface server-start failures in a dialog.
- Content-Security-Policy for the `acute:` scheme.

## Risks / open questions
1. **Workers + custom scheme**: should work for standard+secure schemes; verified in Phase 0.
2. **Copilot SDK in packaged app**: native runtime path resolution under asar/unpacked
   layout is the most likely breakage. Test auth + a real AI run only when you explicitly
   approve it (project rule: no AI runs without approval).
3. **Next origin checks** behind the proxy (Host/Origin rewrite) — verified in Phase 0.
4. **Installer size** ≈ 200–300 MB (Chromium + Copilot runtime + Excalidraw assets).
5. **Existing browser data**: IndexedDB from `localhost:3000` does not carry over to
   `acute://app`. Needs export from the web app and import in the desktop app if you
   want your current notes there.
6. **AI feature flag** for desktop build (`NEXT_PUBLIC_AI_FEATURE`) — decide on/off.

## Definition of done (v1 usable install)
- Windows installer installs, launches, creates/edits notes and canvases, quits cleanly
  (no orphaned Node process).
- Notes persist after quit/relaunch and after forcing a different internal port.
- Mac `.dmg` from CI launches the same way (unsigned; right-click → Open).
- Existing unit tests (`npm test`) and typecheck still pass; web `next build` unchanged.
