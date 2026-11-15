# OpenUI commits 1 and 2: staging-ready patches (2026-11-15)

Prepared by the integrator session. Nothing was staged, committed, stashed, reset or checked out in the main working tree, and no main-tree file was edited. All building and checking happened in throwaway worktrees in the session scratchpad. No AI, contract or `e2e:ai` run. Source plan: `.ai/docs/openui-commit-plan-2026-11-14.md` (§6 and "Verification 2026-11-14 (round 2)").

| Patch | sha256 | Base |
|---|---|---|
| `commit1.patch` | `3b733abbce829ab16cc169c0b2a1e9ce7e35ad6f6dd4e4cbb35e198531df697e` | HEAD `66f7e3b` |
| `commit2.patch` | `6b78f7cc5d738f7d1bbf3a6f18d2e96712b72684682770620da64a6c425689eb` | HEAD + commit 1 |

Both are `git diff --binary --full-index` output with LF-normalized blobs (repo uses `core.autocrlf=true`). Resulting trees: commit 1 = `54fa470cefbef0760459387ce300bcaec976bc76`, commit 1+2 = `eed59a57ab7cb179b9f9aaea641d3360715b4890`.

## Already staged by other lanes (do not disturb)

`git diff --cached --stat` at the start: **177 files, 34300 insertions, 410 deletions**, from Knowledge Notes, Update Engine, cloud/hosting and the golden dataset. The only staged file these patches touch is `package.json`: its staged hunk is `engines: { "node": "22" }` (lines 3–8). `package-lock.json` and `vitest.config.ts` have nothing staged.

Applying the patches leaves that staged content in place, and commit 1's `package.json` hunk applies on top of it with an offset. Checked on a **copy** of `.git/index` (`GIT_INDEX_FILE=<copy>`), both patches gave `--check` OK and then applied. The copy then held the old staged list plus exactly the 18 new paths (`package.json` was already listed). Its `package.json` diff against HEAD was `engines` + `@openuidev/react-lang`, and the real `.git/index` stayed byte-identical.

**Important:** the next `git commit` takes **everything** in the index, including the 177 staged files from other lanes. Before you commit OpenUI on its own, either commit those lanes first, or use a temporary index (see "Staging commands"). Also, `engines.node` will go into whichever commit `package.json` is next committed in, unless it is committed first.

## Commit 1: card library and interactive cards

Files (13, +1716/−1):
- `src/ai/openui/library.tsx`, `library.test.tsx`, `hostContext.tsx`, `interactions.tsx`, `interactions.test.tsx`
- `src/components/openui/OpenUiCardRenderer.tsx`, `src/components/openui/interactions.css`
- `src/config/openui.ts` (inert flag, not read by any mounted code yet)
- `scripts/openui-benchmark.mjs` (scaffold, no model calls)
- `.ai/docs/open-intelligent-ui-audit.md`
- `vitest.config.ts`: the whole change, `include` gains `"src/**/*.test.tsx"` (integrator-owned)
- `package.json`: **only** `+"@openuidev/react-lang": "^1.1.0"` (no `@huggingface/transformers`, no `engines`)
- `package-lock.json`: **+99/−0**. It is HEAD's lock plus the root dependency line and 6 entries: `@openuidev/react-lang@1.1.0`, `@openuidev/lang-core@1.1.0`, `@openuidev/lang-core/node_modules/ci-info@4.5.0`, `@openuidev/devtools@0.3.1`, `@openuidev/observability@0.0.4`, `lucide-react@0.575.0`. Entry bodies are copied verbatim from the working-tree lock, in npm key order. No flag flips. HEAD's lock round-trips byte-for-byte through `JSON.stringify(_, null, 2)`, so only those lines change.

Message:
```
feat(openui): card library and interactive knowledge cards (Phases 1, 3)

Adds @openuidev/react-lang and acuteCardLibrary (IdeaCard, CitationChip,
SourceLink, Callout, ComparisonTable) plus the interactive cards
DecisionCard, Timeline, FlowDiagram, QuizCard, Flashcard and NoteLink,
the read-only OpenUiCardRenderer, the notes host context and the inert
OPENUI_CONFIG flag. Not mounted anywhere; no model calls. vitest now
also picks up src/**/*.test.tsx.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Commit 2: Study Mode foundation and dev demo page

Files (5, +496):
- `src/ai/openui/study.ts`, `study.test.ts`
- `src/app/dev/openui-demo/page.tsx`
- `e2e/local/openuiDemo.local.spec.ts`
- `.ai/docs/study-mode-design.md`

Message:
```
feat(openui): study cards from notes (flashcards, quizzes) and dev demo page

Adds deterministic flashcard and quiz OpenUI Lang generation from notes
(study.ts) and the /dev/openui-demo page that streams a card and shows
the gallery, interactive cards and study cards, with a local no-AI
Playwright spec.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Staging commands (run from the repo root)

Option A: stage into the shared index, after the other lanes' staged work has been committed:
```
git apply --cached --check .ai/commit-prep/2026-11-15/commit1.patch
git apply --cached .ai/commit-prep/2026-11-15/commit1.patch
git diff --cached --stat          # expect the 13 files above (+ engines if still staged)
git commit -F <msg1>
git apply --cached --check .ai/commit-prep/2026-11-15/commit2.patch
git apply --cached .ai/commit-prep/2026-11-15/commit2.patch
git commit -F <msg2>
```

Option B: commit OpenUI first and keep the other lanes' staged work. This uses a temporary index built from HEAD, so neither the staged `engines` nor the 177 staged files go in:
```
GIT_INDEX_FILE=.git/index-openui git read-tree HEAD
GIT_INDEX_FILE=.git/index-openui git apply --cached .ai/commit-prep/2026-11-15/commit1.patch
GIT_INDEX_FILE=.git/index-openui git commit -F <msg1>
GIT_INDEX_FILE=.git/index-openui git apply --cached .ai/commit-prep/2026-11-15/commit2.patch
GIT_INDEX_FILE=.git/index-openui git commit -F <msg2>
rm .git/index-openui
```
After option B, the real index still holds the other lanes' staged blobs, now measured against the new HEAD. Its `package.json` and `package-lock.json` entries are HEAD-old plus `engines`, so they would **revert** the OpenUI lines if committed as they are. Re-stage those two files (for example `git apply --cached` the engines hunk on top of the new HEAD) before the next lanes commit. The working-tree files are never touched by `git apply --cached`. After either option, `package.json`/`package-lock.json` still show as modified in the working tree (transformers, engines), which is expected.

## Verification (throwaway worktree `wt2` at HEAD, `node_modules` junction to the main repo)

Baseline HEAD: `npx tsc --noEmit -p .` → `HEAD tsc exit=0`.

After commit 1 (`git apply --check` → `apply --check: OK`; `git apply --index` → tree equals `54fa470…`):
- `npx tsc --noEmit -p .` → `tsc exit=0`
- `npx vitest run src/ai/openui src/components/openui src/domain/provenanceGuard.test.ts` → `Test Files  3 passed (3)` / `Tests  27 passed (27)`. Per file: `library.test.tsx` `Tests 5 passed (5)`, `interactions.test.tsx` `Tests 15 passed (15)`, `provenanceGuard.test.ts` `Tests 7 passed (7)`
- `npx eslint src/ai/openui src/components/openui src/config/openui.ts scripts/openui-benchmark.mjs vitest.config.ts` → `eslint exit=0`, no output
- `npm ls @openuidev/react-lang lucide-react --package-lock-only` → `@openuidev/react-lang@1.1.0` → `@openuidev/devtools@0.3.1` → `lucide-react@0.575.0`, `npm ls exit=0`. A closure walk over the 6 new entries resolves every dependency and every required peer (react, react-dom, zod, `@openuidev/*`). Only the optional peer `react-native` is unresolved, and none of them points at a `dev` entry.
- `npm ls --all --package-lock-only`: exit 1 with the same 4 `invalid` lines (`react-dom@19.3.0`, `react@19.3.0`, `@emnapi/core@1.10.0`, `@emnapi/wasi-threads@1.2.1`) on **HEAD's own lock** as on the commit-1 lock. These were there before and have nothing to do with OpenUI. `npm ci --dry-run` was not run: the worktree's `node_modules` is a junction to the main repo's, and npm ci would delete it.
- Full `npx vitest run` → `Test Files  3 failed | 227 passed | 1 skipped (231)` / `Tests  1 failed | 2334 passed | 4 todo (2339)`. The same 3 files fail at plain HEAD (separate worktree): `Test Files  3 failed | 225 passed | 1 skipped (229)` / `Tests  2 failed | 2313 passed | 4 todo (2319)`. Those files are `asciiTree/convert.test.ts`, `asciiTree/parse.test.ts` (`TypeError: Cannot read properties of null (reading '1')`) and `layoutDReuse.test.ts` (`Test timed out in 5000ms`, flaky). These failures were already at HEAD.

After commit 2 (`apply --check: OK`; tree equals `eed59a57…`):
- `npx tsc --noEmit -p .` → `tsc exit=0`
- `npx vitest run src/ai/openui src/components/openui src/domain/provenanceGuard.test.ts` → `Test Files  4 passed (4)` / `Tests  35 passed (35)`. `study.test.ts` → `Tests 8 passed (8)`. It has 8 tests now, where the 11-14 plan said 6.
- eslint on the above plus `src/app/dev/openui-demo/page.tsx e2e/local/openuiDemo.local.spec.ts` → `eslint exit=0`
- Full `npx vitest run` → `Test Files  3 failed | 228 passed | 1 skipped (232)` / `Tests  1 failed | 2342 passed | 4 todo (2347)`. The same 3 files fail as at HEAD.
- The local Playwright demo spec was not run, because no dev server was started from the worktree.

Limitation: `node_modules` comes from the main repo, which has every lane's packages. The lock closure check above covers the gap that leaves.

### Guard tests
- `src/domain/provenanceGuard.test.ts`: HEAD's version passes 7/7 after both commits. Leave it out of commits 1 and 2: its OpenUI allowlist entries (`notesModel.ts`, `promotion.ts`) and the Knowledge Notes regex change belong to commit 3 and later. Its staged Knowledge Notes hunk is untouched by these patches.
- `src/ai/changes/commitGuard.test.ts` (untracked, Update Engine): not at HEAD, and it lists `components/openui/notes/promote.ts` as an expected caller. That file is in commit 3, so including or excluding the guard makes no difference to commits 1 and 2. It must land with or after commit 3.

## Not in these commits
- `src/ai/tasks.ts`: not imported by any commit 1 or 2 file. Its `generate_openui_notes` lines belong to commit 3, so it is left out entirely.
- `src/components/canvas/ExcalidrawCanvas.tsx` (mount), `.env.development` (Notes on; not to be committed, per the user), `@huggingface/transformers`/onnx and `engines`, `evaluation/knowledge-notes/experiments/**`, `.ai/docs/claim-condition-*`, `src/ai/contractTests/openuiMeaningDiag.contract.test.ts`.

## What remains for commit 3 (Notes reading view, Phase 2)
Files: `src/ai/openui/{notesTask,notesCheck,positional}.ts` with their tests and `__fixtures__/` (both fixtures), all of `src/components/openui/notes/**` (including `NotesView.test.tsx`, `promoteFlow.test.ts`, `generationStore.test.tsx`), `e2e/ai/openuiNotes.spec.ts`, `.ai/docs/openui-integration-plan.md`, `.ai/docs/openui-live-2026-11-13.md`.

Partial hunks: the 2 `tasks.ts` lines, the `ExcalidrawCanvas.tsx` imports and mount, the 2 `provenanceGuard` allowlist entries, and the `commitGuard` `promote.ts` entry.

It **does not build** until the Knowledge Notes lane (fidelity contracts, review UI, the provenance regex, `ChangeSet.passage`/`knowledge`, `AIMetadata.noteModel`) and the Update Engine lane (`commitOnCanvas` → `ai/changes/commit.ts`, consistency) are committed. See plan R4 (39 tsc errors without them).

Owners: the OpenUI lane owns the files. The integrator owns ordering, `tasks.ts`, `ExcalidrawCanvas.tsx` and the guard-file splits, together with the Knowledge Notes and Update Engine lanes. The plan doc links to the claim-condition docs, so those links stay dangling unless that is resolved.
