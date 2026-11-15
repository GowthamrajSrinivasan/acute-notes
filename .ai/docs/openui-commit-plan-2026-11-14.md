# OpenUI Phases 1–3: commit preparation report (2026-11-14)

Read-only preparation. Nothing was staged, committed, stashed, reset or checked out. No source file was edited. No AI, contract or `e2e:ai` run.

## 0. Bottom line

- The OpenUI code is clean: 55/55 unit tests pass, `tsc` reports 0 errors across the whole repo, eslint reports 0 problems on the OpenUI files, and the local Playwright demo spec passes (1/1).
- **It cannot be committed first.** OpenUI imports 10+ uncommitted files owned by the Knowledge Notes and Update Engine lanes (see §4). It has to land **after** those lanes, or as one coordinated batch with them.
- Five shared files contain OpenUI hunks mixed with other lanes' hunks: `src/ai/tasks.ts`, `ExcalidrawCanvas.tsx`, `package.json`, `package-lock.json` and `src/domain/provenanceGuard.test.ts`. Two guard tests (`provenanceGuard.test.ts`, untracked `commitGuard.test.ts`) **assert that the OpenUI files exist**, so their allowlist entries tie the commit order (§5).
- One OpenUI unit test (`notesCheck.test.ts`) reads a fixture from `evaluation/knowledge-notes/experiments/openui-2026-11-13/`. If `experiments/**` is kept out, that test fails on a clean checkout (§2).
- The requested a → b → c order does not compile at each step: `library.tsx` imports `interactions.tsx`, and `NotesView.tsx` / the demo page import `study.ts`. A compile-clean order is b → c → a (§6).

## 1. Inventory

### 1a. OpenUI-owned, untracked (whole files)

| Path | Phase | Notes |
|---|---|---|
| `src/config/openui.ts` | 1/2 | `OPENUI_CONFIG`, `isOpenUiNotesEnabled` |
| `src/ai/openui/library.tsx`, `library.test.tsx` | 1 (+3) | imports `./interactions` |
| `src/ai/openui/hostContext.tsx` | 3 (used by 2) | no deps |
| `src/ai/openui/interactions.tsx`, `interactions.test.tsx` | 3 | |
| `src/ai/openui/study.ts`, `study.test.ts` | 3 (Study foundation) | `study.ts` has no imports; the test imports `library` |
| `src/ai/openui/notesTask.ts`, `notesTask.test.ts` | 2 | task `generate_openui_notes` |
| `src/ai/openui/notesCheck.ts`, `notesCheck.test.ts` | 2 (steps 1–2) | test reads an experiments fixture (§2) |
| `src/ai/openui/positional.ts`, `positional.test.ts`, `__fixtures__/gemini-2.5-flash-keyword-args.txt` | 2 | |
| `src/components/openui/OpenUiCardRenderer.tsx` | 1 | |
| `src/components/openui/interactions.css` | 3 | |
| `src/components/openui/notes/{NotesView.tsx, generationStore.ts, notesViewStore.ts, notesModel.ts, notesModel.test.ts, promotion.ts, promote.ts, promote.test.ts, notes.css}` | 2 | `NotesView` also hosts Study mode (imports `study.ts`) |
| `src/app/dev/openui-demo/page.tsx` (the whole `src/app/dev/` dir is untracked and holds only this) | 1 + 3 | imports `study.ts`, `hostContext`, `interactions.css` |
| `e2e/local/openuiDemo.local.spec.ts` | 1 | no AI |
| `e2e/ai/openuiNotes.spec.ts` | 2 live | AI spec, refuses without `OPENUI_NOTES_APPROVED_BY` |
| `scripts/openui-benchmark.mjs` | 1 | scaffold only, no model calls |
| `.ai/docs/openui-integration-plan.md`, `openui-live-2026-11-13.md`, `open-intelligent-ui-audit.md`, `study-mode-design.md` | docs | plan §3 links to `claim-condition-*.md`, so those links break if the claim-condition docs stay out |

Not OpenUI, despite the name, and kept out: `src/ai/contractTests/openuiMeaningDiag.contract.test.ts`. It is a paid meaning-check diagnostic. It reads and **writes** `experiments/openui-2026-11-13/`, and it depends on `ai/fidelity/semanticCheck.ts` (Knowledge Notes) and `contractTests/liveProvider`. It belongs with the experiments / Knowledge Notes work, or in its own commit.

### 1b. Shared files with OpenUI hunks

| File | OpenUI hunk | Other lanes in same file? | How to stage |
|---|---|---|---|
| `.env.development` | +2 lines: comment + `NEXT_PUBLIC_OPENUI_NOTES=on` | **No.** It is the only hunk in the file. | Whole file |
| `src/ai/tasks.ts` | +2 lines: comment + `\| "generate_openui_notes"` | **Yes, in the same hunk:** `check_card_meaning`, `resend_cards` (Knowledge Notes), `route_content`, `judge_consistency` (Update Engine). The OpenUI line sits directly next to `route_content`, so `git add -p` → `s` can't separate it. | `git add -p` → `e` (hand-edit the hunk), or let the other lanes commit their lines first and then stage the rest |
| `src/components/canvas/ExcalidrawCanvas.tsx` | 2 imports (`NotesViewHost`, `isOpenUiNotesEnabled`), plus a mount comment and line `{api && isOpenUiNotesEnabled() && <NotesViewHost api={api} home={home} history={history} />}` | **Yes.** Same hunk as `PlaceContentDialog`, `SourceTab`, `KnowledgeOverlay`, `KnowledgeReviewBar` imports, plus separate hunks for LockMarkers, IndexStatusBadge, ConsistencyPanel, liveIndex, commit journal and `__acuteDev` hooks (Knowledge Notes and Update Engine). The OpenUI import pair is separated from the others by context lines, so `s` should split it. The mount hunk (@@ ~911) is OpenUI only. | `git add -p` (`s`); integrator sign-off |
| `package.json` | +1 dep `"@openuidev/react-lang": "^1.1.0"` | **Yes:** `"@huggingface/transformers": "4.3.2"` (Update Engine Stage 5) is in the same hunk. `engines.node 22` is already **staged** (index), from another lane. | `git add -p` → `e` |
| `package-lock.json` | OpenUI-only entries: `@openuidev/react-lang 1.1.0`, `@openuidev/lang-core 1.1.0` (+ nested `ci-info 4.5.0`), `@openuidev/devtools 0.3.1`, `@openuidev/observability 0.0.4`, `lucide-react 0.575.0` (dep of devtools), and the root `dependencies` line | **Yes.** The rest of the +344/−12 diff is `@huggingface/*`, `onnxruntime-*`, `protobufjs`/`@protobufjs/*`, `flatbuffers`, `long`, `guid-typescript`, `platform`, `adm-zip`, plus `dev`/`optional` flag flips on `sharp`, `@img/colour`, `detect-libc`, `semver`, `globalthis`, `@types/node`, `undici-types`, … (all transformers), and the root `engines` block. | Splitting a lockfile by hand is error-prone. Recommended: the integrator commits it once with both deps, or regenerates it per commit (`npm install --package-lock-only`, not run here). |
| `vitest.config.ts` | `include` gains `"src/**/*.test.tsx"` (the only change in the file) | No. The only `*.test.tsx` files in `src/` are the 2 OpenUI tests. Not listed in the lanes ownership table, though. | Whole file; integrator file, so needs sign-off. Without it, `npm test` silently skips `library.test.tsx` / `interactions.test.tsx`. |
| `src/domain/provenanceGuard.test.ts` (Knowledge Notes / integrator) | 2 allowlist entries: `components/openui/notes/notesModel.ts`, `components/openui/notes/promotion.ts` | **Yes.** Same hunk as about 15 Knowledge Notes entries and the regex change. | See §5 |
| `src/ai/changes/commitGuard.test.ts` (untracked, Update Engine) | `rel("components/openui/notes/promote.ts")` in the expected-callers list | Yes, the whole file belongs to the other lane | See §5 |
| `src/ai/changes/commit.ts` (untracked, Update Engine) | Doc comment mentions "OpenUI promotion" only | n/a | none |

### 1c. Confirmation: no OpenUI edits to AIMetadata, domain types, provenance or `ai/changes/**`

- `git diff HEAD` over `src/ai/changes`, `src/domain`, `src/ai/fidelity`, `src/config/fidelity.ts`, `src/ai/visualize`, `src/components/ai`: no added line mentions OpenUI, except `provenanceGuard.test.ts` (allowlist strings only).
- `src/domain/types.ts`, `src/domain/provenance.ts` and `src/ai/changes/*.ts` diffs belong to the Knowledge Notes and Update Engine lanes.
- **But OpenUI depends on their uncommitted content.** `promotion.ts` writes `metadata.noteModel: "distil"` and the change-set fields `passage` and `knowledge.cards[...].sourceUnits/review`. None of these exist at HEAD: `noteModel` has 0 occurrences in HEAD `changeSet.ts`, `domain/types.ts` and `provenance.ts`; `passage` has 0 in HEAD `changeSet.ts`. OpenUI adds no field, but it needs the Knowledge Notes fields committed first.

## 2. Experiments / claim-condition separation

Must not be in any OpenUI commit:
- `evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/**`
- `evaluation/knowledge-notes/experiments/openui-2026-11-13/**` (the OpenUI live-reply fixtures, `openuiFidelity.test.ts`, `report.json`, `meaning-check-2026-11-13.json`)
- `.ai/docs/claim-condition-{prototype,phase2,phase3,phase4}-*.md`
- `src/ai/contractTests/openuiMeaningDiag.contract.test.ts` (reads and writes experiments)

Direction of imports:
- **No OpenUI source file (`src/ai/openui`, `src/components/openui`, `src/config/openui.ts`, demo page) imports from `experiments/`.** The dependency runs the other way: `claimConditions.test.ts`, `phase3/openuiPackets.test.ts`, `phase3/score.test.ts` and `openuiFidelity.test.ts` import `@/ai/openui/notesTask` and `notesCheck`.
- **Flag:** `src/ai/openui/notesCheck.test.ts:14` reads `../../../evaluation/knowledge-notes/experiments/openui-2026-11-13/kn-02-edge-cache-invalidation.openui.txt` at runtime. Its header comment also cites the experiment. If that fixture is not committed, `notesCheck.test.ts` fails on a fresh clone. Options:
  1. Move or copy the file into `src/ai/openui/__fixtures__/` and repoint the test. This is a code edit and needs approval.
  2. Commit only that one `.txt` fixture, in its own evaluation-data commit.
  3. Accept the gap.

  Option 1 is recommended, since `positional.test.ts` already uses `__fixtures__`.

## 3. Free checks (run 2026-11-14)

| Check | Command | Result |
|---|---|---|
| OpenUI unit tests | `npx vitest run src/ai/openui src/components/openui` | `Test Files  8 passed (8)` / `Tests  55 passed (55)` |
| Guard tests touching OpenUI | `npx vitest run src/domain/provenanceGuard.test.ts src/ai/changes/commitGuard.test.ts` | `Test Files  2 passed (2)` / `Tests  9 passed (9)` |
| Typecheck (whole repo, working tree) | `npx tsc --noEmit -p .` | exit 0, **0 errors** (none in OpenUI, none elsewhere) |
| Lint | `npx eslint src/ai/openui src/components/openui src/config/openui.ts src/app/dev/openui-demo/page.tsx e2e/local/openuiDemo.local.spec.ts e2e/ai/openuiNotes.spec.ts scripts/openui-benchmark.mjs src/ai/contractTests/openuiMeaningDiag.contract.test.ts src/ai/tasks.ts src/components/canvas/ExcalidrawCanvas.tsx` | exit 0, no output |
| Local browser spec (no AI) | `OPENUI_DEMO_OUTPUT_DIR=<scratch>/openui-demo-shots npx playwright test --project=local e2e/local/openuiDemo.local.spec.ts --trace off --output <scratch>/pw-out` | `ok 1 [local] › e2e\local\openuiDemo.local.spec.ts:16:1 › OpenUI demo page streams a card in and renders all 5 components (6.2s)` / `1 passed (9.5s)` |

Caveats:
- The `tsc` and test results describe the **full working tree**, with every lane's uncommitted code present. They do not prove that an OpenUI-only commit on top of HEAD compiles; §4 shows it would not.
- The Playwright run reused a dev server already running on :3000 (`reuseExistingServer: true`), started by another session. The page is static fixture text, so no model was called.
- `npm test` (`vitest.config.ts`) only picks up the `.tsx` tests because of the uncommitted `include` change.
- The lanes file's "62 tests pass" for steps 1–2 doesn't match today's 55 in these two folders. That count probably included other files; treat it as unverified.

### Feature → test coverage

| Feature | Covered by | Gap |
|---|---|---|
| Notes view (sections, reading order, filter, progressive disclosure) | `notesModel.test.ts` (readingOrder, splitBody, buildNotes, noteLang) | `NotesView.tsx` component, `notesViewStore.ts`, toolbar toggle, Escape/Canvas switching and the `ExcalidrawCanvas` mount have **no offline test**. Only the AI spec `e2e/ai/openuiNotes.spec.ts` (not run) and a manual browser check cover them. |
| Streaming generation (offline/stubbed) | `notesTask.test.ts` ("reports the blocks while streaming…", mock provider); `library.test.tsx` (streaming parser converges); `openuiDemo.local.spec.ts` (simulated stream in the browser); `positional.test.ts` (mid-stream keyword args) | `generationStore.ts` (survives a remount) has no unit test |
| Citations | `library.test.tsx` (chips rendered); `notesModel.test.ts` (distil link's citations); `notesTask.test.ts` (unknown cites dropped); `notesCheck.test.ts`; demo spec (2 chips) | Expandable inline passage and "Open in source" in `NotesView`: untested offline (`interactions.test.tsx` covers passage expansion for DecisionCard/Timeline only) |
| Links (cross-note) | `notesModel.test.ts` "cross-note links"; `interactions.test.tsx` NoteLink (host navigation, fallback) | Navigation inside the real Notes view: untested offline |
| Pinning / promotion | `promote.test.ts` (5 tests: one `create_block`, passage link, plain card, detail paragraph, review carried) | The UI Pin button and undo: only `e2e/ai/openuiNotes.spec.ts` (AI, not run) |
| Interactive cards | `interactions.test.tsx` (DecisionCard, Timeline, FlowDiagram, QuizCard incl. `$variable` binding, Flashcard, NoteLink); demo page renders them (the local spec only asserts the Phase 1 gallery) | Plan's own gap: two cards sharing a `$variable` across separate Renderers |
| Study mode foundation | `study.test.ts` (flashcardLang, quizLang: deterministic, distractors, title-only skip) | `StudyCards` UI in `NotesView`: untested offline |

Needed but not done for the uncovered UI paths: a local (no-AI) Playwright spec that opens a canvas with seeded cards, toggles Notes, reads, follows a link, switches to Study, and pins a mock-generated card. It would need the dev server plus `NEXT_PUBLIC_OPENUI_NOTES=on` and a mock-provider path.

## 4. Uncommitted non-OpenUI dependencies (imports checked against `git ls-files` / `git status`)

Direct imports from OpenUI files to files that are not committed at HEAD:

| Dependency | Status | Imported by | Lane |
|---|---|---|---|
| `src/ai/fidelity/contracts.ts` | AM (staged add + edits) | notesCheck, notesTask, generationStore, notesModel, promotion | Knowledge Notes / integrator |
| `src/ai/fidelity/knowledgeCheck.ts` | ?? | notesCheck | Knowledge Notes |
| `src/ai/fidelity/exactness.ts` | A | notesTask | Knowledge Notes |
| `src/ai/fidelity/accounting.ts` | AM | notesTask | Knowledge Notes |
| `src/ai/fidelity/sourceUnits.ts` | A | notesCheck.test | Knowledge Notes |
| `src/components/review/knowledgeStore.ts`, `knowledgeActions.ts`, `useKnowledgeObjects.ts`, `wording.ts` | ?? | NotesView, promote, notesModel | Knowledge Notes (review UI) |
| `src/components/ai/commitOnCanvas.ts` | ?? | promote | Knowledge Notes / Update Engine |
| `src/ai/changes/changeSet.ts` | MM | promotion, promote (needs `passage`, `knowledge`, `noteModel`) | Integrator (KN + UE) |
| `src/domain/types.ts` | MM | NotesView, notesModel, promote (symbols exist at HEAD) | Integrator |
| `src/ai/tasks.ts` | M | notesTask (needs the OpenUI hunk itself) | Integrator |
| `src/ai/changes/accept.ts`, `ai/renderer/render.ts`, `ai/visual-plan/validate.ts`, `ai/content/sources.ts` | M | NotesView, promote, promotion | Other lanes. The imported symbols exist at HEAD, so these are probably not hard dependencies; tsc against HEAD was not possible without a checkout. |

Transitive dependencies:
- `commitOnCanvas.ts` → `src/ai/changes/commit.ts` (??), `ai/consistency/check.ts` (??), `search/liveIndex.ts` (M), `ai/changes/parts.ts` (M), `components/canvas/changeSetWriter.ts` (M)
- `knowledgeActions.ts` → `ai/content/sourceReview.ts` (??), `components/canvas/reconcileActions.ts` (M)

**So OpenUI Phase 2 needs the Knowledge Notes lane (WP1 review UI and fidelity contracts) and the Update Engine commit/consistency path (Stage 1–4 commit journal) committed first.**

Phase 3 alone (`interactions.tsx`, `hostContext.tsx`, `study.ts`, `library.tsx`, `OpenUiCardRenderer.tsx`) depends only on `@openuidev/react-lang`, `react`, `zod/v4` and nothing uncommitted. It can land before those lanes, given the `package.json` / lock hunk and `vitest.config.ts`.

## 5. Guard-test coupling (ordering trap)

- `src/domain/provenanceGuard.test.ts:166` asserts that **every allowlisted path exists** (`expect(file, path).toBeDefined()`). If the Knowledge Notes commit includes its entries for `components/openui/notes/notesModel.ts` and `promotion.ts` before those files are committed, the guard fails at that commit.
- `src/ai/changes/commitGuard.test.ts:43` asserts the **exact** list of `commitChangeSet`/`commitParts` callers, including `components/openui/notes/promote.ts`. Same problem for the Update Engine commit.
- Fix options:
  - (i) The other lanes partial-stage their guard files **without** the OpenUI entries, and the OpenUI commit adds them. This needs those lanes' or the integrator's sign-off, because they own the files.
  - (ii) Land Knowledge Notes, Update Engine and OpenUI Phase 2 back to back and accept one or two red intermediate commits.
  - (iii) Commit them together.

## 6. Proposed commit breakdown

The requested order (a) reading/generation → (b) interactive cards → (c) Study does **not** compile at each step:
- `library.tsx` (needed by (a)) imports `./interactions` (b).
- `NotesView.tsx` (a) imports `study.ts` (c) and `../interactions.css` (b).
- The demo page imports `study.ts`.

To keep the requested a/b/c split as-is, code edits would be needed: drop the Study mode from `NotesView`, or make the library registration optional. Neither was done here.

**Recommended compile-clean order: b → c → a**, all after the prerequisite lanes for (a).

### Commit 1, interactive cards (OpenUI Phases 1 + 3 library). Can land now.
Files:
- `src/ai/openui/library.tsx`, `library.test.tsx`
- `src/ai/openui/hostContext.tsx`
- `src/ai/openui/interactions.tsx`, `interactions.test.tsx`
- `src/components/openui/OpenUiCardRenderer.tsx`, `src/components/openui/interactions.css`
- `src/config/openui.ts` (inert flag)
- `scripts/openui-benchmark.mjs`
- `.ai/docs/open-intelligent-ui-audit.md`

Partial hunks:
- `package.json`: only `+"@openuidev/react-lang": "^1.1.0"`
- `package-lock.json`: only the `@openuidev/*` + `lucide-react` entries and the root dep line (or regenerate)
- `vitest.config.ts`: whole file (needs sign-off)

Check: `library.test.tsx` and `interactions.test.tsx` do not import `study`.

Message: `feat(openui): card library and interactive knowledge cards (Phases 1, 3)`
Body: Adds `@openuidev/react-lang`, `acuteCardLibrary` (IdeaCard, CitationChip, SourceLink, Callout, ComparisonTable), DecisionCard/Timeline/FlowDiagram/QuizCard/Flashcard/NoteLink, the read-only renderer and the inert `OPENUI_CONFIG` flag. Not mounted anywhere. No model calls. Includes vitest `.tsx` include.

### Commit 2, Study Mode foundation. Can land now, after commit 1.
Files:
- `src/ai/openui/study.ts`, `study.test.ts`
- `src/app/dev/openui-demo/page.tsx` (it uses study, so it goes here, not in Phase 1)
- `e2e/local/openuiDemo.local.spec.ts`
- `.ai/docs/study-mode-design.md`

Message: `feat(openui): study cards from notes (flashcards, quizzes) and dev demo page`

### Commit 3, reading view and generation (Phase 2 + steps 1–2). Only after Knowledge Notes + Update Engine.
Files:
- `src/ai/openui/notesTask.ts`, `notesTask.test.ts`
- `src/ai/openui/notesCheck.ts`, `notesCheck.test.ts`
- `src/ai/openui/positional.ts`, `positional.test.ts`, `__fixtures__/gemini-2.5-flash-keyword-args.txt`
- `src/components/openui/notes/{NotesView.tsx, generationStore.ts, notesViewStore.ts, notesModel.ts, notesModel.test.ts, promotion.ts, promote.ts, promote.test.ts, notes.css}`
- `e2e/ai/openuiNotes.spec.ts`
- `.ai/docs/openui-integration-plan.md`, `.ai/docs/openui-live-2026-11-13.md`

Partial hunks:
- `src/ai/tasks.ts`: only the 2 `generate_openui_notes` lines (needs `add -p` → `e`)
- `src/components/canvas/ExcalidrawCanvas.tsx`: only the 2 imports + the 2-line mount
- `.env.development`: whole file
- `src/domain/provenanceGuard.test.ts`: the 2 OpenUI allowlist entries (if option §5-i)
- `src/ai/changes/commitGuard.test.ts`: the `promote.ts` entry (if option §5-i)

Decide on the `notesCheck.test.ts` fixture first (§2).

Message: `feat(openui): Notes reading view with streamed generation, citations, links and pinning (Phase 2)`
Body: Flagged by `NEXT_PUBLIC_OPENUI_NOTES` (on in `.env.development` only). Notes/Canvas toggle; sections from frames; `generate_openui_notes` text task streamed into the view; free fidelity check with per-card reasons; expandable citations and Open in source; cross-note links from arrows; Study mode; Pin to canvas via one `create_block` on the `passage` path (opted out of updates, no new AIMetadata field).

Alternative: if the integrator prefers fewer partial-staging steps, fold commits 1–3 into one OpenUI commit placed after Knowledge Notes and Update Engine.

### Explicitly excluded from all OpenUI commits
- `evaluation/knowledge-notes/experiments/**`
- `.ai/docs/claim-condition-*.md`
- `src/ai/contractTests/openuiMeaningDiag.contract.test.ts`
- `.ai/docs/knowledge-notes-lanes.md`, `pending-work-master-plan.md`, `intelligent-update-engine-plan.md`, `in-progress-tasks/in-progress-tasks.md` (other lanes' docs that mention OpenUI)
- `@huggingface/transformers` and `engines` in `package.json` / lock
- `src/app/globals.css`: no OpenUI hunk; its diff is Lock / Place-content (Update Engine)

## 7. Remaining merge risks

1. **Hard dependency on two other lanes** (§4). OpenUI Phase 2 can't be committed or built alone. If Knowledge Notes renames `knowledgeActions`, `knowledgeStore`, `CardReview`, `passage` or `knowledge.cards`, or Update Engine reshapes `commitOnCanvas` or `commit.ts`, OpenUI breaks.
2. **Guard tests** assert the OpenUI files exist and the exact caller set (§5). Any order other than coordinated gives red intermediate commits.
3. **`tasks.ts` hunk interleaving.** The OpenUI line is adjacent to `route_content` and `judge_consistency`, so it needs hand-editing the hunk, or staging after the other lanes.
4. **Lockfile.** Mixed with transformers/onnx (a large native dependency tree with flag flips). Splitting by hand is risky; regenerating means a network `npm install`, which was not done here. `engines.node` is already staged in the index by another lane. Be careful not to sweep it into an OpenUI commit, or to leave it half-staged.
5. **`vitest.config.ts`** is an integrator file not listed in any lane. Without its `.tsx` include, 2 OpenUI test files silently stop running under `npm test`.
6. **`notesCheck.test.ts` reads an experiments fixture.** It fails on a clean clone if experiments stay out.
7. **Plan doc links.** It links to claim-condition docs, so committing the plan without them leaves dangling links.
8. **Untested UI paths offline:** NotesView component, toolbar toggle, Pin button/undo, Study UI, the `ExcalidrawCanvas` mount and `generationStore`. Their only automated coverage is the AI spec, which is gated and was not run.
9. **Validation of the checks.** All green results were measured on the full mixed working tree, so per-commit buildability was not validated. A per-commit `tsc` + vitest in a throwaway worktree is advisable at commit time; it needs the user's go-ahead because it checks out a tree.
10. **Phase 2 open decision** (plan §1): pinning puts unchecked AI wording on the canvas, without the `check_card_meaning` gate. This is a product decision, not a merge blocker.
11. **`.env.development`** turns the flag on for every dev session once committed, which is intended per the plan, and other lanes' e2e local specs will see the Notes pill in the toolbar.

## Verification 2026-11-14 (round 2)

Approved by the user on 2026-11-14 (fixture copy, test reconciliation, offline tests, a throwaway worktree build check). Nothing was staged, committed, stashed, reset or checked out in the main tree. No AI, contract or `e2e:ai` run. No dev server was started or stopped, and no browser spec was run this round. Edits were made only under `src/ai/openui/**` and `src/components/openui/**`.

**Corrections to the sections above:**
- §3 says "`tsc` reports 0 errors across the whole repo". That was true when it was written. Today the full working tree has **12 errors**, all in another lane's files: `evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/review-v3/attachmentSchema{,.test}.ts`. None are in OpenUI.
- §0, §2 and §7.6 describe the `notesCheck.test.ts` fixture risk. That risk is resolved by R1. The test still reads `evaluation/knowledge-notes/cases/kn-02-edge-cache-invalidation/source.md`, but that file is **tracked at HEAD and unmodified**, so a clean checkout has it.
- §3 says the 62 "probably included other files". R2 confirms it: 62 = 55 + `provenanceGuard.test.ts` (7).
- §5 is incomplete. The OpenUI allowlist entries in `provenanceGuard.test.ts` also depend on the Knowledge Notes **regex** change, not only on the files existing (see R4).

### R1. Fixture copy (decision 1)
- Copied `evaluation/knowledge-notes/experiments/openui-2026-11-13/kn-02-edge-cache-invalidation.openui.txt` to `src/ai/openui/__fixtures__/kn-02-edge-cache-invalidation.openui.txt`. The copy is byte-identical: sha256 `deff19ea1c8de12ee72c7f938a26b718e077a21df1352df88545fc45494fd171` for both files.
- **This is a copy. The original was not deleted or modified**, because the frozen claim-condition evaluation data and its hashes reference it.
- `notesCheck.test.ts` now reads `./__fixtures__/kn-02-edge-cache-invalidation.openui.txt`. Its header comment notes the copy. The assertions are unchanged.
- Result: `npx vitest run src/ai/openui/notesCheck.test.ts` → `Test Files  1 passed (1)` / `Tests  3 passed (3)`.
- The new fixture belongs to commit 3.

### R2. 62 vs 55 (decision 2)
The "62" comes from the 2026-11-13 session transcript (tool calls at 11:21 and 12:03 UTC). The command was:

`npx vitest run src/components/openui src/ai/openui src/domain/provenanceGuard.test.ts` → `Test Files  9 passed (9)` / `Tests  62 passed (62)`.

That command includes the guard test. The lanes row's "62 tests pass" counted it, and §3's 55 did not. Re-run today on the code from before this round, it still gives 9 files and 62 tests. No tests moved or disappeared. The Phase 2–3 row's "51 passed" is an earlier point, before `positional.test.ts` and `notesCheck.test.ts` existed.

| File | Tests (before this round) | In the 55? | In the 62? |
|---|---|---|---|
| `src/ai/openui/interactions.test.tsx` | 15 | yes | yes |
| `src/ai/openui/library.test.tsx` | 5 | yes | yes |
| `src/ai/openui/notesCheck.test.ts` | 3 | yes | yes |
| `src/ai/openui/notesTask.test.ts` | 5 | yes | yes |
| `src/ai/openui/positional.test.ts` | 6 | yes | yes |
| `src/ai/openui/study.test.ts` | 6 | yes | yes |
| `src/components/openui/notes/notesModel.test.ts` | 10 | yes | yes |
| `src/components/openui/notes/promote.test.ts` | 5 | yes | yes |
| `src/domain/provenanceGuard.test.ts` | 7 | no | yes |
| **Total** | | **55** (8 files) | **62** (9 files) |

Commands:
- 55: `npx vitest run src/ai/openui src/components/openui`
- 62: the same command plus `src/domain/provenanceGuard.test.ts`
- Separately, `commitGuard.test.ts` has 2 tests, so the §3 "guards 9/9" is 7 + 2.

Not counted anywhere above:
- `evaluation/.../openuiFidelity.test.ts` runs under `vitest.evaluation.config.ts`.
- `openuiMeaningDiag.contract.test.ts` is paid and excluded.
- `e2e/local/openuiDemo.local.spec.ts` has 1 test.

**Counts after this round:**
- `npx vitest run src/ai/openui src/components/openui` → `Test Files  11 passed (11)` / `Tests  79 passed (79)`
- with `provenanceGuard` added → `12 passed (12)` / `86 passed (86)`

### R3. New offline tests for the Notes reading view (decision 3)
There are three new test files, all in `src/components/openui/notes/`, and there are no production code changes. Command:

`npx vitest run src/components/openui/notes/NotesView.test.tsx src/components/openui/notes/promoteFlow.test.ts src/components/openui/notes/generationStore.test.tsx src/ai/openui/notesCheck.test.ts` → `Test Files  4 passed (4)` / `Tests  27 passed (27)`.

**`NotesView.test.tsx`** (happy-dom, 13 tests). It renders `NotesViewHost` through the real card library and `Renderer`, with the real `notesModel`, `notesCheck`, `notesTask` and `generationStore`. Stubbed: the toolbar slot, the review stores and actions, persistence, `useAIMode`, `AIRuntime` (a scripted two-chunk streamed reply) and `promoteNote`. Covered:
- **Switching:** the toolbar toggle opens the view; Canvas and Escape close it.
- **Reading:** the section from a frame, reading order, and the count.
- **Progressive disclosure:** "More" and "Less".
- **Review mark:** the open-review callout.
- **Citations:** the chips are buttons, and a click expands the inline passage loaded from the stored version.
- **Card actions:** "Open in source" closes the view and calls `openSourceOn` with the cited units; "Show on canvas" selects the card.
- **Links:** a cross-note link follows the arrow and flashes the target.
- **Filter:** the "1 of 2" count.
- **Empty canvas:** the empty-state message.
- **Study:** Read → Study gives flashcards that flip, then Quiz, with no pin action, then back to Read. Study has **no review marks by design**: `StudyCards` doesn't render them.
- **Generate:** hidden with AI off. With AI on: streaming status, `data-status` running → done, one `generate_openui_notes` run, and the check summary and per-card "Needs review" that match `checkGeneratedCards`. The "Pin (needs review)" label passes the review to `promoteNote`, and after pinning the action becomes "Show on canvas" with no second pin. Generated cards survive closing and reopening the view.

**`promoteFlow.test.ts`** (node, 5 tests). It runs `promoteNote` through the **real** `commitOnCanvas` → `ai/changes/commit.ts` → the real `CanvasHistory`. Stubbed, following `afterCommit.test.ts`: the scene writer, the live index, persistence, the BlockNote markdown parser, the camera and the knowledge store. Covered:
- A pin is one `create_block` and one history step. It returns the id, moves the camera, and calls `knowledgeUI.changed`.
- **One Undo removes only the pinned card**, and Redo restores it.
- Two pins are two operations; Undo takes back the latest only.
- The review is carried onto the card, and an unsourced note becomes a plain card.
- When the writer creates nothing, it returns null and doesn't move the camera.

**`generationStore.test.tsx`** (happy-dom, 6 tests). Covered:
- Idle default.
- Streaming steps (running → running → done) are notified, and the cards and check are kept.
- A new run aborts the old one: its signal fires, `current()` turns false, and pins reset.
- Canvases are isolated.
- Pins accumulate in a new map each time.
- `useGeneration` survives an unmount and remount while the run keeps streaming.

**Bugs found: none.** One fixture mistake on my side: cards are separated by a `---` line (`CARD_SEPARATOR`), not by a blank line. It was fixed in the test.

Checks:
- `npx eslint src/components/openui src/ai/openui` → clean.
- `tsc` → no errors in OpenUI files. The working-tree errors are the 12 from another lane, noted above.

Still not covered offline:
- the `ExcalidrawCanvas` mount line;
- real scrolling and focus in a browser;
- a no-AI browser spec of the Notes view. That would need `NEXT_PUBLIC_OPENUI_NOTES=on` and a mock provider on a dev server, which this round did not touch.

### R4. Per-commit build check in a throwaway worktree (decision 4)
Setup:
- Worktree: `git worktree add --detach <scratchpad>\wt HEAD`, with `node_modules` linked by a junction (`mklink /J`) to the main repo's.
- **Limitation:** the main `node_modules` already contains every lane's packages. So a missing `package.json` dependency would not show up as a `tsc` or vitest failure; the lock closure was checked separately (below).
- Shared hunks were applied only inside the worktree by small node scripts that insert exactly the OpenUI lines (line endings preserved). No `git apply` was run on the main tree.

| State | Contents | `npx tsc --noEmit -p .` | vitest |
|---|---|---|---|
| HEAD baseline | — | exit 0, **0 errors** | — |
| After commit 1 (cards + interactions) | §6 commit 1 files, plus `package.json` with only `"@openuidev/react-lang": "^1.1.0"`, plus `package-lock.json` with only the 6 OpenUI entries and the root dep line (+99/−0; `npm ls @openuidev/react-lang --package-lock-only` resolves; every non-optional dep and required peer of the 6 entries resolves in the lock), plus `vitest.config.ts` whole | exit 0, **0 errors** | `npx vitest run src/ai/openui src/components/openui` → `2 passed (2)` / `20 passed (20)`; eslint clean |
| After commit 2 (study foundation) | plus `study.ts`, `study.test.ts`, `src/app/dev/openui-demo/page.tsx`, `e2e/local/openuiDemo.local.spec.ts`, `study-mode-design.md` | exit 0, **0 errors** | `3 passed (3)` / `26 passed (26)`; eslint clean. The demo e2e was not run: no server from the worktree |
| After commit 3 (Notes view), without the other lanes | plus every §6 commit 3 file, the new fixture and the 3 new tests, plus the OpenUI-only hunks of `tasks.ts`, `ExcalidrawCanvas.tsx`, `.env.development` and the 2 `provenanceGuard` entries | exit 2, **39 errors**, all in OpenUI files | `7 failed \| 5 passed (12)`, `1 failed \| 43 passed (44)` |

Verdicts:
- **Commit 1 builds and passes on its own.**
- **Commit 2 builds and passes on top of commit 1.**
- **Commit 3 does not build without the Knowledge Notes and Update Engine lanes**, as §4 predicted.

What breaks commit 3:
- **Missing modules (TS2307):**
  - `@/ai/fidelity/contracts`: `notesCheck.ts`, `notesTask.ts`, `generationStore.ts`, `notesModel.ts`, `promotion.ts`, `NotesView.test.tsx`
  - `@/ai/fidelity/knowledgeCheck`: `notesCheck.ts`
  - `@/ai/fidelity/accounting` and `@/ai/fidelity/exactness`: `notesTask.ts`
  - `@/ai/fidelity/sourceUnits`: `notesCheck.test.ts`
  - `@/components/review/wording`: `notesModel.ts`
  - `@/components/review/knowledgeActions`: `NotesView.tsx`, `promote.ts`
  - `@/components/review/knowledgeStore`: `NotesView.tsx`, `promote.ts`
  - `@/components/review/useKnowledgeObjects`: `NotesView.tsx`
  - `@/components/ai/commitOnCanvas`: `promote.ts`
- **Type shapes missing at HEAD (TS2339):**
  - `ChangeSet.passage` and `ChangeSet.knowledge`: `promote.test.ts`, `promoteFlow.test.ts`
  - `AIMetadata.noteModel`: `promote.test.ts`
  - `ContentSourceVersion.units`: `NotesView.tsx`. This is from `ai/content/sources`/`domain` (other lanes), and is not in §4's table.
  - The rest are follow-on implicit-`any` errors.
- **vitest:** files that import those modules at runtime fail to load. These are `notesCheck`, `notesTask`, **`positional.test.ts`** (it imports `notesTask`), `notesModel`, `NotesView` and `promoteFlow`. Files whose imports are type-only still pass: `promote.test.ts` 5/5 and `generationStore.test.tsx` 6/6.
- **New guard coupling:** `provenanceGuard.test.ts` fails "every listed file still uses them (the list stays honest)" for `components\openui\notes\notesModel.ts`. HEAD's `RECONCILIATION_FIELD` regex doesn't match `.review`, `sourceUnits` or `noteModel`; the Knowledge Notes hunk adds those to the regex. So the OpenUI allowlist entries need **the Knowledge Notes regex change first**, not only the files. `promotion.ts` passes, because it mentions `excludeFromReconciliation`.

Cleanup:
- The junction was removed first with `rmdir` (link only). The main `node_modules` is intact.
- Then `git worktree remove --force` and `git worktree prune`; `git worktree list` shows only the main tree.
- Main tree `git status --short | wc -l`: **540 before, 540 after.** The new files sit inside the already-untracked `src/ai/openui/` and `src/components/openui/` directories, so the line count doesn't change.

New and changed files this round:
- `src/ai/openui/__fixtures__/kn-02-edge-cache-invalidation.openui.txt` (new)
- `src/ai/openui/notesCheck.test.ts` (path and comment only)
- `src/components/openui/notes/NotesView.test.tsx` (new)
- `src/components/openui/notes/promoteFlow.test.ts` (new)
- `src/components/openui/notes/generationStore.test.tsx` (new)
- `.ai/docs/openui-commit-plan-2026-11-14.md` (this section)

The three new tests and the fixture belong to commit 3.
