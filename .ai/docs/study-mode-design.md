# Study Mode — design (v1 data model and concept identity)

Status: **draft, decisions provisional** (2026-11-13). Related: [openui-integration-plan.md](./openui-integration-plan.md)
(Phase 3 built the study cards: `QuizCard`, `Flashcard`, and the Notes view's Study mode), and
[openui-live-2026-11-13.md](./openui-live-2026-11-13.md).

Agreed order (user, 2026-11-13): design Study Mode now. Build only its smallest independent slice, after the P0 items
(meaning-check comparison, real ChatGPT MCP run) and the verified-pinning contract. No `domain/types.ts` change for v1:
results live in their own store, keyed by stable concept ids.

## 1. What exists today

- The Notes view's **Study** mode makes flashcards and quiz cards from the canvas's notes (`ai/openui/study.ts`).
  Interaction is local state only, and **nothing is remembered**: a reload forgets every answer.
- Each note is identified by its **canvas object id**. That id isn't stable: regenerating a section replaces the
  objects, so history keyed on it would silently reset after an update.

## 2. The decision: what a "concept" is (SM-D1, provisional)

**A concept is the source passages it teaches: `(contentSourceId, its cited unit ids)`.** Not the card, and not the
object.

Why:
- **Unit ids survive edits.** `matchVersions` carries ids across source versions, and lineage says what happened to each
  unit (`unchanged`, `changed`, `moved`, `removed`, `ambiguous`). A concept keyed on units keeps its history when the
  source changes, and knows when it should.
- **It survives regeneration.** A regenerated card cites the same units, so it maps to the same concept even though its
  object id changed. That holds for distil Visualize cards, pinned OpenUI cards (`promotion.ts` stamps `sourceUnits`) and
  passage cards.
- **It's the identity the update engine already reasons about.** Claim-level patches and the Node Router work on cited
  units too, so Study Mode doesn't invent a third identity scheme (the shared-provenance point, §5).

Concept id, deterministic: `c:<contentSourceId>:<sorted unit ids joined by +>`, e.g. `c:src_Fmea…:u6+u7`. Cards citing
the same units are the same concept. Cards citing overlapping sets are different concepts: v1 doesn't merge them.

On a new source version, each stored concept is mapped through lineage:

| Lineage of its units | What happens |
|---|---|
| All `unchanged` (moves included) | Same concept, history kept |
| Any `changed` | Same concept, marked **source changed since you studied it**; the next review counts as fresh |
| Any `ambiguous` | Kept, marked as needing review; no automatic remap |
| All `removed` | Retired: history kept, never quizzed again |

Cards with no source link (a user's own card, a card made before Knowledge Notes) get a **local concept**
`l:<canvasId>:<objectId>`. It's honest that it resets if that card is deleted or recreated, and it never syncs to MCP.

## 3. v1 data model (device-local, no schema change)

Stored in the `meta` repository under `study.<workspaceId>`, the same device-local and never-exported posture as content
sources and conversations. Bounded: the last 20 attempts per concept, at most 2,000 concepts per workspace (oldest
evicted).

```ts
interface StudyRecord {
  version: 1;
  concepts: Record<ConceptId, {
    sourceId?: string;          // absent for local concepts
    units?: string[];           // cited unit ids at the version last studied
    sourceVersion?: number;
    title: string;              // the card title when last studied (display only)
    attempts: { at: number; kind: "quiz" | "flashcard"; correct: boolean; ms?: number }[];
    flag?: "source_changed" | "needs_review" | "retired";
  }>;
}
```

"Weak concept" (v1, deterministic, explainable): at least 2 attempts and accuracy over the last 5 below 60%, or the last
attempt was wrong; ranked by recency and how many units the concept covers. No spaced-repetition scheduler in v1.

## 4. MCP contract (later slice; read-only)

`get_study_status` gives each weak concept as `{ conceptId, title, sourceId, units, accuracy, lastAttempt, flag }`, plus
the cited passages' text, so ChatGPT can produce personalised revision grounded in the source.
- Any revision it produces comes back as an ordinary proposal (`create_block`) through review. There's no
  write path into the study store from MCP.
- Local concepts are never exposed.

## 5. Shared provenance contract (applies to OpenUI, the update engine and Study Mode)

Every AI-generated artefact on the canvas uses the **existing** `AIMetadata` fields; no feature adds its own:

| Need | Field (exists today) |
|---|---|
| Source, version, cited units | `contentSourceId`, `contentSourceVersion`, `sourceUnits` |
| Model and run | `provider`, `model`, `operationId`, `task` |
| Verification status and result | `review` (`reasons`, `checked`) |
| Stable identity once pinned | `stableNodeKey` |
| Managed by reconciliation or excluded | `excludeFromReconciliation` |

Study Mode reads these and doesn't write them: its own records stay in its store, keyed by concept.
`domain/provenanceGuard.test.ts` keeps every reader documented.

## 6. Smallest slice to build (when prioritised)

1. A pure `conceptOf(card)` and a pure lineage remap, with tests (unit-id fixtures from the golden cases).
2. A `studyStore` over `meta`: record an attempt, list weak concepts.
3. The Notes view's Study mode records quiz and flashcard results, and shows "weak" and "source changed" badges.

Acceptance: results persist across reloads, and the weak-concept list is reproducible from stored attempts.
The interactive canvas card type, and `get_study_status`, come after this slice, with integrator sign-off.

## 7. Open questions

- SM-Q1: do overlapping unit sets ever need merging (two cards teaching nearly the same thing)? v1 says no.
- SM-Q2: should Study history ever sync (cloud-sync plan)? v1: device-local only, like content sources.
