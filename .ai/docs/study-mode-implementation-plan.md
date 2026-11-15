# Study Mode: implementation plan

Status: **plan only, for review** (2026-11-14). Nothing here is built. No source, type or test file was changed to write it.
Builds on [study-mode-design.md](./study-mode-design.md) (SM-D1 and §3–§6). Where this plan departs from the design, it
says so and gives the reason (marked **Δ**). Related: [openui-integration-plan.md](./openui-integration-plan.md) Phase 3,
[intelligent-update-engine-plan.md](./intelligent-update-engine-plan.md),
[chatgpt-mcp-architecture-and-test-plan.md](./chatgpt-mcp-architecture-and-test-plan.md), lanes file Ownership table
([knowledge-notes-lanes.md](./knowledge-notes-lanes.md)).

## 0. Where things stand (verified in code, 2026-11-14)

- `src/ai/openui/study.ts`: `flashcardLang(note)` and `quizLang(notes, index)` turn a `StudyNote {id,title,body,cites}`
  into `Flashcard` / `QuizCard` Lang. They're pure and deterministic, with no model call. Each card carries only `cites[0]` as its `unit`.
- `src/ai/openui/interactions.tsx`: `QuizCardView` keeps the pick in local state, or in a bound `selected` `$variable`.
  It has "Try again". `FlashcardView` only flips, so it gives no right or wrong signal. Neither card reports anything to its host.
- `src/components/openui/notes/NotesView.tsx`: `StudyCards` renders these cards from `studyNotes`, which come from `allNotes`
  (canvas cards only, not unpinned generated previews). **Gap:** `studyNotes` drops `Note.needsReview` and `Note.source`.
  So a quiz made from a card in Needs review shows no mark today (§7 fixes this first).
- `src/components/openui/notes/notesModel.ts`: `Note` has `cites`, `needsReview` (an open review's first reason, via
  `isOpenReview`) and `source {sourceId, version}`. These come from `knowledgeObjectsOf` (`components/review/knowledgeObjects.ts`),
  the review UI's only sanctioned reader of `sourceUnits` / `review` / `contentSourceVersion`.
- `src/ai/fidelity/sourceUnits.ts`: `matchVersions` carries unit ids one-to-one. A unit id is never reused (`nextId`).
  Lineage entries use `unchanged`, `changed` (same id), `moved` (a flag), `ambiguous` (new id plus old `candidates`, which are **not**
  reported as `removed`), `removed` and `added`. Lineage is stored per version on `ContentSourceVersion.lineage` (one step,
  from N-1 to N). It is absent on a first version and after a version without units.
- `src/ai/reconcile/citations.ts`: `planCitationUpdate` / `decide` / `indexLineage` is the reference remap for cards.
  Its actions are `keep`, `resend` (changed), `review` (ambiguous), `recheck` (some units removed) and `remove` (all removed).
  `citationUpdate.ts` rewrites a card's `sourceUnits` to `d.cites`: removed units are dropped and ambiguous ones are kept as they were.
  It's behind `CITATION_UPDATE_CONFIG.enabled = false` (on at R2).
- `evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/claimConditions.ts` `remapRecord` already uses
  the Study Mode states (`kept | source_changed | needs_review | retired`). It has two divergences we must **not** copy:
  (a) it looks up an ambiguous unit by `from`, but ambiguous entries name old ids in `candidates`, so an ambiguous unit
  reads as removed and gets `retired`; (b) it retires when **any** unit is removed, where the design and `decide` retire only when **all** are.
- Device-local stores: `MetaRepository` (`get`/`set`/`delete`, no listing) in `persistence/repositories/types.ts`. Existing
  patterns are `sourceReview:<sourceId>@<v>` (`ai/content/sourceReview.ts`, with the lenient reader `readSourceReview`) and
  `consistency.<canvasId>` (`ai/consistency/store.ts`, bounded with `MAX_CONFLICTS`). The cloud-sync plan says `meta` is
  **never** synced. Export (`portability/workspaceBundle.ts`) doesn't carry `meta`, and import gives sources **new ids**
  (`newContentSourceId`). `deleteWorkspace` (`workspaces/hierarchy.ts`) and `contentSources.delete` don't clean `meta`.
- MCP: `get_consistency` in `mcp/tools/readTools.ts` already reads `meta` read-only (`ReadToolDeps.meta: Pick<MetaRepository,"get">`,
  `READ_ANNOTATIONS`, `toolResult`, bounded `.slice(0, 50)`). `McpReadServices` has no `contentSources`. The reader says content
  sources aren't reachable from MCP. `normalizeAIMetadata` drops `sourceUnits` / `review` / `contentSourceId` for MCP.
  `domain/provenanceGuard.test.ts` says the reconciliation fields are read "never by … MCP".

## 1. Stable concept identity

**Concept key (SM-D1, confirmed): the source passages a card teaches, not the card.**

```
conceptKey(sourceId, units) = "c:" + sourceId + ":" + sortByCounter(dedupe(units)).join("+")   // e.g. c:src_Fm…:u6+u7
```
- `sortByCounter` sorts by the number after `u`, so `u9` comes before `u10`. If there are more than 16 units, the key is
  `c:<sourceId>:h<cyrb53(joined)>`, and the full list is kept in the record (`cyrb53` from `ai/content/fingerprint.ts`).
- The input is `Note.cites` (all cited units), **not** the Lang's `unit` (only `cites[0]`). It never uses the object id,
  `stableNodeKey` or the generated text, so the key survives regeneration (a regenerated card cites carried ids),
  Stage 1 `patch_block` (same object, same cites), Stage 1e `userWording` merges, and Stage 3 multi-location sync
  (several cards citing the same units are one concept).
- A note with no `source` or no cites gets a **local concept** `l:<canvasId>:<objectId>`. It resets if the card is recreated,
  it's never remapped, and it's never sent to MCP (as in the design).
- Every stored concept records `sourceVersion`, the version its `units` belong to.

**Remap (new pure function, `remapConcept(concept, lineages[])`).** It is applied lazily when a source shard is loaded.
It runs whenever the latest source version (or the version of a live card citing the concept) is newer than `concept.sourceVersion`.
It chains the one-step lineages `v+1 … target`, read with `contentSources.getVersion(sourceId, v).lineage`, and checks
each `fromVersion`/`toVersion` as `planCitationUpdate` does. It indexes each step the way `indexLineage` does (`byOld`, and
`ambiguousOf` through `candidates`).

| Cited units, through every step | State | Key afterwards | History |
|---|---|---|---|
| all `unchanged` (with or without `moved`) | `kept` | same ids, same key | kept, still counts |
| any `changed`, none removed or ambiguous | `source_changed` | same key (ids carry) | kept; earlier attempts **stale** (§3) |
| some `removed`, the rest survive | `source_changed` + `narrowed` | key over the survivors; `carriedFrom` = old key | moved to the new key, stale; if the new key already exists, see §4 |
| any cited unit is a `candidate` of an `ambiguous` entry | `needs_review` | old key (cites kept, as `citationUpdate` does) | kept; never remapped automatically |
| all `removed` | `retired` | old key | kept; never quizzed, never "weak" |
| a step's lineage is missing or mismatched (a version without units, §6.3) | `needs_review` (reason `lineage_gap`) | old key | kept; never assumed unchanged |
| source deleted from this device | `retired` (reason `source_missing`) | old key | kept until evicted |

Precedence when several rows apply: `retired` (all removed) > `needs_review` > `source_changed` > `kept`. **Δ:** the design
had no partial-removal row. Partial removal follows `decide`'s `recheck` (the card stays, re-checked), not `remapRecord`'s
"any removed = retired". A user's later study of the narrowed concept clears `source_changed`. `needs_review` clears only once
a card citing the remapped units is studied after the card's own review is resolved.

## 2. Device-local persistence of attempts

**Store:** `MetaRepository`, the same posture as `sourceReview` and `consistency`: device-local, never synced, never exported, not in Yjs.
**Δ (sharded keys instead of the single `study.<workspaceId>`):** a single key is rewritten in full (up to about 2 MB) on every
click. It can't be remapped or deleted one source at a time, and `MetaRepository` has no key listing. So:

| Key | Holds |
|---|---|
| `study.<workspaceId>` | index: `{ version: 1, shards: { [sourceId or "local:<canvasId>"]: { concepts: number, updatedAt } } }` |
| `study.<workspaceId>.<sourceId>` | `StudyShard` for one source |
| `study.<workspaceId>.local.<canvasId>` | `StudyShard` for local concepts of one canvas |

```ts
interface StudyShard {
  version: 1;
  sourceId?: string;
  concepts: Record<string, {           // concept key
    units?: string[];                  // at sourceVersion; absent for local
    sourceVersion?: number;
    title: string;                     // display only, ≤120 chars, the last card title studied
    attempts: [at: number, kind: "q" | "f", correct: 0 | 1, flags: number][];  // flags bit0 unverified card, bit1 stale
    freshSince?: number;               // attempts before this are stale (source_changed)
    state?: "source_changed" | "needs_review" | "retired";
    reason?: "narrowed" | "lineage_gap" | "source_missing";
    carriedFrom?: string; related?: { key: string; rel: "split_from" | "merged_from" | "overlaps" }[];
    cardStatus?: { review: "open" | "none"; at: number; version?: number };   // snapshot for MCP (§6, §7)
  }>;
}
```
- **Δ (dropped `ms`):** answer timing is behavioural data no v1 formula uses, so v1 doesn't store it.
- **Bounds:** 20 attempts per concept (oldest dropped), 500 concepts per shard, 2,000 per workspace. When a bound is hit,
  `retired` concepts go first, then the least recently attempted. That's about 400 KB per shard at worst.
- **Reading:** a lenient reader like `readSourceReview`. Malformed entries are dropped and the reader never throws.
- **Writing:** one `set` per recorded attempt on that shard only, serialised per key with an in-module promise chain.
- **What counts as an attempt:** the first pick on a `QuizCard` per mount ("Try again" picks aren't recorded), and an
  explicit "Got it" / "Missed it" self-grade on a `Flashcard` after flipping. A flip alone records nothing.
- **Export/backup:** not included in v1. That matches `sourceReview`. Import gives sources new ids, so keys wouldn't match anyway.
  A later opt-in "Include study history" would go through Lane E with the import's source-id map (Q5).
- **Privacy:** no answer text, no choice text and no timing is stored, only concept keys, titles and booleans.
  Settings gets "Clear study history" (it deletes the workspace's index and shards). Workspace and source deletion also delete them (Q4).

## 3. Mastery and weak concepts

Everything is computed from stored attempts and an injected `now`, so the result can be reproduced (the design's acceptance test).
Only **fresh** attempts count, meaning `at ≥ freshSince`.

- **Weak (the design's rule, unchanged):** the concept isn't `retired`, and either
  (a) it has ≥ 2 fresh attempts and accuracy over the last 5 fresh attempts is < 0.6, or (b) the last fresh attempt was wrong.
  Minimum evidence for (a) is 2. Rule (b) fires on 1 attempt but ranks below (a).
- **Mastery (new, for display and ranking only; it never feeds a decision about content):**
  `m = (Σ wᵢ·cᵢ + 1·0.5) / (Σ wᵢ + 1)`, where `wᵢ = k(kind)·0.5^((now − atᵢ)/14 days)`, `k(quiz) = 1`, `k(flashcard) = 0.5`
  (self-graded), and `cᵢ ∈ {0,1}`. The single pseudo-attempt at 0.5 is the prior, so one answer can't read as 0% or 100%.
  Evidence is `n = Σ wᵢ`.
- **Bands:** `new` (fewer than 2 fresh attempts), `weak` (the rule above), `learning`, and `strong` (m ≥ 0.85, n ≥ 3). A concept
  whose card has an open review, or whose state is `needs_review`, is capped at `learning` (§7).
- **Rank of the weak list:** rule (a) before (b), then lower m, then more recent last attempt, then more units covered, then the key (a stable tiebreak).
- **Decay** affects only m and the bands. Stale attempts stay visible in history but are never counted.
- There's no spaced-repetition scheduler in v1 (as in the design).

## 4. Concepts that split, merge or disappear

Rule: **attempts belong to the key they were made under. They're never copied, summed or invented for another key.**

- **Split by regeneration** (a card citing `u6+u7` becomes two cards citing `u6` and `u7`): the new keys start empty.
  Each gets `related: [{key: "c:…:u6+u7", rel: "split_from"}]` when its units are a strict subset of a stored key at the
  same version. The UI shows "Studied before as part of ‘X’ (3/5)" as context only. That count isn't added to m.
- **Merge by regeneration** (`u6` and `u7` become one card citing `u6+u7`): the new key gets `merged_from` links to both. Same rule applies.
- **Partial overlap** (SM-Q1): `overlaps` when the Jaccard index is ≥ 0.5. Display only. v1 never merges histories (the design's answer stays).
- **Remap collision** (a narrowed `u6+u7` becomes `u6`, which already exists): the target's own history stays. The narrowed one keeps its
  old key with `state: "source_changed"`, and the target gets `related: [{ key: old, rel: "merged_from" }]`. Neither history is merged.
- **Card deleted, source units still there:** the concept stays and shows as "no card teaches this now". It stays in the weak list,
  linked to its passages (§5), and is evicted by the normal bounds.
- **Units removed:** `retired` (§1). **Source deleted:** `retired / source_missing`. **Workspace deleted:** shards deleted (Q4).
- **Lineage can't split or merge a unit.** `matchVersions` is one-to-one, so a reworded split shows up as `changed`/`removed` + `added`,
  and the §1 table handles it. Added units never join an existing concept.

## 5. Weak-concepts view

- **Where:** in the Notes view's Study mode (`StudyCards` in `NotesView.tsx`), a third toggle **Weak** beside Flashcards and Quiz.
  It's built in a new `components/openui/notes/WeakConcepts.tsx`. Flashcards and Quiz show badges on each card:
  "Weak", "Source changed since you studied this", "Needs review".
- **Each row shows:** the title (the live card's current title, else the stored one), the band, mastery as a percentage, fresh attempts, and
  the last attempt ("2 days ago, missed"). It also shows the state badge, an open-review badge, and `related` context.
- **Links back:** cited passage chips. Their text comes from `contentSources.getVersion(sourceId, sourceVersion).units`, loaded the way
  `NotesView` already loads `units`. Other links:
  - "Open in source": `openSourceOn(env, objectId, units)` when a live card cites it.
  - "Show citing cards": `outlineCiting(env, sourceId, units)`, which also works when no card teaches the concept now.
  - "Quiz me on these": filters Quiz to the cards of the weak concepts.
- Local concepts show without passages. Retired concepts are hidden behind a "Show retired (n)" toggle.
- There's no model call and no canvas write.

## 6. Read-only MCP tool

**Name: `get_weak_concepts`** (**Δ** from the design's `get_study_status`). The tool returns weak concepts only, and its name is
what a client uses to choose it. `get_study_status` stays free for a later summary tool (Q8). It's registered in
`mcp/tools/readTools.ts` beside `get_consistency`, added to `READ_TOOL_NAMES`, with `READ_ANNOTATIONS` and `guarded`/`toolResult`.

```ts
input  { canvasId?: string /* default: open canvas; else the whole workspace */, limit?: 1..25 /* default 10 */,
         includeNeedsReview?: boolean /* default true; such items are still marked */, includePassages?: boolean /* default false */ }
output { scope: { workspaceId, canvasId? }, rule: { version: 1, minAttempts: 2, window: 5, threshold: 0.6 },
         concepts: [{ handle /* "sc_" + cyrb53(key): no source id or unit ids */, title /* ≤120 */,
           cards: [{ objectId, canvasUri, uri? }] /* ≤3; uri as objectUriOf gives it (page preview → acute://page/…), else the canvas URI + objectId */, band, mastery, freshAttempts, recentAccuracy,
           lastAttemptAt /* ISO */, lastCorrect, weakBecause: "low_accuracy" | "last_wrong",
           state?: "source_changed" | "needs_review",
           reviewStatus: "needs_review" | "no_open_review" | "unknown", reviewStatusAsOf /* ISO */, verified: false,
           passages?: [{ text /* ≤600 chars */ }] /* ≤8; only with includePassages AND the workspace opt-in */ }],
         counts: { weak, studied, retiredHidden, localHidden }, truncated: boolean }
```
- **Bounds:** 25 concepts, 8 passages of 600 chars each, and about 20k characters in total (then `truncated`). Only this workspace is read.
- **Data source:** read-only `meta.get` on the index and shards. There's no write path: no attempt, flag or setting can be changed
  through MCP. Revision material ChatGPT produces goes back through `create_block` as a reviewed proposal, as today.
- **Review fields:** `reviewStatus` comes from the shard's `cardStatus` snapshot (§7). It is `unknown` when there's no snapshot, or
  when the snapshot's `version` is older than the source's latest. `verified` is always the literal `false`, so a
  client can't read "no open review" as "verified" (OD5: never "verified").
- **Privacy:** local concepts, retired concepts, attempt timestamps other than the last, and source and unit ids are never returned.
  **Δ (passages off by default):** the design returns passage text. But content sources are deliberately unreachable from the
  MCP reader, and a hosted ChatGPT connection sends what it gets to OpenAI. So passages need a per-workspace opt-in,
  stored in `mcp.access` ("Share cited source passages with connected assistants", off), plus `contentSources`
  read access in `McpReadServices` (Q9, Q10). Without them the tool returns card URIs, and ChatGPT reads the cards with `get_canvas` / `get_page`.
- **Hosted:** AI and MCP are off on hosted until the rest of C1, so this tool ships local/desktop first and follows the MCP gate.

## 7. Provenance and review-status enforcement

1. **Carry review state into study items (fixes the §0 gap):** `StudyNote` gets `needsReview?: string` (in `study.ts`, which is the lane's own file). `StudyCards`
   draws the same "Needs review" note **outside** the Renderer, as `GeneratedNotes` does with `acute-notes__review`.
   So no `QuizCard`/`Flashcard` prop changes (props are positional and append-only).
2. **Mark attempts:** an attempt on a card with an open review is stored with `flags` bit0 set (unverified).
3. **Downstream rules:**
   - Such concepts are capped at `learning`, and in the weak list they sit in their own group, "From cards that need review".
   - MCP returns `reviewStatus: "needs_review"` and `verified: false`.
   - Nothing in Study writes `AIMetadata`, resolves a review or feeds a fidelity report, golden case or `checkGeneratedCards`.
     Study results are never evidence of source fidelity.
4. **No new provenance reader:** Study gets review state only through `Note.needsReview`, which `notesModel.ts` already
   derives from `knowledgeObjectsOf`. The new `src/ai/study/**` modules must not name the guarded fields. That means no `.review` reads, no
   `review?:` declarations and no `sourceUnits` identifier (they use `units`, `cardStatus`), so `provenanceGuard.test.ts` stays green
   with no allow-list change. The snapshot `cardStatus` is written by the Notes view (it reads `Note.needsReview`) each time Study is opened or an attempt is recorded.
5. **"No flags" isn't "correct":** wording in the view and the MCP summary reuses the Notes view's line, "Checked against the source by rules, not by
   AI: a card that passes isn't proven correct."

## 8. Ownership

**New files (Study lane, created by this work):**
- `src/ai/study/concept.ts` (+ `.test.ts`): `conceptKey`, `conceptOfNote`, `remapConcept`, `chainLineages`.
- `src/ai/study/mastery.ts` (+ `.test.ts`): `masteryOf`, `isWeak`, `bandOf`, `rankWeak`.
- `src/ai/study/store.ts` (+ `.test.ts`): `readStudyShard`, `recordAttempt`, `loadWorkspaceStudy`, `snapshotCardStatus`, `clearStudy`, bounds.
- `src/components/openui/notes/WeakConcepts.tsx`; `e2e/local/notesStudy.local.spec.ts`.
- `src/mcp/tools/studyTools.ts` (+ test). The tool body only; registration needs sign-off.

**Edits to free lane files (OpenUI Phase 2/3 lanes, both free):**
- `src/ai/openui/study.ts`: `needsReview` on `StudyNote`.
- `src/ai/openui/hostContext.tsx`: an optional `NotesHost.recordStudy?(r: { kind: "quiz" | "flashcard"; correct: boolean })`.
- `src/ai/openui/interactions.tsx`: QuizCard reports its first pick, and Flashcard gets self-grade buttons. Both only when the host offers `recordStudy`, so the static demo is unchanged.
- `src/components/openui/notes/NotesView.tsx`: wiring, badges, and the Weak toggle.

**Needs integrator sign-off:** `mcp/tools/readTools.ts` and `index.ts` (registration, `READ_TOOL_NAMES`); `mcp/resources/workspaceScan.ts`
(`McpReadServices` + `contentSources`); `mcp/bridge/access.ts` (the passage opt-in); `workspaces/hierarchy.ts` and the source-delete path
(cleanup); `portability/**` (Lane E, deferred); the setup registry. **No change** to `domain/types.ts`, `ai/fidelity/contracts.ts`,
`persistence/repositories/*`, `ai/changes/**`, `ai/reconcile/**` or `domain/provenanceGuard.test.ts`, and **no new card type** in v1.

**Integrator decisions (recommended answer in bold):**
1. Concept key = `c:<sourceId>:<units sorted by counter>`, hashed above 16 units; partial removal narrows the key (§1)? **Yes.**
2. Sharded meta keys `study.<ws>` + `study.<ws>.<sourceId>` + `study.<ws>.local.<canvasId>` instead of one `study.<ws>`? **Yes.**
3. No `domain/types.ts`, `contracts.ts` or `persistence/repositories/*` change; use the index key rather than adding key listing to `MetaRepository`? **Yes.**
4. Delete study shards in `deleteWorkspace` and when a content source is deleted (and fix the same leak for `sourceReview:` keys separately)? **Yes, integrator wires it.**
5. Leave study history out of export/backup in v1? **Yes. Revisit with Lane E using the import's source-id map.**
6. Study reads review state only via `Note.needsReview` and avoids the guarded identifiers, so no provenance-guard exception? **Yes.**
7. Attempts on cards with an open review: count them, mark them, cap the concept at `learning`? **Yes, and never exclude them silently.**
8. Tool name `get_weak_concepts` (not `get_study_status`), registered in `readTools.ts` with `READ_ANNOTATIONS`? **Yes.**
9. MCP returns an opaque `handle`, card ids/URIs and a `reviewStatus` enum from the snapshot, with no source or unit ids? **Yes.**
10. Passage text over MCP: off by default, behind a per-workspace opt-in in `mcp.access` plus `contentSources` read access in `McpReadServices`? **Yes. Off in v1, opt-in in the MCP phase.**
11. Defer the interactive canvas study card type and any `AIMetadata` field? **Yes, until after the MCP phase and OpenUI Phase 4's gate.**
12. Sequencing: Phases 1–3 start after this plan is approved, regardless of update-engine stages; Phase 4 after the real ChatGPT MCP run (S1–S9)? **Yes.**

### Decision status (user review, 2026-11-14)

"In principle" means the user approved the direction. The integrator's sign-off on the details is still required
before anything is built.

| # | Decision | Status |
|---|---|---|
| 1 | Concept key from source id plus unit lineage | **Direction approved in principle.** Open: the exact key form, hashing above 16 units, partial removal narrowing the key |
| 2 | Sharded meta keys | **Open** |
| 3 | No `domain/types.ts` change | **Approved in principle for v1.** Open: no `contracts.ts` / `persistence/repositories/*` change, and the index key instead of key listing |
| 4 | Delete study and `sourceReview:` data on workspace or source delete | **Required** by the user (issue C below). Open: the integrator wires the delete paths |
| 5 | Study history out of backup in v1, limitation documented | **Approved in principle** |
| 6 | Review state read only through `Note.needsReview`, no guard exception | **Open** |
| 7 | Count and mark answers on unreviewed cards, cap at `learning` | **Open.** The visible-inheritance part is required (issue A) |
| 8 | Read-only `get_weak_concepts` exposing verification and review status | **Approved in principle.** Open: registration in `readTools.ts` / `index.ts` |
| 9 | Opaque handle, card ids, `reviewStatus`; no source or unit ids | **Open** |
| 10 | Passage text over MCP only with an explicit opt-in | **Approved in principle.** Open: the opt-in mechanism (`mcp.access`, `McpReadServices`) |
| 11 | Defer the canvas study card type and any `AIMetadata` field | **Open.** A new card type needs integrator sign-off regardless |
| 12 | Sequencing | **The MCP phase waits for the real ChatGPT test: approved in principle.** Open: whether Phases 1–3 start once this plan is signed off |

No additional persistence or MCP code until the integrator signs off on the open items.

### Issues that must be treated before implementation (user, 2026-11-14)

**A. Study cards inherit the review status, visibly.**
- **Change:** `StudyNote` carries `needsReview` from `Note.needsReview` (`study.ts`). Quiz and flashcard cards show
  the same "Needs review" mark as their source card.
- **Effect on scores:** answers on such cards are stored with `underReview: true`, and the concept is capped at
  `learning`.
- **Effect on MCP:** the tool reports `reviewStatus` and `verified: false`.
- **Acceptance:**
  - `study.test.ts`: `needsReview` is carried through.
  - An `interactions.test.tsx` render test: the mark is visible on both card kinds.
  - The Phase 3 e2e: a flagged card's quiz shows the mark after a reload.

**B. Flashcards need a real recall signal before their answers count towards mastery.**
- **Change:** after the reveal, the card shows "Got it" and "Missed it" self-grade buttons, and only a self-grade
  records an answer. Flipping a card records nothing, and an ungraded card contributes nothing.
- **Weighting:** self-grades count at half weight, against a quiz answer's objective right or wrong.
- **Weak rule:** a concept with only flashcard evidence can't be marked `mastered`; it can be `weak`.
- **Acceptance:**
  - Flip-only records nothing.
  - One grade per reveal.
  - "Try again" doesn't double-count.

**C. Deleting a workspace or source cleans up device-local data.**
- **Change:** `deleteWorkspace` removes `study.<ws>*`. Deleting a content source removes its study shard and its
  `sourceReview:<sourceId>@*` keys. That second part is an existing leak, fixed in the same change.
- **Owner:** the integrator, who owns the delete paths.
- **Acceptance:**
  - A memory-repo test: after each delete, no key with that prefix remains.
  - A regression test for the existing `sourceReview:` leak.

### Decisions and sign-off (2026-11-15)

**User decisions, 2026-11-15:**
- **Approved as recommended:** Q2, Q6, Q7, Q9 and Q11.
- **Accepted:** the architecture approved in principle earlier (Q1, Q3, Q5, Q8, Q10, Q12).
- **Authorized:** local Phases 1–3. **Phase 4 (MCP registration and exposure) stays blocked.**
- **Required acceptance areas:** issue A (visible Needs review), issue B (explicit flashcard self-grade) and issue C
  (deletion cleanup).
- **Safeguards:**
  - sharded storage with bounded writes and complete deletion cleanup;
  - review state only through the Notes model;
  - unverified attempts flagged, with the band capped at `learning`;
  - opaque, bounded MCP output with no source or unit ids;
  - no new card type or `AIMetadata` field in v1.

**Integrator sign-off (this session, confirmed by the user as integrator, 2026-11-15):**
- **Lane-owned files:** `src/ai/study/**`, `src/components/openui/notes/WeakConcepts.tsx` and
  `e2e/local/notesStudy.local.spec.ts` belong to the Study lane.
- **OpenUI files:** Phase 3 edits `study.ts`, `hostContext.tsx`, `interactions.tsx` and `NotesView.tsx`. They are
  signed off, and land only after the OpenUI commit 1 and 2 patches are cut (`.ai/commit-prep/2026-11-15/`).
- **Integrator files** (cleanup for issue C): `deleteWorkspace` in `workspaces/hierarchy.ts` and the content-source
  delete path. Signed off.
- **Unchanged:** `domain/types.ts`, `contracts.ts`, `persistence/repositories/*`, `ai/changes/**`, `ai/reconcile/**`
  and the provenance guard allowlist.
- **Phase 4 files** (`mcp/**` registration and `McpReadServices`) are not signed off.

### Build status (2026-11-15) — what "proceed" covered

The user said to proceed. The open items above still block **persistence and MCP code**, so only work that needs
none of them was built: Phase 1's pure core and issue A. No store, no MCP tool, no attempt recording, no
`domain/types.ts` / `contracts.ts` / `persistence/**` change, no new guard exception.

| Item | Status | Where |
|---|---|---|
| Phase 1 — concept keys and remap (§1) | **Built** | `src/ai/study/concept.ts`, `concept.test.ts` (18 tests) |
| Phase 1 — mastery, weak rule, bands, ranking (§3) | **Built** | `src/ai/study/mastery.ts`, `mastery.test.ts` (10 tests) |
| Issue A — study cards show the review mark | **Built** | `study.ts` (`StudyNote.needsReview`, `studyNoteOf`), `NotesView.tsx` (`StudyCards`), tests in `study.test.ts` and `NotesView.test.tsx` |
| Issue B — flashcard self-grade | **Built** (later the same day). Rule: `bandOf` never gives `strong` without a fresh quiz answer. UI: "Got it" / "Missed it" only after the reveal and only when the host offers `recordStudy`; one grade per reveal; a flip records nothing; half weight (`k(flashcard) = 0.5`) | `mastery.ts`; `interactions.tsx`; tests in `interactions.test.tsx` (4 new, 19 total), `NotesView.test.tsx`, e2e |
| Phase 2 — store (§2, §4) | **Built** (2026-11-15). Sharded keys `study.<ws>` / `study.<ws>.<sourceId>` / `study.<ws>.local.<canvasId>`; bounds 20 / 500 / 2,000, retired first then least recently attempted (the concept just studied is never evicted); lenient reader; collision rule; lazy remap on load; `snapshotCardStatus`; `clearStudy`; flags bit0 unverified, bit1 stale | `src/ai/study/store.ts`, `store.test.ts` (19 tests) |
| Phase 3 — UI (§5, §7) | **Built** (2026-11-15). `NotesHost.recordStudy?` (optional: the static demo is unchanged); QuizCard records its first pick per mount, never "Try again"; Notes view wiring, badges ("Weak", "Source changed since you studied this", "Needs review"), the **Weak** toggle (`WeakConcepts.tsx`: ranked, own group for cards that need review, retired behind "Show retired (n)", local concepts without passages, passage chips, "Open in source", "Show citing cards", "Quiz me on these"). Attempts on cards under review are flagged unverified and capped at `learning` (issue A carried through) | `hostContext.tsx`, `interactions.tsx`, `NotesView.tsx`, `WeakConcepts.tsx`; `WeakConcepts.test.tsx` (8), `NotesView.test.tsx` (5 new, 19 total), `e2e/local/notesStudy.local.spec.ts` (3, passing) |
| Issue C — cleanup on workspace / source delete | **Built** (2026-11-15). `deleteWorkspace` calls `clearStudy` (index-enumerated shards, then the index). Deleting a source goes through `deleteContentSource` (`src/ai/study/cleanup.ts`): the source and its `sourceReview:<id>@1…latestVersion` keys (the old leak) are deleted. **Its study history is kept and retired as `source_missing`** (option a, decided and changed 2026-11-15; see the review below). The app's only source-delete path, `__acuteDev.deleteContentSource`, calls it | `hierarchy.ts`, `cleanup.ts`, `store.ts` (`retireStudySource`), `ExcalidrawCanvas.tsx` (one line); `cleanup.test.ts` (4, incl. the `sourceReview:` leak regression), `hierarchy.test.ts` (1 new, 11 total) |
| Phase 4 (MCP) | **Built and registered locally** (user authorization, 2026-11-15 evening, superseding the earlier block and the Q12 sequencing for local use only). Real ChatGPT exposure still follows the MCP launch gate: any `src/mcp/**` change needs a fresh isolated `-Verify` (the MCP integrator session runs it). See "Phase 4, as built" below | `src/mcp/tools/studyTools.ts` (+ `studyTools.test.ts`, 13); `readTools.ts` (name + one register call); `server.test.ts` (tool list); `store.ts` (card refs, revival); `NotesView.tsx` (passes `objectId`); `cardRefs.test.ts` (4), `restoration.test.ts` (3), `citationParityEnabled.test.ts` (2) |

**Phase 1, as built:**
- **Keys:**
  - counter-sorted and de-duplicated;
  - hashed above 16 units (cyrb53, base 36);
  - taken from all of a note's cites;
  - local when the note has no source or no cites.
- **Remap:** reads the lineage exactly as `citations.ts` `indexLineage` / `decide` does.
  - An ambiguous unit is found through `candidates`.
  - A unit with no entry in a valid lineage counts as removed.
  - A concept retires only when all its units are gone.
  - A missing or mismatched step, or an empty lineage, is `needs_review` (`lineage_gap`).
  - Chains stop at the first ambiguity or gap and keep the old key and version.
- **Tests:**
  - every §1 row on fixture 10 through the real splitter and matcher;
  - multi-step chains;
  - **parity with `planCitationUpdate`** on one step: keep↔kept, resend↔source_changed, review↔needs_review,
    recheck↔narrowed (same surviving units), remove↔retired;
  - regressions for both `remapRecord` divergences.
- **Mastery:** exactly §3. A card under review, a `needs_review` concept, or an attempt flagged unverified caps the
  band at `learning`. The cap never hides `weak`.
- **Provenance guard:** green with no allow-list change; `src/ai/study/**` names no guarded field.

### Review, 2026-11-15 (after Phase 1) — a requirement before persistence, and one conflict to decide

**Accepted provisionally:**
- concept identity and lineage, and mastery and ranking;
- issue A as built (the mark sits outside the card, and its test is where the behaviour is rendered);
- issue B's invariant.

The review was written against the Phase 1 report. It doesn't yet cover Phases 2–3 or issue C, which were built the
same day under the sign-off above.

**New requirement:** the study store supports **concept-key migration and orphan handling**.
- When a source passage changes, splits, merges or disappears, history must never attach silently to an unrelated
  concept.
- Prior history is kept, and active, needs-review and retired concepts are told apart.
- **Deletion cleanup must not erase audit history unexpectedly.**
- The future `get_weak_concepts` tool stays read-only, inside the existing canvas authorization boundary.

**Checked against what is built** (a reading of the plan and the build table, not a code review; the Study lane
should confirm):

| Requirement | As built |
|---|---|
| Migration through lineage, never onto an unrelated concept | Met by design: the lazy remap on load (`remapConcept`, citation-update parity); split, merge and overlap are links only (§4); history is never copied or summed |
| Orphans: a card deleted, its passages still there | Met by design (§4): the concept stays, "no card teaches this now" |
| Active / needs-review / retired kept apart, history kept | Met: `state` + `reason` per concept; retired concepts kept and hidden behind "Show retired (n)" |
| **Deletion must not erase audit history unexpectedly** | ~~Conflict with issue C as built~~ **Resolved, option (a), 2026-11-15:** a source delete retires its concepts and keeps their history. Only an explicit workspace delete or "Clear study history" erases it |

**Decision needed (user / integrator):** issue C ("deletion cleans up device-local data") and this requirement pull in
opposite directions for a **source** delete. Options:

| Option | What it means |
|---|---|
| **(a) Recommended** | On a source delete, keep the shard and mark its concepts `retired / source_missing` (the §1 row that already exists); evict it later by the normal bounds, or with "Clear study history". On a workspace delete, keep clearing everything (an explicit, expected wipe). |
| (b) | Keep issue C as built, and say so in the delete confirmation ("study history for this source is also deleted"). |
| (c) | Keep a small tombstone (concept keys, last attempt, state) and drop the attempts. |

Either way the `sourceReview:` leak fix stays.

**Decided (user, 2026-11-15): option (a). Built the same day.**
- `deleteContentSource` (`cleanup.ts`) still deletes the source, its versions and every `sourceReview:<id>@v` key.
  Instead of deleting the study shard, it calls `retireStudySource` (`store.ts`): every concept of the shard becomes
  `retired / source_missing`, its attempts stay, and the shard and its index entry stay.
- Workspace delete and "Clear study history" (`clearStudy`) still wipe everything, a deleted source's retired history included.
- `clearStudySource` remains as a store function but nothing calls it on a source delete.
- Tests: `cleanup.test.ts` now asserts the history is kept and retired, with its attempt, and that `clearStudy` still
  removes it. The `sourceReview:` leak regression is unchanged.
- **Where it shows:** the Weak view lists retired concepts behind "Show retired (n)" for the shards it loads: the
  canvas's sources and the sources its cards cite. If no card on the canvas cites the deleted source any more, the
  history is kept but not listed there. A workspace-wide history view is not in v1.

With this, every requirement row of this review is met.

### Decisions and Phase 4, 2026-11-15 (evening)

**User decisions:**
- **Phase 4:** build and register `get_weak_concepts` locally. MCP stays off in production, and there is no real ChatGPT exposure (the launch gate still applies).
- **Passages (Q10):** none in v1. There is no `contentSources` access in `McpReadServices` and no opt-in setting; the tool returns card URIs.
- **Study integrator:** this session ("Intelligent UPDATE APPROACH") owns the Study lane, including Phase 4. Edits to shared MCP files are coordinated with the MCP integrator session (canvas-notes-39), which owns the bridge, write tools and the `-Verify` gate.
- **Workspace-wide retired-history view:** not in v1. Deferred to Phase 5.

**Phase 4, as built** (contract as §6, with these **Δ**):
- **Read-only:** the tool's deps type exposes only `meta.get`. It reads `study.<workspaceId>` and the shards that index lists, for the connection's own workspace only. A test wraps `set`/`delete` to record calls and runs six argument sets: nothing is written. Unknown arguments (`record`, `clear`, `workspaceId`) are ignored.
- **Canvas authorization boundary:** a `canvasId` of another workspace is "Canvas not found". Every card is checked with `WorkspaceScan.canvas` and the live scene, so cards on another workspace's canvas, or deleted ones, are dropped. A connection for the other workspace sees only its own history.
- **Δ card references:** stored concepts didn't say which card teaches them, and MCP can't read citations without a new provenance reader, which §7 forbids. So the Notes view now passes `objectId` with each answer and each Study snapshot. The concept keeps `cards` (≤ 3 `{objectId, canvasId}`, most recent first). A snapshot of a canvas drops refs on that canvas that now teach another concept or are gone. Canvas scoping uses these refs. Concepts with no live card are listed only in the workspace scope, with `cards: []`.
- **Δ inputs and outputs:** `allCanvases` asks for the whole workspace even when a canvas is open. `counts.needsReviewHidden` is added. `caution` carries §7.5's line. There is no `passages` field.
- **Δ `reviewStatus`:** the tool can't read sources, so `unknown` means: no snapshot, or the snapshot's version is older than the concept's stored (remapped) source version. `verified` is always `false`.
- **Bounds:** default 10, max 25 (a larger `limit` is refused), ~20k characters, then `truncated`.
- **Never returned (tested):** source ids, unit ids, concept keys (`handle` = `sc_` + cyrb53), local and retired concepts, and other workspaces' data.

**Handoff from canvas-notes-39** (`study-mode-handoff-2026-11-15.md`, received 2026-11-15). Its 10 deviations are
accepted as recorded there. Open items:
- **`deleteWorkspace` left content sources and their `sourceReview:` keys behind.** **Fixed:** it now deletes each
  canvas's sources through `deleteContentSource` before `clearStudy`. New test in `hierarchy.test.ts`.
- **"Clear study history":** **Built** (user: proceed, 2026-11-15).
  - **Δ placement:** it lives at the bottom of Study → Weak, not in Settings. The only Settings surface is the AI
    settings dialog, which exists only when the AI feature is on, while Study history exists without AI. The Weak view
    is also the Study lane's own file.
  - **Behaviour:** confirmed with `window.confirm`; it calls `clearStudy` for the workspace (retired history included)
    and never touches cards. The button shows only when there is history.
  - **Files:** `WeakConcepts.tsx` (optional `clearHistory` prop), `NotesView.tsx` (`clearStudyHistory`). Unit test in
    `WeakConcepts.test.tsx`; e2e below.
- **e2e "regenerate a section, history kept":** **Built.** `notesStudy.local.spec.ts` now has 5 tests, passing on two
  runs in a row (local dev server, mock distiller, no AI):
  - An "Update from new content" changes another sentence of the Limits section. The update replaces that section's
    other cards (the spec asserts the review bar reports changes, and resolves conflicts with "Keep mine"). The studied
    "500 entries" card keeps its history: still Weak, and listed in Weak after a reload.
  - "Clear study history" empties Weak, and it stays empty after a reload.
  - **Not covered end to end:** a card whose own passage changes, regenerated at v2. Through the app, the mock
    distiller pairs that card with another one (a conflict), and the update flow was being changed by another session
    at the time, so the run wasn't reproducible. The Study side (same key, history follows, stale) is covered at store
    level by `citationParityEnabled.test.ts`.

**Accepted provisionally (user, 2026-11-15, wrap-up):**
- "Clear study history" stays in Study → Weak; no Settings duplicate.
- The two passing browser runs and the clean unit, typecheck and lint results are accepted.
- **Integration verification gap, not a blocker:** the changed-card browser case. Once the update-engine changes
  stabilise, verify in the app that regenerating a studied card whose own passage changed keeps its history and marks it
  "Source changed since you studied this".
- Workspace-wide retired-history browsing: deferred (not v1).
- **MCP:** no real ChatGPT access until canvas-notes-39's launch-gate `-Verify` passes and the user authorises exposure.
- No commits requested. No further Study scope.

**Citation parity with the switch on (R2):** `citationParityEnabled.test.ts` turns `CITATION_UPDATE_CONFIG.enabled` on for that file only, without the per-call override. It applies each card's decision as the update would (new cites at v2, or unchanged for `review`), then checks that the card's concept key is where the stored history was remapped. Covered: keep, resend, recheck (narrowed, `carriedFrom`), review and remove (retired). **Passes; no divergence.** `ai/reconcile/**` is unchanged.

**Source restoration:**
- **Import** (`restoreSources`) always mints new source ids. A restored source's cards get new concept keys and start empty, and the deleted source's retired history stays under its old key (tested).
- **Same id:** no app path does this today. Loading leaves the concept retired (no silent re-attach). Studying it again starts it fresh: the old attempts are kept but marked stale and never counted, `state`, `reason` and `related` are cleared, and the units and version come from the card. **Before this fix,** an answer on a retired concept was appended to hidden history that could never show as weak.

**One difference from the issue A acceptance list:** it asked for an `interactions.test.tsx` render test. The mark is
drawn by the host outside the card (§7.1, so no card prop changes), so the render test is in `NotesView.test.tsx`
instead: the real flashcard and quiz cards, with the mark on the flagged card and not on the other. The Phase 3 e2e
(the mark after a reload) comes with Phase 3.

## 9. Phasing, tests and gates

**Gate 0 (nothing built before it):** this plan and the ownership review are approved, and Q1–Q12 are answered. Per the design, the slice also
waits for the P0 items: the meaning-check comparison, the real ChatGPT MCP run and the verified-pinning contract.

| Phase | Builds | Offline tests (vitest unless noted; no AI calls, no paid runs) | Exit |
|---|---|---|---|
| 1 Pure core | `concept.ts`, `mastery.ts` | Key determinism and sort; every §1 row through real `splitUnits`/`matchVersions` on `src/ai/reconcile/__fixtures__/update-series/v1.md→v2.md`; multi-step chains; a lineage gap leads to `needs_review`; **parity** with `planCitationUpdate` (keep↔kept, resend↔source_changed, review↔needs_review, recheck↔narrowed, remove↔retired); regressions for `remapRecord`'s two divergences; mastery table tests with a fixed `now`; weak rule edge cases (1 attempt, stale-only, retired) | green; `tsc`, eslint clean |
| 2 Store | `store.ts` over `MetaRepository` | memory repo: record/read round trip, lenient reader on garbage, bounds and eviction order, serialised writes, collision rule (§4), `clearStudy`; the existing IndexedDB/SQLite conformance suites stay untouched | green |
| 3 UI | host capability, card reporting, self-grade, review marks, Weak view | `interactions.test.tsx` (records once per mount, not on "Try again", nothing without a host); `study.test.ts` (`needsReview` carried); `notesModel`-level test that open-review notes get marks; `e2e/local/notesStudy.local.spec.ts` (answer, reload, still weak; regenerate a section by local-tier Visualize, history kept; no AI) | the design's acceptance: results survive reload, and the weak list can be reproduced |
| 4 MCP | `studyTools.ts` and registration (after Q8–Q10) | modelled on `tools.test.ts`: read-only annotations, bounds and `truncated`, no local/retired concepts, no source or unit ids, `verified:false`, `unknown` for stale snapshots, passages refused without the opt-in, scope isolation (`isolation.test.ts` style), nothing written to `meta` | green, then one real ChatGPT check **only with the user's explicit approval** |
| 5 Deferred | SR scheduler, export opt-in, sync (SM-Q2: stays device-local), canvas card type, overlap merging | — | separate approval |

**Update-engine dependencies:**
- Phases 1–3 need none. They consume lineage and `Note.cites`, which exist today, and touch no `ai/router/**`,
  `src/search/**`, `ai/changes/**` or `ai/reconcile/**` file (Stage 5 frozen files are safe).
- **Re-verify** the Phase 1 parity tests when `CITATION_UPDATE_CONFIG` goes on (R2). That's when cards' cites start narrowing in place.
- Stage 1 `patch_block` and 1e keep object and cites, so concepts don't change. Stage 2 Node Router inserts unanchored text without changing cites
  (the concept stays keyed on cites; router-created cards with no cites are local concepts). Stage 3 duplicates share a concept.
- Stage 5b's item-level index ("keyed by the existing unit keys") could later suggest `overlaps`. That's not needed for v1.
- Phase 4 also follows OpenUI's Phase 5 gate in spirit, but it doesn't need the Node Router: it retrieves stored concepts, not related content.
