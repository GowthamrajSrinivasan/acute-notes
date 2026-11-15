# Shared-contract review: ChangeSet and provenance (2026-11-15)

Status: **for integrator sign-off** · Read-only review · Unblocks (or not) [openui-integration-plan](./openui-integration-plan.md) §2 line 160,
"Shared contracts: ChangeSet and provenance not yet reviewed by the integrator."

Scope: the `ChangeSet` contract (`src/ai/changes/**`, `components/canvas/changeSetWriter.ts`, `components/ai/acceptPending.ts`) and the
provenance contract (`AIMetadata`, `ContentSourceVersion`, `domain/provenance.ts`, `ai/content/sources.ts`, the guard test), judged
against what OpenUI Phase 4 (knowledge evolution) and Phase 5 (agent integration) would build on.

Method: code read on the working tree of 2026-11-15 (uncommitted changes included, line numbers are as of that tree). No source,
test, e2e or evaluation file was edited. Nothing sealed was opened. One command run:

```
npx vitest run src/ai/changes src/domain/provenanceGuard.test.ts src/domain/provenance.test.ts \
  src/components/openui/notes/promote.test.ts src/components/openui/notes/promoteFlow.test.ts src/ai/content src/ai/study
→ 41 files, 400 passed, 6 expected fail (the removeRevertBaseline.test.ts it.fails marks)
```

Anything not backed by a test or a direct code read is marked **UNVERIFIED**.

---

## 0. Verdict

**The contracts can be marked as reviewed with conditions. They should not be signed off as-is for Phase 4–5.**

- **Stable enough to build on:** the envelope, the create kinds, the `update_block`/`update_shape` stale-target protection, and the
  `patch_block` conditional contract. The same goes for the pending store, the commit journal, and the provenance normalizer and guard.
- **Three issues block Phase 4–5 directly:**
  1. `remove`/`restore` have no baseline. These are the open deferred defects.
  2. `excludeFromReconciliation` means two different things: "promoted/passage card" and "locked". Unlocking a promoted card hands it
     to source reconciliation, which then proposes deleting it (§5 R2).
  3. Card identity (`stableNodeKey`) is still moving. Fix B is uncommitted and switched off, and the promoted cards' keys are not
     unique.
- **Phase 4 change-kind recommendation (a decision for you):** add **no new `ProposedChange` kind** for the write itself. Reuse
  `create_block` (new canonical card) and `patch_block` (merge an insight into an existing card). Add a **set-level `promotion`
  record** and a **new provenance tracking mode**, to replace the overloaded opt-out. Details in §3.

---

## 1. Inventory

### 1.1 Change kinds (`ProposedChange`, `changeSet.ts:44-209`; schema `:515-605`)

Legend: **Baseline** = an Accept-time check against the live target. **Accept** = what `resolveChangeSet` (`changeSet.ts:860-899`)
does with it. **Undo** = what Ctrl+Z after Accept restores. **Reload** = what happens when a pending MCP set comes back from
`pendingPersistence.ts`.

| Kind | Fields (beyond `kind`) | Baseline | Accept validation | Undo | Persists across reload |
|---|---|---|---|---|---|
| `create_block` | key, blockType, content, box, frame?, fontSize?, textAlign?, backgroundColor?, plainTitle?, stableNodeKey?, sourceRefs?, semantics? | n/a | Always kept (`:878`) | Element removed (one step) | MCP sets only, re-parsed (`pendingPersistence.ts:61`) |
| `create_shape` | key, shape, label?, backgroundColor?, box, stableNodeKey?, sourceRefs?, semantics?, project?, lensKey?, backdrop? | n/a | kept | one step | as above |
| `create_page` | key, title, content, box, stableNodeKey?, sourceRefs? | n/a | kept | Preview element removed. The page document stays (`createPage` is outside the scene). **UNVERIFIED** whether the page is listed afterwards | as above |
| `create_frame` | key, title, box, children, overview?, diagram?, profile?, level? | n/a | kept. Skipped by the writer if every child failed (`changeSetWriter.ts:250`) | one step | as above |
| `update_frame` | target, add[], section?, name? | **No** (rename is checked only at proposal time, by `mapSection.ts`) | dropped if the frame is deleted | one step | as above |
| `connect` | key, from, to, label?, relation?, routing?, explanation?, confidence? | n/a | dropped if an `existing` end is gone (`:879`) | one step | as above |
| `move` | target, to, frame? | **No** | dropped if deleted | one step | as above |
| `update_block` | target, content, title?, stableNodeKey?, sourceRefs?, userWording?, **expectedFingerprint?** | **Yes**. Set by the producer (MCP `writeTools.ts:400-410`) or stamped by `PendingChanges` (`pendingChanges.ts:76-80`, `staleTarget.ts:46-60`) | `baselineHolds` → write. Otherwise `staleConflict` → Keep mine / Use proposed follow-up (`staleTarget.ts:103-161`, `acceptPending.ts:156-160`) | The element is re-pointed to a **new** document, so undo restores the old one (`changeSetWriter.ts:400-414`) | Yes. Legacy sets get `UNKNOWN_BASELINE` (`staleTarget.ts:77-87`) |
| `patch_block` | target, **expectedFingerprint (required)**, edits[≤50], stableNodeKey?, sourceRefs?, onEditedCard? | **Yes** (`claimPatch.ts:73-77`) | `resolvePatch` → becomes an `update_block` (`changeSet.ts:881-885, 902-912`), or is **dropped whole** (`patch_rejected`). In a plain set: no Keep mine / Use proposed | as `update_block` | Yes (a required field, so never legacy) |
| `update_shape` | target, label, **stableNodeKey (required)**, sourceRefs?, expectedFingerprint? | **Yes** (`changeSet.ts:891-895`) | as `update_block` in a plain set. In a **merged/parts** set the stale change is **dropped** as `target_changed` (`parts.ts:160-162`) | one step | Yes, legacy-marked |
| `update_node` | target, semantics (NodePatch) | **No** | dropped if deleted. Last writer wins per field | one step | as above |
| `set_lens` | target, level?, expandsTo? | **No** | dropped if deleted | one step | as above |
| `remove` | target | **No** | dropped only if already deleted. The writer deletes it unconditionally, plus its label and the source's own arrows (`changeSetWriter.ts:446-455`). **It also deletes an emptied Acute frame that the review never lists** (`:537-544`) | one step | as above. **Not** covered by `markLegacyBaselines` |
| `rebaseline` | target, stableNodeKey | n/a (metadata) | kept | **Blocks/pages: the document's metadata is updated in place (`changeSetWriter.ts:466-467`). It is not part of the canvas history, so it is likely NOT undone (UNVERIFIED by test).** Shapes: one step | as above |
| `mark_review` | target, stableNodeKey, review | n/a (metadata) | kept | **The same in-place document write for blocks/pages (`:438-441`), likely not undone (UNVERIFIED)** | as above |
| `restore` | target, element (snapshot ≤200k chars) | **No** at Accept. Proposal-time check is version-only (`agentState.ts` `planRevert`, per the audit) | **never dropped**, even when the target is gone (`changeSet.ts:877-879`) | one step | as above |
| `update_connection` | target, relation?, label?, explanation? | **No** | dropped if deleted | one step | as above |
| `group_objects` | key, title, targets[] | Partial: members that are framed, deleted or turned into frames/arrows are skipped at write (`changeSetWriter.ts:509`) | dropped if no member is live | one step | as above. **Not in `touches()`** (`pendingChanges.ts:57-62`) |

**Set-level fields that carry provenance into the write:**

- `metadata` is normalized at parse (`changeSet.ts:814-816`).
- `contentSource`, `split` and `passage` are mutually exclusive (`:809`). They decide the link that `metadataFor` stamps
  (`changeSetWriter.ts:130-146`).
- `knowledge.cards[stableNodeKey]` supplies `sourceUnits` and `review` (`knowledgeOf`, `changeSet.ts:308-312`).
- `parts[].contentSource` gives each part of a merged set its own version (`parts.ts:152`).
- `session`, `agent`, `reason`, `args` and `reverts` are attribution, recorded in the agent log.

**Undo granularity, all producers:**

| Path | Steps |
|---|---|
| Plain Accept (`accept.ts:59`), auto-accept, promotion (`promote.ts:19` → `commitSetOnCanvas`) | One canvas step |
| Merged sets (`acceptParts`) | One step per Accept call |
| Stale-target follow-up | A second Accept, so a second step with a `.rN` operation id (`staleTarget.ts:120-144`) |

These are **outside** the canvas undo step:

- the content-source version (`acceptPending.ts:183-193`, the known F39 gap);
- source outcomes (`saveSourceOutcomes`);
- the commit journal, the agent log, routing signals and the `sync_session` report;
- in-place metadata writes on blocks and pages (`rebaseline`, `mark_review`, and the user actions `patchAI` / `setCardLocked`,
  `reconcileActions.ts:35-86`).

### 1.2 Provenance fields

`AIMetadata` (`domain/types.ts:71-126`) is stored on the document record for blocks and pages, and on `customData.acuteMeta` for
shapes, arrows and frames (`provenance.ts:199-208`).

| Field group | Fields | Written by | Read by | Guard rule |
|---|---|---|---|---|
| Descriptive | createdBy, task, provider, authType, model, operationId, template, visualPlanNodeId, sourceRefs | `parseChangeSet` → `metadataFor` (`changeSetWriter.ts:123-146`). MCP sets `createdBy:"mcp"`, `task`=tool name and `provider`=client name (`writeTools.ts:249-252`) | `provenanceOf` / `describeProvenance` / `objectsFromOperation` / `evidenceOriginOf` (`provenance.ts`); MCP context (`currentContext.ts:147-154`); Properties panel | Guard 1: **nobody branches on `createdBy`** outside `provenance.ts`. Guard 2: object provenance is read only by the 9 listed readers (`provenanceGuard.test.ts:22-32`) |
| Reconciliation link | contentSourceId, contentSourceVersion, stableNodeKey, contentFingerprint, excludeFromReconciliation, splitOf/splitFingerprint | The writer on create/update from a source, split or passage (`changeSetWriter.ts:131-146, 152-153`); `rebaseline` (`:456-469`); user actions (`reconcileActions.ts`) | `reconciliationOf` (`provenance.ts:171-187`): `ai/reconcile/**` (whole dir exempt), `knowledgeObjects.ts`, `reconcileActions.ts`, the dev hook in `ExcalidrawCanvas.tsx:528-535`; `lensIdentityOf` for Lens | Guard 3: the field names appear only in `ai/reconcile/**` + 37 listed files (`:87-128`). `normalizeAIMetadata` drops them unless `{reconciliation:true}` (`provenance.ts:76-118`), **so MCP, export and search never see them** |
| Knowledge Notes | sourceUnits, review, noteModel | `knowledgeOf` at write; `setCardReview` (`reconcileActions.ts:102-104`); `mark_review` | `knowledgeObjects.ts` → Notes view (`notesModel.ts`), review UI, Study (through Notes, keyed by `conceptKey(sourceId, units)`, `study/concept.ts:48`) | as above |
| Update policy | userWording | Writer: set on merged patch / Keep mine, cleared on AI wording (`changeSetWriter.ts:155-159`) | classify / update policy | as above |
| Lens identity | stableNodeKey via `lensIdentityOf` | — | `domain/lens/identity.ts` only (`provenanceGuard.test.ts:134-138`) | Guard 4 |

`ContentSourceVersion` (`types.ts:152-178`) is device-local and append-only. It is written only on Accept (`sources.ts:31-55,
118-146`), with `units`/`lineage` computed by `matchVersions`, which keeps ids for matched units (`sourceUnits.ts:242-251, 366-367`).

**Consumers checked against the allowlist:**

- `src/ai/openui/**` reads no object metadata. Passages come through `host.unitText`.
- `src/ai/study/**` reads no object metadata. `concept.ts:28` says so, and the grep confirms it.
- `components/openui/notes/notesModel.ts` and `promotion.ts` are allowlisted (`provenanceGuard.test.ts:120-123`).
- No OpenUI or Study reader sits outside the allowlist. One blind spot in the guard itself (§5 R6).

---

## 2. Stability: what is settled, what is moving

| Area | State | Evidence | Safe for Phase 4–5 to build on? |
|---|---|---|---|
| Envelope, `parseChangeSet`, create kinds, `connect`, `resolveChangeSet` transaction | Settled | 400 tests green; unchanged by current work | **Yes** |
| `update_block` / `update_shape` stale-target protection | Settled 2026-11-15 | `staleTarget.test.ts`; restricted gate verified 21:41 IST (lanes file row 164) | **Yes** |
| `patch_block` conditional contract | Gate closed 2026-11-15 | engine plan §4 Stage 1 gate note | **Yes**, but note that **Stage 5d will extend `ClaimEdit`** with append / insert-after / table-row anchors (engine plan §4 Stage 5, §13.5). Expect additive changes to the edit schema |
| `remove` / `restore` baselines | **Open, deferred** | `removeRevertBaseline.test.ts` (6 `it.fails`, run today: still failing as expected); `e2e/local/mcpRemoveRevert.local.spec.ts` (6 `test.fail`); lanes row 165 items 1–3 | **No.** The `Baselined` union (`staleTarget.ts:32`), `ConflictItem` decisions ("Delete anyway"), `LEGACY_KINDS` (`:77`) and possibly `planRevert`'s signature will change |
| Card identity in regenerated distil sections | **Moving, uncommitted** | `reconcile/update.ts` diff: **Fix A** `updateNoteModel` (the update's note model now comes from the canvas, not the dev setting) and **Fix B** `cardMatch.ts` (citation-aware rekeying), behind `CITATION_MATCH_CONFIG.enabled = false` (`cardMatch.ts:33`). `updateOwnPassage.test.ts` +120 lines | **No** for anything keyed on `stableNodeKey` of distil cards. **Yes** for anything keyed on `(sourceId, units)` (Study already is) |
| Citation-driven updates (`mark_review`, `move.frame`) | Built, **switched off** until R2 | `CITATION_UPDATE_CONFIG.enabled` false | Treat `mark_review` as a dormant path: correct by test, not exercised live |
| Stage 2 routing (Node Router, `suggest_placement`, `placeContent`) | Built; "implementation complete, verification pending" | engine plan §10 "first calibrations… tune against real canvases"; 5f locate set has 4 label differences waiting for the user (lanes row "Stage 5f") | Its **outputs** are ordinary `create_block` / `patch_block` sets, so the contract side is fine. Its **choices** (where content goes) are not yet verified |
| Stage 4 consistency (4f) | OFF | §12.29–12.30 | Not a contract dependency |
| Provenance normalize and guard | Settled | guard tests pass | **Yes**, with the R6 blind spot |
| Pending persistence | Settled, no schema version | `pendingPersistence.ts` | Yes, with R7 |

**Re-check of the openui-plan gate (§2).** Stage 1 live-verified is **met**: the integrator closed it on 2026-11-15. Stage 2 shipped is
**built, but verification is pending**. On the plan's own terms, Phase 5's "retrieve related concepts" still waits on the routing
verification. Phase 4 does not need routing to start, once R1–R3 are settled.

---

## 3. Phase 4 fit: can promote and source tracking use the existing kinds?

What Phase 4 needs, from the plan's bullets:

- **(a)** promote an insight into a canonical note;
- **(b)** track source changes on it;
- **(c)** keep version history and provenance;
- **(d)** connect decisions, comments and review status.

### 3.1 What exists today

Promotion today is one `create_block` with `passage` and `knowledge` (`promotion.ts:37-65`), committed directly as one undo step
(`promote.ts:17-24`). The card carries:

- `createdBy:"ai"`, `task:"generate_openui_notes"` and `operationId`;
- `contentSourceId` / `contentSourceVersion` (the passage link);
- `stableNodeKey = "openui § <note key>"` (`:42`);
- `contentFingerprint`;
- `sourceUnits`, `review?` and `noteModel:"distil"`;
- **`excludeFromReconciliation: true`** (`changeSetWriter.ts:141`).

So **(a) works**, but **(b) is deliberately switched off**. The card is opted out, which is exactly why Phase 2 was clear of the
update engine.

### 3.2 Options

| Option | What | Pros | Cons |
|---|---|---|---|
| **A. Existing kinds only** | Promote = `create_block`+`passage` (as now). Re-promote or merge into an existing canonical card = `patch_block` (claim-level) or `update_block`. Tracking = clear `excludeFromReconciliation` | No contract change. `patch_block` and `update_block` are already baselined and reviewed. Stage 2 `placeContent` and Stage 5d already use `patch_block` for "add this fact to that card" | **Unsafe as is.** A card without the opt-out joins source reconciliation, which matches by `stableNodeKey` (`classify.ts:6-8`). `"openui § gN"` is never in the source's plan, so the next update proposes **`remove`** (`classify.ts:162-166`), and `remove` has no baseline (R1). If tracking is turned on instead, an `update_clean` **rewrites** the canonical card from the source. Neither is "track": the user wants to be told, not to have the card rewritten |
| **B. New kind** (e.g. `promote_card {from, target?, expectedFingerprint, insight}`) | One reviewed op that both creates/merges and stamps canonical provenance | Explicit semantics and its own review row. Can carry a baseline from day one | It duplicates `create_block` + `patch_block` writer paths, and every consumer (summaries, review UI, MCP, agent log, `touches()`, persistence) must learn it. The engine plan's rule is "new kinds only when an existing one can't express it" (§3) — and the *write* is expressible |
| **C. Hybrid (recommended)** | Writes stay `create_block` / `patch_block`. Add (1) a set-level `promotion` record next to `passage`: `{ sourceId, version, units, generationId, insightKey }`; (2) a provenance **tracking mode** that replaces the overloaded boolean: `tracking: "managed" \| "excluded" \| "canonical"`. Reconciliation treats `canonical` as "never remove, never rewrite; on a cited-unit change, propose `mark_review` (`source changed`)". That is the citation-update outcome Lane G already built (`citations.ts` `review`/`recheck`) | Reuses the baselined writes and the review UI. "Track source changes" becomes the existing `mark_review` path, with no new writer branch. It separates "locked" from "promoted". The canonical card's history is the content-source versions plus its review marks | Needs an `AIMetadata` change, which is a user decision (§6 D2). Reconciliation needs one new branch (canonical: never `remove`/`update_*`, only `mark_review`). It depends on the citation-update path, which is off until R2 |

**Why not `patch_block` alone for "promote"?** It needs an existing target and a baseline, and it was built for source
reconciliation, as the openui plan §4 warns. It is the right tool for **merging an insight into an existing canonical card**, but not
for creating one. Its stale outcome is also "dropped and reported" with no Keep mine / Use proposed (`changeSet.ts:884`, audit A15).
For a user-initiated merge that should become a decision, like `update_block`'s, before Phase 4 relies on it.

### 3.3 Provenance a promoted (canonical) card must carry

| Field | Today | Needed for Phase 4 |
|---|---|---|
| `createdBy`, `task`, `operationId`, `model`/`provider` | yes (`model`/`provider` absent for Pin: the generation's model isn't stamped) | Stamp the generating model and provider. Descriptive only, no contract change |
| `contentSourceId` / `contentSourceVersion` | yes (passage) | yes |
| `sourceUnits` at that version | yes | yes (Study's concept key depends on it) |
| `contentFingerprint` (baseline) | yes | yes |
| `stableNodeKey` | `"openui § gN"`, **not unique across generations** | Must be unique per canvas, e.g. `openui § <generationId> § gN` (R3) |
| `noteModel`, `review` | yes | yes. Note that the meaning check has not run on Pin (openui plan Phase 2 "Open") |
| opt-out | `excludeFromReconciliation: true` | Replaced by `tracking: "canonical"` (C), so Lock stays a separate concept |
| promotion origin (generation id, insight key, optionally a Lang hash) | none | Needed to de-duplicate re-promotion and to trace an insight to its canonical card. The openui plan §4 says to "revisit if Phase 4 needs the Lang"; a hash is enough |

**Recommendation (a decision for the user, §6 D1/D2):**

- Choose **C**.
- Before Phase 4, fix R1 (`remove` baselines) and R3 (unique keys). Leave Fix B (R4) off for canonical cards: they are never
  regenerated, so citation matching does not apply to them.

---

## 4. Phase 5 fit: agent tools and kinds

The restricted remote profile (`remoteProfile.ts:28-67`) serves 22 reads and 12 write tools.

| Agent need (Phase 5) | Tool(s) | Change kinds | Baseline at Accept | In `restricted`? | Verdict today |
|---|---|---|---|---|---|
| Read notes, related objects, placement | search_workspace, get_block, get_related_objects, **suggest_placement** (Stage 2, read-only), get_consistency | — | — | yes | **Safe**. But the MCP context serializes provenance through `normalizeAIMetadata`'s default, which **hides sourceUnits, contentSourceId and review** (`currentContext.ts:147-154`, `provenance.ts:76-118`). "Retrieve related concepts **and sources**" therefore needs a guard decision (§6 D4) |
| Study weak concepts | get_weak_concepts | — | — | **excluded** (`remoteProfile.ts:87`) | Local only, by user decision |
| Add a note | create_block / create_page / create_table / create_todo / render_visual_plan | `create_*`, `create_frame`, reflow `move` | n/a (move: no) | yes | **Safe** (reviewed). Reflow moves are position-only |
| Explicit knowledge update to a card | **update_block** | `update_block` (whole content) | **yes** | yes | **Safe for overwrite protection**. But (a) the card keeps its previous provenance, so the agent's edit is indistinguishable from the user's at object level (`changeSetWriter.ts:148-153`, `writeTools.ts:404`); (b) it replaces the whole content, so the user's wording is lost if they choose Use proposed |
| Claim-level knowledge update | — (no MCP tool emits `patch_block` remotely; `import_content` is local only) | `patch_block` | yes | no | **Not available.** It is the right kind for Phase 5, but its stale case drops instead of asking (A15) |
| Link / regroup | create_connection, group_blocks, move_object | `connect`, `group_objects`, `move` | no (`group_objects` partial) | yes | Acceptable (metadata, position, membership) |
| Project knowledge (decisions, progress) | record_decision, update_knowledge, update_progress, sync_session | `create_shape`, `update_frame{add}`, **`update_node`** | **no** | **full only** | **Not safe**: last writer wins per field (audit A8) |
| Delete / revert | delete_object, delete_connection, revert_agent_changes | **`remove`, `restore`** | **no** | **full only** | **Not safe** (R1) |
| Edit relation / Lens | update_connection, link_lens_detail | `update_connection`, `set_lens` | no | full only | Low risk, not baselined |
| Traceability | agent log (`recordAccepted`), `session`/`agent`/`reason`/`args` on the set | — | — | — | **Partial**: per set, not per object. `objectsFromOperation` (`provenance.ts:269-280`) finds only objects an operation *created*, never ones it *updated* |

**Phase 5 minimum before "explicit knowledge updates through controlled tools":**

1. A remote-safe claim-level tool on `patch_block`, with a stale decision instead of a drop.
2. Object-level "last modified by" traceability, or an explicit decision that the agent log is enough (§6 D5).
3. R1 fixed before any `remove`/`restore` tool goes remote.

---

## 5. Contract gaps and risks (ranked)

| # | Risk | Where | Failure scenario | Proposed fix | Severity |
|---|---|---|---|---|---|
| **R1** | `remove` and `restore` carry no baseline and are not re-checked at Accept; `planRevert` sees only element versions | `changeSet.ts:877-880`; `changeSetWriter.ts:446-455, 525-536`; `staleTarget.ts:32, 77`; audit A2–A4 | **Phase 5:** an agent proposes `delete_object`; the user edits the block while reviewing; Accept deletes the edit. **Phase 4 (option A):** an update proposes `remove` for an un-opted-out canonical card the user has rewritten | Land deferred defects 1–3 (lanes row 165): widen `Baselined` to `remove`/`restore`, stamp in `withBaselines`, add a Keep mine / Delete anyway decision, and **add `remove`/`restore` to `LEGACY_KINDS`** (`staleTarget.ts:77`), or a persisted pre-fix `remove` gets a *post-reload* fingerprint stamped and loses its protection. Un-mark the 6 + 6 tests | **High** |
| **R2** | `excludeFromReconciliation` means both "promoted/passage card" and "locked" | `changeSetWriter.ts:141`; `reconcileActions.ts:68-86` (Unlock writes `excludeFromReconciliation: undefined`); `classify.ts:145-166` | The user pins a note, Locks it, then Unlocks it. The card is now reconciliation-managed with key `openui § g3`, which the source plan never has. The next "Update from new content" proposes **removing** it, and R1 means that removal has no baseline. The same holds for Source-tab "Add to canvas" passage cards. Proposed, not silent, but a trap. **UNVERIFIED by test**: the Lock control's visibility on passage cards was not checked | Short term: Unlock restores the pre-lock opt-out for passage/promoted cards (store `lockedFrom`), or classify never proposes `remove` for a `passage`-origin card. Long term: the `tracking` mode in §3 option C (§6 D2) | **High for Phase 4** |
| **R3** | Promoted cards' `stableNodeKey` is not unique | `promotion.ts:42` (`openui § ${note.key}`; keys are `g1…gN` per generation) | Two generations of the same source each pin their `g1`. Both cards get the same key and both are opted out, so nothing breaks today. Once either is tracked (R2 or Phase 4), `byKey` (`classify.ts:129`) keeps one; the other falls through to `remove`. `knowledge.cards` collides too if both are pinned in one set | Key = `openui § <generationId> § <note key>`, or the operation id. Add a uniqueness test | **Medium–High** (latent) |
| **R4** | Card identity still moving for distil sections | `update.ts` diff (Fix A `updateNoteModel`, Fix B `applyCardMatching`); `cardMatch.ts:33` | Phase 4 keys "the canonical card behind insight X" on a distil card's `stableNodeKey`. Fix B, once on, transfers or regenerates keys by citation, and the link silently points elsewhere | Phase 4 keys on `(sourceId, cited units)` like Study does, plus its own unique promotion key (R3), never on regenerated `stableNodeKey`s. Re-review once Fix B is committed and its activation is decided | **Medium** |
| **R5** | Version history is inconsistent with undo | `acceptPending.ts:183-193` (source version recorded outside undo: F39, `pending-work-master-plan.md:144`); `changeSetWriter.ts:438-441, 466-467` (`mark_review`/`rebaseline` on blocks write the document store in place); `update_block` leaves the old document orphaned (`feature-map.md:229`) | The user accepts an update, then Undoes it. The canvas is back at vN, but the source says vN+1, the "source changed" amber review stays, and a Keep mine baseline stays moved. Phase 4's "preserve version history" would surface vN+1 history for content the user rejected | Decide F39 (§6 D3). For blocks, route `mark_review`/`rebaseline` through a re-pointed document like `update_block`, or record the metadata write in the history transaction. Add an undo test for each (none exists: no undo test under `components/canvas/`) | **Medium** |
| **R6** | The guard does not see readers that go through `reconciliationOf(` | `provenanceGuard.test.ts:35, 87-88` (regexes match field names, `metadata.ai` and `provenanceOf(`, but not `reconciliationOf(` / `connectorSourceOf(`); `ExcalidrawCanvas.tsx:528-535` calls `reconciliationOf` while its allowlist reason (`:110`) only mentions `setNoteModel` | A new Phase 4/5 module calls `reconciliationOf(el).sourceUnits`, which the regex catches, or passes the whole link onward (e.g. to an MCP serializer), which it does not. Reconciliation fields then reach MCP or OpenUI without review | Add `reconciliationOf\(\|connectorSourceOf\(` to `PROVENANCE_READ` (or a fourth suite with its own allowlist). Update the `ExcalidrawCanvas.tsx` reason to name the dev `reconciliation()` hook | **Medium** (Phase 5 exposes provenance) |
| **R7** | Pending persistence has no schema version, and restore failures are silent | `pendingPersistence.ts:25-29, 58-66` | A contract change (R1's new required field, a Phase 4 field) makes a stored MCP proposal fail `parseChangeSet`. It is dropped in `catch {}` and the agent's proposal vanishes after a reload with no notice. A field that becomes required-for-safety but stays optional is restored without it | Add `v` to `StoredProposal`; count and report dropped restores in the agent log (`recordSettled(..., "expired")`); keep `markLegacyBaselines` in step with `Baselined` (R1) | **Low–Medium** |
| **R8** | Agent edits are not traceable on the object | `changeSetWriter.ts:148-153` (no source → `previous ?? {}`); `writeTools.ts:404` | An MCP `update_block` on a Visualize card keeps the old provenance and baseline, so the next update treats the agent's text as the user's wording (merge-into, never revert). "View changes" (`objectsFromOperation`) does not list it, and only the agent log knows | §6 D5: a `lastModifiedBy {createdBy, operationId, agent}` descriptive field, or accept "agent log only" explicitly | **Medium for Phase 5** |
| **R9** | Overwrite kinds without a baseline (other than R1) | `update_node`, `set_lens`, `update_connection`, `move`, `update_frame{name}` (`changeSet.ts:876-896`); audit A5–A9, A12 | Last writer wins on decision status, Lens links and arrow labels | Per-field before-values checked at Accept (the audit's suggestion for `update_node`). Keep them full-only until then | **Medium** (already gated by profile) |
| **R10** | Duplicated validators that can drift | `CardReview`: zod `changeSet.ts:501-506` vs `provenance.ts:132-147`. Unit id: zod `unitId = string(1..20)` (`changeSet.ts:608`) vs `UNIT_ID = /^u\d{1,9}$/` (`provenance.ts:122`). `SourceRef`: zod `changeSet.ts:429` drops `lastSyncedAt` (`types.ts:63`). `ContentSourceRecord` (`changeSet.ts:335-353`) vs `ContentSourceVersion` (`types.ts:152-178`). Link tuples `passage`/`SplitRecord` vs `ReconciliationLink` | A producer cites `U3` or `u3a`: the set accepts it, the writer stamps it, and the read path silently drops it, leaving an uncited card. The OpenUI path filters against known units today (`notesTask.ts:157`), so this is latent. A `sourceRefs.lastSyncedAt` sent through a set is stripped | One schema module for `CardReview`, `UnitId` and `SourceRef` used by both. Derive `ContentSourceRecord` from `ContentSourceVersion` with `Pick`/`Omit` (+ `origin`/`tier`/`template`). Integrator-owned files, so this is a proposal only | **Low** |
| **R11** | The contract's own header is stale | `changeSet.ts:7-9`: "It can only add… There is no delete or overwrite operation" | A Phase 4/5 author trusts the header and assumes Accept can't destroy content | Rewrite the header: list the overwrite and remove kinds, and point to `staleTarget.ts` | **Low** (documentation, but on the contract) |
| **R12** | `sourceUnits` may outlive the version they belong to | `changeSetWriter.ts:133-144` (`...previous` then `knowledgeOf`, which returns `{}` for a card not in `knowledge.cards`); `rebaseline` advances `contentSourceVersion` but keeps `sourceUnits` (`:461-467`) | After Keep mine, the card says version N+1 but cites units only valid at N. `matchVersions` keeps ids for matched units, so the risk is limited to units `removed`/re-id'd as `ambiguous`. **UNVERIFIED** (no test found) | A test: rebaseline across a version where a cited unit is `ambiguous`. Either re-map through the lineage or flag `review` | **Low** |
| **R13** | `touches()` ignores `group_objects` targets; `update_shape` stale in parts is dropped, not asked | `pendingChanges.ts:57-62`; `parts.ts:160-162` | Two sessions group the same objects (the second is skipped harmlessly); a repo-map relabel on an edited shape is dropped with a report | Fold into the R1 work if convenient; not Phase 4/5 blocking | **Low** |

**Checked and not a problem:**

- OpenUI (`src/ai/openui/**`) and Study (`src/ai/study/**`) read no object metadata. Every Notes/Study read goes through
  `knowledgeObjects.ts` → `notesModel.ts`, both allowlisted.
- Remote sessions can never auto-accept (audit §0).
- Promotion is one undo step (`promote.ts`, `promoteFlow.test.ts` green).

---

## 6. Proposed sign-off checklist

The integrator may mark **"Shared contracts: reviewed"** when every item under "Needs a fix" that is marked *(gate)* is done and every
item under "Needs a user decision" has an answer. The rest can follow Phase 4 start.

### Met now

| # | Condition | Evidence |
|---|---|---|
| M1 | Envelope, create kinds and `parseChangeSet` are total and bounded | 400 tests pass (command above) |
| M2 | `update_block` / `update_shape`: baseline at proposal, re-check at Accept, Keep mine / Use proposed, legacy proposals ask | `staleTarget.ts`, `staleTarget.test.ts`; restricted gate verified 2026-11-15 |
| M3 | `patch_block` conditional contract (rules 1–5) | Stage 1 gate closed 2026-11-15 |
| M4 | One Accept = one canvas undo step for scene changes, including promotion | `accept.ts:59`, `parts.ts:169`, `promote.ts:19` |
| M5 | Provenance is normalized at every read; reconciliation fields are hidden from MCP, export and search by default | `provenance.ts:76-118`; guard tests pass |
| M6 | OpenUI and Study code read no metadata outside the allowlist | grep of `src/ai/openui`, `src/ai/study`; guard green |
| M7 | The restricted remote profile excludes every un-baselined overwrite or removal | `remoteProfile.ts:54-80` |

### Needs a fix

| # | Fix | Owner | Gate? |
|---|---|---|---|
| F1 | R1: baselines + Accept re-check for `remove`/`restore`; content-aware `planRevert`; empty-frame removal itemised; extend `LEGACY_KINDS`; un-mark the 12 tests | Integrator (deferred defects 1–3) | **gate** |
| F2 | R2: Unlock must not hand a passage/promoted card to reconciliation (short-term fix) | Integrator (`reconcileActions.ts` is `components/canvas`, check ownership) | **gate** |
| F3 | R3: unique promotion keys + test | OpenUI lane (`promotion.ts`) | **gate** |
| F4 | R6: guard covers `reconciliationOf(` / `connectorSourceOf(`; fix the `ExcalidrawCanvas.tsx` reason | Integrator (`provenanceGuard.test.ts`) | **gate** (before Phase 5 exposes anything) |
| F5 | R11: correct the `changeSet.ts` header | Integrator | gate (trivial) |
| F6 | R5: undo tests for `mark_review`/`rebaseline` on blocks; fix or document | Integrator / engine lane | before Phase 4 "version history" |
| F7 | R7: `StoredProposal.v` + report dropped restores | Integrator | before Phase 5 |
| F8 | R10: shared schemas for `CardReview`/`UnitId`/`SourceRef`; derive `ContentSourceRecord` | Integrator | no |
| F9 | Re-review `update.ts`/`cardMatch.ts` (Fix A/B) once committed; confirm Fix B's off-switch leaves keys positional | Integrator | before Phase 4 relies on distil keys |

### Needs a user decision

| # | Decision | Recommendation |
|---|---|---|
| D1 | Phase 4: new change kind, or existing kinds? | **Option C**: no new kind for the write; set-level `promotion` record (§3.2) |
| D2 | Replace `excludeFromReconciliation` (as used for promoted cards) with a tracking mode (`managed`/`excluded`/`canonical`) in `AIMetadata` | Yes. Canonical cards get `mark_review` on source change, and are never removed or rewritten. Needs approval: `AIMetadata` + `normalizeAIMetadata` + guard |
| D3 | F39: should Undo of an accepted update roll back the content-source version? | Yes before Phase 4 "version history". Otherwise document it as by design in the Phase 4 spec |
| D4 | Phase 5: expose citations and source passages (reconciliation fields) to MCP? | Only through a new, allowlisted serializer (cited unit ids + passage text, read-only). Never by turning on `{reconciliation:true}` in `currentContext.ts` |
| D5 | Agent-edit traceability: object-level `lastModifiedBy`, or agent log only? | Object-level descriptive field (never branched on, per F25) |
| D6 | A remote claim-level update tool (`patch_block`), and its stale UX | Add it with a Keep mine / Use proposed decision (not drop) before remote exposure |
| D7 | Run the meaning check before Pin (openui plan Phase 2 "Open") | Yes for canonical promotion: a canonical card should not be unchecked AI wording |
| D8 | Fix B activation, and whether Phase 4 may key on distil `stableNodeKey`s | Keep Phase 4 on `(sourceId, units)` + its own promotion key; activation is independent |

---

## 7. Files read

**Plans and audits:** `.ai/docs/openui-integration-plan.md`, `intelligent-update-engine-plan.md` (§0–§4, §10),
`knowledge-notes-lanes.md`, `mcp-write-surface-audit-2026-11-15.md`.

**ChangeSet contract:**

- `src/ai/changes/`: `changeSet.ts`, `claimPatch.ts` (contract part), `accept.ts`, `parts.ts`, `staleTarget.ts`,
  `pendingChanges.ts`, `pendingPersistence.ts`, `removeRevertBaseline.test.ts` (header and setup).
- `src/components/canvas/changeSetWriter.ts`, `src/components/ai/acceptPending.ts`.

**Provenance contract:**

- `src/domain/types.ts`, `provenance.ts`, `provenanceGuard.test.ts`; `src/ai/content/sources.ts`.
- `src/ai/reconcile/classify.ts` (matching), `cardMatch.ts` (header), `update.ts` (uncommitted diff, ignoring line endings).
- `src/components/canvas/reconcileActions.ts`.

**Consumers:**

- `src/components/openui/notes/promotion.ts`, `promote.ts`; grep of `src/ai/openui`, `src/ai/study`, `NotesView.tsx`.
- `src/mcp/tools/writeTools.ts`, `remoteProfile.ts`; `src/ai/openui/notesTask.ts` (cite filtering).

## Integrator follow-up (2026-11-15)

**Risk 2 fixed:** Lock and Unlock no longer clear a card's own opt-out.
- **Lock.** Locking an already opted-out card (passage or pinned, or "Don't update") records `customData.acuteLockKeepsOptOut`.
- **Unlock.** Unlocking keeps `excludeFromReconciliation`.
- **Preserve locked sections off.** The engine still treats such a card as excluded.
  - `optedOutBesidesLock` in `src/domain/canvas/lock.ts` is used by `existing.ts` and `impact.ts`.
  - `setCardLocked` in `reconcileActions.ts`.
- **No `AIMetadata` change:** the marker is element-level lock state, next to `acuteLocked`.
- **Test:** new in `updatePolicy.test.ts` ("a pinned or passage card that is then locked keeps its own opt-out…").
- **Results:**
  - `npx vitest run src/ai/reconcile src/domain src/components/canvas`: 638 passed, 4 todo, provenance guard included.
  - tsc: clean.
  - eslint: clean.

**The tracking-mode proposal stays a user decision.** It would replace the overloaded flag with
`managed`/`excluded`/`canonical`; this fix only removes today's defect.
