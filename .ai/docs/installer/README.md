# Desktop installer (Electron) — build & update guide

Acute Notes ships as an Electron app. The renderer loads `acute://app/`; the main
process proxies that to a bundled Next.js standalone server on a random loopback
port. The origin is constant, so IndexedDB/localStorage survive restarts, port
changes and upgrades. Design/decisions: [../desktop-app-plan.md](../desktop-app-plan.md).

Status (2026-10-09): **Windows installer built, hand-installed and working; AI + MCP enabled and verified. Mac dmg not yet done.**

## Build a new installer from the latest code

From the repo root (PowerShell or Git Bash):

```bash
npm install                 # only if dependencies changed
npm run desktop:dist        # = desktop:build + electron-builder
```

Output: `dist-desktop/Acute Notes Setup <version>.exe` (≈180 MB, unsigned).
Quick test without making an installer: `npm run desktop:pack`, then run
`dist-desktop/win-unpacked/Acute Notes.exe`.

If the shell is VS Code's terminal, Electron may be forced into Node mode. Run
with the variable unset:

```bash
env -u ELECTRON_RUN_AS_NODE npx electron .      # Git Bash
Remove-Item Env:ELECTRON_RUN_AS_NODE; npx electron .   # PowerShell
```

### What the scripts do

| Script | Does |
|---|---|
| `desktop:build` | `ACUTE_DESKTOP=1 NEXT_PUBLIC_AI_FEATURE=on next build --webpack`, then `scripts/prepare-desktop.mjs` copies `public/` and `.next/static` into `.next/standalone` |
| `desktop:pack` | build + `electron-builder --dir` (unpacked app in `dist-desktop/win-unpacked`) |
| `desktop:dist` | build + `electron-builder` (NSIS installer) |
| `desktop:run` | `electron .` against the current `.next/standalone` (dev check) |

### Releasing an update

1. Bump `"version"` in `package.json` (shown in the installer filename).
2. `npm run typecheck && npm test` (the desktop build skips none of Next's type
   check, but run the suites you normally do).
3. `npm run desktop:dist`.
4. Install over the old version (same install dir). User data lives in the Electron
   profile (`%APPDATA%\acute-notes`), not the install dir, so it is kept.

## Icons

Source: `src/asset/logo.png` (1536×1024, logo on black). `npm run desktop:icons`
(`scripts/make-icons.mjs`) crops the centred square and writes `build/icon.png` (1024, used for
macOS `.icns` and the dev window) and `build/icon.ico` (16–256). Re-run it after changing the logo,
then rebuild. Both outputs are committed under `build/`.

## Moving data in (existing browser notes)

The browser app (`localhost:3000`) and the desktop app have different origins, so data does not
carry over automatically. Use the app's own workspace transfer: in the browser, export the
workspace (`.acute.json`, the export button next to the workspace name), then in the desktop app
use Import. Saved AI conversations are never included in exports. There is no automatic backup;
export workspaces you care about before uninstalling or clearing app data.

## Files

| File | Purpose |
|---|---|
| `electron/main.cjs` | Single-instance lock, free-port pick, spawns `server.js` via `utilityProcess`, registers `acute://` (standard, secure, fetch, stream), proxies requests rewriting Host/Origin/Sec-Fetch-Site (MCP routes require loopback + same-origin), opens external links in the system browser |
| `electron/preload.cjs` | Exposes only `window.acuteDesktop.mcpOrigin` (sandbox + contextIsolation on) |
| `scripts/make-icons.mjs` | Generates `build/icon.png` / `build/icon.ico` from `src/asset/logo.png` |
| `electron-builder.yml` | Packaging config; `files` limited to `electron/**` (no `node_modules`) |
| `scripts/prepare-desktop.mjs` | Adds `public/` + `.next/static` to the standalone folder |
| `scripts/after-pack.cjs` | Copies `.next/standalone` → `resources/server` (electron-builder `extraResources` drops `node_modules` and `.next`) |
| `next.config.ts` | `output: "standalone"` when `ACUTE_DESKTOP` is set; webpack alias for `decode-named-character-reference` (mirror of the Turbopack alias) |

## Gotchas (learned the hard way)

- **Turbopack production build hangs** on this machine (workspace page compile never finishes,
  idle CPU). The desktop build therefore uses `--webpack`. Keep the webpack alias in
  `next.config.ts` in sync with `turbopack.resolveAlias`.
- **`ELECTRON_RUN_AS_NODE=1`** is set in VS Code terminals → `electron .` fails with
  `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`. Unset it.
- **extraResources drops `node_modules`/dot-folders**, hence the `afterPack` hook. If the
  packaged app dies at start with "Cannot find module 'next'" / missing `.next`, check
  `resources/server` contains `node_modules` and `.next`.
- **Concurrent edits**: another Claude session editing `src/` can cause transient build or
  type errors; re-run.
- **Silent install (`/S`) hung** when run from the agent shell; test via
  `dist-desktop/win-unpacked` or run the installer by hand.
- **AI is on** (`NEXT_PUBLIC_AI_FEATURE=on`; this single flag covers built-in AI *and* MCP). The
  Copilot runtime (`@github/copilot-sdk-<platform>`, ~115 MB) is not found by Next's file trace, so
  `next.config.ts` adds it via `outputFileTracingIncludes` for `/api/ai/*`. Only the platform
  package installed on the build machine exists, so the Mac build must run on a Mac (CI).
  Built-in AI uses the user's own GitHub/Copilot login; it was **not** exercised (no AI runs
  without approval) — only that the runtime package ships and the MCP path works.
- Browser data (`localhost:3000`) is a different origin and does **not** appear in the
  desktop app.

## Built-in AI check (done 2026-10-09, packaged app)

Settings → AI Providers → GitHub Copilot → Connect uses the Copilot CLI login on this machine
(`copilot login` if not signed in). Result: `/api/ai/models` 200 (model list), `/api/ai/stream` 200,
chat answered. Quirk: right after connecting, the chat box still said "Connect AI" until the page was
reloaded (app behaviour, not packaging).

Quitting: closing the window ends all `Acute Notes` processes and frees port 47821 (verified).

## MCP with Claude Code

The app's server listens on **127.0.0.1:47821** (override with `ACUTE_PORT`; falls back to a
random free port if taken). External clients cannot reach `acute://app`, so the preload exposes
the real origin to the page (`window.acuteDesktop.mcpOrigin`, see `src/types/acute-desktop.d.ts`)
and the MCP access dialog shows `http://127.0.0.1:47821/api/mcp`.

1. Open the app → ⋮ → **MCP access** → turn **On** (the tab must stay open; clients get 503
   "not connected" otherwise).
2. Copy the "Add to Claude Code" command from the dialog and run it:
   `claude mcp add --transport http acute-notes http://127.0.0.1:47821/api/mcp --header "Authorization: Bearer <token>"`
3. The URL is stable across launches while the port is free; the token is stable until you click "New token".

Verified: with MCP on, an `initialize` request with the bearer token returns the server info;
a wrong token returns 401; before enabling, 503.

### What the MCP tools can do (findings)

There is no "create workspace/canvas" tool and no raw "create shape" tool. Diagrams go through
`render_visual_plan` (templates: flow, architecture, decision_tree, …; Acute does the layout), plus
`create_block/table/todo/page`, `create_connection`, `group_blocks`, project tools. All writes are
proposals the user accepts in the app ("Accept all"); only one proposal can be pending at a time.
A vague prompt such as "create a workspace and a flowchart" made Claude use `create_project`
(a "Project state" frame) instead of a diagram. Direct probe of `render_visual_plan` (login flow,
6 nodes, 6 links) worked, but the `flow` template laid the nodes in one horizontal row (branches not
forked) with one shared-corridor warning. Prompts should name the tool/template: e.g.
"use render_visual_plan with the flow template".

## Verifying a build

Launch with `--remote-debugging-port=9333` and check via CDP/Playwright
(`chromium.connectOverCDP("http://127.0.0.1:9333")`):

- `location.origin === "acute://app"`
- `indexedDB.databases()` lists `acute-notes`
- a value in `localStorage` survives quit + relaunch
- `new Worker(blobUrl)` works
- Kill all `Acute Notes.exe` processes afterwards (the server child exits with the app).

## TODO

- [x] Real installer hand-tested (install, launch, MCP) — user, 2026-10-09.
- [x] App icon from `src/asset/logo.png` (Windows `.ico`; macOS uses `build/icon.png`).
- [ ] Mac dmg via GitHub Actions matrix (`windows-latest`, `macos-latest`); unsigned first
      (right-click → Open). `mac` target already in `electron-builder.yml`; `after-pack.cjs`
      already handles the `.app/Contents/Resources` path.
- [ ] Code signing: Windows cert (SmartScreen), Apple Developer ID + notarization.
- [ ] Auto-update (`electron-updater`) and an in-app "Export all" backup.
- [x] Built-in AI exercised in the packaged app (see below).
- [ ] Show the actual port in-app if 47821 is taken (dialog already shows the real one).
