# Promotion contract proposal: promotion record and tracking modes (2026-11-15)

Status: **proposal, for integrator approval** · Design only · No code changed
Implements the design side of **User decision 4** in [openui-integration-plan](./openui-integration-plan.md) Phase 4. It answers the five
approval items that decision lists, and builds on [shared-contract-review-2026-11-15](./shared-contract-review-2026-11-15.md) §3 (option C), risks
R2–R5, and that review's integrator follow-up (the `acuteLockKeepsOptOut` fix).

> **User decision 4 (verbatim intent).** Approve the design of a separate promotion record and three tracking modes: `managed`,
> `excluded`, `canonical`. Do not add a new `ProposedChange` kind solely for promotion. Before implementing the `AIMetadata` change, the
> integrator approves: schema and migration behaviour; compatibility with `excludeFromReconciliation`; all affected provenance readers;
> reconciliation behaviour for each tracking mode; undo, reload and source-version update behaviour. Production activation is separate.

**Method.** Code read of the working tree on 2026-11-15, including uncommitted changes. Line numbers refer to that tree, and many lanes
are editing it, so re-check them at implementation time. I edited no source, test, e2e, script or evaluation file, and opened no sealed
set. One command was run to confirm the current behaviour:

```
npx vitest run src/domain/provenanceGuard.test.ts src/ai/reconcile/updatePolicy.test.ts \
  src/components/openui/notes/promote.test.ts src/components/openui/notes/promoteFlow.test.ts src/ai/reconcile/cardMatch.test.ts
→ 5 files, 54 passed
```

Claims that come from reading code, with no test behind them, are marked **(code read)**. Claims that are unverified are marked
**UNVERIFIED**.

---

## 0. Summary

| Item | Proposal |
|---|---|
| Write path | Unchanged. A promotion is one `create_block` committed as one undo step. **No new `ProposedChange` kind.** |
| Set-level record | `ChangeSet.promotion`, next to `passage`. It is mutually exclusive with `contentSource`, `split` and `passage`. |
| Object fields | `AIMetadata.trackingMode` and `AIMetadata.promotion`, both in the **reconciliation group**. They are dropped by the default `normalizeAIMetadata`, so MCP, search and a sources-free export never see them. |
| Mode when absent | Derived at read time from `excludeFromReconciliation`, the lock markers and the legacy key shape (§2). No write-time migration. |
| `excludeFromReconciliation` | **Kept and dual-written.** It is `true` whenever the mode is `excluded` or `canonical`, or the card is locked. The engine reads the mode, not the flag. Old builds and rollbacks still read the flag and stay safe. |
| `canonical` engine rule | Taken out of key matching before `classify`. It is **never** `update_*`, `patch_block`, `remove`, `rebaseline`, or an impact patch. A cited-unit change becomes `mark_review` ("source changed"). |
| Key | `promoted § <generationId> § <insightKey>`. `generationId` is a fresh random id per generation run. This replaces `openui § gN` (R3). |
| Activation | Two switches, both off. The producer writes today's metadata until `PROMOTION_TRACKING_CONFIG.enabled` is on. Readers accept the new fields regardless, and handle them safely. |

New defects found during this review (each is handled in §7):

| # | Finding | Evidence |
|---|---|---|
| N1 | **R2 is still reachable through "Allow AI updates".** A pinned or passage card that is excluded but not locked shows **Allow AI updates**. That control clears the opt-out. The card becomes managed with a key the plan never has, and the next update proposes `remove`. The lock fix covers Lock and Unlock only. | `ProvenanceSection.tsx:121-124, 196`; `reconcileActions.ts:98-100`; `classify.ts:162-166` (code read) |
| N2 | **A card locked before today's fix loses its own opt-out when "Preserve locked sections" is off.** A passage or pinned card locked before `acuteLockKeepsOptOut` existed carries `excludeFromReconciliation` and `acuteLocked`, but no marker. `optedOutBesidesLock` then says it is not excluded, so with Preserve off it is reconciled and proposed for `remove`. | `lock.ts:39-41`; `existing.ts:35`; `update.ts:351-352` (code read) |
| N3 | **Pinning a note can switch a preserve canvas's updates to distil.** Pinned and passage cards are stamped `noteModel: "distil"` (`promotion.ts:53`, `knowledgeActions.ts:126`). `sourceOrganisation` counts every linked object, excluded ones too. Every recorded version has units (`sources.ts:118-141`). So `updateNoteModel` returns `"distil"` for that source's next update. | `update.ts:487-500` (code read; no test) |
| N4 | **Splitting a pinned or passage card ("Visualize better") orphans the pieces.** The pieces get `splitOf = <pin key>` and no opt-out (`changeSetWriter.ts:140-141` stamps the opt-out only for `passage && !split`). The node is never in the plan, so `classify` removes them ("a split node the source no longer has"). | `split.ts:24-33`; `visualizeBetterAction.ts:50`; `classify.ts:27-33` (code read). UNVERIFIED whether the action is offered on a pinned card |
| N5 | **Lock on a block is only half undoable.** `setCardLocked` writes the document's `excludeFromReconciliation` in place (`:79`), and only the element change is a history step (`:80-90`). Undo of a Lock therefore leaves the card opted out. | `reconcileActions.ts:68-91` (code read) |
| N6 | **`passage` exclusivity is documented but not checked.** The doc comment says "never together with `contentSource` or `split`", but `parseChangeSet` checks only `split` against `contentSource`/`parts`. The writer silently drops the opt-out when both are present. | `changeSet.ts:236, 809`; `changeSetWriter.ts:130, 141` |
| N7 | **Passage-card keys collide too.** The key `passage § <unit>` repeats when the same unit is added twice, and unit ids carry over between versions. This is harmless while the cards are excluded. It would collide in `knowledge.cards` and `byKey` once tracked. | `knowledgeActions.ts:108`; `classify.ts:117-120` |

---

## 1. Schema

### 1.1 The tracking mode

**Proposal**

```ts
// src/domain/types.ts, AIMetadata, reconciliation group (after excludeFromReconciliation, :103)
/**
 * How "Update from new content" treats this object (openui Phase 4, decision 4). Absent: derived (§2), never trusted as stored
 * when it disagrees with the link. Read through reconciliationOf only.
 */
trackingMode?: "managed" | "excluded" | "canonical";
```

| Mode | Meaning | Who sets it |
|---|---|---|
| `managed` | The source owns the content. Updates may rewrite, patch, remove or `mark_review` it, as ordinary Visualize cards are today. | Implicit for every Visualize, update or split object. Never written explicitly by a producer (absent means managed). |
| `excluded` | Left alone. No update ever proposes anything for it, and its link is frozen at the version it was written at. | Passage cards (Add to canvas / Include), and pins while the flag is off. The user's "Don't update". |
| `canonical` | The user's note, *tracked*. Never rewritten and never removed. When a passage it cites changes, it gets a "source changed" review mark. | Pin to canvas with the flag on. The user's "Track source changes" on an excluded promoted card. |

**Where it lives: `AIMetadata` (the reconciliation group), not element `customData`.**

| | `AIMetadata` (chosen) | Element `customData` (rejected) |
|---|---|---|
| Next to the link it qualifies | Yes. It means nothing without `contentSourceId`/`stableNodeKey`, and `reconciliationOf` returns it with the link. | No. Provenance would be split across two stores for blocks (the document record versus the element). |
| Normalized and bounded | Yes. `normalizeAIMetadata` (`provenance.ts:76-118`) validates the enum. | No. `customData` keys are opaque, and nothing validates them. |
| Hidden from MCP, search and sources-free export | Yes, by default (`provenance.ts:91`; `exportOptions.ts:46-55` drops the whole link without sources). | No. `withoutSources` keeps `customData`, so a dangling mode would travel. |
| Guarded | Yes. `RECONCILIATION_FIELD` (`provenanceGuard.test.ts:87-88`) gets one more name. | It would need a new guard suite. |
| Undo | **Weaker for blocks:** a document-store write is outside canvas history (N5). Mitigated in §6.2 by re-pointing the document, as `update_block` does. | Comes free with the element's history step. |
| Redraw | Needs a `knowledgeUI.changed` nudge (that already happens). | Immediate. |

The lock stays in `customData` (`acuteLocked`, `acuteLockKeepsOptOut`). The lock is a **user's temporary hold** that a frame can also
hold, and it needs the icon redrawn. The mode is a **property of the object's relation to its source**. The two are orthogonal (§3).

**Default when absent.** The mode is derived by one pure function, `trackingModeOf(el, link)`, in `src/ai/reconcile/tracking.ts`
(inside `ai/reconcile/**`, so the guard exempts it). §2 has the table. A stored mode that is not one of the three values is
dropped by the normalizer and then derived.

### 1.2 The promotion record

**Set level.** This is the input to the writer. It sits next to `passage` (`changeSet.ts:238`):

```ts
/** A note promoted onto the canvas (openui Phase 4): one create_block linked to the source version its units belong to. */
promotion?: PromotionRecord;

export interface PromotionRecord {
  sourceId: string;                     // the ContentSource
  version: number;                      // the stored version the cited units belong to (the anchor)
  units: UnitId[];                      // cited units, 1..500, /^u\d{1,9}$/ (the read path's rule, provenance.ts:122)
  generationId: string;                 // newId("gen"), one per Generate run (generationStore.start)
  insightKey: string;                   // the note's key within that run ("g3"), 1..40
  key: string;                          // the stableNodeKey to stamp: must equal promotionKey(generationId, insightKey)
  mode: "excluded" | "canonical";       // never "managed": the key is never in the source's plan (§3)
  origin: "openui_notes";               // origin marker; an enum so "source_passage" / "agent" can be added later
  generatedBy?: { task: string; model?: string; provider?: string };  // the generation's own task and model, not the pin's
  generatedAt?: number;                 // when the generation run started
  promotedAt: number;                   // when the user pinned it
  insightHash?: string;                 // cyrb53 of the normalized title+body+cites, for re-promotion de-duplication (Q6)
}
```

**Persisted on the object.** These are the fields that are not already on the link:

| Object field | From | Notes |
|---|---|---|
| `contentSourceId`, `contentSourceVersion`, `sourceUnits` | `promotion.sourceId/version/units` | The existing link fields. The writer stamps them as it does for `passage` today. |
| `stableNodeKey` | `promotion.key` | Unique (§1.3). |
| `contentFingerprint` | the content | As today. |
| `noteModel: "distil"` | the set's metadata | As today. N3 is fixed on the read side (§5.4), not by dropping the stamp: the Notes view and Source tab need it (`knowledgeObjects.ts:40`). |
| `trackingMode` | `promotion.mode` | |
| `excludeFromReconciliation: true` | derived | Dual-write (§3). |
| `model`, `provider` (descriptive) | `promotion.generatedBy` | Descriptive group, shown in the Origin section. This closes the review's "model/provider absent for Pin" gap. |
| `promotion` | `{ generationId, insightKey, origin, version, promotedAt, generatedAt?, insightHash? }` | A new reconciliation-group field. `version` is the **immutable** anchor. `contentSourceVersion` may later move to the version the user acknowledged (§5.2). |

`task` stays `"generate_openui_notes"` and `createdBy` stays `"ai"`.

**Rejected alternatives**

| Alternative | Why rejected |
|---|---|
| A new kind, e.g. `promote_card` | Decision 4. The write is a `create_block`. A kind would duplicate the writer branch, and every consumer would have to learn it (review §3.2 B). |
| Reuse `passage` with optional extra fields | `passage` means "the user added a passage" and implies `excluded`. Overloading it repeats the R2 mistake one level up. |
| Store only on the object, with no set-level field | Then the writer would need the record from somewhere else. The set is the one validated input the writer has (`metadataFor`, `changeSetWriter.ts:131-146`). |
| Store the OpenUI Lang | The provisional decision (openui plan §4) stands. A hash (`insightHash`) is enough for de-duplication and tracing. |
| Put `generationId`/`insightKey` only in the key | Parsing keys is fragile, and `insightKey` is needed on its own for "Show on canvas" after a reload. |

### 1.3 The stable key (R3)

`promotionKey(generationId, insightKey) = "promoted § " + generationId + " § " + insightKey`, for example
`promoted § gen_4fQ… § g3`. It is at most 300 characters (`changeSet.ts:428`).

- **Unique:** `generationId` has 119 random bits (`ids.ts:4`). `insightKey` is unique within one run. Two generations can no longer
  share `openui § g1`.
- **Never confused with a plan key:** the engine takes promoted objects out of key matching *before* `classify` (§5.1). So even a plan
  node that happened to have the same key would be added as new, and nothing would be lost. `unitOfKey` gives `"promoted"`, which a
  scoped Re-visualize never selects (`existing.ts:86-89`, `update.ts:339-340`).
- **One live card per key:** `promoteNote` looks up a live object with the key first, and if one exists it offers **Show on canvas**
  instead of pinning a duplicate. Today this works only from the in-memory map (`generationStore.ts:28-29`), which a reload clears.
- **`IdPrefix`** gains `"gen"` (`ids.ts:12`).
- **Passage cards (N7)** are out of this proposal's scope. Recommended: `passage § <version> § <unit>` with the same live-key check.

### 1.4 Validation rules

**`parseChangeSet` (`changeSet.ts`, near `:809`)**

| Rule | Reason |
|---|---|
| `promotion` is not combined with `contentSource`, `split`, `passage` or `parts` | One link per set. This also closes N6 for `passage`. |
| `promotion.key === promotionKey(generationId, insightKey)` | The key cannot be forged into a plan key. |
| Exactly one `create_block` in `changes`, with `stableNodeKey === promotion.key`, and no `update_*`, `patch_block`, `remove`, `restore`, `rebaseline` or `mark_review` | A promotion only creates. |
| `promotion.mode ∈ {excluded, canonical}` | `managed` is never valid for a promoted object (§3). |
| `units` are unique, 1–500, and match `/^u\d{1,9}$/` | Uses the read path's rule, not the looser zod `unitId` (R10), so an uncited card cannot be written. |
| `knowledge.cards` may hold only `promotion.key`, and its `sourceUnits` must equal `promotion.units` | Avoids two sources of truth. |
| The zod schema: a strict `promotionSchema`. Malformed means the set is **refused**, not dropped by `.catch` | A canonical card with a broken record must not be written as something else. |

**`normalizeAIMetadata` (`provenance.ts:91-116`, only under `{ reconciliation: true }`)**

| Field | Rule |
|---|---|
| `trackingMode` | `oneOf(raw.trackingMode, ["managed","excluded","canonical"])`. Anything else is dropped. |
| `promotion` | An object with `generationId` (text ≤ 60), `insightKey` (text ≤ 40), `origin ∈ {"openui_notes"}`, `version` (positive integer), `promotedAt` (finite number), and optionally `generatedAt` and `insightHash` (text ≤ 40). Missing a required field drops the whole record. |
| Consistency | None at the normalizer: it validates shape, not semantics. `trackingModeOf` decides (for example, a `managed` mode on an object with a promotion record is read as `excluded`, §2). |

`ReconciliationLink` (`provenance.ts:150-164`) gains `trackingMode?` (as stored) and `promotion?`. `reconciliationOf` (`:171-187`) passes
them through.

---

## 2. Migration

**Read-time derivation, no write-time migration.** `trackingModeOf(el, link)` is pure and idempotent. It never writes. A stored mode
wins once it is present and consistent. Rules apply in order, and the first match decides:

| # | Object as stored | Detect | Derived mode | Lock |
|---|---|---|---|---|
| 1 | Has a `promotion` record | `link.promotion` | stored `trackingMode` if it is `excluded`/`canonical`, else **`excluded`** | as stored |
| 2 | Stored `trackingMode` (no record) | `link.trackingMode` | that value. But `managed` on a rule-3/4 key is read as `excluded` | as stored |
| 3 | **Pinned OpenUI card (legacy)** | `stableNodeKey` matches `^openui § ` (task `generate_openui_notes`) | **`excluded`**, whatever the lock state (fixes N2). Not auto-canonical (Q1) | as stored |
| 4 | **Passage card** | `stableNodeKey` matches `^passage § ` (task `include_passage`) | **`excluded`**, whatever the lock state (fixes N2) | as stored |
| 5 | Locked card **with** `acuteLockKeepsOptOut` | `isLocked && lockKeepsOptOut` | **`excluded`** (the opt-out is the card's own) | locked |
| 6 | Locked card **without** the marker | `isLocked && excludeFromReconciliation` | **`managed`** (the flag is the lock's) | locked |
| 7 | **"Don't update" card** (pre-lock F39 opt-out; the UI no longer sets it, only clears it: `ProvenanceSection.tsx:123`) | `excludeFromReconciliation && !isLocked` | **`excluded`** | — |
| 8 | **Ordinary Visualize, update or split card** | link present, none of the above | **`managed`** | — |
| 9 | **Legacy or partial metadata** (any of `contentSourceId`, `contentSourceVersion`, `stableNodeKey`, `contentFingerprint` missing) | `reconciliationOf` returns undefined (`provenance.ts:174`) | not linked: never reconciled, and the mode is irrelevant | — |
| 10 | Connectors | `connectorSourceOf` | not applicable (matched by their ends) | — |

Rules 3 and 4 are key-shape heuristics. They are safe because the keyers never produce `openui § ` or `passage § ` prefixes
(`keys.ts:6-11`: `<unit> § <key>`, where a unit is an analysis-unit or topic id). **UNVERIFIED:** a topic id literally named "openui"
or "passage". A test pins the derivation, and a Visualize source whose topic is named "passage" is the one edge case to check.

**Idempotence.** Derivation reads, never writes, so running it any number of times gives the same answer. When a writer later
rewrites an object's metadata, it spreads `previous` first (`changeSetWriter.ts:133`). A managed update never adds a mode, and a
promotion always writes one. No write ever changes a mode except the explicit user actions (§6.2).

**Optional lazy write.** None proposed. Writing the derived mode back would put unreviewed changes into users' documents.

**Export and import** (`portability/sanitize.ts:19-49`, `exportOptions.ts:46-55`, `workspaceBundle.ts:136-142, 367, 471`):

| Bundle | What happens | Change |
|---|---|---|
| Without sources (default) | `withoutSources` uses the default normalizer, so the whole link drops, `trackingMode` and `promotion` with it. The imported card is a plain AI card that is never reconciled. | None |
| With sources (§6.4) | `objectMetadataWithLinks` normalizes with `{reconciliation:true}`, so the mode and the record travel, and `contentSourceId` is remapped (`metadataLinkedTo`). | None in code; add a round-trip test |
| Bundle from an older build | No mode, so it is derived (rules 3–8) | None |
| Bundle from a newer build, read by an older one | The older normalizer drops the unknown fields. Dual-written `excludeFromReconciliation: true` keeps canonical and excluded cards out of reconciliation. | Dual-write (§3) |

**Cloud sync.** It is not built: `SyncProvider` ships only `LocalOnlySyncProvider` (`sync/SyncProvider.ts:15-24`). Content sources are
device-local (`types.ts:130-134`), so on another device the link points at a source that is not there, and nothing reconciles. The
new fields add nothing to this. Revisit when the cloud-sync plan wires `ContentSource` sync.

---

## 3. Compatibility with `excludeFromReconciliation`

**Proposal: keep the flag, dual-write it, and read the mode.**

- **Write:** `excludeFromReconciliation = (mode !== "managed") || locked`. This is exactly today's meaning of the flag, so older
  builds, rollbacks and any reader not yet migrated behave as they do now. `setCardLocked` keeps its current logic
  (`reconcileActions.ts:74-79`), with `keepsOptOut` computed from the **mode** (`mode !== "managed"`) instead of the flag.
- **Read:** the engine reads `trackingModeOf` plus the lock, and never the bare flag. That changes `existing.ts:35` and `impact.ts:118`.
  `mapSection.ts:57` (Repo Map) is left reading the flag while dual-write lasts, because repo-map objects are never promoted.
- **Retire:** not proposed now. Stop *reading* the flag once every reader uses the mode. Stop *writing* it at least one release after
  production activation (Q4).

Rejected:

- **Retire the flag immediately.** An older build or a rollback would then reconcile canonical cards as managed, which means removal.
- **Derive the flag on read only.** The legacy write sites (`setCardLocked`, `patchAI`) would still need changing, and older builds
  would get nothing from the stored data.

### 3.1 Truth table (engine behaviour per update)

`Preserve` is AI settings → Update behaviour → "Preserve locked sections" (`updatePolicy.ts:19`, default on). "Section" means the card
sits in a locked frame (`existing.ts:19, 29`).

| Mode | Lock (card or section) | Preserve | Classify / update / patch / remove | Impact (other sources' updates) | Canonical source-change mark | Counted in `skipped.locked` |
|---|---|---|---|---|---|---|
| managed | none | on/off | **normal** (today) | normal offers | — | no |
| managed | locked | **on** | **skipped** | not offered | — | if the source changed it (today) |
| managed | locked | **off** | **normal** (the lock is a marker only) | normal offers | — | no |
| excluded | none | on/off | **skipped** | **skipped** | — | no |
| excluded | locked | on | **skipped** | skipped | — | no (Q2b: today it can be counted, `update.ts:574-576`; proposed: count only managed) |
| excluded | locked | **off** | **skipped** (the card's own opt-out stands: the lock-fix invariant) | skipped | — | no |
| canonical | none | on/off | **never**: taken out before `classify` | **related only** (listed, never a patch offer) (Q3) | **yes**: `mark_review` on a cited-unit change | no |
| canonical | locked | **on** | never | not listed | **suppressed** (the lock means "leave alone") (Q2) | yes, when a cited unit changed |
| canonical | locked | **off** | never | related only | **yes** | no |

Invariants the tests must pin:

1. No row produces `update_block`, `patch_block`, `remove`, `rebaseline` or `restore` for an `excluded` or `canonical` object.
2. Lock and Unlock never change the mode. Unlock never makes a promoted card managed. This generalizes the integrator fix in
   `lock.ts:23-47` and keeps it: `optedOutBesidesLock(el, optedOut)` equals `mode !== "managed"` for every rule-5/6 object.
3. "Preserve off" never reaches an `excluded` or `canonical` object.

---

## 4. Provenance readers: inventory

Built from greps of `src/**` (tests and `testUtils` excluded unless noted) for `excludeFromReconciliation`, `reconciliationOf(`,
`connectorSourceOf(`, `optedOutBesidesLock`, `lockKeepsOptOut`, `existingObjects(`, `knowledgeObjectsOf(`, `.excluded`,
`metadata.ai`, `acuteMeta`, `provenanceOf(`, `normalizeAIMetadata(`, `normalizeObjectMetadata(`, `lensIdentityOf(`, `sourceRefsOf(`,
`evidenceOriginOf(`, plus `.passage`.

### 4.1 Readers and writers of the reconciliation link

| # | File:line | What it does | Change |
|---|---|---|---|
| 1 | `domain/types.ts:89-126` | declares `AIMetadata` | **add** `trackingMode`, `promotion` |
| 2 | `domain/provenance.ts:76-118` `normalizeAIMetadata` | normalizes | **add** both (reconciliation group only) |
| 3 | `domain/provenance.ts:150-187` `ReconciliationLink`, `reconciliationOf` | the engine's view | **add** pass-through |
| 4 | `domain/provenance.ts:194-197` `connectorSourceOf` | connector link | no change |
| 5 | `domain/provenance.ts:231-238, 309-319` `provenanceOf`, `describeProvenance` | Origin display (descriptive) | optional: `TASK_LABELS` gains `generate_openui_notes: "Pinned note"`, `include_passage: "Added from source"`. No behaviour |
| 6 | `domain/provenance.ts:264-266` `lensIdentityOf` | Lens identity | no change (the unique key helps) |
| 7 | `domain/canvas/lock.ts:23-47` | lock markers | no change. `trackingModeOf` uses `isLocked` / `lockKeepsOptOut` |
| 8 | **new** `ai/reconcile/tracking.ts` | `trackingModeOf`, `promotionKey`, `isPromotedKey` | **new** (inside `ai/reconcile/**`, exempt from the guard) |
| 9 | `ai/changes/changeSet.ts:225-238, 693-695, 805-816` | set fields, schema, `parseChangeSet` | **add** `promotion`, its schema and the §1.4 rules (**src/ai/changes, so `-Verify`**) |
| 10 | `ai/changes/changeSet.ts:307-312` `knowledgeOf` | per-card units | no change |
| 11 | `components/canvas/changeSetWriter.ts:129-146` `metadataFor` | stamps the link and the opt-out | **change**: `link` from `promotion`; stamp `trackingMode`, `promotion`, `model`/`provider`; dual-write the flag |
| 12 | `components/canvas/changeSetWriter.ts:148-153` `updatedMetadata` | MCP edit keeps `previous` | no change (keeps the mode) |
| 13 | `components/canvas/changeSetWriter.ts:436-445` `mark_review` | in-place document write | **change** (§6.2, R5): re-point the block or page document so Undo restores the review |
| 14 | `components/canvas/changeSetWriter.ts:446-455, 456-469` `remove`, `rebaseline` | | no change (never proposed for non-managed; invariant 1) |
| 15 | `components/canvas/reconcileActions.ts:57-62` `reconcileStatus` | Origin controls | **change**: return `{ mode, locked, promoted }` |
| 16 | `components/canvas/reconcileActions.ts:68-91` `setCardLocked` | Lock and Unlock | **change**: `keepsOptOut` from the mode; re-point the document for undo (N5) |
| 17 | `components/canvas/reconcileActions.ts:98-100` `setExcludedFromReconciliation` | "Allow AI updates" | **change** to `setTrackingMode(api, id, mode)`. It refuses `managed` for a promoted, passage or legacy-pin key (N1) and writes the mode plus the dual-written flag |
| 18 | `components/canvas/reconcileActions.ts:107-109` `setCardReview` | review resolution | **change** for canonical only: Keep or Edit also re-anchors (`contentSourceVersion` set to the checked version, cites remapped) (§5.2) |
| 19 | `components/canvas/reconcileActions.ts:131-145` `sourceEditTarget` | "Update source from this edit" | no change (a promoted key has no plan node, so it returns null) |
| 20 | `components/canvas/reconcileActions.ts:176-181` `choiceOptionOf` | G3 choices | no change |
| 21 | `components/properties/ProvenanceSection.tsx:118-126, 186-197` | toggle labels | **change**: per mode. Managed: Lock/Unlock. Excluded, not promoted: "Allow AI updates". Excluded, promoted: "Track source changes". Canonical: "Stop tracking". Never "Allow AI updates" on a promoted key |
| 22 | `ai/reconcile/existing.ts:17-51` `existingObjects` | the engine's object list | **change**: add `tracking`; `excluded = tracking !== "managed"` (the lock is still reported apart) |
| 23 | `ai/reconcile/existing.ts:76-89` `sourcesOf`, `sectionsOfObjects` | selection scope | no change |
| 24 | `ai/reconcile/classify.ts:39-71, 145-148, 162-166` | key matching | **type only**: `ExistingObject.tracking?`. The logic is unchanged: canonical objects never reach it, and excluded ones are skipped as today |
| 25 | `ai/reconcile/update.ts:263-266` | note model, `identity` | **change**: compute `identity` (units and lineage) whenever the source has a canonical card, not only for distil or citations |
| 26 | `ai/reconcile/update.ts:349-361` | lock and existing | **change**: partition canonical objects out; run the canonical pass; append its `mark_review`s to `extra` (`:368`) |
| 27 | `ai/reconcile/update.ts:487-500` `sourceOrganisation`, `updateNoteModel` | organisation | **change** (N3): ignore objects whose mode is not managed |
| 28 | `ai/reconcile/update.ts:571-589` `withoutLockedSections` | locked counts | **change**: count managed locked objects only (Q2b) and locked canonical cards whose units changed |
| 29 | `ai/reconcile/impact.ts:110-123` | impact scan | **change**: `excluded` skips; `canonical` can be `related` only, never `restates` |
| 30 | `ai/reconcile/mapSection.ts:47-58, 166` | Repo Map index | no change while dual-write lasts |
| 31 | `ai/reconcile/cardMatch.ts:258-289` | Fix B | no change. A promoted key is never a section card (`isCard`, `:258`), and canonical objects are excluded at `:283` |
| 32 | `ai/reconcile/citations.ts:161`, `citationUpdate.ts:139` | citation update | no change (excluded leads to `skip`) |
| 33 | **new** `ai/reconcile/canonical.ts` | the canonical pass | **new** (§5.2) |
| 34 | `ai/reconcile/split.ts:24-33` `splitLinkOf` | Visualize better | **change** (N4): return null for a non-managed object, so the split is not offered (the alternative is to carry the mode: Q12) |
| 35 | `components/review/knowledgeObjects.ts:35-55, 80-90` | Notes and Source-tab reader | **change**: expose `tracking` and `promoted` (for a badge and the "Show on canvas" lookup by key) |
| 36 | `components/review/knowledgeActions.ts:106-141` `addPassageCard` | passage producer | no change in this proposal (N7 deferred) |
| 37 | `components/review/knowledgeActions.ts:170-185` Keep, Edit | | **change** via #18 (canonical re-anchor) |
| 38 | `components/openui/notes/promotion.ts:37-65` | pin producer | **change**: build `promotion`, the unique key, the mode by flag |
| 39 | `components/openui/notes/promote.ts:17-24` | commit | **change**: look up a live key and show it instead of pinning a duplicate |
| 40 | `components/openui/notes/generationStore.ts:46-53` | runs | **change**: `generationId` and `generatedAt` per run (names no fields, so no guard entry) |
| 41 | `components/openui/notes/NotesView.tsx:211-212, 496` | pin button | **change**: pass `generationId`; read pins from the canvas by key after a reload |
| 42 | `components/openui/notes/notesModel.ts` | Notes reader | optional: show "Tracked" on canonical cards |
| 43 | `portability/sanitize.ts:19-49` | export and import | no change (a test only) |
| 44 | `portability/exportOptions.ts:46-55` | strip without sources | no change |
| 45 | `mcp/context/currentContext.ts:147-154` | MCP provenance | no change: the default normalizer hides both fields (test: they never appear). Phase 5 D4 decides any exposure |
| 46 | `mcp/tools/studyTools.ts`, `ai/study/**` | Study | no change (keyed on `(sourceId, units)`; a canonical card keeps its units) |
| 47 | `mcp/tools/writeTools.ts`, `objectTools.ts`, `ingestTools.ts`, `repoMap/service.ts` | MCP set builders | no change: none sets `promotion`. Add a test that no MCP tool's set carries one |
| 48 | `components/canvas/ExcalidrawCanvas.tsx:528-536` | dev `reconciliation()` hook | no change (returns the whole link, dev builds only) |
| 49 | `components/ai/ChangeSetReview.tsx:167, 680, 881` | `mark_review` rows | no change (the reason text comes from the change) |
| 50 | `components/review/{KnowledgeOverlay,KnowledgeReviewBar,chipView,queue}.ts(x)` | review UI | no change (given objects by #35) |
| 51 | `ai/ingest/{ingest.ts:71, targets.ts:29}`, `components/ai/{AIPanel.tsx:214,295,621, rearrangeAction.ts:44}` | `existingObjects` and `sourcesOf` callers | no change. Re-arrange moves canonical cards by position only, never their content (Q13 if that is unwanted) |
| 52 | `ai/changes/{pendingPersistence.ts, staleTarget.ts, unapplied.ts}` | | no change (§6.3) |
| 53 | `testUtils/reconcileHarness.ts`, `testUtils/repoMapWorld.ts` | test writers | **change** (harness): able to stamp a mode and a record |

**Counts:** 53 rows. **27 need a change** (2 of them new modules): rows 1–3, 8, 9, 11, 13, 15–18, 21, 22, 25–29, 33–35, 37–41 and 53. Of the rest,
23 need no change and 3 need only optional or type-level edits (rows 5, 24, 42).

### 4.2 Provenance-guard allowlist

Changes to `src/domain/provenanceGuard.test.ts`:

| Change | Reason |
|---|---|
| `RECONCILIATION_FIELD` (`:87-88`) gains `trackingMode`, plus the property-read form for `promotion`: `(?<=[\w)\]?])\.promotion\b\|\bpromotion\?:` (the same treatment as `review`, because "promotion" is an ordinary word) | The new fields must be inert outside the engine |
| `RECONCILIATION_READERS` gains `components/properties/ProvenanceSection.tsx`, **only if** it names `trackingMode`. Preferred: it reads `reconcileStatus(...).mode`, which does not match the regex, so no entry is needed | |
| `RECONCILIATION_READERS["components/openui/notes/promotion.ts"]` (`:122-123`): reason updated to "builds the set's promotion record and tracking mode" | It still names the fields |
| `RECONCILIATION_READERS["components/canvas/reconcileActions.ts"]` (`:98`): reason updated to "…and sets the tracking mode on the user's explicit action" | |
| `RECONCILIATION_READERS["components/review/knowledgeObjects.ts"]` (`:114-115`): reason gains "and its tracking mode, for the badge and Show on canvas" | |
| **R6 (still open):** `PROVENANCE_READ` (`:35`) gains `reconciliationOf\(\|connectorSourceOf\(` | A new reader could otherwise pass the whole link, now including `promotion`, to a serializer unseen. The current callers that would then need `READERS` entries: `ai/reconcile/**` (exempt it as in suite 3), `components/review/knowledgeObjects.ts`, `components/canvas/ExcalidrawCanvas.tsx` (fix its reason, `:110`) |
| **No** entry for `ai/reconcile/tracking.ts` or `canonical.ts` | `ai/reconcile/**` is exempt (`:89, 161`) |
| **No** entry for `generationStore.ts` or `NotesView.tsx` | They pass ids and never name the fields. If an implementation does name them, the guard fails, and that is correct |

---

## 5. Reconciliation per mode

### 5.1 Where the modes split in the pipeline

```
existingObjects (tracking, excluded = tracking !== managed, locked)
  ├─ canonical ──────────────► canonicalPass(previous units, next units, lineage)  →  mark_review[] → extra
  └─ managed + excluded ─────► (preserve? lock → excluded) → classify.reconcile → buildChangeSet
                                   excluded → plan.skipped (as today)
impact.ts (other sources' cards): managed → offers/related · excluded → skip · canonical → related only
cardMatch.ts (Fix B, distil, switch on/off): promoted keys are never section cards → untouched
```

### 5.2 What a source update does

| Cited passages (lineage, previous → next) | `managed` | `excluded` | `canonical` |
|---|---|---|---|
| all `unchanged` | `unchanged`, or an update if the plan node changed (key matching, as today) | skip | **nothing**. A resolved review stays resolved (`reviewAfterUpdate` rule, `citations.ts:221-226`) |
| some `changed` | `update_clean` / `patch_block` on an edited card / `update_conflict` (Stage 1e) | skip | **`mark_review`** "a passage this card cites changed in the source" (with the before→after text in the flag's evidence) |
| some `ambiguous` | as today (citation path: `review`) | skip | **`mark_review`** "source ambiguous" |
| some `removed` | as today (`recheck`) | skip | **`mark_review`** "a passage this card cites was removed" |
| all `removed` | `remove` (proposed) | skip | **`mark_review`** "every passage this card cites was removed". **Never `remove`** |
| moved topic | `move` (citation path) | skip | nothing (position is the user's) |
| key not in the next plan | `remove` (proposed) | skip | not applicable (taken out before matching) |
| cites an id the anchor version does not have (data drift) | — | skip | `mark_review` "can't check this card's passages", once (the flag text is stable, so it is never re-added) |

**Which versions the canonical pass compares.** It compares from the **card's anchor** (`contentSourceVersion`), not from the
update's previous version. It composes the stored lineages `anchor → … → latest` (each `ContentSourceVersion.lineage`,
`types.ts:175-176`) with the update's own `latest → next` (`nextIdentity`, `citationUpdate.ts:60`).

- This makes the pass idempotent and independent of F39: an undone update cannot swallow a change.
- The **anchor moves only when the user acknowledges a review.** Keep or Edit on a canonical card's "source changed" sets
  `contentSourceVersion` to the version the review was computed against, and remaps `sourceUnits` through the lineage (ambiguous ids
  stay as they are). `promotion.version` never moves.
- A broken chain (a version without units or lineage) leads to one "can't check" mark, never a silent pass.

Implementation: `canonical.ts` reuses `planCitationUpdate`'s `decide` with `excluded: false` and maps its actions:

| `decide` action | Canonical result |
|---|---|
| `keep` | none |
| `resend`, `conflict`, `review`, `recheck`, `remove` | `mark_review` with `reviewAfterUpdate` |
| `section` | the "can't check" mark |

There is no model call and no AI cost.

**Every update with a canonical card on the source computes `identity`.** Today `identity` is computed only for AI-tier distil or
citation runs (`update.ts:266`). Local-tier sources therefore gain one deterministic unit match per update. It costs no AI and is
already used on the Accept path (`sources.ts:118`).

### 5.3 Impact discovery (`impact.ts`) and Fix B (`cardMatch.ts`)

| Engine path | managed | excluded | canonical |
|---|---|---|---|
| `impact.ts` restates (a `patch_block` offer as a `ConflictItem`) | offered (as today) | **skipped** (as today, `:118`) | **never offered** |
| `impact.ts` related (listed, never edited) | listed | skipped | **listed** (Q3), unless locked with Preserve on |
| The source's own cards (`:116`) | skipped (as today) | skipped | skipped. The canonical pass handles them instead |
| `cardMatch.ts`, switch **off** | positional keys (as today) | untouched | untouched: no `mark_review` from Fix B |
| `cardMatch.ts`, switch **on** | rekeyed by citation; "kept" cards are marked | untouched (`:283`) | untouched. `isCard` (`:258`) never selects `promoted § …`, so a canonical card is never a rekey target and never a "kept" card, and the new cards' keys (`<section> § …`) can never take its key |

Required tests (§7): an update that regenerates the section a canonical card cites, run with Fix B **off** and **on**. In both runs
the canonical card is untouched apart from at most one `mark_review` from the canonical pass, and is never in `removals`.

### 5.4 N3 (note model) fix

`sourceOrganisation` and `updateNoteModel` (`update.ts:487-500`) consider only `managed` objects. A preserve canvas with a pinned
distil note then keeps updating as preserve. Promoted and passage cards still carry `noteModel: "distil"`, which the Notes view needs.

---

## 6. Undo, reload and source-version updates

### 6.1 Undo of a promotion

| Aspect | Behaviour | Evidence or change |
|---|---|---|
| Steps | **One canvas undo step per pin.** `promoteNote` → `commitSetOnCanvas` → `commitChangeSet` → one history step | `promote.ts:19`; `commitOnCanvas.ts:50-58`; `promoteFlow.test.ts` (green) |
| Undo removes | The element. The block's document stays in the store, orphaned, as for any created block | as today |
| Notes view after Undo | "Show on canvas" falls back to "Pin to canvas" | `NotesView.tsx:211-212` |
| Content-source version | **None recorded by a pin.** A pin set has no `contentSource`, so **F39 does not apply to promotion itself** | `acceptPending.ts:183-193` only runs for `set.contentSource`; pins don't even go through `acceptPending` |
| Redo | Brings back the element, pointing at the same document (mode and record intact) | |
| Commit journal | The pin's `operationId` is journalled, so a replay is a no-op | `commit.ts:172-174` |

### 6.2 Undo of the mode, lock and review writes (the R5/F6 family)

Today, blocks and pages keep `AIMetadata` on the document record. `patchAI`, `setCardLocked` and the writer's `mark_review` and
`rebaseline` update that record **in place**, outside canvas history (N5; review R5).

**Proposal.** For blocks and pages, these writes **re-point the element to a new document** carrying the new metadata, inside the same
history step as the element change. This is the technique `update_block` uses (`changeSetWriter.ts:400-404`). The writes covered:

- `setTrackingMode`
- `setCardLocked`
- the canonical re-anchor (#18)
- the writer's `mark_review` (#13)

Undo then restores the old pointer, and with it the old mode, lock flag or review. Shapes already get this from `customData`.

| Action | One undo step restores |
|---|---|
| Track source changes (excluded → canonical) | `excluded`, and the old key (the action rekeys a legacy `openui § gN` to `promoted § …`) |
| Stop tracking (canonical → excluded) | `canonical` |
| Lock / Unlock | lock flag + `excludeFromReconciliation` + `acuteLockKeepsOptOut` together (closes N5) |
| Keep / Edit on a canonical "source changed" | the review and the old anchor (`contentSourceVersion`, `sourceUnits`) |
| Accept of an update that marked canonical cards | the marks (with re-pointing). **F39 gap:** the content source stays at vN+1 (`acceptPending.ts:183-193`). Because the canonical pass compares from each card's own anchor (§5.2), the next update re-raises the same marks, so nothing is lost. Without re-pointing (today), the marks survive Undo, which is inconsistent with the canvas |

Decision D3 (roll back the source version on Undo) remains the user's and is **not required** by this contract. The anchor-based
comparison makes canonical tracking correct either way.

### 6.3 Reload and pending proposals

| What | Across a reload |
|---|---|
| Pinned canonical or excluded cards | Persisted: document plus element. The mode and record are re-read and derived. |
| The generation (`generationStore`) | In memory, so it is gone after a reload (as today). "Show on canvas" for an earlier pin is found by the **live key lookup** (`promoted § <gen> § gN`) whenever the same generation is open. A new generation has a new id, so de-duplication across generations needs `insightHash` (Q6). |
| An open update review with canonical marks (app session) | Memory-only, so it is lost, as every app-session review is today (`pendingPersistence.ts:73-75` mirrors only external sessions). The next update recomputes the marks deterministically. |
| MCP pending sets | Unaffected. No MCP tool emits `promotion`. An older stored set has no such field and parses as before. |
| `StoredProposal` schema version | **No bump required**: `promotion` is optional, and `trackingMode` is object metadata, not set data. R7's `v` field is still recommended before Phase 5, but it does not gate this. |
| `markLegacyBaselines` | No change: a promotion has no update kinds. |

### 6.4 What a new source version does to each mode

| Mode | Content | Link (`contentSourceVersion`, `sourceUnits`) | Review | Shown on canvas |
|---|---|---|---|---|
| managed | updated, patched, removed or kept per §5.2 (reviewed) | advanced to the new version on the objects written (as today) | as today | normal |
| excluded | never | **frozen** at the version it was written at | never touched | normal. The Source tab shows its passages at that version |
| canonical | never | frozen until the user acknowledges (then re-anchored) | `mark_review` when a cited passage changed since the anchor | amber chip until resolved (existing review UI) |

---

## 7. Changes in reviewable steps

The steps are in order. Each step is a separate review, and nothing is committed without the integrator's go-ahead. Legend:
**[AIM]** touches `AIMetadata`. **[CHG]** touches `src/ai/changes`, which the closed MCP gate fingerprints, so it needs a later
`scripts/chatgpt-mcp-session.ps1 -Verify` rerun (`:99` protects `src/ai/changes`, `src/mcp`, `src/app/api`, `src/proxy.ts` and
`src/config`). **[CFG]** touches `src/config`, which also needs `-Verify`. No step makes AI calls, and every listed e2e is local, with
no AI.

| Step | Scope | Files | Tests | Flags |
|---|---|---|---|---|
| **P0. Pre-fixes, no schema** | Unique pin key (R3); live-key de-duplication; `IdPrefix "gen"`; "Allow AI updates" never shown for a key matching `openui § `/`passage § ` (N1); `splitLinkOf` refuses opted-out objects (N4); `sourceOrganisation` ignores opted-out objects (N3) | `promotion.ts`, `promote.ts`, `generationStore.ts`, `NotesView.tsx`, `domain/ids.ts`, `ProvenanceSection.tsx`, `ai/reconcile/split.ts`, `ai/reconcile/update.ts` | unit: `promote.test.ts` (two generations give distinct keys; a second pin of a live key gives Show on canvas); `split.test` (a pinned card is not splittable); `updateOwnPassage`/`updatePolicy` test (a preserve source plus one pinned card still updates as preserve); a ProvenanceSection test (no Allow AI updates on a pin). Local e2e: extend `openuiNotesFlow.local.spec.ts` (pin, pin again, Undo) | none needed: defect fixes |
| **P1. Schema and normalizer** [AIM] | `AIMetadata.trackingMode` and `promotion`; `normalizeAIMetadata`; `ReconciliationLink`; guard regex and R6 | `domain/types.ts`, `domain/provenance.ts`, `domain/provenanceGuard.test.ts` | `provenance.test.ts` (accept, drop and bounds; hidden without `{reconciliation:true}`); guard green; `currentContext` test (fields never in MCP output); a `workspaceBundle` round trip with and without sources | inert: nothing writes them yet |
| **P2. Derivation** | `trackingModeOf`, `promotionKey`, `isPromotedKey`; `existingObjects.tracking`; `excluded` from the mode | `ai/reconcile/tracking.ts` (new), `existing.ts`, `classify.ts` (type), `testUtils/reconcileHarness.ts` | `tracking.test.ts`: every §2 row 1–10, including N2 (a legacy-locked pin with Preserve off stays excluded); the §3.1 truth table on `existingObjects` + `update` for managed and excluded; the existing `updatePolicy.test.ts` lock test unchanged and green | none: identical to today except N2 (a fix) |
| **P3. Set-level record and writer** [CHG] [AIM] | `ChangeSet.promotion`, its schema, the §1.4 rules (with N6); the writer stamps mode, record, `model`/`provider` and the dual-written flag | `ai/changes/changeSet.ts`, `components/canvas/changeSetWriter.ts` | `changeSet.test.ts` (each §1.4 rule refuses; `passage`+`contentSource` refused); a writer test (stamped fields; flag `true` for both modes; `managed` refused); `npx vitest run src/ai/changes` all green; **`-Verify` later** | inert: no producer sets `promotion` yet |
| **P4. Undo-safe metadata writes** (R5, N5) | Re-point the block or page document in `setCardLocked`, the new `setTrackingMode`, canonical re-anchor and the writer's `mark_review` | `reconcileActions.ts`, `changeSetWriter.ts` | unit: Undo after Lock restores the flag; Undo after Accept of a `mark_review` restores the review (the first undo tests under `components/canvas/`); local e2e: `studyChangedCard.local.spec.ts`-style Lock → Undo | none: a fix |
| **P5. Engine: canonical pass** | Partition canonical cards; `canonical.ts`; `identity` whenever a canonical card exists; `impact.ts` canonical related-only; `withoutLockedSections` counts | `ai/reconcile/canonical.ts` (new), `update.ts`, `impact.ts` | `canonical.test.ts` (each §5.2 row, the composed lineage, the broken chain, idempotence over two runs, a resolved review staying resolved); `updatePolicy.test.ts` (canonical rows of §3.1); `impact.test.ts` (canonical never a restates offer); `cardMatch.test.ts` + `updateOwnPassage.test.ts` with Fix B **on and off** (canonical untouched, never removed); a local-tier update with a canonical card | `PROMOTION_TRACKING_CONFIG.enabled` (off). Off means no canonical pass: canonical cards are skipped like excluded ones |
| **P6. Producer** | `promotion.ts` builds `promotion`: mode `canonical` when the flag is on; flag off means today's `passage` set, byte for byte except the P0 key | `promotion.ts`, `NotesView.tsx`, `generationStore.ts` | `promote.test.ts`, `promoteFlow.test.ts` (one undo step, one record, the mode by flag); local e2e `openuiNotesFlow.local.spec.ts` with the flag on (dev override): pin → local update that changes a cited passage → amber "source changed" → Keep → update again → no new mark | same flag |
| **P7. User actions and UI** | `setTrackingMode`; ProvenanceSection labels per mode; Track source changes / Stop tracking (with rekey); knowledgeObjects `tracking`; "Tracked" badge in Notes | `reconcileActions.ts`, `ProvenanceSection.tsx`, `knowledgeObjects.ts`, `knowledgeActions.ts`, `notesModel.ts` | unit per action (each one undo step; `managed` refused for promoted keys); local e2e: a legacy `openui § g1` card → Track → key rewritten → update marks it; Undo restores excluded | the controls are hidden while the flag is off |
| **P8. Later** (not in this approval) | Stop reading `excludeFromReconciliation` (the Repo Map `mapSection.ts:57`); later still, stop writing it; passage keys (N7); `StoredProposal.v` (R7) | | | after activation (Q4) |

The flag goes in a module constant beside its code, `PROMOTION_TRACKING_CONFIG` in `ai/reconcile/canonical.ts`, as
`CITATION_MATCH_CONFIG` does (`cardMatch.ts:33`). It has a `__acuteDev.setPromotionTracking(on)` dev override. That keeps it out of
`src/config`, so **[CFG]** is avoided.

**`-Verify` needed after:** P3. Also after any step that ends up touching `src/mcp` (none planned beyond tests) or `src/config`.

**Run before each step's review:**

```
npx vitest run src/ai/reconcile src/domain src/components/canvas src/ai/changes \
  src/components/openui src/components/review src/portability
```

Plus `tsc` and eslint. Then the step's named local e2e, headed, with no AI.

---

## 8. Activation

| Layer | When off (default) | What turns it on |
|---|---|---|
| Schema, normalizer, derivation, guard (P1–P2) | Always active, and **behaviour-identical** to today apart from the N2 fix. No producer writes the new fields. | Merging P1–P2 |
| Pre-fixes (P0) and undo fixes (P4) | Active: defect fixes | Merging. They do not depend on activation |
| Producer and engine (P5–P6) | `PROMOTION_TRACKING_CONFIG.enabled = false`. Pins write today's `passage` metadata (excluded); there is no canonical pass; a canonical card written by a flag-on dev build is skipped like an excluded one (dual-written flag plus derivation). | The dev override `__acuteDev.setPromotionTracking(true)`, or the per-update option `promotionTracking: true` (tests) |
| UI (P7) | Track / Stop tracking hidden | same flag |
| Notes view itself | `NEXT_PUBLIC_OPENUI_NOTES === "on"` only (`config/openui.ts:24-26`; development only) | separate, already gated |

**Production activation**, a separate approval, is: flipping the `PROMOTION_TRACKING_CONFIG` default (or moving it to `src/config` with
an env switch, which needs `-Verify`) together with `NEXT_PUBLIC_OPENUI_NOTES` in production. Its gate:

- P0–P7 merged with the tests above;
- the local e2e set passing headed;
- an integrator read of the canonical review copy;
- the user's answers to Q1–Q3.

No live or paid run is needed: the canonical path makes no model call.

---

## 9. Open questions

**For the user (product)**

| # | Question | Recommendation |
|---|---|---|
| Q1 | Legacy pins (`openui § gN`): stay `excluded`, or become `canonical` automatically? | Stay excluded. Offer **Track source changes** (an explicit, undoable action that also rekeys). Silent conversion would start raising review marks on cards that users were told are "opted out". |
| Q2 | Does a **lock** on a canonical card also hold back its "source changed" marks (Preserve on)? | Yes: the lock means "leave this card alone". The marks come back when the card is unlocked, because they are computed from the anchor. |
| Q2b | Should excluded and locked cards stop counting in "N locked cards not updated"? | Yes: they would not have been updated anyway. |
| Q3 | Canonical cards in **impact discovery** from *other* sources: list them as "related" (no edit), or skip them? | List as related: "track" means tell me. Never a patch offer. |
| Q5 | Run the meaning check (`check_card_meaning`) before a **canonical** pin (review D7)? | Yes for canonical. It is a paid call per pin, so it needs your authorization, and it is outside this contract. |
| Q6 | Should pinning the same insight from a *later* generation offer "Show on canvas" for the earlier card (by `insightHash`)? | Yes, when the hash matches exactly; otherwise pin as new. |
| Q10 | Should passage cards (Add to canvas) also be able to become canonical? | Not in v1: they quote the source word for word, so a source change already means "re-add". Revisit. |
| Q11 | Phase 4's "merge an insight into an *existing* canonical card" (`patch_block`): do we keep a list of promotions per card? | Out of scope for v1. A card has one record (its origin). Merges would append to a bounded `promotion.history[]` later. |

**For the integrator (contract)**

| # | Question | Recommendation |
|---|---|---|
| Q4 | When do we stop writing `excludeFromReconciliation`? | Not before one release after production activation. Keep reading the mode only (P8). |
| Q7 | Approve the **anchor semantics**: `contentSourceVersion` on a canonical card means "last acknowledged version", moved only by Keep or Edit; `promotion.version` stays immutable. | Yes. It is what makes the pass F39-proof. |
| Q8 | Make P4 (re-pointing documents for metadata writes) a prerequisite of P5–P7, or ship it independently first? | A prerequisite. Otherwise Undo after Accept leaves canonical marks behind (R5). |
| Q9 | The N1, N2, N3 and N4 fixes in P0/P2: land them unflagged as defect fixes? | Yes. N2 only changes the "Preserve off" behaviour of legacy-locked passage and pin cards, from "proposed removal" to "left alone". |
| Q12 | Visualize better on a promoted card: refuse it (P0), or allow it with the pieces carrying the parent's mode and record? | Refuse in v1. Carrying the mode needs split pieces to be partitioned like canonical cards. |
| Q13 | Should Re-arrange (`rearrangeAction.ts`) move canonical cards? | Leave as is (position only), unless the user objects. |
| Q14 | Topic ids literally named `passage` or `openui` would make the rule-3/4 heuristics misread a Visualize card as legacy (UNVERIFIED that any keyer can produce them). | Add a keyer test, or narrow the heuristic with `task` (`include_passage` / `generate_openui_notes`). The task is descriptive, but `trackingModeOf` reading it is a reviewed exception. |

---

## 10. Files read

- **Plans and reviews:** `.ai/docs/shared-contract-review-2026-11-15.md`, `.ai/docs/openui-integration-plan.md`.
- **Provenance:** `src/domain/{types.ts, provenance.ts, provenanceGuard.test.ts, ids.ts, canvas/lock.ts}`.
- **Change sets:** `src/ai/changes/{changeSet.ts, pendingPersistence.ts, commit.ts (head)}`; `src/components/canvas/{changeSetWriter.ts, reconcileActions.ts}`;
  `src/components/ai/{acceptPending.ts, commitOnCanvas.ts, rearrangeAction.ts}`.
- **Engine:** `src/ai/reconcile/{existing, classify, impact, mapSection, update, cardMatch, citations, citationUpdate (parts), keys, split}.ts`; `updatePolicy.test.ts` (lock test).
- **Promotion and review UI:** `src/components/openui/notes/{promotion.ts, promote.ts, generationStore.ts, NotesView.tsx (pin)}`;
  `src/components/review/{knowledgeActions.ts, knowledgeObjects.ts}`; `src/components/properties/ProvenanceSection.tsx`.
- **Sources and portability:** `src/ai/content/sources.ts`; `src/portability/{sanitize.ts, exportOptions.ts}`; `src/sync/SyncProvider.ts`.
- **MCP:** a grep of `src/mcp/**`; `src/mcp/context/currentContext.ts`; `src/mcp/tools/studyTools.ts` (head); `scripts/chatgpt-mcp-session.ps1:99` (the protected paths).

## Integrator review (canvas-notes-39, 2026-11-16)

**Verdict: APPROVED WITH CONDITIONS** for the five items the user reserved to the integrator.

| Item | Decision |
|---|---|
| Schema and migration | **Approved.** The set-level `promotion` record and object `trackingMode` + `promotion` go in the reconciliation group of `AIMetadata`. `trackingMode` is derived at read time when absent, with no migration write. Key `promoted § <gen_id> § gN` |
| Compatibility with `excludeFromReconciliation` | **Approved.** It stays written alongside the mode (true when the mode isn't `managed` or the card is locked); the engine reads the mode. Retire it only at P8, as a separate decision |
| Provenance readers | **Approved:** the inventory of 53 call sites. **Condition:** R6, the guard regex for `reconciliationOf(` and `connectorSourceOf(`, closes in P1, not later |
| Reconciliation per mode | **Approved:** the truth table above. A canonical card is never updated, patched or removed by an update; it gets only a "source changed" review mark against its own anchor version |
| Undo, reload, source-version updates | **Approved, on condition that P4 (undo-safe metadata writes) lands before P5–P7** (Q8: yes) |

**Integrator answers:**
- **Q4:** the flag is retired only after production activation is separately approved, plus one release with no reported regression.
- **Q7:** approved. A canonical card's `contentSourceVersion` moves only when the user acknowledges a review.
- **Q8:** yes, P4 is a prerequisite of P5–P7.
- **Q9:** yes. N1–N4 are defect fixes that change no schema, so they land unflagged in P0.
- **Q12:** yes, refuse "Visualize better" on promoted cards until P5 defines split behaviour.
- **Q13:** Re-arrange may move canonical cards. Position isn't content, and the change is reviewed or undoable as today.
- **Q14:** new objects are identified by the `promotion` record, not by key prefix. The legacy prefix rules match only the exact generated forms (`openui § g<n>`, `passage § <unit id>`). A section literally titled "openui" or "passage" can't produce those forms.

**Confirmed by the integrator in code:**
- **N1:** `setExcludedFromReconciliation` (`src/components/canvas/reconcileActions.ts`) clears the opt-out with no regard for a pin or passage origin.
- **N3:** pins stamp `noteModel: "distil"` (`promotion.ts:53`, `knowledgeActions.ts:126`), and `sourceOrganisation` (`update.ts:487-488`) switches on any distil object of the source.

**Conditions on implementation:**
- **P0** (defect fixes, no schema) may start now. P1+ needs the user's answers to Q1, Q2, Q2b, Q3, Q5, Q6, Q10 and Q11 first. Q5 involves paid calls.
- P3 touches `src/ai/changes`, so the MCP restricted gate needs a `-Verify` rerun afterwards. The full gate stays closed.
- Everything past P0 stays behind `PROMOTION_TRACKING_CONFIG.enabled = false`. Production activation is a separate user approval.
- Nothing is committed before the manual verification results and the shared-contract sign-off (user decision, 2026-11-15).

## User decisions on the open questions (2026-11-16)

- **Q1:** existing pins never become canonical automatically. There's an explicit "Track source changes" action.
- **Q2:** a lock suppresses active "source changed" marks, but doesn't erase the source-version difference. It is
  re-evaluated on unlock.
- **Q2b:** locked cards that are also excluded don't count in "locked cards not updated".
- **Q3:** canonical cards may appear in related-content discovery. They are never automatically patched, updated or
  removed.
- **Q5:** no mandatory paid meaning check before a canonical pin. The free checks and review status stay.
- **Q6:** an exact repeat pin is deduplicated by generation and promotion identity. Cards are never merged or deleted
  by text similarity across generations.
- **Q10:** ordinary source-passage cards can't become canonical in v1.
- **Q11:** promotion history is kept when an insight is merged into an existing card: source, cited units,
  generation, destination and operation identity.

**P1 condition (user):** "Do not create a second independently writable tracking state that can contradict
`excludeFromReconciliation`." This supersedes the earlier "written alongside" design; the integrator revision
follows.

## Integrator P1 schema revision (2026-11-16): single writable opt-out

The earlier proposal wrote `trackingMode` and `excludeFromReconciliation` side by side. They could contradict each
other, which the user ruled out. Revised:

1. **`excludeFromReconciliation` stays the only writable opt-out.** No `trackingMode` field is stored.
2. **Canonical is a property of the promotion record:** `AIMetadata.promotion.tracking: "canonical"`.
   - It is only valid on an object that has a `promotion` record and `excludeFromReconciliation === true`.
   - `normalizeAIMetadata` drops `tracking` when either is missing, so a canonical card that loses its opt-out reads
     as `managed` and never as "canonical but reconciled".
3. **The mode is derived, never stored,** by one function, `trackingModeOf(link, element)` in
   `ai/reconcile/tracking.ts`:
   - `canonical` if there is a promotion record, `tracking === "canonical"` and the card is opted out;
   - else `excluded` if it is opted out besides a lock (`optedOutBesidesLock`);
   - else `managed`.
   Every engine reader uses this function only. The guard test forbids reading `promotion.tracking` anywhere else.
4. **One writer per transition, so both fields change together atomically in one undo step:**
   - `trackSourceChanges(id)`: sets both;
   - `stopTracking(id)`: clears `tracking`, keeps the opt-out;
   - "Allow AI updates" on a canonical card: refused (P0 N1 rule).
5. **Q11 merge history.** `AIMetadata.promotion.history[]` holds
   `{ sourceId, version, units, generationId, destinationId, operationId, at }`. It is append-only and bounded, and is
   written only by the merge path (`patch_block` with a set-level `promotion`).

**Consequences for the proposal:**
- §1's `trackingMode` field is removed, and the truth table rows are unchanged.
- §3's "written alongside" is replaced by the derivation above.
- P8 ("stop writing `excludeFromReconciliation`") is dropped: that field stays the source of truth.

**Readiness:** P1 can be implemented once P0 lands and this revision's tests are written first:
- `normalizeAIMetadata` drops invalid `tracking`;
- the derivation table;
- the guard forbids direct reads;
- undo, reload, lock/unlock and source-version update for each mode;
- promotion-record persistence.

P1 stays inactive behind `PROMOTION_TRACKING_CONFIG.enabled = false` until it is separately authorized.
