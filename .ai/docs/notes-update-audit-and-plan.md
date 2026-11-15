# Notes Update — Audit, Simplification Plan, Tests & Best Practices

Status: **draft** · Date: 2026-11-10 · Owner: Gowthamraj

Goal: make note updates **simple and efficient** without making the update
process more complicated — and ensure the feature stays **non-duplicated**
(one source of truth per concern, no parallel code paths doing the same job).

---

## 0. TL;DR

There are **two distinct "update" systems**. They are in opposite health:

- **System A — local persistence of edits** (drag a shape / type in a note):
  clean, correct, well-layered. **Do not refactor.** One mild tax (a parallel
  preview snapshot write).
- **System B — AI "Update from new content" (F38 reconcile pipeline):** this is
  the complexity. ~6,600 lines across ~40 modules; `update.ts` is 1,172 lines
  with a single **190-line** `updateFromNewContent` function carrying ~15
  mutable accumulators and multiplicative feature-flag branching. Runtime
  efficiency is already good (unchanged units skip the model); the cost is
  **developer time and bug risk**, not compute.

High-value change: refactor `updateFromNewContent` into a **mode-resolved
strategy dispatch** with a common result struct. Everything else is secondary.

---

## 1. Architecture as implemented

### System A — local edit persistence

```
Excalidraw onChange ─(skip while pointer down)─▶ SceneBinding diff (O(changed))
      │                                               │  commitTimer 120ms
      │                                               ▼
      │                            canvas Y.Doc ─▶ DocumentProvider (buffer+merge)
      │                                               │  flushDelay 200ms
      │                                               ▼
      │                                        YUpdateStore.append → IndexedDB / SQLite(IPC)
      ├─ new image files ─▶ AssetRepository (Blob, never in scene state)
      └─ viewport / theme ─▶ CanvasRepository / MetaRepository (debounced 600ms)

Rich text (BlockNote): editor ─▶ same DocumentProvider/Yjs path (source of truth)
                        editor onChange ─▶ useSnapshotMirror (250ms)
                                        ─▶ DocumentStore.update (400ms) → documents store  [PREVIEW ONLY]
```

Key files: `src/components/canvas/CanvasSession.ts`,
`src/sync/DocumentProvider.ts`, `src/sync/sceneBinding.ts`,
`src/sync/documentRegistry.ts`, `src/components/blocks/editor/documentSession.ts`,
`src/state/documentStore.ts`, `src/persistence/*`.

**Why it's healthy:** single responsibility per hop; nothing awaited on the
interaction path; failures re-queue (`DocumentProvider.flush` re-`unshift`s on
error); ref-counted registry so N views share one Y.Doc; log compaction at 50
entries. Leave it.

### System B — AI update-from-new-content

Entry: `updateFromNewContent(original, runtime, options)` —
`src/ai/reconcile/update.ts:201`.

Pipeline: parse new + previous text → compute topic ids (renamed section keeps
id) → build the next `VisualPlan` **by one of three tier strategies** → validate
→ ensure stable keys → `reconcile` against live canvas geometry → `buildChangeSet`
for review. Accepted sets apply via `acceptChangeSet`
(`src/ai/changes/accept.ts`) as one undo step, which then flows through System A.

Supporting modules: `classify.ts`, `units.ts`, `sections.ts`, `preserve.ts`,
`paragraphs.ts`, `keys.ts`, `topicIds.ts`, `citations.ts`, `citationUpdate.ts`,
`appendOnly.ts`, `capacity.ts`, `rearrange.ts`, `mapSection.ts`, etc.

---

## 2. Findings — what makes the update complicated / inefficient

### System A (minor)

| ID | Finding | Impact | Action |
|----|---------|--------|--------|
| A1 | Four staggered debounce timers for one edit: scene 120ms, yupdates 200ms, snapshot 250ms, document 400ms. | Hard to reason about together; one keystroke touches storage up to 3×. | Keep, but document the ladder as **two pipelines** (scene 120→200, preview 250→400), not four knobs. |
| A2 | **Dual store for rich text**: Yjs update log *and* denormalized `DocumentRecord.snapshot`. Forces seeding/id-rewrite/clone-race logic in `openDocument` (`documentSession.ts:33-56`). | The one real "duplication" in System A. | Prefer deriving the preview from the last-flushed Yjs state over a parallel write. Low priority; correctness is fine today. |

### System B (the real target)

| ID | Finding | Impact |
|----|---------|--------|
| B1 | `updateFromNewContent` is a 190-line function branching 3 ways on `source.tier`, each re-branching on `citationsOn`, `identity`, `distil`, `appendOnly`, `regenerate`, `plainUnits/plainSpans`, choices/revisions. Carries **~15 mutable `let` accumulators**. | Highest readability + bug-risk hotspot. |
| B2 | Feature flags threaded through the call tree, re-tested at multiple depths (`ai ?` ~6×; `v2` spread into 3 validate calls) instead of decided once. | Reader can't hold "which mode am I in". |
| B3 | The three tiers (`local`, `sectioned`, unit-keyed) share the function but almost no code — they produce `raw` by different means, rejoining at `validateVisualPlan`. | Should be 3 named strategies returning a common shape. |
| B4 | Rules live in prose comments (G1, G3.3, F38b, F42, WP1.10, §6.1), not in named code constructs. | Modes are inferred from flag combinations. |
| B5 | Efficiency is **deliberately good**: unchanged units reuse prior plan nodes with no model call (`update.ts:297-301`); heading-only + plain cards skip the model; citations short-circuit regeneration. | Do **not** regress this during refactor. |

---

## 3. Simplification plan (no behavior change)

Principle: **decide the mode once, then run one straight pipeline.** Keep the
model-call avoidance exactly as-is.

### Step 1 — Resolve an `UpdateMode` at the top
```ts
interface UpdateMode {
  tier: "local" | "sectioned" | "unitKeyed";
  appendOnly: boolean;
  distil: boolean;
  citations: boolean;
  ai: boolean;
  v2: boolean;
  scope: ReadonlySet<string> | null; // regenerate / selection re-run
}
```
Compute every flag combination once; stop re-testing them downstream.

### Step 2 — Three tier strategies, one return shape
Extract `updateLocalTier`, keep `updateOutlined`, add `updateUnitKeyed`. Each
returns a common struct — eliminating the ~15 shared `let`s:
```ts
interface PlanResult {
  raw: unknown;                 // pre-validation next plan
  reanalyzedUnits: string[];
  reusedUnits: string[];
  provenance?: Provenance;
  grouped: VisualPlan | null;
  outlinedSections: OutlineSection[] | null;
  plainCardKeys?: string[]; plainMissed?: ...; economy?: ...;
  planSkips?: ...; capacity?: ...; knowledgeRun?: ...;
}
```

### Step 3 — Shared tail becomes one pipeline
`validate → ensureStableKeys → typeExplanations → appendOnly? → withChoiceNodes
→ reconcile(scoped) → buildChangeSet` consuming `PlanResult`. The 190-line body
becomes ~30 lines of orchestration + 3 focused producers.

### Step 4 — Name the rules
Replace flag-combination inference with named predicates/enums
(`isAppendOnly(mode)`, `reusesUnitPlans(mode)`), referencing the spec tags.

### Non-goals
- No change to debounce/flush timings in System A.
- No change to the model-skip heuristics (B5).
- No new persistence store; do **not** add a third source of truth.

---

## 4. Tests — prove the update works and stays non-duplicated

Existing coverage to lean on (the safety net that makes the refactor safe):
`update.test.ts`, `classify.test.ts`, `units.test.ts`, `preserve.test.ts`,
`conflicts.test.ts`, `citationUpdate.test.ts`, `appendOnly.test.ts`,
`topicIds.test.ts`, `regenerateScope.test.ts`, plus persistence conformance
(`sqlite.conformance.test.ts`, `sqlite.storage.test.ts`).

Refactor guardrails — add/confirm:

1. **Characterization (golden) tests first.** Before touching `update.ts`,
   capture current `UpdateResult` for one case per tier (local / sectioned /
   unit-keyed) × {appendOnly, distil, citations, regenerate-scope}. Refactor
   must leave these byte-identical. Use the existing
   `evaluation/knowledge-notes` record-and-replay harness so no live model runs.
2. **No-op update** = empty change set (unchanged text → zero proposed changes,
   zero model calls). Assert model-call count is 0.
3. **Reuse assertion:** unchanged units produce **no** `generate_visual_plan`
   call; only changed units do (guards B5).
4. **Idempotency:** applying an accepted change set twice does not duplicate
   nodes/objects (stable-key dedup holds).
5. **Scope isolation:** a selection re-run proposes changes only within its
   sections (ties to memory: *selection-actions-stay-scoped*).
6. **Round-trip persistence:** apply → flush → reload (`DocumentProvider.load`
   replay + compaction) yields the same scene; preview snapshot matches Yjs
   state (guards A2 duplication).
7. **Crash/retry:** a failed `YUpdateStore.append` re-queues and the next flush
   succeeds with no lost update.

Run policy: **do not run AI/e2e/contract tests without explicit go-ahead that
turn** (memory: *no-ai-runs-without-approval*). Prefer `--provider=aicredits`,
`--trace off`, separate `--output` when authorized.

---

## 5. Best practices — non-duplicated notes updates

Follow these whenever touching the update feature:

1. **One source of truth per concern.** Yjs update log is the truth for content;
   `DocumentRecord.snapshot` is a *derived* preview — never let a second writer
   treat it as authoritative. No new store without deleting an old one.
2. **Decide the mode once.** Resolve all flags into a mode object up front; never
   re-test the same flag at multiple call depths.
3. **One write path per edit.** New edit flows must reuse
   `DocumentProvider.applyLocalChange` → flush → `YUpdateStore`. Do not add a
   parallel persistence route.
4. **Diff, don't rewrite.** Persist only changed elements (`SceneBinding`) and
   re-analyze only changed units (`currentUnits`/reuse). Never re-run the model
   on unchanged content.
5. **Never block the interaction path.** Nothing awaited in `onChange`;
   persistence is debounced + fire-and-forget with re-queue on failure.
6. **Stable keys for identity.** Reconciliation and dedup rely on stable node
   keys / topic ids; a rename must keep its id (`topicIds`). Any new node must
   carry a stable key or it will duplicate on next update.
7. **Idempotent apply.** `acceptChangeSet` must be safe to re-apply; applying the
   same set twice must not create duplicates.
8. **Scope stays scoped.** Selection/frame re-runs touch only that selection.
9. **Share, don't clone, providers.** Acquire via `documentRegistry` (ref-counted)
   so N views share one Y.Doc; respect grace-period disposal.
10. **Characterize before refactor.** Lock behavior with golden `UpdateResult`
    snapshots; keep them identical across the refactor.
11. **Flush on teardown.** pagehide/unmount must flush providers + `DocumentStore`
    + settle `pendingWork` before disposal.
12. **No live model/e2e runs without approval**; record provisional results and
    ask before any paid run.

---

## 6. Sequencing

1. Land §4.1 characterization tests (replay-only, no live model). ← start here
2. Refactor per §3 Steps 1–3 behind the golden tests.
3. Apply §3 Step 4 (name the rules) once structure is stable.
4. Revisit A2 (derive preview from flushed Yjs) only if §4.6 shows drift.

Open questions:
- Is the unit-keyed (default) tier worth extracting, or fold into `sectioned`?
- Can `DocumentRecord.snapshot` be fully derived, removing the dual-write (A2)?
