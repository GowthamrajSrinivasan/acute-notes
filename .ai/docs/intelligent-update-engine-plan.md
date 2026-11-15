# Intelligent Update Engine — Proposal Review & Plan

Status: **draft** · Date: 2026-11-13 · Owner: Gowthamraj
Related: [[notes-update-audit-and-plan]] (`.ai/docs/notes-update-audit-and-plan.md`),
knowledge-notes-plan, open-intelligent-ui-audit

**Note for whoever works this plan (2026-11-13):** [[openui-integration-plan]]
(`.ai/docs/openui-integration-plan.md`) Phases 4–5 are gated on this plan reaching Stage 1
live-verification + Stage 2 (Node Router) shipped. When either lands, that plan's §2 sequencing decision
should be re-checked — it was written against this doc's state as of today.

Reviews an external architectural proposal ("hybrid hierarchical tree + semantic
graph + AI patch engine") against what Acute already implements, and plans the
parts worth adopting.

**Reviewer status (2026-11-13): approved with refinements**, all folded in
below — (A) explicit update-intent classification separate from the edit
operation; (B) a stricter, conditional `patch_block` contract with atomic
multi-edit; (C) separate routing vs update confidence; a three-mode router
design (§3); a five-scenario gate on Stage 1 (§4); and a hybrid claim layer (§6).

**Implementation status (2026-11-13): Stage 1 (1a–1e) built and verified** — the Stage 1
gate and Stage 1e tests offline, local e2e in the app, one approved AI e2e run, and a live
look at the review and settings UI. Stage 1's known gaps are closed (§9). **Stage 2 (Node
Router, 2a–2d) built 2026-11-13** — offline tests and a live local check; its optional AI step
not yet run live (§10). **Stage 3 (multi-location sync, impact discovery) built 2026-11-13** —
offline tests and local e2e, no AI involved (§11). **Stage 4: design approved with revisions (§12.9);
4a–4e built and verified 2026-11-13 (§12.11, §12.13)** — the 4a–4b checkpoint was self-reviewed on the user's
instruction. **4f: approved 2026-11-13 for a controlled AI evaluation only; the bounded recording ran (§12.14).** AI checking
of real accepted changes is NOT active and stays off by default. See §7 (contract), §8 (1e),
§9 (gaps and 1d), §10 (Stage 2), §11 (Stage 3).

**Direction (2026-11-14): Stage 5 — semantic locate and anchor — is planned in §13, not started.** A second outside
design ("AI Topic Accumulation Design") was compared with what is built. Decision: keep the local-first backbone, add
a **local embedding model behind a provider-neutral seam** (a provider embeddings API can replace it later by
configuration only), index at item level, make the router descend with early exits, add the missing anchor actions,
and fold the three model prompts into one call. Stage 4f continues unchanged and comes first where the two meet
(§13.7). §1, §2, §4, §6 and §10 below are updated to match.

---

## 0. Verdict (read this first)

The proposal is **architecturally correct and well-reasoned** — and it is also
**~70% already built in Acute**. The proposer is reasoning from the outside and
doesn't appear to know that.

Most importantly: the proposal names **one design decision to prioritize above
everything else** — *"a precise, typed, versioned, testable patch contract
between the AI and your editor."* **Acute already has exactly this**: the
`ChangeSet` / `ProposedChange` model (`src/ai/changes/changeSet.ts`) — a
renderer-agnostic, zod-validated, versioned set of operations, applied
deterministically as one undo step, reviewed before it touches the scene. That
is the proposal's foundation, and it shipped.

So we do **not** rebuild. We keep the patch-contract backbone, recognise what's
already done, and adopt the genuinely-new parts incrementally.

**One real philosophical divergence** (see §3): the proposal assumes *arbitrary
new information routed across the whole canvas*. Acute is deliberately
**source-anchored** — content comes from a tracked content source and updates
reconcile version N → N+1 of that same source. The source-anchored model is
safer and avoids most of the routing ambiguity the proposal itself warns about.
Recommendation: keep source-anchored reconcile as the backbone; add semantic
routing as an *additional* path for the unanchored-insert case only.

---

## 1. Proposal ↔ Acute mapping

| Proposal pillar | Status in Acute | Evidence |
|---|---|---|
| **Typed, versioned, testable patch contract** (its #1 priority) | ✅ **Built** | `ChangeSet`/`ProposedChange`, `parseChangeSet` (zod), `resolveChangeSet` vs live canvas, renderer-agnostic by design |
| Stable identity, not title/position/text | ✅ **Built** | `stableNodeKey` (canonical id), `keys.ts` structural keys; `reconcile` matches by key only — "nothing here matches by array position or timing" |
| Separate structure from visual layout | ✅ **Built** | `stableNodeKey`/`frameId` are logical; Excalidraw x/y never reconciled (`ExistingObject.box` "never compared") |
| Optimistic concurrency / version / conflict / rebase | ✅ **Built** | `ExistingObject.version` + `baseline` fingerprint; `update_clean` vs `update_conflict`; "Keep mine" = `rebaseline`; `resolveChangeSet` drops stale targets |
| Deterministic execution, LLM only for reasoning | ✅ **Built** | changeSet header: AI proposes data, code applies; `accept.ts` writes in one transaction |
| Typed rich-text AST (not markdown/HTML) | ✅ **Built** | BlockNote typed blocks (`RichContent`); table/list/image are typed blocks with ids |
| Review / approval before apply | ✅ **Built** | ghosted review; conflicts need per-item decision; Project-profile `reason` required |
| Patch as data, not a rewritten document | ✅ **Built** | a `ChangeSet` is a list of ops; `update_block` carries only the one block's new content |
| NO_CHANGE | ✅ **Built** | no-op → null change set, zero model calls |
| Operations: INSERT / APPEND / REPLACE / DELETE / SPLIT / MULTI_PATCH | 🟡 **Mostly** | create_* (insert), update_frame (append-to-section), update_block/shape (replace), remove (delete), `splits`/`splitOf` (split), a set is already multi-patch. **Claim-level MERGE/REPLACE missing** |
| Audit / undo / history | ✅ **Built** | Agent State, change-log, `revert`/`restore` (D30/D43) |
| Keyword/retrieval search index | ✅ **Built** | `src/search/workspaceIndex.ts` (F22) — deterministic BM25-style; the embedding tier was added in Stage 2a (`VectorTier`, §10) |
| Per-node summaries + semantic embeddings index | 🟡 **Partial** | Stage 2a–2b: descriptors + a local *hashed* embedder (word forms, not paraphrase). A real local embedding model behind a provider-neutral seam is Stage 5a (§13.2) |
| **Node Router** (semantic + graph retrieval to find targets) | 🟡 **Partial** | Stage 2 (§10): flat-pool router, card-level targets, two actions (`update` a sentence / `insert_near`). Descent with early exits, item-level anchors and append / insert-after / table-row actions are Stage 5c–5d (§13.4–13.5) |
| Claim-level patch (replace "five"→"three" in place, preserve rest) | 🔴 **Gap** | smallest patch unit is a block's full content; units are diffed at sentence level (`unitSetSchema` kinds: sentence/list_item/table_row) but the *patch* replaces the block |
| Multi-location same-fact sync (Case A) | 🔴 **Gap** | reconcile is per-source; no propagation of one fact to N unrelated nodes |
| Destination disambiguation UI (NEEDS_CLARIFICATION, "where should this go?") | 🟡 **Partial** | conflicts UI exists; no "choose target node(s)" flow |
| Persistent relationship graph (depends-on/supersedes/implements) | 🟡 **Partial** | typed relationships + connections exist on canvas; not used as a retrieval/expansion graph |

**Four-engine model** (Node Router / Update Planner / Patch Executor / Validator):
Acute already has Update Planner (`update.ts` + reconcile), Patch Executor
(`accept.ts`), and Validator (`parseChangeSet` + reconcile conflict checks).
The missing engine is the **Node Router**.

---

## 2. What's genuinely new & worth adopting

In priority order (value × how additive, lowest-risk first):

0. **Update-intent classification** *(reviewer refinement A)* — before choosing
   any edit operation, classify what the incoming information *means* relative to
   existing content: `NEW` (add) · `SUPERSEDES` (replace an old fact) · `EXTENDS`
   (enrich a claim) · `CONTRADICTS` (investigate/escalate) · `DUPLICATE` (no
   change) · `UNCLEAR` (ask). This is **separate from the editing operation** —
   detecting a contradiction does *not* imply overwriting. Acute has a partial
   precedent (`revisions`, G3.3 = "the text changed its mind" ≈ SUPERSEDES) but
   no general semantic intent classifier; this is the cross-cutting input to the
   planner, upstream of `patch_block`/`update_block`/`remove`.
1. **Claim-level patching** — replace/merge a specific fact inside a block while
   preserving surrounding prose, marks, links. Units are already diffed at
   sentence granularity; the gap is a patch op that edits *within* a block via
   stable block id + rich-text range, with exact-text/anchor fallback, and that
   supports **several independent edits in one block as a single atomic patch**
   *(reviewer refinement B)*.
2. **Patch-contract hardening** — the proposal's `expectedVersion` + exact-text
   match + "re-evaluate, don't silently modify" is slightly stronger than our
   current baseline-fingerprint check. Worth tightening the contract and tests.
3. **Node Router (Capability A)** for the *unanchored-insert* case (Ask AI /
   MCP / a pasted Slack line with no source): hierarchical + semantic + graph
   retrieval → ranked candidates → disambiguation UI. Built on the F22 index's
   embedding seam.
4. **Multi-location same-fact sync (Case A)** — detect the same claim in several
   nodes and propose coordinated patches; distinguish genuine duplication from
   "just link/reference" (the proposal's own warning).
5. **Knowledge layer** — maintained per-node summaries + embeddings; partly
   overlaps knowledge-notes (`sourceUnits`, `lineage`, citations already exist).
6. **Semantic locate and anchor** *(added 2026-11-14, Stage 5, §13)* — real
   (paraphrase-level) embeddings from a local model, item-level index, router
   descent with early exits, append / insert-after / table-row anchors, and one
   combined "relate" model call. Items 3–4 and Stage 4 all match by shared words
   today; §12.20 showed that does not generalise, so this is fixed once, in the
   shared retrieval layer.

Deliberately **not** adopting wholesale:
- Whole-canvas autonomous routing as the default path — keep source-anchored
  reconcile as the backbone; routing is the exception, not the rule.
- A permanent per-sentence stored graph — use the proposal's own "ephemeral
  claim graph, generated on demand" guidance. *(Stage 5b's item index stores a
  hash and a vector per existing unit — a derived, rebuildable cache, not a graph
  and not a second knowledge system.)*
- From the second design (§13.1): a server database (PostgreSQL / pgvector /
  ltree), provisional threads with clustering, a facts table with fan-out, and a
  model call on every capture.

---

## 3. Recommended approach

**Keep the backbone, extend at the edges.** The patch contract is the asset; it
already satisfies "precise, typed, versioned, testable." Everything new plugs
into it as new `ProposedChange` kinds or new *producers* of change sets — not a
rewrite.

Two independent, separately-testable capabilities (matching the proposal):
- **Capability B — modify precisely** (we are here): finish claim-level patching
  on top of the existing reconcile. **Finish and verify this first** (the
  proposal agrees: "finish Stage 1 before autonomous discovery").
- **Capability A — find where it belongs**: the Node Router, added later as a
  new producer that emits candidate change sets, gated behind disambiguation.

**Router modes — an initial boundary, not a permanent restriction** *(reviewer
refinement, §3 disagreement accepted).* Design the router for three modes even
though only the first two ship initially; this keeps the safety posture without
constraining the future architecture:

| Mode | Behaviour | Initial state |
|---|---|---|
| **Source reconciliation** | Update nodes directly tied to the changed source (today's reconcile) | ✅ active |
| **Unanchored routing** | Discover the destination for new content with no source | 🟡 Stage 2 |
| **Impact discovery** | Find *other* nodes a source-anchored change may affect (threshold → spec, table, overview) | ✅ Stage 3 (§11): offered per card as a decision, never by "Accept all" |

**Two confidence scores, never one** *(reviewer refinement C).* Routing
confidence ("is this the right target node?") and update confidence ("does the
proposed edit correctly incorporate the new information?") are different
questions. A router can be certain of the paragraph while the content is
contradictory or too unclear to edit safely. Keep them separate signals end to
end; a single blended score hides exactly the case we must escalate.

---

## 4. Plan

### Stage 0 — Harden the backbone (in flight)
- ✅ Extract unit-keyed tier from `updateFromNewContent` (done; 209 reconcile
  tests green). Continue the [[notes-update-audit-and-plan]] refactor (local
  tier → common `PlanResult` → `UpdateMode`). This *is* patch-contract hardening.
- Add contract tests from the proposal's matrix that we don't yet cover
  explicitly: stale-version rejection, formatting-preservation, no-op-no-dupe.

### Stage 1 — Claim-level patch (Capability B)
- **1a. Intent classifier** *(refinement A).* A planner step that labels the
  incoming change NEW / SUPERSEDES / EXTENDS / CONTRADICTS / DUPLICATE / UNCLEAR
  *before* an operation is chosen. CONTRADICTS → escalate (don't auto-overwrite);
  DUPLICATE → no-op; UNCLEAR → clarification. Separate from the edit op.
- **1b. Contract.** Add a `patch_block` (working name) `ProposedChange`
  carrying **one or more independent edits applied atomically**:
  `{ targetNodeId, expectedVersion, blockId, edits: [{ match: {range|exactText|anchor}, replacement }], reason }`.
  Validate in `parseChangeSet`; execute in `accept.ts` as rich-text range edits
  that preserve marks and inline objects. The contract is **conditional** — the
  patch applies only if *all* hold, else it is rejected and re-evaluated (never a
  best-guess overwrite):
  1. the target block exists and its version matches `expectedVersion`;
  2. each edit's range/anchor identifies **exactly one** target;
  3. the replacement preserves unaffected formatting and inline objects;
  4. no unrelated claim is removed as a side effect;
  5. any ambiguous match ⇒ reject the whole atomic patch, re-evaluate.
- **1c. Planner.** Teach the changed-unit path (now `updateUnitKeyedTier`) to
  emit `patch_block` (with multiple edits where a block has several changed
  claims) instead of a whole-block `update_block`, when claims are localizable.
- **1d. Table/image ops.** Add `update_cell` / `update_caption` so a one-cell
  change doesn't rewrite the table (the proposal's §6 concern). *After* 1a–1c
  pass. *(Built 2026-11-13 as `cell` / `caption` edit targets inside `patch_block`, see §9.)*
- **1e. Update policy, Lock, and preserve settings** *(built 2026-11-13, see §8)*.
  "Update everything" means the new fact is **merged into the user's text**, never
  that the card is replaced with the source's version. Provenance note: we can tell a
  card *changed since AI last wrote it* (fingerprint ≠ baseline); we don't store who
  made each edit, so "edited by the user" means exactly that.
  - **Default policy:** new information updates every card — AI-written or edited —
    unless it is locked (R2) or preserved (R3).
    - *Cards AI wrote, nobody edited:* claim-level `patch_block` where possible,
      else the whole-card update (Stage 1c).
    - *Cards changed since AI wrote them:* a claim-level patch onto the card's
      **current** text — the new fact goes in, the user's wording, marks and links
      stay — as a normal reviewed change, not an Apply / Keep mine conflict.
    - *Fallback:* a patch that can't be placed exactly → today's conflict card
      (Apply / Keep mine). Never a silent overwrite.
    - *Contradictions:* CONTRADICTS / UNCLEAR escalate to a decision under every
      setting; never applied automatically.
  - **Lock:** a visible Lock toggle on a card and on a section frame. Locking a
    section locks every card in it, including cards added to it later. Locked
    cards are skipped entirely (no update, no conflict card, no review noise). Built
    on `excludeFromReconciliation`, extended to frames. A small lock icon on locked
    objects. Unlocking makes the object eligible on the next update.
  - **Settings → AI → Update behaviour:** two independent toggles — *Preserve
    locked sections* (on; off = locks are markers only) and *Preserve edited cards*
    (off; on = every changed card gets Apply / Keep mine, never patched). Threaded
    through `UpdateOptions`, saved like the other AI settings; `claimPatches` stays a
    developer override.
  - **Review UI:** a patch onto an edited card reads "Updates your edited card:
    “five” → “three”"; the review bar counts skipped cards ("2 locked cards not
    updated").
  - **Baseline rule (R5):** after a patch onto an edited card is accepted, its new
    baseline is the patched content and its source version advances; the next
    update treats it as current and never proposes the same change again.
  - **Safety (unchanged from Stage 1):** patches are checked against live content
    at accept; a patch that no longer fits is skipped and reported; one undo step;
    contradictions always escalate.

**Stage 1 gate — all five must pass before Stage 2** *(reviewer acceptance
scenarios; 209 green reconcile tests do not cover these):*
1. **Single claim** — change one fact, rest of the paragraph untouched.
2. **Multiple claims** — change ≥2 facts in one block atomically, all unaffected
   content preserved.
3. **Rich formatting** — bold/italic/links/inline objects outside the edited
   region survive.
4. **Concurrent modification** — reject a patch against content changed since
   planning (version/anchor mismatch).
5. **Semantic integrity** — correctly distinguish EXTENDS from SUPERSEDES
   (intent classifier drives the right operation).

> **Gate status: CLOSED 2026-11-15 by the integrator, as the user's 2026-11-15 decision allowed.**
> No further paid run: the acceptance criteria don't require one.
>
> **Evidence:**
> - **Offline:** `claimPlanner.test.ts` (gates 1, 2, 3, 5) and `claimPatch.test.ts` (gate 4) pass; 354/354 across
>   `claimPlanner`, `src/ai/changes`, `src/components/ai` and `src/ai/content`.
> - **Real app, no AI:** `e2e/local/stage1Gate.local.spec.ts` runs all five gates as claim-level patches.
>   - Gate 4 adds: the follow-up "Update again" offers exactly the skipped fact, then nothing; 4b, the all-stale case
>     with the corrected message; 4c, the same after a page reload.
>   - Traces: `test-results/stage1-gate-2026-11-14/` and `…-2026-11-15/`.
> - **Live AI run:** `e2e/ai/updatePolicy.spec.ts` 5/5 (§8, 2026-11-13).
>
> **Fixed before closing** (`src/ai/content/sources.ts` `recordPartlyAppliedSource` / `withUnappliedNodes`,
> `src/components/ai/unapplied.ts`, `acceptPending.ts`, `ChangeSetReview.tsx`):
> - **A skipped stale patch no longer loses its fact.** The recorded version keeps the previous node and text for
>   each unapplied card. If that can't be done exactly, no version is recorded.
> - **Correct message for a stale-only change:** "the card changed since this update was planned", not "deleted
>   object".
> - **Trade-off:** a partly applied version stores the new source text with the skipped passages put back. It matches
>   the canvas, not the exact text the user supplied.
>
> **Still open, not part of the gate:**
> - **Stage 1e, classify.ts rule 2:** a card in the user's wording that the source said nothing new about gets a
>   spurious "You edited this" conflict once the source moves on twice without it. A safe failure: the user is asked,
>   nothing is overwritten. Recorded as a `test.fail` in `stage1Gate.local.spec.ts`; owned by this lane.
> - **The `update_block` stale-target overwrite (P0):** separate; the integrator is fixing it next.

### Stage 2 — Node Router (Capability A), unanchored inserts only *(built 2026-11-13, see §10)*
- **2a. Embedding tier** behind the existing `SearchIndex` seam
  (`workspaceIndex.ts`) — local, incremental; no change to the context builder.
  *(The built embedder is hashed features, not a model. Stage 5a replaces it as
  the default once it passes its gate; the hashed one stays as the fallback.)*
- **2b. Per-node summaries + keywords** (the proposal's node descriptor),
  computed incrementally; reuse knowledge-notes summaries where they exist.
- **2c. Router** = hierarchical route + semantic retrieval + graph expansion →
  ranked candidates with relevance evidence (not just heading match).
- **2d. Disambiguation UI** — "Where should this go?" multi-select; record the
  choice as a routing signal. Model may return `NEEDS_CLARIFICATION`.
- **Tests:** direct match, non-obvious cross-parent match, ambiguous → asks,
  "contains the claim" vs "related topic" distinction.

### Stage 3 — Multi-location sync (Case A) *(built 2026-11-13, see §11)*
- Detect the same claim across nodes (via the claim graph + embeddings); emit a
  coordinated multi-patch; flag duplication-vs-reference. Approval required for
  destructive/multi-target sets (already supported by the review model).
- **Tests:** every required target updated; link-only cases not over-written.

### Stage 4 — Continuous consistency *(design approved §12.9; 4a–4e built 2026-11-13, §12.11 and §12.13; 4f evaluation recorded §12.14 and near-miss routing built offline §12.15; 4f not active)*
- Incrementally refresh summaries/index on accept; contradiction checks across
  nodes; surface "this change conflicts with X elsewhere."

### Stage 5 — Semantic locate and anchor *(planned 2026-11-14, see §13; not started)*
- **5a. Embedding provider seam + local model** — async, batched, dense vectors
  behind one interface; local model by default; a provider API is a second
  implementation chosen by configuration.
- **5b. Item-level index** — hash + vector per sentence / list item / table row,
  keyed by the existing unit keys; exact duplicates found with no model call.
- **5c. Router descent with early exits** — open frame or selection → exact
  duplicate → keyword postings → top sections → cards → items.
- **5d. Anchor actions** — append to a list, insert after an item, add a table
  row or fill a cell, all as `patch_block`.
- **5e. One "relate" call** — `route_content`, the `UNCLEAR` intent refinement
  and `judge_consistency` become one batched call, made only on a small margin.
  **Gated on the Stage 4f outcome.**
- **5f. Locate evaluation set** — labelled placements, built before 5c–5e are
  tuned; routing weights change only against it.
- **Latency and UX rules (§13.10, proposal)**: the deterministic answer first, the model
  refines in the background and only suggests; stale answers are dropped; local work
  is precomputed; the embedder is warmed during idle time.

**Sequencing rule:** Stage 1 fully shipped and verified before Stage 2 routing —
per the proposal and per our own risk posture. Stage 5 never edits a file frozen
for the third unseen set until that recording is done (§13.7).

---

## 5. Evaluation (adopt the proposal's matrix)

Add to the reconcile suite (offline, mock provider — no AI spend without
approval): single-point replacement · multi-point replacement · append no-dupe ·
formatting preservation · no-op · contradictory info (escalate) · stale version
(reject) · multi-location consistency. Model allowed to return `NO_CHANGE` /
`NEEDS_CLARIFICATION`.

---

## 6. Decisions & open questions

**Resolved — claim layer is hybrid** *(reviewer refinement, §5).* Do **not**
build a second knowledge system. Instead:
- keep the existing `sourceUnits` + `lineage` structures as the durable
  foundation (the claim layer of record);
- generate claim-level representations **on demand** for precise editing
  (ephemeral per update — the proposal's own guidance);
- persist *additional* semantic relationships only where they demonstrably
  improve retrieval or consistency checks, never by default.

Resolved during Stage 1 (provisional — review):
- **Anchoring:** block index (+ block id, checked when both sides have one) and a
  plain-text `range` carrying the text expected there is what the planner emits;
  `exactText` and `anchor` (text + before/after context) are accepted for other
  producers. Any match that isn't exactly one place rejects the whole patch.
- **Intent classifier placement:** a deterministic pre-pass (`intent.ts`) reusing
  the meaning rules; an LLM step can later refine `UNCLEAR` without changing the
  contract.
- **CONTRADICTS / UNCLEAR surface:** as a conflict card with an `escalation` note
  ("The new content contradicts this card: …"), so it needs a per-item decision and
  "Accept all" never applies it. Apply / Keep mine work as for a user edit.

Resolved 2026-11-14 (user decision, §13):
- **Embeddings come from a local model by default.** No per-call cost, and card
  text stays on the device.
- **The embedder must be swappable.** A provider embeddings API is a second
  implementation of the same interface, selected by configuration. Nothing
  outside the seam may know which one is running. It is built only if needed.
- **No server database.** The second design's storage layer is not adopted; the
  in-memory index, idb and the commit journal already cover it.

Still open (Stage 5, to settle in the 5a spike — §13.8):
- Which local model, and whether its weights ship in the build or download on
  first use.
- Whether the web build gets the model or keeps the hashed embedder.

Still open:
- Router: unanchored routing stays opt-in (Ask AI / MCP). *(Resolved provisionally —
  Stage 3, §11.)* Impact discovery is on; source-anchored updates never silently fan
  out: every card elsewhere is its own decision ("Update this too" / "Leave as is"),
  never applied by "Accept all", and AI settings → "Suggest updates elsewhere" turns it
  off. Review the gating once it has been used on real canvases.
- *(Resolved — Stage 1e, §4 and §8.)* Cards changed since AI wrote them get a
  claim-level patch onto their current text; the conflict card is the fallback and
  the "Preserve edited cards" setting.

---

## 7. Implementation (Stage 0–1, 2026-11-13)

**Contract as built** (`src/ai/changes/claimPatch.ts`, `changeSet.ts`):

```ts
{ kind: "patch_block", target, expectedFingerprint, stableNodeKey?, sourceRefs?,
  edits: [{ blockIndex, blockId?, match: {exactText} | {anchor:{before,text,after}} | {range:{start,end}, text},
            replacement, intent? }] }
```

Two refinements of §4 1b: `expectedVersion` is `expectedFingerprint` (the object's
`fingerprintOf`, the same value reconcile already uses as its baseline — stricter than
a source version number, which a user edit doesn't bump); and the block is addressed
per edit, so one atomic patch can change claims in several blocks of one card.

**Where the rules are enforced:** `resolvePatch` at accept time, against the live
content (`ChangeSetCanvas.contentOf`). Rule 1 = fingerprint + block id; 2 = exactly-one
match; 3 = an edit lies wholly inside one link or outside all links, and the replacement
takes the marks of the run it starts in; 4 = each edit inside one sentence
(`sentenceSpans`), no overlaps; 5 = any failure drops the whole patch, reported as
"precise edit skipped … Update again". A resolved patch becomes the `update_block` the
writer already handles, so undo, Agent State and the change log need no new path.

**Planner** (`src/ai/reconcile/claimPlanner.ts`, called from `update.ts` `buildChangeSet`
for `update_clean` items): pairs blocks and sentences; any added/removed block or
sentence, type change, table/code block, or formatting-only change falls back to the
whole-block update. A patch is emitted only if applying it reproduces the proposed
content's fingerprint exactly (so the next update sees the card as current).
`UpdateOptions.claimPatches: false` turns it off.

**Tests (offline):** `claimPatch.test.ts` (contract rules), `intent.test.ts`,
`claimPlanner.test.ts` (planner + the five gate scenarios end to end: update from new
content → accept), `changeSet.test.ts` (schema, resolution, escalation round-trip).

**Not done:** 1d (`update_cell` / `update_caption`); Stage 2–4; a live check that the
review label and escalation note read well in the app.

---

## 8. Implementation — Stage 1e (2026-11-13)

Offline only (mock AI; no live, e2e or contract runs).

**Edited cards — three-way placement** (`src/ai/reconcile/claimPlanner.ts`
`editedCardUpdate`, `placeEditsOnto`). The source's own change is planned from what AI
last wrote (the previous version's node, rendered as the writer would) to what it says
now — so the user's rewording is never mistaken for a change to undo. Each edit is then
placed on the card's *current* text: by its words of context from the AI wording first
(`anchor`), then by its text alone (`exactText`), only where it lands on exactly one
place; then the whole patch must apply (`applyClaimEdits`). Any edit that can't be placed
→ the conflict card. The patch carries `onEditedCard: true` and `expectedFingerprint` =
the card's current fingerprint, and is checked again at accept like every patch.

**Which cards count as edited** (`update.ts` `buildChangeSet`): `update_conflict` items
(fingerprint ≠ baseline), and `update_clean` items stamped `AIMetadata.userWording` — a
card whose last write was a merge into the user's wording, or "Keep mine". The writer
stamps it on those writes and clears it on any write of AI's own wording (an update, an
Apply update, a shape relabel); Undo restores it with the rest of the metadata. *(First
built by inference — "content ≠ the previous version's node" — which the local e2e caught
misreading an untouched card after accept + Undo as edited; replaced by the stamp.)*

**R5 baseline:** no writer change was needed — accepting a patch writes it as an
`update_block`, which stamps the written content's fingerprint as `contentFingerprint` and
the set's version as `contentSourceVersion` (`changeSetWriter` `updatedMetadata`). The
next update over the same text finds the card source-silent; a later change to the same
claim is merged into the user's wording again. Covered by an explicit test.

**Lock** — `src/domain/canvas/lock.ts` (`customData.acuteLocked` on the element, cards
and frames). `existingObjects` reports `locked: "card" | "section"` (a card in a locked
frame at update time, so cards moved in later are locked too). A card lock also sets
`excludeFromReconciliation`; the element flag is what tells a lock from other opt-outs
(passage cards), so "Preserve locked sections: off" ignores locks without touching those.
`update.ts`: with the setting on, locked objects are skipped like opted-out ones, new
nodes of a section whose frame is locked aren't added (`withoutLockedSections`), and the
locked cards the source changed (or dropped) plus the skipped adds are counted into
`ChangeSet.skipped.locked` — or a notice when nothing else changed. An unchanged locked
card isn't counted. UI: properties panel "🔒 Lock / 🔓 Unlock" on a source-linked card
(`reconcileActions.setCardLocked`; an object opted out the old way keeps "Allow AI
updates"), "🔒 Lock section" on a frame (`setFrameLocked`, `DiagramPanelSection`), and a
lock icon overlay (`components/ai/LockMarkers.tsx`).

**Settings** — `src/ai/reconcile/updatePolicy.ts` (`UpdatePolicy`, defaults
`{ preserveLockedSections: true, preserveEditedCards: false }`, registered from
`uiPrefs.aiUpdate`); `ingestContent` reads it for every update and merge (app and MCP)
unless `IngestOptions.updatePolicy` is given; `UpdateOptions.preserveLockedSections` /
`preserveEditedCards`. UI: `components/shell/UpdateBehaviourSettings.tsx` under AI
settings.

**Review UI** (`ChangeSetReview.tsx`): "Updates your edited card “…”: “five” →
“three”"; the bar's "🔒 N locked cards not updated" (`skippedNote`).

**Tests:** `src/ai/reconcile/updatePolicy.test.ts` (16): locked card and locked section
skipped (incl. a new card for the section), lock-preserve off updates locked cards, lock
read from the scene (card flag, frame, passage opt-out never a lock), edited card merged
with the user's other edits kept, unplaceable → conflict card, Preserve edited cards →
conflict, contradiction escalates under six setting combinations, R5 (no repeat proposal;
a later change merges into the user's words again), review bar count (and no count for
an unchanged locked card).

**Limits / not done:**
- In the local tier a section's prose is one text node, so a new *paragraph* in a locked
  section is a change to its (locked) text card, not a new card — still skipped.
- Locks on shapes are honoured by the engine (the AI run locked a concept-map shape); the
  lock icon was checked live on a text card.
- *(Closed, §9)* ~~Merging limited to in-sentence changes~~ — sentences added or removed are
  now edits too.
- *(Closed, §9)* ~~Review wording and settings not checked live~~.

**Checks run (2026-11-13, approved):**
- *Local e2e* (`e2e/local/reconcile.local.spec.ts`, no AI): 9/9. Updated for Stage 1e —
  an edited block now gets the fact merged into its wording and a re-run proposes nothing;
  an edit the merge can't place → conflict (Keep mine / Apply update); "🔒 Lock" / "🔓
  Unlock" with its icon replaces "Don't update this from AI" (the toast says "1 locked card
  not updated").
- *AI e2e* (`e2e/ai/updatePolicy.spec.ts`, AICredits `openai/gpt-oss-120b`, ~2.3 min, a
  small "MCP servers" note: one paragraph + three points, concept map): 5/5 (preflight + 4).
  New content: a new point joined "Key points", a new "Security" section with its note,
  shapes and link. Changed fact: proposed as a claim-level patch ("replaces “five” →
  “three”"), applied. Identical re-run: 0 AI calls. Edited card: "Updates your edited card:
  replaces “three” → “four”" → *"a client can connect to four (my note: check the client's
  limit) servers at once"*. Locked card (a point changed in meaning): one
  `generate_visual_plan` call for the section, card unchanged, "1 locked card not updated".
  A mere rewording of the locked point ("needs explicit approval from the user") came back
  "Nothing changed" with no notice — confirmed by design in §9.

---

## 9. Stage 1 gaps closed, and Stage 1d (2026-11-13)

**Sentences added or removed** (`claimPlanner.ts` `alignSentences`, `sentenceEdits`). A
block's sentences are aligned instead of required to match one-to-one: identical sentences
anchor the alignment (longest common subsequence); between anchors an equal number pair in
order (changed claims, classified as before), else a sentence pairs with the first later one
that still reads as the same claim (`SUPERSEDE_OVERLAP`); the rest are removed or added.
- *Added* sentences (a run of them is one edit, intent `NEW`) are an edit of the unchanged
  sentence before them — its last word, kept, with the new sentences after it — or of the one
  after them (its first word). No unchanged neighbour → rewrite.
- *Removed* sentence: an edit that removes exactly it. Contract rule 4 gained one narrow
  exception (`claimPatch.ts` `removesOneSentence`): an empty replacement may cover exactly one
  whole sentence plus the space between it and the next (or, for the last, the previous) —
  nothing of any other sentence. A block's only sentence removed → rewrite.
- More than `MAX_SENTENCE_EDITS` (4) sentences touched, or over half of a block of four or
  more, is a rewrite of the block, not claim edits — the whole-block update stands, and no
  sentence is classified one by one (this also keeps heavy rewrites fast).
- Works for edited cards too (placed onto the user's wording like any edit): an added
  sentence is merged in, a removed one is removed from the user's text when it is there word
  for word, else the conflict card.

**Rewording vs a change of meaning — confirmed by design.** When a section changes, the
model gets its current cards and how the text changed; the prompt
(`ai/visualize/tasks.ts`, the "unchanged" rule) says a node "whose concept is unchanged — the
content states the same facts about it, only worded differently" is answered
`{"id", "unchanged": true}`, and `expandUnchanged` (`reconcile/preserve.ts`) gives the
previous node back. So a pure rewording proposes nothing, nothing was skipped, and no lock
notice is right. A change of meaning updates (the second AI run). Not a bug; no change.

**Live UI check** (`e2e/local/updateReview.local.spec.ts`, local tier, screenshots viewed):
the review bar reads "~3 updated · 🔒 1 locked card not updated", with rows *Edit “Retries
happen five times. Timeouts las…”: adds “Backoff doubles each time.”*, *Edit “Setting Value”:
row 2, column 2: replaces “5” → “3”*, *Updates your edited card “Payments team (my note:
confirm with fi…”: replaces “Payments” → “Platform”*; the lock icon sits at the locked card's
corner; AI settings shows "Update behaviour" under "Clean pasted answers", in its style, with
the defaults (locked on, edited off) and Reset to defaults. Two fixes from the look:
- every card was "Edit a card" — text cards and pages are now named by their heading or first
  line (`ChangeSetReview.tsx` name map);
- an added sentence read “seconds.” → “seconds. Backoff…” — `describeClaimEdit` now says
  *adds “…”* for an edit that keeps its words and adds to them, *removes “…”*, and *replaces /
  extends “a” → “b”* (the intent verb moved from the review into `describeClaimEdit`).

**Stage 1d — cells and captions** (the plan's `update_cell` / `update_caption`, built as edit
*targets* inside `patch_block` so they share its conditional, atomic contract):
`ClaimEdit.cell: {row, col}` (header rows included) or `ClaimEdit.caption: true`; offsets and
every rule apply within that cell's or caption's text; the rest of the table (other cells,
header, column widths, cell props) or image (url, size) is kept. Planner (`tableEdits`,
`captionEdits`): same rows, columns and header rows, else rewrite; a changed cell is
classified with its whole row as context ("Retries | 5" → "Retries | 3" = SUPERSEDES — a cell
alone has no words to judge); a cell filled in or emptied, a formatting-only change, or a
changed image → rewrite; over `MAX_SENTENCE_EDITS` cells and over half → rewrite. Edited
tables: a cell edit is placed within the same cell of the user's table. Review: "row 2,
column 2: replaces “5” → “3”", "caption: …". Image blocks only occur on pages and aren't in
the change set's block types yet, so caption edits are engine- and planner-level only.

**Unrelated failing test — resolved upstream.** `domain/provenanceGuard.test.ts` passes again:
the OpenUI session changed `src/ai/openui/library.tsx` on their side; nothing changed here.

**Tests:** `claimTargets.test.ts` (18, Stage 1d), `claimPlanner.test.ts` (+9: sentences
added/removed, edited cards), `claimPatch.test.ts` (+3: whole-sentence removal, labels),
`updatePolicy.test.ts` (+2 end to end); `npx vitest run src` 3036 passed; local e2e
`reconcile.local.spec.ts` + `updateReview.local.spec.ts` 11/11. No AI run this round.

---

## 10. Implementation — Stage 2, the Node Router (2026-11-13)

Offline tests plus a live local check in the app (no AI). New code in `src/ai/router/`.

**2a — embedding tier** (`embedding.ts`). No provider implements embeddings
(`AICapabilities.embeddings` is false everywhere), so the default `Embedder` is local and
deterministic — no call, no spend: hashed features (significant words stemmed, word pairs in
order, each word's letter trigrams so "retry/retries/retried" meet), signed hashing into 2^16
buckets, sublinear weights, L2-normalised **sparse** vectors (25k objects × dense 1,024 floats
would be ~100 MB). `VectorTier` wraps a `WorkspaceIndex` behind the existing `SearchIndex`
seam (queries pass through untouched — the context builder is unchanged) and adds
`nearest(text)`; `refresh()` re-embeds only objects whose title/text hash changed and drops
removed ones. `WorkspaceIndex.objects()` (new) lists what a query could return. A provider's
real embeddings plug in as another `Embedder` (vectors are tagged with the embedder id).

**2b — descriptors** (`descriptors.ts`): per card a title, a one-line summary (first sentence,
≤160 chars), up to 6 distinctive keywords (tf·idf over the index's document frequencies), and
its section with the section's own overview takeaway reused (frame `acuteOverview`, Wave D).
`DescriptorCache` recomputes only when the card's text or section changes.

**2c — router** (`router.ts`, `routeContent`). Modes per §3: only `unanchored` runs;
`source_reconciliation` and `impact_discovery` throw `RouterModeUnavailableError` (the latter
"disabled until Stage 3"). Pool: the nearest cards by vector and the best by the index's
retrieval (`any` mode), **only elements on the canvas** (an off-canvas document — e.g. an
older card version kept for undo — was offered in the first live look; fixed and tested).
Scores, all kept as evidence: semantic (cosine), lexical (relative to the best hit), section
(cosine with the section's centroid + its name/summary — the hierarchical route), graph (a link
to one of the 3 strongest; such neighbours also join the pool); routing =
0.5·semantic + 0.25·lexical + 0.15·section + 0.1·graph (+ up to 0.1 from routing signals).
Per candidate the action: `update` when one of its sentences holds the claim (≥ 50 % shared
significant words, intent classified as in Stage 1a), `none` when it already says it
(DUPLICATE), else `insert_near` ("contains the claim" vs "related topic"). **Two confidences,
never blended:** `routing` (right place?) and `update` (SUPERSEDES/EXTENDS 0.5 + 0.5·overlap,
DUPLICATE 1, CONTRADICTS 0.15, UNCLEAR 0.1, insert 0.9); the decision uses routing only:
`NEW` below 0.2, `NEEDS_CLARIFICATION` when the top two are within 0.08 and in different
sections (or both updates), else `route`. A contradiction is escalated in the result
(`claim.escalate`).

**2d — "Where should this go?"** (`placement.ts`, `task.ts`, `signals.ts`; UI
`components/ai/PlaceContentDialog.tsx` + `placeContent.ts`):
- Entry points: ⋮ → "Place text in notes…"; Ask AI answer → "Place in notes…"; MCP read tool
  `suggest_placement` (deterministic, read-only; the agent applies a choice with
  `update_block` / `create_block`, which the user reviews; CONTRADICTS flagged "needs the
  user's decision").
- The dialog lists candidates with section, action, **Where %** and **Edit %** side by side
  (tooltips name them), and evidence; multi-select, "Add as a new card beside it instead", and
  "A new card on its own". The router's own pick is preselected only when it decided `route`.
- Optional model step `route_content` (new task id): only on an explicit "Ask AI to decide"
  when the router said NEEDS_CLARIFICATION; the model picks among the shown cards by reference,
  says `new`, or answers `needs_clarification` with a question. It never invents a destination
  or changes a confidence; a failed call leaves the router's result.
- `placeContent`: an `update` is a claim-level `patch_block` on that sentence (word-level when
  the content is that one sentence, else the sentence replaced by all of it), checked at accept
  like every patch, the card keeping its own provenance (counts as the user's edit to a later
  source update); `insert_near` a new card at the bottom of the card's section, joining its
  frame (several stack, never overlap); `new` at the viewport centre; an update that can't be
  placed exactly falls back to a new card beside it, with a note.
- Routing signals: each choice is recorded (bounded 200, per workspace, local meta store);
  similar later content (≥ 50 % shared words) gives that destination up to +0.1 routing, as
  evidence.

**Tests:** `router.test.ts` (17: embedding, incremental tier, descriptors, the plan's router
cases — direct, non-obvious (no shared word or prefix), ambiguous → asks, contains-claim vs
related, DUPLICATE, contradiction (high routing / low update), NEW, graph, signals, off-canvas
never, modes), `placement.test.ts` (11: placement kinds, stacking, fallback; the model step
with a fake runtime — only when undecided, picks only shown cards, question back, failure
leaves result), `mcp/tools/search.test.ts` (+1), `server.test.ts` (tool list); `npx vitest run
src` 3071 passed. Live, local e2e `e2e/local/placeContent.local.spec.ts` 3/3 (update in place,
new card in the section, new card alone), screenshots viewed.

**Limits / not done:**
- The local embedder catches shared stems and word forms, not true paraphrase ("callers don't
  retry together" vs "retries" scored 0.09 semantic); keyword and section signals carry such
  cases. A real embedding model is the upgrade path (the `Embedder` seam).
  *(Planned as Stage 5a, §13.2. The seam as built is synchronous and sparse, so
  it is widened there rather than reused as is.)*
- Weights and thresholds are first calibrations on small fixtures — record and tune them
  against real canvases.
- *(Checked live 2026-11-13, approved — see "Live AI check" below.)* ~~`route_content` tested with a fake runtime only~~.
- Destinations are canvas elements on the open canvas only (not other canvases or pages off the
  canvas); shapes can be insert targets, but an `update` of a shape's label isn't offered yet
  (it falls back to a new card).


**Live AI check of "Ask AI to decide" (2026-11-13, approved).** New `e2e/ai/placeContent.spec.ts`, AICredits
`openai/gpt-oss-120b`. A note with two sections ("The cache stores user sessions." / "…access tokens."),
visualized on the local tier first so the only AI calls are `route_content`. The router alone leaves all three
placements undecided (checked on the local tier); the model was asked once each:
- "…stores API keys for an hour." → picked the Tokens card ("…similar to … access tokens … credentials").
- "…stores data for an hour." → `needs_clarification`, asking back "Does the data relate to user sessions or
  access tokens?" — the right answer for a genuinely ambiguous line.
- "…stores browser logins for an hour." → picked the Sessions card; proposed, reviewed and written as a new card
  in that section.

Final run 4/4 (preflight + 3), 3 `route_content` calls, ~24 s. Every pick was among the shown cards, by
reference; the reason reached the dialog's banner. **Not deterministic:** in an earlier run cut short by a
spec bug (the item locator matched the nested "Why" bullets), the same "browser logins" line was routed to
Tokens ("similar to storing access tokens"). So the model step is a helpful tie-breaker, not an authority:
it preselects, the user still confirms in the dialog and the review. All AI spend this check: 5
`route_content` calls and 3 preflights over three runs (two cut short by spec-ordering/locator bugs, now
fixed — the case that writes a card runs last, since that card changes later routing).

---

## 11. Implementation — Stage 3, multi-location sync / impact discovery (2026-11-13)

Offline tests plus a live local check in the app (local tier, no AI call, no AI run). Router mode
`impact_discovery` (§3) is now on, as `discoverImpact` in `src/ai/reconcile/impact.ts` — it lives under
`ai/reconcile/` because it reads other cards' source links, which the provenance guard allows only there.
`routeContent` still runs `unanchored` only; asked for `impact_discovery` it says to use `discoverImpact`.

**What changed** — read from the update's own clean changes (`patch_block`, `update_block`, `update_shape`):
blocks and then sentences aligned before → after (`alignSentences`), each changed sentence classified
(Stage 1a). Only **SUPERSEDES** and **EXTENDS** propagate: a contradiction or unclear rewrite is already
escalated on its own card, and an added or removed sentence is nothing another card can repeat in a changed
form. Each claim keeps its changed words (`wordHunk`) and their replacement.

**Where else it is said** — every other card on the canvas, sentence by sentence:
- *Restates* (duplication): the sentence holds the claim — the router's own test, ≥ 0.5 of significant
  words shared (`IMPACT_OVERLAP` = `CLAIM_OVERLAP`) — **and** the changed words occur in it exactly once as
  whole words, **and** making the same edit there still classifies as SUPERSEDES / EXTENDS. → a claim-level
  `patch_block` (range edit; several claims on one card = one atomic patch).
- *Related* (reference) — listed, never edited: the claim in other words ("up to 5 times"), the changed
  words more than once in the sentence, a shape whose label repeats it (shape labels aren't patched yet), two
  edits that would overlap, or a card drawn linked to a changed card that shares a word of the claim.
- A sentence that already says the new value: nothing.
- Never considered: the source's own cards (each reconciles from its own text — if the source still says
  the old value elsewhere, that card is right), cards the set already changes, cards opted out of AI updates
  (`excludeFromReconciliation` without a lock, e.g. passage cards). Locked cards (own lock or a locked
  frame) are left alone and, when they repeat the fact, counted into `skipped.locked` ("🔒 N locked cards not
  updated"); with "Preserve locked sections" off they are offered like any card.

**Contract** (`changeSet.ts`): an offer is a `ConflictItem` with `impact: { from, claim, detail, proposed }`
whose `apply` is the `patch_block` and which has no `keep` (the schema refuses a `patch_block` conflict
without `impact`, or with `keep`). So it reuses the conflict path end to end: never applied by "Accept all";
"Update this too" adds the patch to the accepted set, where `resolveChangeSet` checks it against the card's
live content like any patch (changed since → dropped, `patch_rejected`); "Leave as is" adds nothing. The
written `update_block` carries no node key or source link, so the card keeps its own provenance — to its own
source's next update the edit is the user's, merged per Stage 1e. References are `ChangeSet.related`
(`{ target, name, reason }`, max 50, a bad value dropped, never a reason to refuse the set). Best match
first, at most 20 offers and 20 related.

**Wiring** — `ingestContent` runs it for `mode: "update"` when the new optional port `scene()` is given
(the Visualize dialog and the MCP ingest tools pass it), the set isn't empty, the request isn't a
"Re-visualize" of a selection (that must touch only its sections), and AI settings → Update behaviour →
**Suggest updates elsewhere** is on (new `UpdatePolicy.suggestElsewhere`, default on). Merges are append-only
and don't run it.

**Review UI** (`ChangeSetReview.tsx`): the bar counts "↗ N elsewhere to check" apart from "⚠ N need your
input"; an offer reads *"↗ Our worker retries five times… — Says the same as “Retries happen five
times…”, which this update changes. The same edit here: replaces “five” → “three”"*, with Now / Proposed
side by side, View diff, **Leave as is**, **Update this too**; a "Related cards, not changed" list names each
reference and why ("holds “…” in other words — not edited; check it"), with the card focusable.

**Tests:** `src/ai/reconcile/impact.test.ts` (13): the plan's tests — every card that repeats the fact
offered (the user's own and another source's), link-only / other words / shape label listed and never
edited; Accept all writes the source's card only, Update this too / Leave as is per card, the write carries
no source link; two facts changed → each card gets exactly the edits for the facts it repeats (one atomic
patch for a card with both); EXTENDS propagates as an extension; a contradiction propagates nothing; locked
card / locked section counted, offered with the setting off; opted-out and same-source cards never; the
changed words twice → listed, not guessed; a card changed after planning → dropped at accept; an
add-only update finds nothing; the schema rule; through `ingestContent`: on, setting off, Re-visualize, no
scene port. Router mode test updated. `npx vitest run src` 3084 passed. Local e2e
`e2e/local/impactReview.local.spec.ts` 2/2 (two sources repeat a fact; Update this too writes it there;
a second update with no decision leaves the other card alone; the setting is on by default), plus
`reconcile` / `updateReview` / `placeContent` 14/14. Screenshot of the review looked at.

**Limits / not done:**
- "Same claim" is lexical (word overlap + exact placement). It can't tell "retries happen five times" from
  "timeouts happen five times" when they share enough words — so each offer is a decision showing the
  sentence it matched, and never auto-applied. A real embedding model (the `Embedder` seam) or an LLM check
  of the offers is the upgrade path; none was run.
- Prose only: table cells and shape labels elsewhere are listed as related, not patched; a claim changed
  inside a table cell at the source isn't propagated yet.
- One canvas: other canvases and pages off the canvas aren't searched.
- The related list shares the conflict card's styling; it may want a quieter look after real use.
- Thresholds (0.5, 20 offers) are first calibrations on small fixtures.

---

## 12. Stage 4 design — continuous consistency (for review, 2026-11-13)

**Status (review 2026-11-13): APPROVED WITH MINOR REVISIONS.** **4a–4b approved for implementation**
(the shared accept hook and index synchronization, with failure recovery, idempotency and tests). **4c–4e:
design approved**, to be built only after the 4a–4b checkpoint (§12.10). **4f: design only**; AI checking
needs its own authorization and stays disabled. The routing weights are unchanged, the human confirmation
flow is unchanged, and no AI checking is activated. The reviewer's decisions and refinements are in §12.9 and
take precedence over anything above that differs.

**Success criterion:** accepted knowledge stays searchable and in step with the canvas, and possible
contradictions are shown with evidence. They are never resolved silently, and no other card is ever
rewritten automatically.

### 12.1 The sequence, and what is separate

```
change accepted ──► (1) index sync ──► (2) deterministic check ──► (3) AI judgment (only if needed) ──► (4) user decides
                     synchronous,       synchronous, ms,            queued, background,                 accept / dismiss /
                     local, no AI       local, no AI                retryable, budgeted                 defer — no auto-edit
```

(1) and (2)–(3) are separate operations with separate failure handling. **Nothing after the accept can undo
or invalidate it.** The accept has already been written as one undo step. A failure in (2) or (3) is
recorded as a *pending check* and can be retried (§12.4).

**One hook.** Every accepted write goes through one function, `afterAccept(home, set, result)`, called from
`acceptPendingSet` / `acceptPendingParts` (the review bar, auto-accept, MCP accept). Two places call
`acceptChangeSet` directly today: OpenUI `promote.ts` and the Source tab's `knowledgeActions.ts`. Both move
onto the hook. A guard test (like `provenanceGuard.test.ts`) fails if anything else calls `acceptChangeSet`
directly. The hook runs after the write, fire-and-forget, with its own `.catch`, as the content-source
record does today.

### 12.2 Index synchronization

**What exists (verified):**
- The live index (F22, `liveIndex.ts`) follows the scene and the document store, re-indexing only what
  changed (by text hash), in idle time, while AI mode is on.
- The router keeps its own index otherwise, synced from the scene on each use.
- MCP has its own search service with a refresh queue.

All three read the canvas, not the review. A proposed change set lives in `PendingChanges` and is drawn
only as ghosts, so **a rejected or pending change never reaches any index**, by construction. Undo restores
the scene, and the index follows it back.

**What Stage 4 adds:**
- **Targeted refresh on accept.** `WorkspaceIndex.syncObjects(canvasId, ids)` re-indexes exactly the
  elements the accepted set created, changed or removed. The vector tier and descriptors are refreshed for
  the same ids, before the check reads them. Today the next idle slice (or the next use) catches up; Stage 4
  makes it immediate and limited to the touched cards, so the check never reads a stale entry.
- **Failure and recovery.** The sync is local and deterministic, so the expected failure is an exception
  (a document not loaded yet, a malformed element). On failure:
  1. log it;
  2. mark that canvas's index *stale* (one flag per canvas);
  3. let the existing full-resync path (`markAll` → scheduler) rebuild it in the next idle slice;
  4. run no consistency check on stale data — the check waits for the resync and is recorded as pending.

  The scene and documents are the source of truth; an index is always rebuildable from them.
- **Verification.** Each entry keeps its text hash. A cheap `verify(ids)` compares those hashes to the live
  content after sync. A mismatch is a sync failure, and recovery runs as above.

**Tests:** propose → index unchanged; reject → unchanged; accept → touched entries updated and nothing else
re-indexed; undo → reverted; sync throws → stale flag set, full resync, check pending then run.

### 12.3 Contradiction detection

**Input:** the claims of the accept, meaning the sentences the set *adds or changes*. These come from
`create_*` content, from `update_block` / `update_shape` minus what the card already said, and from
`patch_block` as applied. Old disagreements on untouched sentences aren't raised by every unrelated accept.

**Retrieval (incremental, never a full rescan):** for each claim, the index returns the relevant cards on
the same canvas. It takes the top 10 by lexical retrieval plus the top 10 by vector nearness, de-duplicated,
excluding cards the set itself wrote. The cost is per claim, not per canvas. A canvas-wide scan exists only
as an explicit action (MCP `check_consistency`, a "Check this canvas" button), never automatically.

**Tier 1, deterministic (no AI)** — each claim against each sentence of each retrieved card:

| Result | Rule | Example |
|---|---|---|
| **CONFLICT** | Same claim (≥ 0.5 shared significant words, the router's test) and the Stage 1a classifier says CONTRADICTS (negation flip, opposite direction) | "Retries are enabled" / "Retries are disabled" |
| **CONFLICT** | The words around the values are the same claim (≥ 0.5 shared once the numbers are taken out), a value of the same kind differs, neither value contains the other, and **no context marker** (below) differs | "Retries happen three times" / "The worker retries five times" |
| **POSSIBLE** | A CONFLICT pattern where a context marker differs or is present on one side only: environment (staging/production/test), time (dates, years, "since", "until", "before", "after", quarters), version ("v2", "2.0"), place/region, scope qualifiers (`fidelityCues` scope and condition cues — "for admins", "per job", "on mobile"), or a comparison that may not be a contradiction ("up to", "at least", "about") | "Retries happen five times in staging" / "…three times in production" |
| **COMPATIBLE** (dropped) | Restatement, extension (EXTENDS), a value inside the other's range ("up to 5" / "3"), different subjects sharing only generic words (the shared words exclude the subject noun phrase: the first significant noun of each sentence must match) | "Timeouts happen five times" / "Retries happen three times" |

The subject rule is the main defence against the known lexical false positive (Stage 3 limits).

**Tier 2, AI judgment — POSSIBLE pairs only:**
- One new task, `judge_consistency`: a batch of pairs. Each pair is the two sentences, the two card titles
  and their section names, and nothing else from the canvas.
- Answer per pair: `contradicts` | `compatible_context` | `compatible` | `unclear`, a one-line explanation,
  and, only for `contradicts`, a neutral suggested resolution ("confirm which value is current").
- The model never edits, never chooses a winner, and never sees ids it could act on. It refers to pairs by
  local references, as `route_content` does.
- `compatible*` answers are recorded (as evidence) and not shown as conflicts. `unclear` is shown as a
  possible conflict with "AI couldn't tell".
- With AI off, or the "AI consistency check" setting off, POSSIBLE pairs are shown as *possible* conflicts,
  labelled "not checked by AI". They are never dropped silently.

### 12.4 Conflict records: persistence and lifecycle

**Storage.** The device-local meta store, one record per canvas: `consistency:<workspaceId>:<canvasId>`,
bounded at 200 conflicts and 50 jobs, oldest closed ones dropped first. It is the same store as routing
signals and source outcomes, so it moves with the workspace backup and is ready for cloud sync later
(cloud-sync-plan).

```ts
ConsistencyConflict {
  id;                                    // hash(sorted element ids + both sentence hashes): the same pair is one record
  a, b: { elementId, sentence, sentenceHash, cardName, section? };
  kind: "contradicts" | "differs"; certainty: "deterministic" | "ai" | "possible";
  explanation; suggestion?;              // tier 1 detail, or the model's line
  evidence: { rule | model, provider?, at };
  raisedBy: operationId;
  status: "open" | "confirmed" | "dismissed" | "deferred" | "obsolete";
  decidedAt?; deferredUntil?: "next_change" | timestamp;
}
ConsistencyJob {
  operationId; claims: { elementId, sentenceHash }[];
  stage: "index_pending" | "ai_pending" | "done" | "failed";
  attempts; lastError?; nextRetryAt?;
}
```

**User actions** (never an automatic cross-card edit):
- **Accept**: "yes, this is a real conflict". Status becomes *confirmed*; it stays marked on both cards
  until one of them changes. Optional **Propose a fix** builds an ordinary reviewed change set (a
  claim-level patch from Stage 1b, on the card the user picks). Nothing is written without the normal
  review.
- **Dismiss**: "not a conflict". This is remembered for this exact pair of sentences (`sentenceHash` on
  both sides). It never comes back unless either sentence changes.
- **Defer**: hidden until either card changes, or until a date the user picks.

**Re-evaluation after later changes.** Whenever an accept (or the index, for a user's own edit) changes a
card that has open, confirmed or deferred conflicts, those conflicts are checked again:
- a sentence is gone or reworded → *obsolete*, closed with a line in the panel's history, never deleted
  silently;
- still disagreeing → kept;
- deferred until the next change → reopened.

Undo of the accept that raised a conflict is the same case: the sentence is gone, so the conflict becomes
obsolete.

**Stage 3 interaction:** "Leave as is" on an impact offer is a decision about that exact pair, so it is
recorded as a *dismissal* and the post-accept check doesn't raise the same disagreement again. Cards still
on the related list stay flagged, because the user hasn't decided on them.

**Pending and retry.**
- Tier 1 runs synchronously in the hook; if it fails, the job is `failed` with its error.
- Tier 2 is queued as `ai_pending` and retried automatically with backoff: on the next idle slice, then
  after 1 minute, then after 10 minutes, at most 3 attempts. After that it stays `failed`, with **Retry** in
  the panel.
- Jobs are persisted, so a reload resumes them.
- The accept is never awaited, rolled back or marked as failing because of a job.

**Surfaces:**
- A small "⚠ 2 possible conflicts" badge after accept.
- A **Consistency** panel listing open, possible and pending items. Each shows **both statements side by
  side**, both card names (each focusable), the section, the explanation, the certainty (rule / AI /
  possible) and the actions.
- Markers on both cards, reusing the marker layer.
- MCP read tool `get_consistency` (open conflicts), and agents see open conflicts in
  `get_session_context` warnings. There is no MCP write; decisions are the user's.

### 12.5 Evaluation set

`evaluation/update-engine/consistency/pairs.json` will hold about 70 labelled sentence pairs, each with
`category`, `expected` (`conflict` | `possible` | `compatible`) and a short rationale. Labels follow
[[no-manual-steps]]: independent model labellers with consensus, splits excluded, marked *provisional, not
human-validated* until the user reviews them.

| Category | n | Examples |
|---|---|---|
| True contradictions — negation / direction | 12 | enabled/disabled; "grows" / "shrinks"; "is required" / "is optional" |
| True contradictions — values | 12 | 3 vs 5 retries; 10 s vs 30 s timeout; owner A vs B (a non-numeric value) |
| Lexical false positives | 15 | different subjects sharing words (timeouts vs retries); different metrics (p50 vs p99); a different entity with the same verb |
| Contextual differences (compatible) | 15 | staging vs production; before/after a date; v1 vs v2; region; per job vs per day; "up to 5" vs 3 |
| Restatements / extensions (compatible) | 10 | paraphrase; added clause; same value written differently ("five" / "5") |
| Ambiguous (AI should say `unclear` or `possible`) | 6 | missing context on both sides |

**Gates, before the feature is turned on by default:**
- Tier 1 CONFLICT precision ≥ 0.9.
- Contextual differences reported as CONFLICT ≤ 10 %.
- With tier 2, the share of true contradictions shown (conflict or possible) ≥ 0.85.
- Tier 2 runs record-and-replay, as the knowledge-notes golden set does: one approved live recording, then
  replayed offline in CI at no AI cost.

**Regression tests (§5 of the review):**
- accepted update → checked;
- rejected update → no index change, no check;
- unrelated cards → nothing;
- a real contradiction → shown with both statements;
- an apparent one that is compatible → not shown;
- dismissal sticks; obsolete after edit or undo;
- an AI failure → accept intact, job pending, then retried;
- a failed index sync → stale, resync, then check.

### 12.6 Cost and latency budget

| Step | Budget | Notes |
|---|---|---|
| Index sync (touched ids) | ≤ 20 ms p95 for a set touching ≤ 50 cards | local; measured in `performance/synthetic.ts` on a 2,000-card canvas |
| Tier 1 check | ≤ 50 ms p95 for ≤ 20 claims × ≤ 20 retrieved cards | after the write, off the input path (idle slice if over budget) |
| Tier 2 calls | **≤ 1 call per accepted set**; ≤ 10 pairs per call; ≈ ≤ 1,500 input + 300 output tokens | only POSSIBLE pairs; pairs beyond 10 stay "possible, not checked by AI" |
| Tier 2 latency | target ≤ 5 s p50 (the live `route_content` calls took about 3–4 s each), 30 s timeout | background; the user is never waiting on it |
| Daily cap | 50 `judge_consistency` calls per workspace per day (a setting) | beyond it, jobs wait as pending for the next day or a manual Retry |
| Default | "AI consistency check" **off** until the §12.5 gates pass on replay | tier 1 runs regardless (free) |

Money is budgeted in tokens. The price depends on the connected provider's rates, and none is quoted here.
The one evaluation recording needs the user's approval like any AI run.

### 12.7 Build order once approved (each step tested before the next)

- **4a.** `afterAccept` hook, with the two direct callers moved onto it and the guard test.
- **4b.** Targeted index sync, verification and stale-flag recovery.
- **4c.** The evaluation set (provisional labels).
- **4d.** Tier 1 rules, measured against 4c.
- **4e.** Conflict store, lifecycle and re-evaluation; the Consistency panel and markers; MCP read tool.
- **4f.** Tier 2 task and job queue with retry, behind the setting; record-and-replay. The live recording
  waits for approval.

### 12.8 Questions for the reviewer

1. **Scope**: the same canvas only for v1 (recommended), or the whole workspace?
2. **The user's own edits** (not change sets): v1 re-evaluates existing conflicts when a card is edited, but
   raises *new* conflicts only after accepted change sets (recommended, matching the approved sequence).
   Should manual edits raise new ones too?
3. **"Accept" a conflict** = confirm it's real, plus an optional *Propose a fix* through normal review. Is
   that the intended meaning?
4. **Tier 2 default** off until the gates pass (recommended)?
5. **"Leave as is" on a Stage 3 offer** counts as a dismissal of that pair. Agreed?

### 12.9 Review decisions and required refinements (2026-11-13)

**Decisions on §12.8:**

| Question | Decision |
|---|---|
| 1. Scope | **Same canvas for v1.** Keep the design extensible to other canvases (canvas id on every record and query). |
| 2. Manual edits | **They don't raise new conflicts in v1**; they re-check existing ones. **Index sync happens for every content mutation**, manual edits included. |
| 3. Accept on a conflict | **It confirms the conflict is real.** Any correction goes through the existing review workflow. |
| 4. AI default | **Off until the gates pass *and* the user explicitly approves.** Passing the thresholds never turns it on by itself. |
| 5. Stage 3 "Leave as is" | **It dismisses that exact pair.** A material change to either statement (its sentence hash) makes the pair eligible again. |

**Refinement A — the index invariant.** The index reflects the latest **committed** canvas state, however
that state was produced: accepted AI changes, manual edits, deletions, undo and redo. A failed
synchronization leaves an explicit **stale** state with a recoverable rebuild. **No consistency check runs
against a known-stale index.**

**Refinement B — an idempotent commit.** One accepted change is one committed revision and **one** logical
consistency-check job, with stable revision and job ids. Retries, reloads or repeated events never duplicate
accepted content or conflict records.

**Refinement C — detection separate from resolution.** States:
`pending → possible → confirmed / dismissed / deferred → closed`. AI output is **evidence for review, never an
authority** that confirms or resolves a conflict. An unresolved *possible* conflict and a *confirmed*
contradiction are distinct in both storage and UI. This replaces §12.4's `open`/`obsolete`: a conflict that
no longer applies is *closed* with the reason "statement changed".

**Refinement D — stronger evaluation.** The three thresholds are kept (rule precision ≥ 90 %, context
false-positive rate ≤ 10 %, contradiction recall ≥ 85 %). In addition:
- report precision and recall **per category** (temporal, environment, numeric, subject mismatch,
  restatement, …);
- measure **rules alone** and **rules + AI** separately;
- keep a **held-out subset** (about a quarter, fixed before any tuning) that is never used to tune rules or
  prompts.

### 12.10 Checkpoint before going past 4b

1. Every accepted-content path uses the shared commit mechanism.
2. Rejected and pending changes never update the committed index.
3. Manual edits, deletions, undo and redo keep the index consistent.
4. A simulated index failure gives a visible stale state, and recovery succeeds.
5. Repeated accept events and retries can't duplicate commits.
6. No consistency-check failure can roll back an accepted change.
7. Stage 3 routing and the human confirmation behaviour are unchanged.

### 12.11 Implementation — 4a and 4b (2026-11-13)

Offline tests plus local e2e in the app. No AI runs, no AI checking. Routing weights and the human
confirmation flow are unchanged.

**4a — the shared commit** (`src/ai/changes/commit.ts`, `src/components/ai/commitOnCanvas.ts`):
- `commitChangeSet` / `commitParts` are now the only callers of `acceptChangeSet` / `acceptParts`.
  `commitGuard.test.ts` fails on any other caller; the Repo Map test world is allowed, with its reason, and
  `live.acceptParts(…)` is a port method the canvas implements through the shared commit.
- All five live accept paths go through `commitSetOnCanvas` / `commitPartsOnCanvas`:
  - `acceptPendingSet` (the review bar, auto-accept, MCP accept);
  - `acceptPendingParts` (merged sets, part by part);
  - OpenUI `promote.ts`;
  - the Source tab's `knowledgeActions.ts`;
  - the Repo Map auto-accept, through the canvas port.
- **Idempotent.** One accepted change is one `CommittedRevision`. Its ids are stable: `rev:<operationId>` for
  a whole set, and `rev:<operationId>#<sorted part keys>` for parts of a merged set. Each revision carries
  exactly one check job, `check:<revision>`, held on the revision so it can never be duplicated.
  - A repeated accept of the same operation writes nothing and returns null. This covers a double-click, a
    retry, and the same set again.
  - A merged set writes each part once, whatever order or repetition the accepts come in.
- **The `CommitJournal`.** It is in memory, and in the meta store under `commits.journal` (the 1,000 most
  recent revisions), so it survives a reload. Restored MCP proposals that were already committed are not put
  back under review (`restorePendingProposals` checks the journal). This closes a small real gap: a reload
  between writing an accepted MCP set and saving its removal could have offered it again.
- **`afterCommit`**, isolated and never throwing, runs:
  1. the index sync and verification;
  2. the job — `awaiting_checker` until 4d builds the checker, or `waiting_for_index` while the index isn't
     fresh;
  3. the post-commit listeners (the future checker). A failure is recorded on the job (`failed`, attempts,
     `lastError`), and the commit stands.
- Fixed during the in-app check: `McpBridgeHost` must import the commit path dynamically, as it does its
  other browser-only modules. A static import broke server rendering ("window is not defined"); this was
  caught before anything else depended on it.

**4b — index synchronization** (`src/search/indexHealth.ts`, `liveIndex.ts`, `workspaceIndex.ts`,
`indexScheduler.ts`):
- **Two existing gaps closed:**
  - The scheduler swallowed failures; it now reports them (`onError`).
  - `WorkspaceIndex` stamped an object as indexed *before* its work ran, so a failed unit left the object
    looking current while its old text stayed indexed. It is now stamped only after the work succeeds, so
    the object stays due.
- **A third gap, found by the in-app check:** a deleted card's document, kept in the store for Undo, stayed
  searchable as an "off-canvas block". Now a block of a canvas whose scene is indexed, but which no live
  element there shows, is never returned. Blocks of other canvases still are, and Undo makes the card
  findable again.
- **`IndexHealth`, per canvas:** `fresh` → `stale` (a failure, or verification finds objects out of date) →
  `rebuilding`, which rebuilds from the scene, the source of truth.
  - Backoff is 0 s, 1 s, 5 s; after 3 failed rebuilds the canvas stays `failed` until Retry.
  - A failure reported during the canvas's own rebuild counts as that rebuild failing, so there is no
    rebuild storm.
  - `whenFresh` holds anything that must not read a stale index.
- **`WorkspaceIndex.verifyScene`:** a side-effect-free comparison of each object's indexed stamp against the
  scene, plus anything indexed that the scene no longer has. It shares one collection pass with
  `planScene`, so the two can't diverge.
- **`syncCommitted`**, after every commit, runs the pending work now and verifies. It never throws. With AI
  mode off there is no live index; the router's and MCP's on-demand indexes already sync from the committed
  scene before every read, so the state reported is `on_demand`.
- **UI:** `IndexStatusBadge`, shown only when the index isn't fresh: "Search index out of date — updating…",
  "Rebuilding the search index…", or "Search index couldn't be rebuilt — search, Ask AI context and
  placement may miss recent changes." with **Retry**.
- **Dev hooks:** `__acuteDev.failIndex(n)`, `indexState()`, `indexTexts()`, `verifyIndex()`, `commits()`.

**Checkpoint evidence (§12.10):**

| # | Criterion | Evidence |
|---|---|---|
| 1 | Every accepted-content path uses the shared commit | `commitGuard.test.ts` (no other caller; the canvas paths listed) |
| 2 | Rejected and pending changes never update the committed index | `indexSync.test.ts` (proposed, then rejected: index unchanged); e2e `commitIndex` 1–2 (not indexed before Accept; a rejected proposal never indexed, no commit) |
| 3 | Manual edits, deletions, undo and redo keep the index consistent | `indexSync.test.ts` (each verified; a deleted card's document not found, Undo brings it back); e2e `commitIndex` 3 (in the app, verified after each) |
| 4 | A simulated failure gives a visible stale state, and recovery succeeds | `indexHealth.test.ts` (6); `indexSync.test.ts` (a failed unit stays due, then recovers); e2e `commitIndex` 4 (badge, then "couldn't be rebuilt" + Retry, then Retry recovers; content untouched; screenshots viewed) |
| 5 | Repeated accepts and retries can't duplicate commits | `commit.test.ts` (7: same op twice, after a reload, merged parts in any order, one job per revision, an already-committed proposal not restored); e2e `commitIndex` 1 (a double-clicked Accept: one revision) |
| 6 | No consistency-check failure can roll back an accepted change | `afterCommit.test.ts` (3: a throwing or rejecting step is recorded on the job and the revision is untouched; a stale index holds the job, nothing runs until fresh) |
| 7 | Stage 3 routing and human confirmation unchanged | e2e `impactReview`, `placeContent`, `reconcile`, `updateReview`, `changeReview` all pass unchanged |

**Runs:**
- `npx vitest run src`: 3110 passed (+26), none failing.
- Local e2e: 47/47 across `commitIndex` (new, 4), `changeReview`, `impactReview`, `reconcile`, `updateReview`,
  `placeContent`, `knowledgeNotes`, `agentHistory`, `openuiDemo`, `chatUpdateFromAI` and `mcpAccess`.
- `tsc`: clean in these files. The one error is in another session's new
  `evaluation/knowledge-notes/experiments/openui-2026-11-13/`.

**Not done (by design; 4c–4f):** no checker, no conflict store or panel, no evaluation set, no AI task. Every
job waits as `awaiting_checker`. The badge appears only in failure states, so it hasn't been seen in normal
use.

### 12.12 4c — the held-out split, fixed before any rule (2026-11-13)

`evaluation/update-engine/consistency/heldout.json` (19 pairs, about a quarter of the set) was written before the
dev split and before any 4d rule existed. **SHA-256 `9114c001350a2da346bbb7522fd6b540ee68eea194b2ae9684240d8958fe9488`**, recorded here at that point. Rules and prompts are
tuned on the dev split only; the held-out split is run once, after the rules are final, and reported as it comes
out (§12.9 D). The labels are **provisional**: author-labelled by the assistant, not human-validated, and not model
consensus — that needs an approved AI run ([[no-manual-steps]], [[no-ai-runs-without-approval]]).

### 12.13 Implementation — checkpoint self-review, 4c, 4d and 4e (2026-11-13)

On 2026-11-13 the user said: "review it yourself and proceed to remaining steps". So the 4a–4b checkpoint was
reviewed by the assistant rather than by the user, and 4c–4e were built. **4f was not built**: the review made it
conditional on a separate authorization of live AI evaluation and a reviewed paid recording, and "proceed" doesn't
cover a paid run ([[no-ai-runs-without-approval]]). No AI ran, and the routing weights are unchanged.

**Self-review of 4a–4b — three findings, fixed:**
1. *A check job held for a stale index was never resumed.* If the index stayed failed past the 60 s wait, or
   the app reloaded, the job sat at `waiting_for_index` forever. `resumeCheckJobs` now re-runs waiting jobs,
   interrupted ones, and failed jobs with attempts left (at most 3; after that, the user's Retry). It runs only
   while the index is fresh: when the canvas opens and whenever its index turns fresh again. Each revision's one
   job is reused, never duplicated.
2. *The stored journal could grow large* (every touched id per revision). It is capped at 500 ids per revision.
3. *A job never reached `done`.* `runListeners` now settles every post-commit step: `done` when all succeed,
   `failed` with the error otherwise. The journal also notifies listeners, so the UI's "checking…" follows it.

Reviewed and left as they are: the journal swap happens once at start-up, before any commit; a merged set
that is already fully committed settles cleanly; the badge's one-second poll runs only while AI mode is off.

**4c — evaluation set** (`evaluation/update-engine/consistency/`; held-out fixed first, §12.12):
- 56 dev pairs and 19 held-out pairs in 13 categories, with provisional author labels.
- `src/ai/consistency/evaluation.ts` scores them per category, rules alone.
- `evaluation.test.ts` asserts the rule gates on dev only, pins the held-out file's SHA-256, and only *reports*
  the held-out results.

**4d — tier-1 rules** (`src/ai/consistency/rules.ts`, `judgePair`), deterministic:
- **Opposites:** a negation, or one antonym swapped.
- **Different values of the same claim:** the subject must match, the context words around the values must be
  at least half shared, and the values must clash. "Up to", "at most", "at least" and "about" are bounds, so a
  value inside the other's range is compatible.
- **Context markers** (environment, time, version, platform, region, "per X" vs "in total") turn a
  disagreement into *possible*.
- **Different metrics** (p50 / p99, average / peak, daily / monthly) and **different subjects** are
  compatible.
- **One term swapped** in an otherwise identical claim is *possible*, never a conflict, and not when one side
  is negated.
- **Too little context** ("The limit is 100") is *possible*.
- Tuned on dev only, in two rounds of general changes (irregular past forms, marker words left out of the
  context, the negation guard on term swaps).

| Split | Rule precision | Context false positives | Recall, rules alone | Matches expected | `possible` on compatible pairs |
|---|---|---|---|---|---|
| dev (56) | **100 %** | **0 %** | 100 % | 52/56 | 39 % |
| held-out (19, run once) | **100 %** | **0 %** | 88 % | 18/19 | 46 % |

- **Per category (held-out):** every category matches except `numeric`, which is 2/3. The miss is h03, "every
  two weeks" vs "every week": a period with no number isn't read as a value.
- **Dev misses:** four, all "possible" where "compatible" was expected, or the reverse (d35, d36, d45, d51).
  None is a false conflict.
- **Gates:** both rule gates pass on both splits. The recall gate (≥ 85 %) is defined for rules + AI, which
  hasn't run. Rules alone reach 88 % on held-out.
- **Noise:** "possible on compatible" is 39–46 %. It counts the context pairs, where *possible* is the intended
  verdict (they go to the user, or to the AI tier once authorized), and some one-term swaps ("user sessions" /
  "access tokens").

**4e — conflict store, runner, review UI, MCP:**
- `src/ai/consistency/store.ts` — records with exact-pair ids (the two cards plus the hashes of the two
  sentences). Lifecycle: `possible` → `confirmed` / `dismissed` / `deferred` → `closed`; "pending" is the
  revision's job.
  - Only the user's decision moves a record, except closing: a record closes only because a statement itself
    changed ("statement changed", which covers an edit or an undo) or no longer disagrees.
  - A dismissal holds for that exact pair; a material change to either sentence makes a new pair.
  - "Later" lasts until either card changes, or until a time.
  - Bounded at 200 per canvas (closed records dropped first), kept in the meta store, survives a reload.
- `src/ai/consistency/check.ts` — the checks run only on what a commit *newly* says (`newClaims`, captured in
  the shared commit: the sentences just before the write against just after, kept on the job). `detect` checks
  against the retrieved candidates, never the claim's own card, one detection per pair of cards. `fixFor` builds
  the claim-level patch for a confirmed value conflict.
- `components/consistency/consistencyRunner.ts`, a post-commit step (`onCommitted`):
  - retrieval through the index (the router's tier: lexical plus vector, same canvas, ≤ 20 candidates per
    claim) — never a rescan;
  - rules, then the store; Stage 3 "Leave as is" pairs (passed from the review's decisions, kept on the job)
    are recorded *dismissed* and never shown;
  - re-checks the touched cards' open records;
  - manual edits, undo and redo re-check open records only (document and scene subscriptions);
  - "Propose a fix" puts a `patch_block` proposal (`task: consistency_fix`) into the normal review. Nothing
    is written without Accept.
- `components/consistency/ConsistencyPanel.tsx`:
  - a chip ("⚠ N possible conflicts", "N confirmed", "checking…", "N checks couldn't run");
  - the panel: both statements side by side, both cards (focusable), the reason, and a label (*Rule: can't
    both be true* / *Possible — needs a look (not checked by AI)* / *Confirmed conflict*, the last with a red
    border), with **It's a conflict / Not a conflict / Later**. Confirmed items offer *Propose: make "…" agree*
    and *Not a conflict after all*;
  - Retry for failed checks;
  - ⚠ markers on both cards (dimmer while only possible).
- MCP read tool **`get_consistency`**: the open records of a canvas, read-only, with an optional `meta` reader
  on the MCP read services. The description tells agents not to resolve conflicts themselves.
- Dev hook: `__acuteDev.conflicts()`.

**Tests:**
- Units:
  - `store.test.ts` (7): lifecycle, exact-pair dismissal, Stage 3 pairs, closing only on change, defer, touched
    scope, reload;
  - `check.test.ts` (3);
  - `evaluation.test.ts` (2);
  - `afterCommit.test.ts` (+1: resume, done);
  - MCP `server.test.ts` (+1: `get_consistency`).
  - `npx vitest run src`: **3124 passed**, none failing.
- Local e2e, new `e2e/local/consistency.local.spec.ts` (5):
  - two sources disagree → possible with both statements and evidence, markers → confirmed → fix proposed →
    reviewed → accepted → closed (still on record);
  - "Not a conflict" sticks; a manual edit raises nothing new;
  - "Later", then a card edit → back;
  - undo of the commit that raised it → closed ("statement changed");
  - Stage 3 "Leave as is" → dismissed and not shown, and a later material change raises it again.
- Screenshots of the possible and confirmed states were viewed.
- All related local specs: **52/52** (`consistency`, `commitIndex`, `changeReview`, `impactReview`,
  `reconcile`, `updateReview`, `placeContent`, `knowledgeNotes`, `agentHistory`, `openuiDemo`,
  `chatUpdateFromAI`, `mcpAccess`).

**Limits / not done:**
- **4f (AI judgment on `possible` pairs) is not built.** Those pairs are shown as "not checked by AI". The
  combined rules + AI recall is unmeasured.
- **Recall gap found live:** a clause that dilutes the shared words ("Our worker retries five times *before
  giving up*") hides a value conflict from the rules, though Stage 3's impact offer, which counts the number
  word itself, catches it. Like h03, it is not tuned for.
- **Labels are provisional.** Model-consensus labelling needs an approved AI run.
- **Same canvas only** (decision 1). The canvas id is on every record and query, ready for wider scope.
- **`get_session_context` doesn't yet warn about open conflicts.** Agents read them with `get_consistency`.

### 12.14 Stage 4f — the bounded AI evaluation recording (2026-11-13)

**The review of 4c–4e (2026-11-13):** 4a–4b fixes, 4d rules and the 4e workflow accepted; 4c fixtures accepted
provisionally (independent label validation still needed). **4f approved for one bounded recording campaign only**, under
these conditions:
- the recorded fixtures only;
- two independent model labellers, with disagreements kept for human review;
- the AI kept separate from the rule results;
- the §12.6 limits;
- usage, cost and latency recorded;
- no sensitive canvas content;
- no reruns or tuning without another decision.

Not authorized: AI checking of real accepted changes, which stays off by default even if the gates pass, and automatic
conflict resolution.

**Built (the minimum for the recording; nothing in the app calls it):**
- `src/ai/consistency/judge.ts`:
  - the `judge_consistency` task (registered, with schemas), answering `contradicts` / `compatible_context` /
    `compatible` / `unclear`, plus a why and an optional neutral suggestion;
  - `planCalls`: ≤ 10 pairs and ≤ 1,500 estimated input tokens a call, a call cap, and the rest left "possible, not
    checked by AI";
  - `outputBudget`: input + output ≤ 1,800;
  - pairs referenced as `p1…p10`, never ids.
- `combine`, the rules + AI policy, **fixed before the recording and not changed after it:**
  - only a rule `possible` is affected;
  - `contradicts` → *likely* ("AI: likely conflict", still the user's decision), **except when the rules saw a context
    marker differ: then it stays *possible*** (the model can't turn a context difference into a definite conflict);
  - `compatible*` → hidden, with the answer kept as evidence;
  - `unclear` or no answer → *possible*.
  - `PairJudgement.contextDiffers` was added to `rules.ts`. It is additive, and no rule verdict changed.
- `judgeEvaluation.ts`: rules + AI scoring (a *conflict call* is a rule `conflict` or *likely*) and label agreement.
  It never rewrites a label.
- `evaluation/update-engine/consistency/regressions.json`: the two known misses as regression cases.
  - r01 repeats held-out h03 word for word; `heldout.json` is unchanged and its hash still verified.
  - r02 is the 4e e2e pair: "Our worker retries three times before giving up." / "Retries happen five times."
  - A test pins that the rules still miss both, so nothing was tuned on them.
- The recorder `src/ai/contractTests/consistencyJudge.contract.test.ts`:
  - it refuses without a named, approved run, never overwrites a run, caps the campaign at 50 calls, and does no repair
    retries;
  - it stops a model after a failed first call.
- The offline replay `judgeEvaluation.test.ts`: scores every recording and checks the limits held (≤ 10 pairs, ≤ 50
  calls, each held-out pair classified at most once).

**The run:** `evaluation/update-engine/consistency/recordings/2026-11-13-judge-baseline/`.
- Files: meta, every call's prompt, raw reply, usage, cost and latency, judgments, labels, report.
- Connection: AICredits.
  - Classifier `openai/gpt-oss-120b` (the app's model), `reasoning_effort: low`, temperature 0.
  - Labellers `anthropic/claude-haiku-4.5` and `deepseek/deepseek-v3.2`: different vendors from the classifier and from
    each other.
- Only the synthetic fixture sentences were sent.
- **20 calls**, all `ok`, none truncated, none skipped:
  - classifier: 4 (dev 10 + 9 pairs, regressions 2, held-out 6);
  - labellers: 8 each.
- **Largest call 1,289 tokens** (limit 1,800).

| | Rules only | Rules + AI |
|---|---|---|
| Precision of conflict calls | dev 100 % · held-out 100 % | dev 100 % · held-out 100 % |
| Context false-positive rate | dev 0 % · held-out 0 % | dev 0 % · held-out 0 % |
| Contradiction recall | dev 100 % · held-out 88 % | dev 100 % · held-out 88 % (h03 never reaches the AI) |
| Unresolved *possible* | dev 19 · held-out 6 | dev 0 · held-out 0 |
| Compatible pairs still shown as *possible* | dev 39 % · held-out 46 % | dev 0 % · held-out 0 % |
| AI / label disagreement | n/a | 0 of 23 answered non-ambiguous pairs |
| AI "contradicts" on a context pair | n/a | 0 (the context guard never had to act) |
| Cost | local, free | **$0.0245** at catalogue prices for the whole campaign; the provider reported 2.654 in its billing unit (AICredits bills INR, so ≈ ₹2.65). Classifier alone: $0.0004. |
| Latency | local (ms) | classifier p50 **14.9 s**, max 24.0 s (4 calls); labellers p50 3.6 s (Haiku), 8.9 s (DeepSeek) |

**What the classifier did:**
- It answered all 25 *possible* pairs: 4 true contradictions → `contradicts`; 15 + 5 compatible pairs →
  `compatible_context` / `compatible`.
- It said `contradicts` on the two ambiguous pairs (d55 "The limit is 100" / "…500"; d56 "It takes 5 minutes" /
  "…2 hours"). They would be shown as *likely*. Ambiguous pairs are left out of precision; both labellers also called
  them contradictions.
- **The two known misses:** the rules call both compatible, so by design they are never sent and rules + AI still
  misses them (recall 0/2). Sent as a diagnostic, the classifier answered `contradicts` on both. So the AI would catch
  them **if** such near-misses were routed to it, which is a design change needing its own decision; it was not made.

**Label agreement** (77 pairs; the labellers never saw the provisional labels or categories):
- The models agree on 69/77; all three (both models and the author) on 65/77.
- **Model disagreements (8, for human review):** d01, d17, d21, h07, h08, h14, h19, r02. DeepSeek leans to
  "ambiguous" or "multiple channels possible"; Haiku once read an extension (h19) as a contradiction.
- **Both models against the provisional label (4, the strongest signals a label may be wrong):**
  - d19 "Builds run on GitHub Actions" / "…on Jenkins": author contradiction, models ambiguous;
  - **d37 "Retries happen up to five times" / "…three times"**: author compatible (a value inside a bound), models
    contradiction;
  - d55 and d56: author ambiguous, models contradiction.
- Classifier vs labellers on the 27 pairs it judged: Haiku 26/27 (d19), DeepSeek 21/27.
- **No label was changed.** Agreement isn't ground truth; the 12 listed pairs wait for the user's review.

**Held-out exposure (disclosed):**
- The classifier saw the 6 held-out pairs the rules leave *possible*, once.
- Each labeller saw all 19 held-out pairs once.
- Nothing was tuned on any result. The prompt and `combine` were written before the run.

**Findings to weigh:**
1. **Latency misses the §12.6 target** (p50 ≤ 5 s): gpt-oss-120b took 10.5–24 s a call, even at low reasoning.
   That's acceptable for a background check, but the 30 s timeout leaves little room. A faster model would need its own
   recording.
2. **The AI removes the noise, not the misses.** Rules + AI shows no compatible pair, and found no false positive and no
   context conversion. But recall is unchanged, because the rules' misses never reach the AI.
3. **Small sample:** 25 judged pairs, written by the same author as the labels and the prompt. 100 % here is not broad
   reliability.
4. **Reproducing the run:** the live integration, if approved, must send the same `reasoning_effort: low`, or be
   re-recorded.

**Not done (by the authorization):**
- no runner wiring;
- no setting, nothing on by default;
- no reruns;
- no prompt or rule tuning;
- no label changes.

**Tests:** `judge.test.ts` (7) and `judgeEvaluation.test.ts` (3 scoring + 1 replay). The full unit run, beside the
recording, had 32 timing and timeout failures from load. All 23 files pass when rerun alone or serially; none touch
the consistency code.

### 12.15 Near-miss routing, candidate budget and label adjudication — offline (2026-11-13)

**The review of §12.14 (2026-11-13): "approve refinements first".** The recording stays the accepted baseline. The AI
resolved 25 of 25 *possible* pairs but left contradiction recall unchanged, so it hasn't yet shown it adds value.
Approved:
- near-miss routing in the deterministic candidate selector and the offline evaluator, with regression tests,
  prioritization and budget enforcement;
- label adjudication, stored separately;
- replay of the recorded answers, with no new model calls.

Not approved: additional paid evaluation (needs its own sample, model and maximum spend first) and live 4f activation.
Stage 4f stays **OFF**.

**The design.** Three routes, each decided by structured comparisons rather than a lower similarity threshold:
- **Definite compatible → excluded.** Different subjects, different metrics, a value inside the other's range ("up to
  five" / "three", d37), or nothing found.
- **Possible → AI.** The existing uncertainty route.
- **Near-miss → AI.** A rule `compatible` with a `nearMiss` flag. The verdict itself is unchanged, so the live check and
  the rule-only metrics are unchanged. Three kinds:
  - **value:** the same subject (the rules' subject test) and clashing values of one dimension, but too little shared
    wording to call it the same claim. r02: "Our worker retries three times before giving up" / "Retries happen five
    times".
  - **frequency:** both sentences state a rate ("every two weeks", "twice a week", a sentence-final "weekly"), read as
    occurrences a day. The rates differ, and the subject and the rest of the claim match (≥ 0.5 of the words). r01 /
    h03: "every two weeks" / "every week". This check runs **only where the other rules found nothing**, so a
    conflict they find ("3 times a week" / "5 times a week") is never weakened.
  - **negation:** opposite polarity, the same subject, no values, and at least half of the content words shared in a
    different order ("doesn't support pagination" / "pagination is supported").
  - A near-miss whose context markers differ keeps its `contextDiffers` flag, so a context difference stays
    distinguishable from a contradiction.
- **The combination with the AI answer** (`combine`, extended):
  - near-miss + "contradicts" → *likely*, except where the contexts differ → *possible*;
  - "compatible*" → hidden, with the answer kept as evidence;
  - "unclear" → *possible*;
  - no answer → hidden but `awaitingAI` (tracked, not dropped).
  - A bound with a value inside it never reaches the AI, because the value doesn't clash. That keeps "a limit vs the
    actual count" a definite compatible, as adjudicated for d37.

**Candidate selection and budget** (`src/ai/consistency/candidates.ts`):
- **Priority**, so the 10-pair cap is never spent on harmless ambiguity while a likely contradiction waits:
  - 4 — a near-miss without a context difference;
  - 3 — a possible one-term swap;
  - 2 — a possible value clash with too little context;
  - 1 — anything whose context differs.
- `planForChange` makes at most one call per accepted change: ≤ 10 pairs, inside the token budget, from the ranked list.
- **Every candidate ends in exactly one place:**
  - the call;
  - `pending`, with a reason: `over_call_limit`, `daily_cap` or `change_already_checked`;
  - `skipped`, with a reason: `ai_check_off`.
- `JudgeBudget`: one call per change and 50 a day (UTC). A reservation is taken synchronously before sending, so a
  burst can't overrun it. The state can be persisted and reloaded.
- **Not wired into the app.**

**Results:**

*Routing confusion matrices* (truth × route, before any AI answer):

| dev (56) | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction | 17 | 4 | 0 | 0 |
| compatible | 0 | 13 | **0** | 20 |
| ambiguous | 0 | 2 | 0 | 0 |

| regressions (2) | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction | 0 | 0 | **2 (r01, r02)** | 0 (was 2) |

| held-out (19), reported once | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction | 6 | 1 | **1 (h03)** | 0 (was 1) |
| compatible | 0 | 5 | **0** | 6 |

*Replayed with the recorded answers only* (no calls):

| | Baseline routing (possible only) | Near-miss routing |
|---|---|---|
| Routing recall (contradictions shown or sent to the AI) | dev 100 % · held-out 88 % · regressions 0 % | dev 100 % · **held-out 100 %** · **regressions 100 %** |
| Recall after the recorded answers | dev 100 % · held-out 88 % · regressions 0 % | dev 100 % · held-out 88 % (h03 awaiting AI) · **regressions 100 %** |
| Precision / context false positives | 100 % / 0 % | 100 % / 0 % (no compatible pair newly routed) |

The regressions reach 100 % because both pairs were answered "contradicts" in the recording, as a diagnostic. h03 has
no recorded held-out answer, so it shows as awaiting AI; a new call would need new approval.

*The two known misses:* both are near-misses now, and with the recorded answers both are shown as *likely* conflicts.
The rules alone still show nothing; a test pins their verdict as `compatible`.

*Candidate budget behaviour* (tests):
- With all 21 dev + regression candidates in one change, the call takes r01, r02, d17–d20 (every routed contradiction),
  d45, d51, d55 and d56. The 11 context pairs wait as `over_call_limit`.
- A synthetic burst of 15 candidates puts the near-miss and the swap first; the harmless context pairs wait.
- 60 changes in a burst produce exactly 50 calls; the rest are `daily_cap`. The same change again is
  `change_already_checked`, and the next day the budget is fresh.
- With AI off, all candidates are `ai_check_off`.

*Latency* (per classifier call, from the recording and measured offline):
- provider p50 14.9 s (max 24.0 s);
- parsing and validation 0.09 ms;
- conflict-store update for 10 pairs 0.19 ms.
- So the provider is essentially the whole cost. Queue wait and edit-to-visible need the runner wiring, which isn't
  authorized, so they aren't measured. The 30 s timeout and the retries are unchanged.

**Label adjudication** (`evaluation/update-engine/consistency/adjudication.json` and `.md`, side by side; the original
labels and the recording are unchanged):
- 12 entries, each with:
  - both full statements;
  - the context qualifiers (markers, bounds, frequency);
  - the original label and rationale;
  - both labellers' labels and rationales, and the classifier's answer where there is one;
  - today's rule route.
- **Decided** (the reviewer's provisional assessment, 2026-11-13):
  - d19 → ambiguous (the original said contradiction);
  - d37 → compatible (confirmed);
  - d55 and d56 → ambiguous (confirmed).
- **Awaiting the reviewer:** d01, d17, d21, h07, h08, h14, h19, r02.
- `withAdjudication` applies decisions as an overlay; the evaluator can report on original or adjudicated labels.

**Disclosures:**
- The near-miss rules and the probes in `candidates.test.ts` were written together, on dev and the regressions; they
  show intent, not independent evidence.
- r01 repeats h03 word for word, so h03 is no longer independent evidence of near-miss routing.
- The held-out matrix was computed once, before a final correction (the frequency check moved after the other rules).
  The correction only affects pairs the rules already call conflict or possible, which excludes h03; the held-out
  matrix was not recomputed.
- The held-out split has also been seen by the evaluation models (§12.14). **A genuinely unseen set is needed** before
  any claim of broad reliability.

**Tests:**
- `candidates.test.ts` (22): the known misses, probes, context, priority, overflow, burst, per-change and daily caps,
  AI off, reload;
- `judgeEvaluation.test.ts` (7): misses, dev routing, priority on the set, adjudication overlay, replay of both routings
  with the latency breakdown;
- `judge.test.ts` (7).
- All consistency tests: 49 passed.
- The local e2e `consistency.local.spec.ts` 5/5: the live check is unchanged.
- `tsc` is clean apart from another session's file.

**Next decision** (the user's): review the 8 open adjudications. Then, if wanted, a proposal for one small paid
recording on a new, unseen set (sample, model, maximum spend), to measure whether near-miss routing recovers
contradictions without new false positives.

### 12.16 Budget verification fixes and the unseen-evaluation proposal (2026-11-13)

**The review of §12.15:** the offline checkpoint was accepted, and live activation stays blocked.
- The eight open adjudications stay unresolved until the reviewer has seen the full evidence. Nothing is recorded under
  their name.
- Preparing a new unseen evaluation is approved. **The paid run is not yet approved.**

**§5 verification conditions, now met** (`candidates.ts`; the selector's design is unchanged):
- **Three independent limits:**
  - per call: ≤ 10 pairs and ≤ 1,800 tokens;
  - per day: ≤ 50 **calls**;
  - per day, separately: ≤ 90,000 **tokens**. Each call reserves its estimated input plus its whole output allowance
    (`callTokens`). Money is budgeted in tokens.
  - A test shows a token cap stopping calls the call cap alone would allow.
- **"Already checked" is per committed revision** (`rev:…`): a content change is a new revision. An explicit Retry of
  the same revision is allowed and still counted.
- **Already-answered pairs are skipped by sentence-pair fingerprint** (the store's `pairId`). A materially changed
  sentence is a new fingerprint, so it is eligible again (tested).
- The scorer adds **strict recall** (shown as a conflict or likely conflict). A routed pair without an answer counts as
  missed in every recall.
- The context false-positive rate now also counts platform, region and version pairs. This was done before the freeze;
  dev has none of those categories, so the earlier numbers are unchanged.

**The unseen set** (`evaluation/update-engine/consistency/unseen/`):
- **`pairs.json`:** 36 pairs, statements only (no labels, no categories), in new domains: payroll, invoices, warehouse,
  onboarding, certificates, an SDK, pricing, DNS, the board, sign-ups.
- **Coverage** (the author's design, in `author-draft-key.json`):
  - frequency (4) and frequency equivalence (2);
  - numeric limits (5);
  - explicit and paraphrased negation (3);
  - different metrics (2);
  - context: environment, temporal, platform, region, version, scope (6);
  - value swaps (2), a diluted value (1), numeric (2), direction (1);
  - restatement and extension (2);
  - adversarial surface similarity (4);
  - ambiguous (4).
  - Draft: 14 contradictions, 18 compatible, 4 ambiguous.
- **Overlap:** `src/ai/consistency/unseen.test.ts` checks for no shared sentence and no near-duplicate (word Jaccard ≥ 0.6)
  against dev, held-out, regressions, the unit-test probes and the consistency e2e. It found one: the first u28
  (Frankfurt / Virginia) nearly repeated an existing pair. It was replaced (Canada / Brazil) before anything ran on the
  set.
- **Frozen** (`unseen/FREEZE.json`, SHA-256, checked by the test and the recorder):
  - the pairs and the draft categories;
  - `rules.ts` and the two fidelity modules it reads;
  - `judge.ts` (prompt and combining policy);
  - `candidates.ts`;
  - both scorers;
  - the recorder.
  - `pairs.json` = `c8621e179463e988d1e768792c7b541cb7b7112da50ea76ed00ce76792679673`.
  - Not frozen: the shared `runtime.ts` (JSON reply parsing), which other work may touch.
- **Nothing has run on the set:** no rules, no selector, no model.

**The process** (`src/ai/contractTests/consistencyUnseen.contract.test.ts`; each step runs once and refuses if any frozen
hash changed):
1. **Labels:** the reviewer labels `unseen/labelling-sheet.md` blind (statements only), into `unseen/labels.json` with
   `blind: true`.
   - The author's draft is compared only afterwards, with every difference listed for the reviewer, whose labels are the
     ground truth.
   - No model labels and no classifier answers exist before this.
2. **`route` (free, no network):** the frozen rules and selector over all 36 pairs. It writes `routing.json` (the route
   and priority of every pair, the candidate counts, the planned calls with their token maxima) and the rules-only
   report. The labels' hash is recorded.
3. **`classify` (paid, needs its own approval):** exactly the planned calls, once.
   - It refuses if the labels changed after routing, and it never reruns.
   - The call cap and the dollar ceiling are enforced before each call on worst-case cost; a call not sent is recorded
     as `not_sent`, and its pairs count as missed.
4. **Report, end to end over all 36 pairs** (not only the routed ones), for rules only, baseline routing and near-miss
   routing:
   - candidate-routing recall;
   - final recall (shown) and strict recall (conflict or likely);
   - conflict precision;
   - the context false-positive rate;
   - unresolved and unanswered counts.

**Proposal for the paid step** (for approval):

| Item | Proposal |
|---|---|
| Pairs | 36 new pairs (draft 14 / 18 / 4; the reviewer's labels decide) |
| Expected AI candidates | Known only after step 2 (the selector runs after the labels are frozen, so routing can't bias them); at most 36 |
| Calls | ≤ 4 expected (10 pairs a call); **hard cap 6**. One call per batch, no repair retries, no reruns |
| Tokens | ≤ 1,800 a call, so ≤ 10,800 in all |
| Model / provider | `openai/gpt-oss-120b` on AICredits, `reasoning_effort: low`, temperature 0, 30 s timeout: the §12.14 settings. No labeller models |
| Spend | Worst case $0.0018 at catalogue prices (all tokens at the output price). **Hard ceiling $0.05**, enforced in code |
| Reference labels | The reviewer, blind; the author's draft compared afterwards; disagreements listed; no model consensus |
| Overlap | None with dev, held-out, regressions, probes or e2e (checked); one near-duplicate replaced before the freeze |
| Content | Synthetic sentences only |

**Limits of independence (disclosed):**
- The same author wrote the rules and the unseen pairs, and designed the categories knowing the rules' weak spots. The
  draft labels aren't independent either; the reviewer's blind labels are the ground truth.
- If the reviewer wants more independence, they can add or replace pairs of their own before labelling. That needs a
  re-freeze, and nothing would have run yet.

**The eight open adjudications** (d01, d17, d21, h07, h08, h14, h19, r02) are given in full to the reviewer from
`adjudication.md`. No decision is recorded.

**Tests:**
- `candidates.test.ts` (25: + token cap, Retry, fingerprint);
- `unseen.test.ts` (3: freeze, blind, no overlap).
- All consistency tests: 54 passed. `tsc` is clean apart from another session's file.
- The recorder refuses without labels (checked).

### 12.17 Adjudications recorded, budget accounting verified, conditional approval of the unseen recording (2026-11-13)

**The review of §12.16:**
- The eight adjudications were decided on the full statements.
- **The unseen recording is conditionally approved:** ≤ 6 calls, ≤ 10,800 tokens in all, ≤ $0.05, gpt-oss-120b on
  AICredits with the baseline settings, once. No paid retries, no labellers, no model switching. It may run, with no
  further approval, once all of these hold:
  1. all 36 blind labels are reviewed and frozen;
  2. the hash checks pass;
  3. the free routing pass has recorded the candidate counts;
  4. the budget accounting is clarified;
  5. the recorder enforces every ceiling and stops safely.
- Stage 4f stays **OFF**. No commits, no routing-weight changes.

**Adjudications** (`adjudication.json` / `.md`, the overlay layer only; `dev.json`, `heldout.json`, `regressions.json`
and the recording are unchanged):
- d01 → ambiguous; d17 → ambiguous; d21 → compatible; h07 → compatible; h08 → compatible; h14 → compatible;
  h19 → compatible; r02 → ambiguous. Each has the reviewer's reason, verbatim.
- d19 → ambiguous, d37 → compatible, d55 and d56 → ambiguous (§12.15) remain.
- All 12 are decided.
- d01 and r02 are *conditional* contradictions: inconsistent only if they describe the same retry mechanism.
- h07 isn't a contradiction just because the classifier said so.

**Adjudicated metrics** (recorded answers only, no calls; reported next to the original-label metrics, never replacing
them):

| Split, routing | Original labels | Adjudicated labels |
|---|---|---|
| dev, baseline and near-miss | precision 100 % (21/21) · recall 100 % (21/21) · context FP 0 % (0/16) | precision 100 % (18/18) · recall 100 % (18/18) · context FP 0 % (0/16). Shown as a conflict but labelled ambiguous (not counted): d01, d17, d19, d55, d56 |
| regressions, baseline | recall 0 % (0/2) | recall 0 % (0/1) |
| regressions, near-miss | precision 100 % (2/2) · recall 100 % (2/2) | precision 100 % (1/1) · recall 100 % (1/1, r01). **r02 is now ambiguous**: its *likely* is reported as "ambiguous shown as conflict", not as a recovered contradiction |
| held-out, baseline | precision 100 % (7/7) · recall 88 % (7/8) | **precision 86 % (6/7)** · recall 86 % (6/7) |
| held-out, near-miss | precision 100 % (7/7) · recall 88 % (7/8) · routing recall 100 % (8/8) | **precision 86 % (6/7)** · recall 86 % (6/7) · routing recall 100 % (7/7) |

- **The finding: h07 is a false *likely* conflict.** The classifier read two non-exclusive destinations ("Alerts go to
  the on-call channel" / "…the platform channel") as a contradiction.
- The same pattern explains d17 and d19 (value swaps without exclusivity, now ambiguous) being shown as conflicts.
- It comes from the classifier on the `possible` route, not from near-miss routing.
- **The prompt is frozen and wasn't changed.** The unseen set tests it: u12 and u30 state exclusivity ("sole owner",
  "all invoices"); u26 doesn't.
- The held-out split was recomputed once, at the reviewer's explicit request, from recorded answers.

**Budget accounting** (`candidates.ts`):
- The reviewer was right: with the defaults (50 × ≤ 1,800 = 90,000) the token cap can't block a call the call cap
  allows. The earlier test only showed it binding with a lower cap (3,000).
- Clarified:
  - a reservation holds the worst case (estimated input + whole output allowance);
  - `settle(reservation, actualTokens)` releases only the unused part, once;
  - a failed call, or one without usage, keeps it all;
  - a reservation never releases more than it reserved, and one from an earlier day is ignored;
  - the call count is never released.
- So the token cap binds when set lower (a spend budget) or if the per-call limit is raised; the two stay independent.
- Tests: the default arithmetic (the 51st call stopped by the call cap at exactly 90,000), release, keep on failure,
  single settle, no over-release, day rollover.
- The recorder's own ceilings, each checked on the worst case before every call: calls, a required total token ceiling
  (`CONSISTENCY_UNSEEN_MAX_TOKENS` ≤ 10,800, new), and dollars. A call that would pass any of them isn't sent; its pairs
  count as missed.

**The scorer** now prints every rate with its numerator and denominator, keeps ambiguous pairs shown as conflicts apart,
and names the route of each false conflict call (so near-miss false positives are visible on their own).

**The route step** also records the 10-pair survival: if every candidate came in one accepted change, which routed
contradictions its one call would take, and which it would leave out.

**Re-freeze (before anything ran on the unseen set):**
- Changed: `candidates.ts`, `judgeEvaluation.ts`, the recorder.
- Unchanged: the pairs, the draft key, the rules, the prompt and combining policy.
- `pairs.json` is still `c8621e179463e988d1e768792c7b541cb7b7112da50ea76ed00ce76792679673`.

**The blind labelling sheet** (36 statements, no labels, rule results or predictions) is given to the reviewer.
Context qualifiers aren't extracted: the marker extraction is part of the rules, which mustn't run on the set before
the labels are frozen, and the qualifiers are in the statements' own words.

**Tests:** all consistency tests 56 passed; the recorder refuses ("labels missing").

### 12.18 The unseen recording (2026-11-13)

**Inputs:**
- The reviewer's 36 blind labels (14 contradiction / 19 compatible / 3 ambiguous) were transcribed verbatim into
  `unseen/labels.json` and added to `FREEZE.json` (SHA-256 `6cddd9ed…`). Every other frozen hash was checked unchanged
  first.
- The free route step and then the single paid classify step ran:
  `evaluation/update-engine/consistency/unseen/runs/2026-11-13-unseen/`. The recorder now refuses a rerun.

**Gates before the paid step:**
- the labels frozen; the hashes pass; routing recorded;
- 2 planned calls (≤ 6), 3,600 tokens reserved at most (≤ 10,800), a worst case of $0.0006 (≤ $0.05);
- the budget accounting clarified (§12.17).

**The call:**
- 2 calls, both `ok`, none truncated: 10 and 5 pairs, 1,295 and 887 tokens (2,182 in all).
- $0.00023 at catalogue prices; the provider reported 0.0252 in its billing unit (INR, ≈ $0.0003).
- 22.3 s and 16.0 s.

**Routing** (truth × route; the reviewer's labels):

| truth | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction (14) | 1 (u27) | 5 (u05, u08, u12, u24, u33) | 5 (u01, u03, u14, u17, u21) | **3 (u06, u19, u30)** |
| compatible (19) | 0 | 3 (u20, u26, u32) | 2 (u23, u29) | 14 |
| ambiguous (3) | 1 (u35) | 0 | 0 | 2 (u16, u31) |

**End to end, all 36 pairs:**

| | Rules only | Rules + AI, baseline routing | Rules + AI, near-miss routing |
|---|---|---|---|
| Candidate-routing recall | 6/14 (43 %) | 6/14 (43 %) | **11/14 (79 %)** |
| Final recall (shown at all) | 6/14 (43 %) | 6/14 (43 %) | **11/14 (79 %)** |
| Strict recall (conflict or likely) | 1/14 (7 %) | 5/14 (36 %) | **10/14 (71 %)** |
| Conflict precision (ambiguous left out) | 1/1 (100 %) | 5/6 (83 %) | 10/11 (91 %) |
| Context false-positive rate | 0/5 | 0/5 | 0/5 |
| Unsupported conflict calls (ambiguous shown as conflict or likely) | u35 (rule) | u35 | u35 |
| Unresolved possible | 5 | 1 (u08) | 1 (u08) |
| Unanswered candidates | — | 0 | 0 |

**Findings:**
1. **Near-miss routing added value on unseen data.** It recovered 5 contradictions (u01 frequency, u03 and u17 negation,
   u14 and u21 values), all answered "contradicts". Strict recall went 36 % → 71 % and precision 83 % → 91 %.
   **Near-miss routing caused no false conflict call:** its two compatible candidates (u23, u29) were both answered
   compatible.
2. **The recall gate (≥ 85 %) is not met: 79 %.** Three contradictions never reach the AI, because the rules exclude
   them:
   - u06, two limits ("limited to 25 MB" / "up to 100 MB"): both are maxima, which the rules treat as compatible;
   - u19, a paraphrased optional ("mandatory" / "may choose whether to turn on");
   - u30, a currency swap under "All".
   These are new selector blind spots. They are not tuned for on this set.
3. **One AI false positive: u26** ("The team uses Postgres" / "…MongoDB"). The reviewer's label is compatible; the AI
   assumed exclusivity. This is the same pattern as h07 (§12.17), on the existing `possible` route. In the report, "u26
   (ambiguous, …)" names the author's design category; its reference label is compatible. Where exclusivity was stated
   (u12 "sole owner"), the AI was right.
4. **The context guard held back a correct answer:** u08 (certificate dates). The rules read "until" as a context marker,
   so the AI's "contradicts" stayed *possible*. It was still shown, so it counts toward recall but not strict recall.
5. **The unsupported conflict call is the rules', not the AI's:** u35 ("Prices went up 10%" / "…4%"), a rule conflict
   on a pair the reviewer judged ambiguous. The AI never saw it.
6. **The 10-pair limit, in one change:** if all 15 candidates arrived in one accepted change, its call would take 8 of
   the 10 routed contradictions. u33 and u08 would wait (`over_call_limit`), partly behind the two compatible
   near-misses ranked above them. u23 is a near-miss only because a month counts as 30 days ("twice a year" / "every six
   months" = 182.5 vs 180 days).
7. **Latency:** 16–22 s a call, as in the baseline. Over the §12.6 target, accepted for offline evaluation only.

**Labels:** the author's draft differed from the reviewer on four pairs (u05, u10, u26, u31; the totals differ by
one). The comparison is in `unseen/label-comparison.md`; neither key was adjusted.

**Not done (by the authorization):**
- no reruns, repairs, extra judges or tuning on this set;
- the three blind spots, the 30-day month and the exclusivity pattern are recorded, not fixed. Fixing any of them would
  be tuning unless it is measured on yet another set.
- Stage 4f stays OFF; nothing is wired into the app.

### 12.19 Targeted refinements (offline) and the second unseen set (2026-11-13)

**The review of §12.18:** the recording is valid evidence, and its set is now diagnostic and regression material only.
Approved offline:
- the selector fixes (limits, modality, exclusive universal claims, calendar-aware frequencies, temporal context, the
  u35 overconfidence);
- a classifier policy that doesn't infer exclusivity;
- evidence-based ranking with overflow still tracked;
- preparing a second unseen set (≈ 50–60 pairs, ≥ 20 contradictions, ≥ 20 compatible, a separate author, blind labels).

**No paid call. Stage 4f OFF.**

Activation gates (none activates anything by itself):
- final recall ≥ 85 %;
- strict recall reported, target ≥ 85 %;
- precision ≥ 90 % on non-ambiguous labels;
- context false positives ≤ 10 %;
- no systematic unsupported conflicts on non-exclusive relationships.

**Selector specification after §12.19** (`rules.ts`; every dev verdict unchanged — the dev misses are pinned to d35, d36,
d45, d51):
- **Limits.** "limited to", "capped at" and "a limit of" are maxima. Two different limits of the same kind never clash
  by themselves; for the same subject they are a **near-miss (`limit`)** — they may govern different cases. A value
  over a stated maximum is still a rule conflict ("at most 2,500" / "holds 4,000"); a value inside it is excluded.
- **Modality.** Each statement is classed required, optional, prohibited or permitted, with negation applied
  ("not required" = optional, "cannot" = prohibited). A conflicting pair (required/optional, prohibited/permitted,
  required/prohibited) is a **near-miss (`modality`)** only when the two claims are the same apart from at most one
  word. A different action ("cannot edit" / "can view") is two claims.
- **Negation near-miss**, tightened to the same rule: at most one unmatched content word, with participles and
  gerunds matched ("support" / "supported", "export" / "exporting").
- **Exclusive universal claims.** A one-term swap is `exclusive` when a statement says only one value holds (only,
  sole, solely, exclusively, all, every, single, primary, default, main, due). "US dollars" is a currency, not a
  region.
- **Frequencies**, calendar-aware: occurrences a year (a month = 1/12 year, a week = 365.25/7 days), so "every six
  months" equals "twice a year". The tolerance is 2 %.
- **Temporal context vs date values.** "valid / available / supported / open … until <date>" states the value, not a
  time scope. The text of a full date (its year) is never a context marker. Full dates are compared as values:
  different dates for the same subject are a **near-miss (`date`)**. "Until March, …" at the head of a claim is still a
  scope.
- **Changes are not levels.** A value after up / down / by / rose / grew / fell / increased … is a change. Two changes
  are at most *possible* ("baseline and period not stated"), never a rule conflict (u35).
- **Hyphenated number words** ("two-factor", "three-tier") name a kind, not a value.
- **More irregular verbs:** shrank and shrunk → shrink (so grew / shrank is a known antonym), sank, rang.
- These rules are **shared with the live rules-only consistency panel (4e)**. So "two changes" now shows as possible
  instead of a conflict, and grew / shrank as a conflict. The local consistency e2e still passes 5/5. The AI path stays
  disconnected.

**Classifier policy after §12.19** (`judge.ts`):
- The prompt adds: "A difference is not a contradiction unless the claims cannot both be true under the same subject,
  scope and time. Do not infer exclusivity solely from different named values…". Then which properties can naturally
  hold several values (databases, channels, shared ownership) and which can't (a single configured limit, required vs
  optional, prohibited vs permitted, explicit sole ownership, two dates for one event). "A maximum and an actual or
  smaller amount fit together. When the evidence is insufficient, answer 'unclear'."
- `combine`: a possible one-term swap that isn't `exclusive` and that the AI reads as "contradicts" stays *possible*
  ("nothing says only one can hold — needs a look"). It is shown for review, never a likely conflict. With exclusivity
  ("sole owner", "All invoices") it is *likely*.
- **Not run against a model** (no paid call). The revised prompt's own behaviour is unmeasured. The replays below use
  answers recorded with the baseline prompt, combined under the new policy.

**Ranking** (`candidates.ts` `priorityOf`):
- From the rules' evidence, never the route alone or any label: 2 × incompatibility (strong 3 / medium 2 / weak 1)
  + 1 for the same claim, so 2–7. Context differences come last (1).
- Strong: clashing values or dates for the same subject, frequencies, modality, negation, an exclusive swap.
  Medium: a coexisting swap, two limits. Weak: thin context, changes.
- Overflow is still `pending` with its reason.

**Regression coverage**
- `regressions-unseen1.json`: u06, u08, u19, u23, u26, u30, u35, plus u29 and u33. Each is labelled regression
  evidence, with the route at the recording and the intended route.
- `regressionsUnseen1.test.ts` (17): every intended route, plus the counter-cases:
  - a value over a maximum still conflicts;
  - a value inside a bound is excluded;
  - "Until March, …" is still a scope;
  - "For US customers" is still a region;
  - a different action isn't modality;
  - two levels still conflict;
  - the ranking order.

**Results (offline, no calls):**
- **Dev, rules only:** precision 100 %, context FP 0 %, recall 100 %, 52/56. Unchanged and pinned.
- **Dev, near-miss routing, recorded baseline-prompt answers, new combining policy:**
  - original labels: precision 19/19, recall 21/21, **strict 19/21**. d17 and d19 (owners, CI tools — no exclusivity)
    are now held at *possible*.
  - adjudicated labels: precision 18/18, recall 18/18, strict 18/18. Ambiguous pairs shown as a conflict: d01 (a rule
    conflict) and d56 (the AI on thin context).
- **Regressions:** r01 and r02 are still near-misses.
- **First unseen set, DIAGNOSTIC only** (not a score; its pairs drove these fixes): with all of its candidates in one
  change, the 10-pair call holds 10 contradictions. Waiting with `over_call_limit`: u21 and u06 (contradictions); u26,
  u20, u32 (compatible); u35 (ambiguous). **No compatible pair outranks a contradiction**, where before u23 and u29 did.
- The held-out split is no longer re-scored in the test runs (only its hash is checked); its scores stay as reported.

**The second unseen set** (`evaluation/update-engine/consistency/unseen2/`):
- **The code was frozen first** (`unseen2/FREEZE.json`: rules, the two fidelity modules, judge, candidates, both
  scorers, the recorder), before any pair existed.
- **Author:** a fresh agent given only the coverage spec and a list of subjects to avoid (no earlier sentences). It
  was told not to open any repository file and reported opening none.
- **56 pairs** (`pairs.json`, statements only, SHA-256 `8f15b8f0…`). The author's draft (`author-draft-key.json`,
  frozen, not read by the rules' author beyond its counts): 21 contradiction / 26 compatible / 9 ambiguous, across
  modality 7, temporal 7, limit 6, exclusivity 6, paraphrase 5, frequency 4, extension 4, subject mismatch 4,
  adversarial 4, frequency equivalence 3, metric 2, numeric 2, scope 1, environment 1.
- **Overlap:** none with dev, held-out, regressions, the first unseen set, its regressions, the unit-test probes or
  the e2e (`unseen2.test.ts`).
- **Nothing has run on it:** no rules, no selector, no model.
- **Recorder:** `CONSISTENCY_UNSEEN_SET=unseen2`, the same two one-shot steps and ceilings.

**Proposed paid step (for approval):**

| Item | Proposal |
|---|---|
| Model / provider | `openai/gpt-oss-120b` on AICredits, the baseline settings (`reasoning_effort: low`, temperature 0, 30 s), the **revised** prompt |
| Calls | Known after the free route step (at most 56 candidates); **hard cap 6** (6 × 10 = 60 ≥ 56) |
| Tokens | ≤ 1,800 a call, so **≤ 10,800** |
| Spend | Worst case ≈ $0.0018 at catalogue prices; **ceiling $0.05**, enforced |
| Labels | The reviewer, blind, on `unseen2/labelling-sheet.md`; the author's draft compared afterwards |
| Report | Rules only / baseline routing / near-miss routing: routing recall, final and strict recall, precision (ambiguous apart), context FP, unsupported conflict calls, the 10-pair survival, every rate with numerator and denominator |

**Tests:**
- all consistency tests 77 passed, 1 skipped (the labels check, until the labels exist);
- the full unit suite 3,187 passed, 0 failed;
- the local consistency e2e 5/5;
- `tsc` clean apart from another session's file.

### 12.20 The second unseen recording (2026-11-13)

**Inputs and preflight:**
- The reviewer's 56 blind labels (22 contradiction / 29 compatible / 5 ambiguous: v17, v23, v33, v44, v54) were
  transcribed verbatim into `unseen2/labels.json` and frozen (SHA-256 `743dfe34…`), after checking that every frozen
  hash (code first, then pairs and draft key) was unchanged. They are the reviewer's interpretation of the statements,
  not an independently established factual ground truth.
- The free route step ran once: 10 candidates of 56, 1 planned call, 1,800 tokens reserved, a worst case of $0.0003
  (caps 6 / 10,800 / $0.05). Scope: the second unseen set only.
- Then the single approved recording: `evaluation/update-engine/consistency/unseen2/runs/2026-11-13-unseen2/`.
- **The call:** 1, `ok`, 10 pairs, 1,721 tokens, 15.8 s, $0.00018 at catalogue prices (the provider reported 0.0196 in
  its billing unit, INR). No unanswered candidate. The recorder refuses a rerun.

**Routing** (truth × route):

| truth | rule conflict | possible → AI | near-miss → AI | excluded |
|---|---|---|---|---|
| contradiction (22) | 2 (v16, v27) | 0 | 5 (v09, v10, v20, v25, v42) | **15** |
| compatible (29) | **2 (v40, v43)** | 4 (v03, v32, v48, v50) | 1 (v38) | 22 |
| ambiguous (5) | 0 | 0 | 0 | 5 |

**End to end, all 56 pairs:**

| | Rules only | Rules + AI, baseline routing | Rules + AI, near-miss routing |
|---|---|---|---|
| Candidate-routing recall | 2/22 (9 %) | 2/22 (9 %) | 7/22 (32 %) |
| **Final recall** (shown) | 2/22 (9 %) | 2/22 (9 %) | **7/22 (32 %)** |
| **Strict recall** (conflict or likely) | 2/22 (9 %) | 2/22 (9 %) | **5/22 (23 %)** |
| **Conflict precision** (ambiguous left out) | 2/4 (50 %) | 2/4 (50 %) | **5/7 (71 %)** |
| Context false-positive rate | 0/5 | 0/5 | 0/5 |
| Unsupported conflict calls (ambiguous shown as conflict or likely) | none | none | none |
| Unanswered candidates | — | 0 | 0 |
| Cost / latency | local | $0.00018 / 15.8 s (one call for both AI pipelines) | same |

**Every gate fails:** final recall 32 % (target ≥ 85 %), strict recall 23 %, precision 71 % (target ≥ 90 %). Only
context false positives (0 %) and unsupported conflict calls (none) pass.

**Failures by source:**

| Source | Count | Pairs |
|---|---|---|
| **Candidate selection** — a contradiction the rules exclude, so the AI never sees it | **15** | v01, v35 (must / optional: the wording around them differs by more than one word); v04, v29, v52 (exclusive claim vs "also" / a counter-example / an added approver); v08, v31, v46, v56 (a paraphrased opposite: accessible / cannot reach, includes / no, welcome / no pets, free / pay); v12, v34, v53 (frequencies the rules don't parse as one claim: "every Monday", "once a year, in August", the same rooms worded differently); v13 (8:30 / 8:00 not read as values); v18 (voluntary / automatically enrolled and can't leave); v41 (any station / must return to the same one) |
| **Deterministic verdict** — a rule conflict on a compatible pair | **2** | v40 (120 rooms / 95 *available* for booking), v43 (the Premium plan / the Team plan: different subjects read as one) |
| **AI classification** — the model wrong on a routed pair | **0** | all 10 right: 5 contradictions → "contradicts", 5 compatible → compatible / compatible_context |
| **Combining policy** — a correct AI answer held back | **2** | v09 ("Last Saturday …"), v25 ("next year" / "the following year"): the rules saw a context difference, so the AI's "contradicts" stayed *possible*. Shown, so in recall; not in strict recall |

**What it means:**
- **The bottleneck is candidate selection, not the classifier.** On this set the AI was right on every pair it saw
  (10/10; on the first unseen set 14/15). But the rules let only 10 of 56 pairs through, and only 7 of the 22
  contradictions.
- The near-miss rules generalise poorly to a different author's phrasing: paraphrased opposites, exclusive claims
  contradicted by an example, schedules written as days of the week. Each §12.19 fix was right for its pattern, but
  patterns written against earlier sets don't cover a new author's wording.
- **Patching the selector pattern by pattern after each evaluation would be tuning to the test.** The first set showed
  it, and this set confirms it.
- The two rule false positives (v40, v43) show the same narrowness in the other direction: the value rule treats
  "rooms" and "rooms available", or two plans, as one claim.

**Labels:** the author's draft differed from the reviewer on six pairs (v10, v28, v33, v35, v40, v48). The comparison
is in `unseen2/label-comparison.md`; neither key was changed. The five ambiguous reference pairs stay ambiguous; none
was shown as a conflict.

**Not done (by the authorization):**
- no reruns, no repairs, no tuning on this set;
- the 15 selector misses, the 2 rule false positives and the 2 guard holds are recorded, not fixed;
- Stage 4f stays OFF.

### 12.21 Retrieval-then-judgment pipeline (offline) and the third unseen set (2026-11-13/14)

**The architecture decision after §12.20:**
- Stop extending the selector with one-off rules. Build high-recall candidate retrieval followed by AI judgment, with
  deterministic safety constraints and human review.
- Hard exclusions need positive evidence; low shared wording is never enough.
- Safeguards:
  - A: no numeric difference between different metrics or subjects becomes a conflict (v40, v43 as controls);
  - B: no assumed exclusivity;
  - C: context is distinguished from the value asserted (v09, v25), without removing the guard wholesale;
  - D: no silent loss of recall to the budget — report what fits, what waits, and whether it can ever be processed.
- Two separate measurements: candidate-generation recall and budgeted selection recall.
- A third unseen set (80–100 pairs, a new author isolated from the earlier sets, the routing code and the failure
  ids; isolated pairs and competing batches; blind labels before the selector).
- No paid recording yet. Stage 4f OFF.

**Built** (`src/ai/consistency/screen.ts`; the tier-1 rules' logic and the live rules-only panel are unchanged — only
helper exports and a `thin` field were added):

    new or changed sentence → related sentences (recall first) → screen → budgeted AI judgment → guards → user review

- **Related** (`relatedness`): a shared meaningful word (generic words left out), or local-embedder cosine ≥ 0.2.
  Only the clearly unrelated are dropped.
- **Rule conflict** (shown without the AI) only when the rules find a conflict *and* the statements are the same claim
  word for word apart from their values, or an exact negation or antonym flip. Precision first: v40 and v43 now go to
  the AI.
- **Excluded**, each with a stated reason:
  - `values_agree` (including a value inside a limit);
  - `same_frequency` (calendar-equivalent, the rest of the claim the same);
  - `different_metrics` (named metric words);
  - `different_scope` (the same kind of scope stated on *both* sides with different values);
  - `extension` (one says all the other says and more; same polarity and modality; no exclusivity word on the shorter
    side);
  - `unrelated`.
- **Forwarded:** everything else that is related, ranked by evidence:
  - strong: values, dates, frequencies or limits that differ; negation; modality; a contradicts-flip;
  - medium: a swapped value, exclusivity;
  - then the same claim (+1), with similarity as a tie-break;
  - a scoped pair last.
- **Context guard, refined (C)** — `scoped` holds the AI's "contradicts" at *possible* only for:
  - scope stated on both sides;
  - an environment, platform, region or version on one side;
  - a time phrase heading the sentence;
  - past tense with a time marker.

  Not for a unit ("per order"), a period inside the claim ("into the next year"), or an observation checked against a
  stated limit.
- **Guards in `combine`:**
  - context — as before, with the refined scope;
  - a non-exclusive swap (B) — as before;
  - **new, `thin`:** a statement with fewer than two claim words ("The limit is 100", "It takes 5 minutes"), or changes
    without a baseline. The AI's "contradicts" alone stays *possible*.
- **`pipelineEvaluation.ts`:**
  - `evaluatePipeline`: generation recall, recall, strict recall and precision with recorded answers (a forwarded
    pair without an answer counts as missed), context FP, rule false positives, false exclusions by reason and
    category, unsupported conflict calls;
  - `budgetedSelection`: each pair's `a` is an accepted change, against every related sentence of its pool (`pool`:
    the whole set as one canvas; `batch`: its batch). Only its one ≤ 10-pair call counts. Also: candidates per change,
    what waited and what outranked it, pending total, the Retry calls needed, and the days at the daily cap.
- **Ranking:** `Candidate.priority` lets the pipeline's own priority drive `planForChange`.
- **Speed:** 100 sentence pairs (a claim against 20 cards × 5 sentences) screened in about 37 ms locally, inside the
  §12.6 tier-1 budget of 50 ms, without much headroom.
- **The recorder** (for the third set, frozen):
  - it plans the calls over every pair *any* routing sends to the AI, pipeline candidates first, so rules only,
    baseline, near-miss and the pipeline are scored on the same answers;
  - it reports the pipeline and, for batches, its budgeted selection;
  - each run's approved caps must be passed explicitly (the code allows at most 12 calls and 21,600 tokens).

**Offline results on the development material** (dev; regressions; both earlier unseen sets as diagnostics. Recorded
answers only — no call; a forwarded pair without an answer counts as missed; the held-out split is not used):

```
dev: 56 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 14 | 7 | 0 |
| compatible | 0 | 15 | 18 |
| ambiguous | 0 | 2 | 0 |
- candidate-generation recall 100% (21/21) · budgeted selection recall 100% (7/7)
- with recorded answers (forwarded without one = missed: 11): recall 86% (18/21) · strict 76% (16/21) · precision 100% (16/16) · context FP 0% (0/16) · unsupported none
- budget: candidates per change 0/6/26 (min/median/max) · pending 119 → 12 Retry calls · 2 day(s) at 50 calls/day

regressions: 2 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 0 | 2 | 0 |
| compatible | 0 | 0 | 0 |
| ambiguous | 0 | 0 | 0 |
- candidate-generation recall 100% (2/2) · budgeted selection recall 100% (2/2)
- with recorded answers (forwarded without one = missed: 0): recall 100% (2/2) · strict 100% (2/2) · precision 100% (2/2) · context FP — (0/0) · unsupported none
- budget: candidates per change 1/1/1 (min/median/max) · pending 0 → 0 Retry calls · 1 day(s) at 50 calls/day

unseen1 (diagnostic): 36 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 1 | 13 | 0 |
| compatible | 0 | 8 | 11 |
| ambiguous | 0 | 3 | 0 |
- candidate-generation recall 100% (14/14) · budgeted selection recall 100% (13/13)
- with recorded answers (forwarded without one = missed: 12): recall 71% (10/14) · strict 71% (10/14) · precision 100% (10/10) · context FP 0% (0/5) · unsupported none
- budget: candidates per change 0/2/11 (min/median/max) · pending 1 → 1 Retry calls · 1 day(s) at 50 calls/day

unseen2 (diagnostic): 56 pairs
| truth | rule conflict | forwarded → AI | excluded |
|---|---|---|---|
| contradiction | 1 | 21 | 0 |
| compatible | 0 | 20 | 9 |
| ambiguous | 0 | 5 | 0 |
- candidate-generation recall 100% (22/22) · budgeted selection recall 100% (21/21)
- with recorded answers (forwarded without one = missed: 36): recall 27% (6/22) · strict 27% (6/22) · precision 100% (6/6) · context FP 0% (0/5) · unsupported none
- budget: candidates per change 0/9/14 (min/median/max) · pending 42 → 5 Retry calls · 2 day(s) at 50 calls/day
```

Reading it:
- **Candidate-generation recall is 100 % on every set**, including all 22 contradictions of the second unseen set
  (the old selector let 7 through).
- **Budgeted selection recall is 100 %** (pool mode): every forwarded contradiction made its change's one call.
- **No rule false positive.** v40 and v43 now go to the AI.
- **No unsupported conflict call,** after the `thin` guard; before it, d55 and d56 were on the AI's word alone.
- **Context FP 0 %.**
- **Precision 100 % wherever an answer exists.**
- The low "recall with recorded answers" on the unseen sets is **unmeasured, not wrong**: 36 forwarded pairs of the
  second set have no answer yet (they were never sent).
- **The cost is volume.** Dev as one canvas gives up to 26 candidates for one change (median 6). 119 wait as
  `over_call_limit`: 12 Retry calls, all processable within 2 days at 50 calls/day. The second set's compatible pairs
  forwarded: 20 of 29 — the AI must reject them, which spends budget.

**Tests:**
- `screen.test.ts` (8):
  - the 15 former exclusions forwarded;
  - v40 and v43 not rule conflicts; the same-words value conflict still one;
  - v09 and v25 not scoped, real scopes still scoped;
  - every exclusion reason, and the exclusive-extension counter-case;
  - paraphrase relatedness;
  - the B and thin guards, and a sole-owner swap still likely;
  - the dev and regressions pipeline properties;
  - speed.
- `unseen2.test.ts` now pins only that set's data (its code freeze served its run).
- All consistency tests 90 passed, 1 skipped. Full unit suite 3,200 passed, 0 failed. `tsc` clean apart from another
  session's file.

**The third unseen set** (`evaluation/update-engine/consistency/unseen3/`):
- **Code frozen first** (`unseen3/FREEZE.json`: rules, quantities, information, meaning, the local embedder, screen,
  judge, candidates, the three scorers, the recorder).
- **Author:** a new fresh agent given only the coverage spec and subjects to avoid. No earlier sentences, routing code
  or failure ids; told not to open any file, and reported opening none.
- **90 pairs** (`pairs.json`, statements only, SHA-256 `7ae25422…`): 10 batches of 5 (one new statement against five
  existing ones) and 40 isolated pairs.
- **The author's draft** (`author-draft-key.json`, frozen; only its counts were read): 34 contradiction / 41 compatible
  / 15 ambiguous. Paraphrase 12, subject mismatch 12, temporal 9, universal 8, exclusivity 7, metric 6, limit 6,
  modality 6, extension 6, ambiguous reference 6, frequency equivalence 4, frequency 3, scope 2, numeric 2,
  environment 1.
- **Overlap:** none with dev, held-out, regressions, either earlier unseen set or any probe (`unseen3.test.ts`, which
  also checks the batch shape).
- **Nothing has run on it.** The blind sheet is `unseen3/labelling-sheet.md`.

**Projected paid step** (to be fixed after the free route step; not yet approved):
- the AI candidates are the union of what the three routings send: at most 90 pairs, so **at most 9 calls**;
- **≤ 16,200 reserved tokens** (9 × 1,800);
- worst case ≈ $0.003 at catalogue prices; **proposed ceiling $0.05**;
- `gpt-oss-120b` on AICredits, the reviewed prompt and the baseline settings.
- The exact counts and caps come back for approval after the route step.

### 12.22 The third unseen recording — labels and the free route step (2026-11-14)

**Labels.**
- **Source:** the reviewer's 90 labels with reasons, transcribed verbatim into `unseen3/labels.json` (`blind: true`).
- **Provenance**, stated in the file: the reviewer says they were made blind and supplied earlier. That table never
  reached this session; it was re-supplied on 2026-11-14 as "reconstructed from my earlier adjudication, with the
  original labels and reasons preserved".
- **Checks:**
  - 90 / 90 ids match `pairs.json`;
  - 35 contradiction / 46 compatible / 9 ambiguous, with the ambiguous ids as given (w06, w11, w23, w25, w48, w55, w60,
    w70, w90);
  - every frozen hash unchanged (`unseen3.test.ts`).
- **Frozen:** labels SHA-256 `db25699f…` added to `unseen3/FREEZE.json`.
- **The author's draft key:** its labels were not read. The frozen recorder reads only its design categories.

**The route step** ran once (free, local), as approved: `unseen3/runs/2026-11-14-unseen3/` (`routing.json`, `routing.md`).
- **One recorder artefact:** the frozen recorder fills a placeholder `expected: "compatible"` for every pair. So the
  "matches expected" column and the "expected compatible" lines in `routing.md`'s rules-only section are not the
  reviewer's labels; ignore them. Every routing table and rate below uses the reviewer's labels.

**The retrieval-then-judgment pipeline (§12.21) — before any AI answer:**

| truth | forwarded → AI | excluded |
|---|---|---|
| contradiction (35) | 34 | **1 (w31)** |
| compatible (46) | 38 | 8 |
| ambiguous (9) | 7 | 2 (w11, w25) |

- **Candidate-generation recall: 34/35 (97 %).**
- **The one false exclusion — w31:** "Closing the gym to members every night" vs uninterrupted member access. Excluded
  as `values_agree`, which is wrong: a rule read the two statements' values as agreeing. Recorded, not fixed (no
  tuning on this set).
- **Correct exclusions of compatible pairs (8):**
  - `different_metrics`: w10, w20;
  - `values_agree`: w27, w35, w62, w77, w83;
  - `different_scope`: w76.
- **Ambiguous pairs excluded:** w11 (`different_metrics`), w25 (`values_agree`). Ambiguous pairs aren't scored for
  recall; listed for completeness.
- **No rule conflict without the AI.** None of the pairs has identical wording apart from its values.

**Budget** (each pair's first statement taken as an accepted change):
- **Pool mode** (all 90 as one canvas, against every related sentence):
  - **budgeted selection recall 34/35 (97 %)**: every forwarded contradiction made its change's single ≤ 10-pair
    call; none waited;
  - candidates per change: 1 / 13 / 25 (min / median / max);
  - pending 260 → 26 Retry calls, 3 days at 50 calls a day.
- **Batch mode** (the 10 batches of 5): budgeted selection recall 16/17; candidates per change 3 / 5 / 5; nothing
  pending.

**For comparison — the earlier selectors on the same pairs:**
- **Rule conflicts:** 7 (w02, w58, w75, w80 correct; **w34, w37, w45 compatible — rule false positives**). Rule
  precision 4/7 (57 %); recall by rules alone 4/35 (11 %).
- **Near-miss routing** (§12.15–12.19): sends 6 more contradictions to the AI and excludes **25 of 35**. Generation
  recall 10/35 (29 %), against the pipeline's 97 %.
- **Its ten-pair call** (all 15 near-miss candidates in one change):
  - in the call: w18, w47, w67, w03, w15, w60, w61, w74, w71, w17;
  - waiting `over_call_limit`: w24, w29, w38, w56, w76;
  - contradictions routed 6, in the call 5. **Left out: w38** (new-patient fee £60 vs £45), ranked low as scoped.

**Planned paid step** (the union of what all routings send to the AI, so every routing is scored on the same answers):

| Item | Value |
|---|---|
| Pairs to classify | 80 (the pipeline's 79 forwarded + w76, which only the old routing sends) |
| Calls | **8** (8 × 10 pairs) |
| Reserved tokens | **14,400** (8 × 1,800) |
| Worst-case spend | ≈ $0.0024 at the unseen2 run's catalogue price (≈ $0.0003 per 1,800-token call); the recorder recomputes it from the live catalogue at preflight |
| Proposed caps | **≤ 8 calls, ≤ 14,400 tokens, ≤ $0.05** (within the §12.21 projection of ≤ 9 / ≤ 16,200 / ≤ $0.05; the recorder's hard limits are 12 / 21,600) |
| Model | `openai/gpt-oss-120b` on AICredits, the frozen prompt and baseline settings, once, no rerun |

**The paid recording** (approved by the user 2026-11-15 with the caps above; run once; the recorder refuses a rerun).
`unseen3/runs/2026-11-14-unseen3/` (`calls.json`, `judgments.json`, `report.md`).

| | Recorded |
|---|---|
| Calls | 8 sent: **6 `ok`, 1 `truncated`, 1 `unreadable`** |
| Tokens | 13,250 (6,768 prompt + 6,482 completion), against 14,400 reserved |
| Spend | **$0.00135** by the recorder's catalogue price (the provider billed 0.147 in its unit, INR); worst case reserved $0.0024; cap $0.05 |
| Latency | 9.1–19.4 s a call, median 15.5 s |
| Pairs answered | 60 of 80; **20 unanswered**, all from the two failed calls |

**Why two calls failed** (infrastructure, not judgment; recorded, not fixed — `judge.ts` is frozen and there is no
rerun):
- **Call 5, `unreadable`:** the model returned well-formed JSON, but wrote `"suggestion": null` for pairs with nothing
  to suggest. The frozen output schema (`judge.ts` line 40) accepts a string or nothing, not `null`, so the whole
  call was rejected. **A schema bug:** a nullable `suggestion` would have accepted all 10 answers.
- **Call 3, `truncated`:** the call's output budget (`outputBudget` = 1,800 total − prompt ≈ 966 tokens) was used up
  by the reasoning model before the answer finished. Every completion ran 623–966 tokens, so the budget is tight for
  `gpt-oss-120b` even at low reasoning effort.

**Side by side** (90 pairs, scored against the reviewer's labels; ambiguous pairs left out of precision):

| | Rules only | Baseline routing | Near-miss routing | **§12.21 pipeline** |
|---|---|---|---|---|
| Candidate-generation recall | 4/35 (11 %) | 4/35 (11 %) | 10/35 (29 %) | **34/35 (97 %)** |
| Budgeted selection recall | — | — | 9/10 into the 10-pair call (w38 left out) | **34/35 (97 %)** |
| **Final recall** (shown) | 4/35 (11 %) | 4/35 (11 %) | 9/35 (26 %) | **22/35 (63 %)** |
| **Strict recall** (conflict or likely) | 4/35 (11 %) | 4/35 (11 %) | 8/35 (23 %) | 18/35 (51 %) |
| **Precision** | 4/7 (57 %) | 4/7 (57 %) | 8/11 (73 %) | **18/18 (100 %)** |
| Context false positives | 0/6 | 0/6 | 0/6 | 0/6 |
| Unsupported conflict calls (ambiguous shown as conflict or likely) | none | none | none | none |
| Unanswered candidates | — | 0 | 3 | 20 (9 of them contradictions) |
| Cost / latency | local | the same 8 calls are shared by all three AI routings: $0.00135, median 15.5 s a call | | |

On the 10 competing batches, the pipeline found 16/17 contradictions as candidates. Final recall there was 8/17, with
15 forwarded pairs unanswered.

**Every contradiction, by source** (the pipeline):

| Source | Count | Pairs |
|---|---|---|
| Shown as a conflict or likely | 18 | — |
| Shown as *possible*, held by the context guard (scoped) | 4 | w32, w38, w40, w44 |
| **No answer, the parser rejected `suggestion: null`** | **5** | w01, w12, w59, w68, w85 |
| **No answer, the output was truncated** | **4** | w15, w49, w57, w84 |
| AI classification wrong | 3 | w22 (compatible), w73 and w80 (compatible in context) |
| Screen false exclusion | 1 | w31 (`values_agree`) |

**Reading it:**
- **Retrieval and budget worked** on a new, isolated author: 34 of 35 contradictions reached the AI step. The
  earlier selectors let 10 through.
- **The AI judged well where it answered.** 22 of 25 answered contradictions were "contradicts". Not one of the 27
  answered compatible pairs was called a contradiction, so there was no review noise. Strict precision was 18/18.
- **The final-recall shortfall is mostly the call failures:** 9 of the 13 lost contradictions sat in the two failed
  calls. What recall would have been without them is **unmeasured** and is not claimed.
- **The guards behaved as designed.** The 4 held at *possible* are all scoped pairs; one ambiguous pair (w70)
  became *possible*, not a conflict.
- **One trade-off to note:** w80 (adult ticket £11 vs £9.50) was a correct rule conflict under the old routing. The
  pipeline sends it to the AI instead (precision first, §12.21), and the AI read it as compatible in context.

**Gates (§12.19):**
- final recall 63 % — **fails** (≥ 85 %);
- strict recall 51 % — **fails** (≥ 85 %);
- precision 100 % — **passes** (≥ 90 %);
- context false positives 0 % — **passes** (≤ 10 %);
- unsupported conflict calls: none — **passes**.

Stage 4f stays OFF.

**Labels:** the author's draft and the reviewer differ on 8 of 90 pairs (6 the author drafted as ambiguous). Detail in
`unseen3/label-comparison.md`; neither key changed, and no conclusion changes.

**Not done, by the authorization:** no rerun, no repair, no tuning on this set. The parser's `null` handling and the
output budget are **findings for the next design** (5e's relate call; a future 4f proposal):
- accept `null` for optional fields;
- size the output budget for a reasoning model, or split a call that runs short.

Neither is a fix to this run.

### 12.23 Review of the unseen3 recording, and the execution hardening (2026-11-15, offline, no AI call)

**Review decision:** the recording is accepted as a valid **failed** evaluation. Stage 4f stays off. Candidate discovery
now works (34/35); the problem has moved to reliable execution and classification. Approved offline: (A) the response
contract, (B) reasoning-token exhaustion, (C) per-pair completion accounting. **The historical unseen3 figures stand
(63 % final, 51 % strict recall); no replay replaces them.** No new unseen set until the execution path is proven
reliable.

**History preserved first.** Nothing is committed, so before any change the 12 code files the recording ran were copied
byte for byte to `unseen3/frozen-code/` (`INDEX.json`; each matches its `FREEZE.json` hash).
- `unseen3.test.ts` now pins the data (pairs, draft key, labels) and the preserved copies, as `unseen2.test.ts` does
  after its run.
- `judgeReply.test.ts` pins the hashes of the recording's own `calls.json`, `judgments.json`, `report.md` and
  `routing.json`.

**A — the response contract** (`judge.ts`): `why` and `suggestion` accept `null` as a **documented representation of
"absent"**.
- Nothing else is loosened: a wrong type, an over-long line, an unknown answer and a missing `ref` are still rejected
  (tested).
- **Offline replay:** the rejected call 5 now gives 10 validated answers. The recording still shows it as unreadable
  with no answers, and the preserved frozen parser shows the line that rejected it.

**B — reasoning-token exhaustion** (`judge.ts` `JUDGE_BUDGET`, `outputBudget`): the completion budget is now two explicit
parts — the visible answer (60 tokens a pair) plus a separate reasoning reserve (700) — instead of one shared ≈ 966.
- **Sizing, from the recording:** a full 10-pair answer is ≈ 470 visible tokens. The truncated call spent ≈ 560 of
  its 966 on reasoning and stopped at pair 7.
- **Not changed:** model, reasoning effort, flags. The AI check is still off.
- **Consequence for spend:** a full call now reserves ≈ 2,000 tokens. **The daily token cap stays at 90,000**, so
  about 45 full calls fit in a day instead of 50 (tests and docs updated). Raising the cap is a separate decision.
- **Provider settings evaluated, not changed or verified:** the OpenAI-compatible `max_tokens` includes reasoning, so
  the reserve is the safe fix. `response_format` JSON mode, or a separate reasoning cap, would need the provider's
  confirmation and a paid check, so they are not adopted. The app's runtime doesn't pass `finish_reason` through, so
  a cut-off reply is also recognised by its shape.
- **Cut-off replies are explicit:** a cut-off reply fails every pair as `truncated`. Nothing is salvaged, guessed or
  read as compatible (replayed on call 3, tested).

**C — per-pair completion** (`judgeReply.ts`, `judgeLedger.ts`, both new, not wired):
- **The reader** validates each item on its own:
  - a valid item → `classified`;
  - an invalid item → that pair `failed` (`invalid_answer`);
  - unanswered → `missing_answer`; answered twice → `duplicate_answer`;
  - unknown refs → counted and ignored.

  So one bad item no longer loses a call.
- **The ledger** holds each pair (keyed by its fingerprint, the store's `pairId`) as `pending` / `classified` /
  `failed` / `gave_up` (after 3 attempts). It is persisted per canvas in device-local meta, bounded, and read
  leniently.
  - **Classified is set once:** a replay, a retry or a later answer never changes or duplicates it.
  - **Retries:** only pending and failed pairs. They are planned through `planForChange({ retry, judged })`, so every
    retry passes the daily call and token caps (tested).
- **No duplicate conflict records on retry:** the store keys a conflict by `pairId`, so the same contradiction found
  twice is one record (tested).
- **The unseen3 recording is never retried.** Its replies are only replayed.

**Checkpoint (the review's list) — status:**

| Item | Status |
|---|---|
| Offline replay of the rejected JSON after the contract fix | **Done**: call 5 → 10 classified (`judgeReply.test.ts`) |
| Explicit handling of token-exhausted responses | **Done**: `truncated` per pair, with or without `finish_reason` |
| Persistence of failed and pending classifications | **Done**: ledger round trip and lenient reader (`judgeLedger.test.ts`) |
| No duplicate conflict records on retry | **Done** (`judgeLedger.test.ts`) |
| Exact accounting of the remaining four missed contradictions | **Done**: below |
| Regression coverage of the contradiction excluded upstream | **Done**: `regressions-unseen3.json` + `regressionsUnseen3.test.ts` |

**The four missed contradictions not caused by the failed calls:**

| Pair | Statements | Source | Exact cause |
|---|---|---|---|
| **w31** | "Members can use the gym 24 hours a day, 7 days a week." / "The gym is closed to members every night between midnight and 5 a.m." | Screen | Excluded as `values_agree`, but the rules compared **no** values: A has durations (24 hours, 7 days); B's only number, the clock time "5 a.m.", is parsed as a bare count. A vacuous "agree" was taken as evidence. **Fixed:** `values_agree` now needs at least one pair of values of the same kind (`valuesCompared`). The clock-time parsing gap is in the shared quantity parser (`fidelity/quantities.ts`) — recorded, not changed. |
| **w22** | "The publisher accepts unsolicited manuscripts." / "Manuscripts that arrive without an agent or an invitation are returned to the sender unread." | AI | Answered `compatible`: "Manuscripts can be accepted but still be returned unread". It read "accepts" as "receives", not "considers". A word-sense judgment. Forwarded with weak evidence (priority 2.02). |
| **w73** | "All pull requests to the main branch need approval from at least two maintainers." / "Documentation-only pull requests to main can be merged with one approval." | AI | Answered `compatible_context`: it treated "documentation-only" as a separate scope and ignored that "All" excludes exceptions. The screen had marked the pair exclusive. Likely cause: the prompt rule "if one statement names a context the other doesn't, prefer compatible_context" outweighed the universal claim. |
| **w80** | "The cinema's adult ticket currently costs £11." / "As of this month, an adult ticket at the cinema is £9.50." | AI (and the §12.21 trade-off) | Answered `compatible_context`, reading "as of this month" as a different time from "currently" — both mean now. The old rules alone called this a conflict (correct). The pipeline sends it to the AI because the wording isn't identical (precision first, §12.21). |

**Also visible, not misses for final recall:** the 4 contradictions held at *possible* by the context guard (w32, w38,
w40, w44) lost strict recall. Only w38 has the kind of context difference the guard is meant for. The others were
marked "scoped" by phrases such as "Since the 2024 rule change", "before … opens a file" and "solely". **A candidate
next fix, not made:** it needs its own approval, and its evidence is this set.

**Diagnostic, not a score:** the w31 fix moves three unseen3 pairs from excluded to the AI step — w31 (contradiction),
w27 and w77 (compatible, which the AI must then reject). Generation recall on this set would be 35/35. That is
regression evidence, not an unseen result.

**Tests:** consistency 114 passed. New: `judgeReply.test.ts` (8), `judgeLedger.test.ts` (8),
`regressionsUnseen3.test.ts` (4); updated: `judge.test.ts`, `candidates.test.ts` (the split budget), `unseen3.test.ts`
(data and preserved-code pins).

**Before any new paid evaluation** (separate approval): a cost proposal from `callTokens` under the new budget. The
recorder must use `readJudgeReply`, the ledger and per-pair accounting. Decisions needed: the context guard and the
prompt's context-preference rule (w73, w80), which are left as they are.

### 12.24 Context-guard refinement and the Stage 4f verification report (2026-11-15, offline, no AI call)

**Review decision (2026-11-15):**
- the §12.23 parser, budget and ledger fixes are accepted provisionally;
- the context-guard refinement is approved offline;
- the daily token cap stays at 90,000 (an increase is not approved);
- code review and a controlled full-suite run are approved;
- a new paid recording needs separate approval;
- live activation stays OFF;
- commits come after review and verification.

**The rule:** treat two statements as being about different contexts only when **positive evidence** shows a material
difference in scope, time, subject or environment. An uncertain reading is never promoted to a definite conflict.

**P0 — what changed:**

| Case | Exact cause | Fix |
|---|---|---|
| w32 | Both sides say "since the 2024 change", but a time phrase leading one sentence counted as a scope | `screen.ts`: a time scope at the head of the sentence, or a past time, counts only when **the other side doesn't state that same time** |
| w40 | Not "solely": "a **local** cheesemaker" was read as the `local` environment marker | `screen.ts`: ambiguous environment words (local, stage, test, testing, preview) count only next to an environment noun ("local environment", "test server") or after "on" / "in". Staging, production, sandbox, … always count |
| w44 | "before the firm opens a file" (a precondition) counted as a past time | `screen.ts`: `since`, `before` and `after` no longer mark the past tense. Leading the sentence ("Before the migration, …") they still scope it |
| w73 | The prompt rule "if one statement names a context the other doesn't, prefer compatible_context" outweighed "All" | `judge.ts` prompt: compatible_context needs positive evidence; a detail that only one side mentions is not a context; a universal or exclusive statement covers its cases, and an exception contradicts it unless the universal itself allows it; required vs optional under one policy can't both hold |
| w80 | "as of this month" was read as a different time from "currently" | `judge.ts` prompt: "currently", "now", "today", "as of this month" and "since <a past change>" all describe the present |
| (all) | — | `judge.ts` prompt: "if you are not sure whether the contexts differ, answer unclear, never contradicts" |

**Kept unchanged:**
- the non-exclusive swap protection (`combine`, and the prompt's "do not infer exclusivity solely from different named
  values" rule, word for word);
- the thin guard;
- `rules.ts` and the live rules-only panel. The false `local` / `stage` markers are filtered in the screen only.
  `markersOf` still reports them, and the live panel is unchanged by design.

**Which pairs moved (P0, before the review fixes below):** of the 185 forwarded pairs across dev, regressions, unseen1, unseen2 and unseen3 (held-out
excluded, as always), exactly **four** lost the guard:
- w32, w40, w44 (the targets);
- w52, a compatible pair scoped only by "near each **stage**". Its recorded AI answer was `compatible`, so moving it
  costs no precision on replay.

Every genuine context pair kept its protection: d21–d25, u20, v03, v32, v38, v50, w17, w24, w38, w41.

**Replay of the frozen recording's own answers (diagnostic only, never a score — these fixes were written against
unseen3):**
- w32, w40, w44 move from *possible* to *likely conflict*;
- w38 stays *possible* (the guard's intended case);
- no compatible pair becomes *likely*.

w73 and w80 can only change with a new model answer to the new prompt, so their effect is **unmeasured** until a paid
recording. **The historical unseen3 scores stand: 63 % final, 51 % strict.**

**Regression coverage:** `regressions-unseen3.json` now pins w31, w32, w40, w44, w73 and w80, plus the counter-cases
w38 (must stay scoped) and w52, each with the recorded AI answer. `regressionsUnseen3.test.ts` (+11) checks:
- scope per pinned pair;
- the replay outcomes;
- ten genuine context counter-cases (from dev and the earlier sets) that must stay scoped;
- four non-contexts;
- the non-exclusive swap protection;
- the prompt's new rules, and the absence of the old one;
- the token ceiling.

**Token budget — the ceiling is now stated and enforced:**
- `JUDGE_CALL_CEILING` = input cap 1,500 + a full answer 600 + reasoning 700 = **2,800**.
- `JudgeBudget.reserve` refuses anything above it as `over_call_limit`. That includes retries and non-finite figures,
  and a refused reservation spends neither a call nor tokens. This is the one choke point every caller goes through.
- **Cost of the clearer prompt:** about +175 input tokens a call. Measured on the 8 unseen3 calls: input ≈ 970–1,040,
  reservation ≈ 2,270–2,340.
- **At the unchanged 90,000 cap:** about **39** typical full calls a day (was ≈ 45). At the ceiling, exactly 32
  (tested). Raising the cap remains the user's decision; it is not proposed here.

**P1 — independent code review.** A separate reviewer was given the code, not these conclusions. It read the five
modules, the runtime and the frozen history, ran about 70 pairs and inputs offline, and reported 13 findings. Each
finding was reproduced here before it was fixed.

| # | Finding | Severity | Disposition |
|---|---|---|---|
| 1 | The screen **silently excluded** pairs whose two sides state different times: "signed in 2023" / "signed in 2024", March / June, Q3 / Q4. They were never sent to the AI and never shown. The frozen code does the same: an old hole, not a §12.24 one | HIGH | **Fixed.** A time difference is never grounds to exclude; it is forwarded and held at *possible* (`timeBothSided`). Only a non-time scope stated on both sides (staging / production, UK / Ireland) is still excluded. `time:past` is out of the comparison. A "version" / "release" marker needs a number |
| 2 | The per-call ceiling holds at reservation only. Through the app runtime, `judge_consistency` would get no `max_tokens`, an unreserved automatic repair call and failover calls, and would return parsed data without the raw text or `finish_reason` that `readJudgeReply` needs | HIGH (blocks activation) | **Not fixed. Recorded as an activation blocker.** 4f is off and nothing calls the task. Before activation: a dedicated execution path that sends `outputBudget` as `max_tokens`, has no repair or failover, returns raw text + `finish_reason` + usage, and reserves each attempt |
| 3 | `JudgeBudget` trusted persisted state: missing `used` → NaN → the call cap was not enforced. Missing `changes` threw. Negative reservations freed budget. Reservation ids could collide | MEDIUM | **Fixed.** Persisted state is read fail-closed: an unreadable count = the cap. Reservations must be positive whole numbers. Ids can't collide |
| 4 | The guard missed genuine contexts: "During testing" (a §12.24 regression), "Locally", countries ("In Germany"), "During the pilot" | MEDIUM | **Fixed.** "during" before an environment word; "locally"; a country-name list (screen only); a leading "During the X". Demonyms are left out ("French fries") |
| 5 | The guard still held pairs with no positive evidence: the passive voice ("the limit **was** set to 10"), a leading "Since 2024" or "As of 2024" | MEDIUM/LOW | **Fixed.** Only **specific** times count (a year, a month, a quarter, last-X, until, previously, …). Present anchors don't count ("since" / "as of" + year or month), nor the past tense alone. A mid-sentence month or "last year" counts only in a past-tense sentence ("was raised … in January"), not as a schedule or an aside ("audits once a year, in August": v53; "a risk identified last year": w28). Closing times and deadlines ("until 7 p.m.", "until 30 June") are values, not contexts. Found while checking: "into the next year" (v25) is not a scope |
| 6 | Ledger: replaying a failed reading used up attempts. Retry could resend pairs whose call was still out | MEDIUM | **Fixed.** New `in_flight` state (`markSent`), never retryable. A reading is recorded once per call (`reservation`). A pair stored `in_flight` reads back as failed after a restart, with the attempt counted |
| 7 | The planner asked `judged(fingerprint)` but the ledger is keyed by the call key, so a pair without a fingerprint was re-sent on every revision | MEDIUM | **Fixed:** checks the key, and the fingerprint when it differs |
| 8 | `settle` never charged usage above the reservation (the input is an estimate) | LOW | **Fixed:** overage is charged |
| 9 | A reply with a complete block followed by a cut-off one classified from the first block | LOW | **Fixed:** a reply that ends inside JSON is truncated, whatever parsed before it |
| 10 | Only the first 20 items were read, which could hide a duplicate answer | LOW | **Fixed:** more than two items per pair sent is unreadable; all items are read otherwise |
| 11 | The lenient ledger reader kept any field: a `classified` pair without an answer, negative attempts, unbounded text. A write during `load()` could overwrite stored pairs | LOW | **Fixed:** a field whitelist, answer validated, attempts clamped, text cut, load capped at 500, and saves wait for the load |
| 12 | A card title or section is sent in the prompt but is not in the pair fingerprint; a stale reading can set an older revision | LOW | **Open** (record only): matters once wired |
| 13 | The daily budget reset when the clock moved backwards | LOW | **Fixed:** the day rolls forward only |
| — | The non-exclusive swap regression test could pass vacuously | test | **Fixed:** its preconditions are asserted |
| — | `FREEZE.json`, `frozen-code/INDEX.json` and `routing.md` were not pinned | history | **Fixed:** pinned in `unseen3.test.ts`. The reviewer recomputed every frozen hash; all match |

**Moves after the review fixes**, over the same 185+ forwarded pairs (held-out excluded):
- **No labelled contradiction gains a scope except w38** (intended). v25, v53 and w28, which an intermediate version
  scoped, are clear and pinned.
- Every genuine context pair stays scoped, or excluded as both-sided: dev d21–d30, d34–d36; u02, u13, u20, u28, u32;
  v03, v32, v38, v50; w17, w24, w41.
- Two compatible pairs that were excluded as "different times" (v26, w76) are now forwarded and held. That is the safe
  direction: a little more AI spend, no lost contradiction.
- Lost a scope (compatible or ambiguous; now judged by the AI unguarded): w26, w55, w70 (closing times or deadlines),
  v49, w86 ("last week" in an aside), v44.

**Known limit:** the past tense is detected from auxiliaries and a few words (was, were, had, used, previously,
stopped). "Ana Ruiz **left** the company last year" (v44) is not scoped.

**Tests:** consistency **136 passed** (114 at §12.23, +22); `tsc` clean; eslint clean.

**P2 — full suite, controlled concurrency:**
- At 4 workers: 3,394 passed, 6 failed.
- At 2 workers: 3,394 passed, 7 failed.
- In both, every failure was a 5-second timeout or a performance budget in modules outside this lane (parser, meaning eval, merge layout D, OpenUI notesCheck, distilLimits, repoMap), and the failing set changed between runs. The 6 from the first run pass alone (88/88).
- **Serial (`--no-file-parallelism`): 326 files, 3,412 passed, 0 failed, 4 skipped, 4 todo (636 s).** That is the stable result. **The intermittent parallel-run timeouts are documented, not resolved** (review, 2026-11-15): they are consistent with load contention, but nothing has fixed them.

**The recorder now uses the new execution path (built, never run).** `consistencyUnseen.contract.test.ts`, classify
step:
- each reply is read with `readJudgeReply`, passing the provider's `finish_reason`;
- the result goes into a `JudgeLedger`, so a bad item or a cut-off reply fails only its own pairs;
- `pair-outcomes.json` records each pair's state;
- the report gains an execution line: classified / failed / gave up / pending;
- every call is checked against `JUDGE_CALL_CEILING` before it is sent;
- an optional retry pass (`CONSISTENCY_UNSEEN_MAX_RETRY_CALLS`, 0–2, default 0) resends **only failed pairs**, inside the
  same approved call, token and dollar ceilings. It never adds to them.

Editing the recorder changes a file listed in the unseen, unseen2 and unseen3 `FREEZE.json`. Those runs are done, and
unseen3's copy is preserved, so the recorder now refuses those sets, which is intended: no reruns. `tsc` and eslint
are clean. The file is not run (contract tests need approval).

**P3 — commit checkpoint (prepared, nothing staged or committed).** Everything in this lane is **untracked**:
`src/ai/consistency/`, `src/ai/router/descent.ts`, `locateEvaluation.test.ts`, the recorder and every evaluation
folder. The only commit is the initial one. Proposed split, in build order:
1. **Historical evidence, byte for byte, no code:**
   - `evaluation/update-engine/consistency/unseen3/**` (pairs, labels, draft key, `FREEZE.json`, `frozen-code/**`,
     `runs/2026-11-14-unseen3/**`);
   - likewise `unseen/` and `unseen2/`.

   Committing these first anchors their hashes outside the working tree (review finding: today nothing outside the repo
   does).
2. **Stage 4f implementation:**
   - `src/ai/consistency/*.ts` and their tests;
   - `regressions*.json`;
   - `src/ai/contractTests/consistencyUnseen.contract.test.ts`.
3. **Stage 5 prototype:** `src/ai/router/{itemIndex,descent,embeddingProvider,localModelEmbedding}.ts`,
   `locateEvaluation*.ts`, `evaluation/update-engine/locate/**` (`heldout.json` included, sealed hash).
4. **Docs:** this plan, the lanes file.

Shared files are mixed with other lanes: `tasks.ts`, `package.json` and its lock (transformers.js), `vitest.config.ts`.
They need a hand split, as in the OpenUI commit plan. **Waiting for your go-ahead; this session does not commit.**

**P4 — proposal for the next paid recording (NOT approved; nothing has been run):**
1. **A fourth unseen set, `unseen4/`.** No earlier set can measure these fixes: unseen3 is regression evidence now.
   - About 90 pairs, written by an isolated agent that sees neither unseen3 nor these fixes, in the same format and
     category mix as unseen3.
   - **The code is frozen first:** `screen.ts`, `rules.ts`, `judge.ts`, `judgeReply.ts`, `judgeLedger.ts`,
     `candidates.ts`, the scorers, the recorder and the embedder, hashed in `unseen4/FREEZE.json`.
2. **Blind labels from you or your reviewer.** Never drafted or reconstructed by this session.
3. **The free route step**, once.
4. **The paid classify step**, once:
   - gpt-oss-120b on AICredits, the same settings as unseen3;
   - **≤ 9 calls** (≤ 8 planned + ≤ 1 retry);
   - **≤ 21,600 tokens** (the recorder's hard maximum; 8 × ≈ 2,300 + 1 × 2,800 fits);
   - **≤ $0.05**. At unseen3's measured rate the expected cost is ≈ $0.002.
5. **Gates:**
   - the existing ones: final recall ≥ 85 %, precision, context false positives, no unsupported conflicts;
   - **plus an execution gate:** ≥ 95 % of sent pairs classified, and no truncated call.

   Report with the frozen code; no rerun.

Steps 1–3 cost no provider money, but step 1 starts an authoring agent, so it waits for your go-ahead too.

### 12.25 unseen4 prepared, and the dedicated AI call path (2026-11-15, offline, no AI call)

**Decision (2026-11-15):** unseen4 preparation and the dedicated call path are approved, offline. The paid recording
needs separate approval. Live activation is blocked until the reliability and quality gates pass. Stage 5 integration
is deferred. No commits until the user says so.

**unseen4 — authored and frozen, in this order:**
1. **Author:** an isolated agent given only a coverage spec. It saw no earlier sets, no code, no plan and no failure
   ids; its only tool use was writing its three files.
   - 90 pairs: 10 batches of 5 (one new statement against five existing ones) and 40 single pairs.
   - The author's draft: 36 contradiction / 45 compatible / 9 ambiguous. Covers paraphrase and negation, temporal
     qualifiers and present-time wording, exclusivity, universals, numbers, limits, frequency, modality, scope and
     environment, metric and subject mismatches, extensions and ambiguous references.
2. **Validated by script, ids only** (`check-unseen4.js`; no statement was printed):
   - the shape is right, the sheet matches the pairs exactly, and the sheet leaks no labels;
   - one pair (**x05**) shared 0.91 / 0.73 of its words with a pair of unseen2. The same author rewrote it as a fresh
     pair in the same category and label, without being shown the earlier sentence. Re-check: no overlap with any
     earlier set (dev, held-out, regressions, unseen1–3).
3. **Inputs frozen first** (`DATA-FREEZE.json`: pairs, author draft key, labelling sheet), before any selector, rule,
   screen or model ran on them. The author's draft key is kept separately; it is not the truth.
4. **Code frozen after the call path passed its safety tests** (`FREEZE.json`, 21 files):
   - the rules, quantities and meaning helpers, the local embedder, the screen;
   - the prompt and combining policy, the selector and budget;
   - the per-pair reader, the ledger, the dedicated call path and its HTTP transport, the JSON extraction;
   - the scorers and the recorder.

   There are byte copies in `frozen-code/` (`INDEX.json`). `unseen4.test.ts` pins the inputs (both hash lists), the
   code freeze and the copies, checks independence from every earlier set, and checks that no labels and no runs exist
   yet.
   - **Note:** `src/ai/runtime.ts` is frozen because the reader uses its JSON extraction. It is shared with other lanes,
     so an unrelated edit there would make the recorder refuse; the byte copy shows exactly what changed.
5. **Next:** the reviewer's blind labels (`labelling-sheet.md`). The labels hash is then added to `FREEZE.json`. Then
   the free route step, which gives the **exact candidate and call counts** for the paid proposal.

**The dedicated call path** (`judgeCall.ts`; `contractTests/judgeHttpTransport.ts`). Built, tested with mocked providers, not
connected to accepted changes.

```
request → [critical section: re-read budget + ledger → validate → reserve → mark in flight]
        → ONE provider call (cap as max_tokens, reasoning effort low; no repair, no fallback, no retry)
        → read per pair → [critical section: settle with reported usage] → ledger → human review
```

| Requirement | How |
|---|---|
| Token budget | 90,000 a day and 2,800 a call (`JudgeBudget`), unchanged |
| **Atomic reservation** | Every reservation and settlement runs in a critical section, after re-reading the persisted counts. `webLockSection` uses the Web Locks API, so one lock is shared by every tab and window of the origin (browsers and Electron); `inProcessSection` is a mutex for one process. Tested: two "tabs" with one stored state can't both spend the last call; three concurrent checks near the token cap send one call and never exceed 90,000 |
| Output limit, reasoning included | `max_tokens` = answer (60 a pair) + reasoning reserve (700); reasoning effort "low", what the reserve was sized for. The app's Copilot host now hands the cap to a BYOK model (`ProviderConfig.maxOutputTokens`) and the effort to the session. **A connection that can't cap output (a Copilot subscription) sends nothing:** `outputCap` is declared per provider, and the pairs wait as `output_cap_unavailable` with nothing reserved |
| No repair, no fallback | One `generate` on one provider; the HTTP transport makes one request even on 429 or 500. Tested: a provider error or an invalid reply is exactly one call |
| Idempotency | A pair in flight (in any tab: the ledger is refreshed in the critical section), or classified or given up for its context, is never planned again. A reading is recorded once per call. A late reading of an older call can't overwrite a newer call or a classification |
| Failure handling | Truncated, unreadable, empty or invalid replies fail their pairs; never compatible by default. Gives up after 3 attempts; every attempt passes the budget |
| **Context identity** | Each pair carries `pairContext` (both card titles and sections, normalised). After a material rename or move the answer is stale: the pair is sent again, and the old answer is kept in `history` (≤ 3, persisted). Re-typing the same names (case, spacing, punctuation) is not material |
| Usage truth | Settled with the provider's reported usage; overage is charged and flagged (`overReservation`) |

**Not verified, recorded:**
- whether the Copilot SDK honours `maxOutputTokens` and `reasoningEffort` against every BYOK endpoint (a live check is
  a paid run);
- the size of the Copilot session's own system prompt, which affects real input tokens (settlement charges actual
  usage, so the budget stays true).

**Re-freeze (same day, before labels or any run):** the vendor-name guard (`noVendorLeak.test.ts`) failed on the HTTP transport, so it moved to `src/ai/contractTests/` (the only place a vendor protocol may be named). The recorder's import changed with it; no behaviour change. Recorded in `FREEZE.json` `refrozen`.

**The recorder now uses the same core:** `sendJudgeCall` over the one-request HTTP transport. Its retry pass is
**removed** ("paid retries: none").

**Tests:** consistency 165 passed (160 + `unseen4.test.ts` 5), including `judgeCall.test.ts` 18 safety tests; host and
provider 99 passed; `tsc` and eslint clean.

**Paid recording proposal (not authorized):**
- at most 9 calls, 21,600 reserved tokens and $0.05;
- gpt-oss-120b; no paid retries; no live activation.

Exact candidate and call counts follow the free route step, after the blind labels.

**Blind labels and the free route step (2026-11-15).**
- **Labels:** the reviewer's 90 blind labels (38 contradiction / 44 compatible / 8 ambiguous) were converted verbatim
  by script to `unseen4/labels.json` (`blind: true`). Their hash was added to `FREEZE.json` before the route step, and
  `unseen4.test.ts` pins them.
- **Route step:** run once, no network: `unseen4/runs/2026-11-15-unseen4/routing.json`. **Do not rerun.**

| Paid-step figures (exact) | Value |
|---|---|
| Planned calls | **8** (7 × 10 pairs, 1 × 2) |
| Pairs sent to the model | **72 of 90** (18 excluded by the frozen screen) |
| Reserved tokens, worst case | **17,855** (largest call 2,358 ≤ 2,800 ceiling) |
| Contradictions reaching the model | **34 of 38** |

**Free-step finding, not fixed:** the frozen screen excludes 4 labelled contradictions before the AI — x04, x24 and
x71 as `different_metrics`, x60 as `values_agree`.
- So final recall can be at most 34/38 (89 %). The 85 % gate needs ≥ 33/38: at most one forwarded contradiction may
  be lost to the model or the guards.
- Changing the screen now would be tuning on unseen4 (not allowed). It is evidence for after the recording.
- `routing.md`'s rules-only "matches expected" lines are meaningless (the recorder's placeholder `expected`, as for
  unseen3).

**Paid classify step — proposal for approval (not run):**
- **Limits:** gpt-oss-120b on AICredits; 8 calls (cap 9); ≤ 18,000 reserved tokens (cap 21,600); ≤ $0.05; no paid
  retries; no live activation.
- **Expected cost:** ≈ $0.002 at unseen3's measured rate.
- **Command, once approved:**
  `CONSISTENCY_UNSEEN_SET=unseen4 CONSISTENCY_UNSEEN_STEP=classify CONSISTENCY_UNSEEN_RUN=2026-11-15-unseen4 CONSISTENCY_UNSEEN_APPROVED_BY="<name>" CONSISTENCY_UNSEEN_MAX_CALLS=8 CONSISTENCY_UNSEEN_MAX_TOKENS=18000 CONSISTENCY_UNSEEN_MAX_USD=0.05 npx vitest run --config vitest.contract.config.ts consistencyUnseen`

---

### 12.26 The fourth unseen recording (2026-11-15, one approved paid run — never rerun)

**Approved by the reviewer** ("proceed with paid run"):
- gpt-oss-120b on AICredits;
- ≤ 8 calls, ≤ 18,000 reserved tokens, ≤ $0.05, no retries;
- run once, through the dedicated call path (`sendJudgeCall`).

Recording: `unseen4/runs/2026-11-15-unseen4/`. Pinned byte for byte in `unseen4.test.ts`.

**Spend:**
- 8 calls sent, 17,855 tokens reserved (worst case $0.0030);
- reported usage 6,274 tokens / **$0.00057** for the 4 answered calls;
- the 4 timed-out calls reported no usage; whether the provider billed them is unknown, and the worst case is inside
  the cap.

**Result: a failed evaluation — execution, not judgment.**

| Gate | Result | |
|---|---|---|
| Execution: ≥ 95 % of sent pairs classified | **44 % (32/72)** | ✗ |
| Final recall ≥ 85 % | **42 % (16/38)**; strict 39 % | ✗ |
| Precision | **100 % (15/15)** | ✓ |
| Context false positives | **0 % (0/8)** | ✓ |
| Unsupported conflicts | none | ✓ |

**Exact cause:**
- **4 of 8 calls hit the 30-second call timeout** (`judgeConsistencyTask.timeoutMs`), all at ≈ 30.0 s. The answered
  full calls took 21.5, 29.9 and 27.7 s; the 2-pair call took 10.2 s.
- So the provider's latency for a 10-pair call now sits at the limit (unseen3: p50 ≈ 15 s). The 30 s figure dates from
  the §12.6 design and was never re-measured.
- The execution path behaved as designed: every timed-out pair is `failed` (`call_error`), none read as compatible, no
  retry was made, and nothing was over budget.
- **18 of the 38 contradictions were in the timed-out calls.**

**On the pairs that were answered, the model was right every time:**
- contradiction → "contradicts" **16/16**;
- compatible → compatible or different contexts **12/12**;
- ambiguous → compatible or different contexts 4/4.

One of the 16 was held at *possible* by a guard, so strict recall is 15. That is evidence the §12.24 prompt and guard
work, not a score.

**The other ceiling (free step, unchanged):** the screen excluded 4 contradictions before the AI (x04, x24, x71
`different_metrics`; x60 `values_agree`), so at most 34/38 (89 %).

**What the next step would need (each a decision):**
1. **The timeout (offline code change).** Latency for a full call is ≈ 20–30 s, so the 30 s limit must go. Proposed:
   - a 90 s call timeout;
   - the ledger's in-flight staleness window raised to match (≥ 2 × timeout, so 180–240 s);
   - optionally smaller calls (fewer pairs per call → shorter replies).
   `judge.ts` and `judgeLedger.ts` are unseen4-frozen, but the recording is done and their copies are preserved in
   `frozen-code/`, so editing them now is allowed. The live unseen4 code pins would then move to the copies, as unseen3
   did in §12.23.
2. **Measuring it.** unseen4 can't be rerun. Retrying only its 40 failed pairs (4 calls, ≈ 9,300 reserved tokens,
   ≈ $0.001) would measure execution reliability. It would **not** be an unseen score for recall: the 32 answered pairs
   were already seen. A clean recall measurement needs a fifth unseen set.
3. **The 4 screen exclusions** (`different_metrics` reading "a day" vs "on average" as different metrics; a vacuous
   `values_agree`). Evidence for a later fix, which would need a new set to measure.

**Stage 4f stays OFF.**

### 12.27 Execution reliability, offline (2026-11-15, no AI call)

**Decision (2026-11-15):** offline timeout and execution-layer hardening approved. **Not approved:** retrying the 40
timed-out pairs, any paid call, changing the screen for the 4 excluded contradictions, prompt tuning, Stage 4f
activation, and any claim of passing the unseen recall gate. A future paid diagnostic needs separate authorization and
must be labelled an **execution-reliability check, not an unseen evaluation**. Stage 4f stays disabled until a future
independently sealed evaluation meets its gates.

**unseen4 preserved:**
- the recording (6 files), the inputs, the labels and `FREEZE.json` are pinned byte for byte in `unseen4.test.ts`;
- the code it ran is checked against `frozen-code/`, so the live code may now change;
- the recorder refuses unseen4 (frozen hashes no longer match the live code), so it can't be rerun by accident.

**Configuration:**

| Setting | Before | Now |
|---|---|---|
| Request timeout (`JUDGE_CALL_TIMEOUT_MS`) | 30 s (§12.6, never re-measured) | **90 s**, three times the slowest answered unseen4 call |
| Path backstop deadline | none (the transport's own limit only) | **95 s** (`JUDGE_DEADLINE_GRACE_MS` 5 s): stops a transport that ignores its timeout. A reply after the deadline is never recorded |
| In-flight recovery window (`IN_FLIGHT_STALE_MS`) | 120 s | **180 s**: separate from the timeout and at least twice it |

**Interruption policy (each case leaves the pairs failed or pending, never compatible):**

| Case | Pairs | Reservation |
|---|---|---|
| Timeout (no reply in 90 s) | failed, `call_error` "timeout" | kept: it may have been billed |
| Cancelled mid-call | failed, "cancelled" | kept |
| Cancelled before sending | failed, "cancelled before sending" | released: nothing sent |
| Transport error (HTTP, unreadable) | failed, `call_error` | kept |
| App closed mid-call, reloaded within 180 s | still `in_flight`: not retried, not resent (another tab's slow call is respected) | — |
| …reloaded after 180 s | failed ("interrupted"), attempt counted, retryable | — |
| Reply answers only some pairs | answered pairs classified; the rest failed (`missing_answer`) | settled with reported usage |

Failures are reported by cause (`failure`: timeout / cancelled / transport), separately from the model's judgments.

**Offline tests** (`judgeExecution.test.ts`, 13; fake timers, mocked transports):
- a 45 s reply, which the old 30 s limit cut off, is now answered;
- a timeout fails all pairs and keeps the reservation;
- a transport that ignores its timeout is stopped by the backstop, and its late reply is not recorded;
- cancellation mid-call and before sending;
- restart inside and after the recovery window;
- a 6-of-10 partial reply;
- an unanswered pair shows as *possible*, not hidden;
- usage limits (below).

Consistency total: **175 passed**. `tsc` and eslint clean.

**Cost-cap enforcement:**
- timed-out calls still count against the day, and the 90,000-token cap stops further calls (tested over 45 full
  calls, all timing out);
- no call reserves above 2,800;
- usage above the reservation is charged;
- reservation is atomic across tabs (§12.25 tests, unchanged).

**Batch size, from the five recordings only** (`judgeBatchSizing.test.ts`; 35 answered calls, plus 4 timed out):
- **The provider slowed.** Earlier runs averaged ≈ 22 ms per completion token; unseen4 ran at 32.9–36.7 ms. Full calls
  drifted from ≈ 15–20 s to 21–30 s, which is why the 30 s limit failed.
- **The model below:** completion ≈ 172 + 58.5 tokens a pair (unseen4), at the slowest observed rate (36.7 ms/token).
  Worst case at the output cap = answer + reasoning reserve, all used. Reserved tokens are exact (`callTokens` on
  unseen4's 72 forwarded pairs in routed order).

| Pairs a call | Typical latency | Worst at the output cap | Calls for 72 pairs | Reserved tokens | Calls a day | Pairs a day |
|---|---|---|---|---|---|---|
| **10 (current)** | 27.7 s | 47.6 s | 8 | 17,855 | 38 | 380 |
| 8 | 23.5 s | 43.3 s | 9 | 19,183 | 42 | 336 |
| 6 | 19.2 s | 38.9 s | 12 | 23,176 | 46 | 276 |
| 5 | 17.0 s | 36.7 s | 15 | 27,165 | 49 | 245 |
| 4 | 14.9 s | 34.5 s | 18 | 31,153 | 50 | 200 |
| 3 | 12.7 s | 32.3 s | 24 | 39,134 | 50 | 150 |
| 2 | 10.6 s | 30.1 s | 36 | 55,097 | 50 | 100 |

- **The timeout is the lever, not the batch size.** At today's rate, every size's worst case at the cap exceeds the old
  30 s, because the 700-token reasoning reserve dominates small calls. With 90 s, every size's worst case sits at
  30–48 s.
- **Smaller batches cost more:** 5 pairs a call needs +52 % reserved tokens for the same pairs, and a day checks 245
  pairs instead of 380. The gain is a smaller blast radius (one failed call loses 5 pairs, not 10) and shorter calls.
- **Recommendation: keep 10 pairs a call with the 90 s timeout.** Revisit if a reliability check shows
  time-to-first-token (provider queueing) is large.
- **Limits of this estimate:**
  - latency was measured end to end; queueing before generation was never recorded separately (the fit's intercept is
    ≈ 0.2 s over all runs, so it has been small);
  - the 4 timed-out calls are censored at 30 s, so how long they would have taken is unknown;
  - none of this is a measurement of the new timeout.

**The unseen4 result, explained separately (the recorded gate results stand: execution 44 %, recall 42 %, strict 39 %,
precision 100 %, context FP 0 %):**
1. **Execution failures (timeout or transport):** 4 of 8 calls, all timeouts at ≈ 30 s → 40 of 72 sent pairs
   unanswered, 18 of them contradictions. No HTTP or parse failure. Every unanswered pair is a failure, never
   compatible.
2. **Contradictions excluded before the model:** 4 of 38 (x04, x24, x71 `different_metrics`; x60 `values_agree`),
   by the frozen screen. Not changed (not approved).
3. **Model judgments on the 32 answered pairs:** contradiction → contradicts **16/16**; compatible → compatible or
   different contexts **12/12**; ambiguous → compatible or different contexts 4/4. One of the 16 was held at
   *possible* by a guard. This is **not** an unseen recall result: 32 pairs is a partial, non-random sample (which
   calls timed out decided it).

### 12.28 Reliability checkpoint accepted; screening misses; reliability-test proposal (2026-11-15, offline, no AI call)

**Review decision (2026-11-15):**
- accepted: the 90 s timeout, 95 s backstop and 180 s recovery window;
- kept: 10 pairs a call, the 90,000-token day and the 2,800-token call;
- accepted: per-pair failure accounting;
- no dynamic batching until queue time, latency distributions and production workloads are measured;
- unseen4 stays a valid failed evaluation and is never rerun;
- no paid calls; no activation.

The 4 skipped tests in the suite are documented as skipped (opt-in spikes and absent data), not failures.

**Budget safeguard, confirmed by test:**
- a timed-out call keeps its whole reservation;
- usage above a reservation is charged in full, even past the cap (recorded, never hidden);
- the next call is then blocked (`daily_tokens`).

`judgeExecution.test.ts` now has 14 tests. **If a provider ignores the output cap, the budget is a conservative
operational control, not a financial guarantee:** one call can overrun before the block takes effect.

**P2 — the four screening misses (diagnosis only; no rule added or changed):**

| Pair | Statements (unseen4, recording done) | Rule that excluded it | Cause |
|---|---|---|---|
| x04 | "ships about 1,200 parcels per day **on average**" / "**typically** sends out around 400 parcels a day" | `different metrics` | **one-sided metric word**: "average" on one side; "typically" is not in the list, so the rule sees average vs nothing |
| x24 | "about 1,200 parcels per day **on average**" / "**No more than 800** … in a single day" | `different metrics` | **one-sided metric word**, and a cap vs an average *is* comparable: an average can't exceed the maximum |
| x71 | "meets every Wednesday" / "moved its **weekly** meeting to Thursdays" | `different metrics` | **one-sided metric word**: "weekly" is a schedule word here, not a statistic |
| x60 | "allows **a maximum of 40** rowers" / "**caps** its competitive squad **at 30**" | `the values agree` | **limit phrasing not recognised**: "caps … at" isn't a bound (only "capped at" is), so two different maxima look like an observation inside a limit |

**Two general causes:**

1. **A metric word on one side only is read as two different statistics** (3 of 4).
   - The same exclusion on dev and unseen1–3 (held-out and unseen4 not used): 12 pairs excluded as
     `different_metrics`, **0 contradictions lost**. 8 were one-sided (7 compatible, 1 ambiguous) and 4 two-sided (all
     compatible).
   - So the rule is cheap where the extra word really is a qualifier ("median latency is 120 ms" / "latency is
     120 ms"), and wrong when both sides describe the same measure in different words.
   - **General fix option (not made):** under the positive-evidence principle (§12.21), exclude only when **both** sides
     name **different** statistics (average / peak). A one-sided metric word becomes a low-priority forward. Read
     daily / weekly / monthly as frequency words, not statistics, and compare a stated maximum with any average or
     typical value.
   - **Cost on the other sets:** ≈ 8 more pairs sent to the AI, about 1 call. Recorded AI precision on compatibles is
     high, but that is not a guarantee.
2. **A limit stated in an unrecognised form reads as an observation** (1 of 4).
   - **General fix option (not made):** recognise limit phrasings as a class ("caps X at", "limits X to", "a cap of",
     "up to … allowed"), in the shared quantity and bound parsing. Two limits for the same thing are then compared as
     limits: two different maxima conflict.
   - This touches `rules.ts`, which the live rules-only panel also uses.

**Both need a decision and a fresh sealed set to measure.** unseen4 can't measure them (it is the set they were
diagnosed on). Even with perfect execution these 4 stay missed, so unseen4's ceiling stays 34/38.

**P3 — execution-reliability test: proposal (NOT authorized; an execution check, not a semantic evaluation):**

| Item | Proposal |
|---|---|
| Purpose | Measure completion, timeouts, latency and actual usage under the accepted settings (90 s, 10 pairs, cap + reasoning "low"), through the shipped path (`sendJudgeCall` + the one-request HTTP transport) |
| Workload | 60 pairs from the **dev split and the regression files** (tuning material, no sealed set), sent as **6 full 10-pair calls**, sequentially. Not screened (the screen isn't under test). **No accuracy is reported** |
| Model | gpt-oss-120b on AICredits, the same settings as unseen4; no retries |
| Calls | **6** (hard cap 6) |
| Maximum reservation | **16,800 tokens** (6 × the 2,800 ceiling); expected ≈ 13,000–14,000 reserved, ≈ 6,000–9,000 used |
| Spending ceiling | **$0.02**; expected ≈ $0.001 (unseen4: $0.00057 for 4 answered calls) |
| Recorded per call | start and end time, HTTP status, finish reason, prompt / completion / reasoning tokens when reported, reserved vs used, per-pair outcome. Latency only end to end (non-streaming; queue time can't be separated with this transport, and the report will say so) |
| **Pass criteria** | ≥ 95 % of sent pairs classified (≥ 57/60); **no call reaching the 90 s timeout**; p95 latency ≤ 60 s; no `finish_reason: length`; every call's usage recorded; total usage ≤ 16,800 or the overrun flagged and charged |
| **Failure-handling assertions** (checked by the harness) | a timeout or HTTP error fails exactly its pairs, keeps its reservation, and is not retried; one HTTP request per call; no pair classified without a validated answer; at the end every pair is classified or failed (none in flight or pending); the ledger, the budget and `calls.json` agree; a second run is refused |
| Harness | A `reliability` mode of the recorder, built and tested offline first (free), then frozen before the run. Not built yet: it waits for this proposal's approval |
| Reported as | "Execution-reliability check, 2026-11-xx". Never as an unseen or recall result |

**P1 — final implementation review (independent reviewer, offline; 7 defects found, 7 fixed and pinned).** The
reviewer was given the code and the invariants (late replies, cross-tab reservations, reload recovery, usage
overruns, no duplicate or unbudgeted judgments). It reproduced each defect with a probe; each is now a regression in
`judgeCrossTab.test.ts` (9 tests).

| # | Defect | Severity | Fix |
|---|---|---|---|
| 1 | **Tabs overwrote each other's ledger.** A save wrote the tab's whole map. A reply landing in tab A erased tab B's in-flight mark, so tab C resent the pair; B's later save erased A's classification | HIGH | Every ledger save is **read-merge-write** (stored records merged by precedence first). Every ledger write — reserve, record, settle — runs **inside the shared critical section** (`sendJudgeCall` `commit`) |
| 2 | A reply arriving after cancellation, from a transport that ignores its signal, was recorded | MEDIUM | Cancellation is its own racer; the result is re-checked after the race |
| 3 | The 95 s backstop was timer-only: a throttled tab's late timer let a reply older than the deadline through | MEDIUM | A wall-clock check after the race: older than the deadline = timeout, not recorded |
| 4 | A long-lived tab never saw an in-flight pair go stale (only a fresh load did) | MEDIUM | `expireStale()` (before planning and in `retryable()`); `blocksResend` expires by the clock; an interrupted conversion is stamped now, so it wins merges |
| 5 | A failed budget save after `markSent` cost an attempt for a call never sent | LOW–MEDIUM | The budget is saved **before** any pair is marked. If the **ledger** save fails, the call is not sent: reservation released, pairs back to pending, no attempt counted |
| 6 | Usage above the reservation was charged to no day when a call settled after UTC midnight | LOW | The excess is charged to the new day (`settle(…, reservedHint)`) |
| 7 | The recorder never counted reported usage above its estimate against its approved ceilings | LOW | The overrun is added to its token and dollar totals (recorder code, reviewed, not run) |

**Holding (the reviewer's probes):**
- one-tab late replies;
- cross-tab budget with a shared store and section (no double spend; unique reservation ids);
- fail-closed reading;
- attempts can't pass 3 through a reload;
- a context change resets attempts by design, and each resend is still budgeted;
- overruns block the next call;
- no call without a reservation;
- the cap plumbing (BYOK only).

**Documented limits:**
- a tab without the shared section or budget store isn't covered by cross-tab atomicity (the contract says so; wiring
  must pass both);
- **unverified:** whether the Copilot SDK retries a model call internally (its "auto-mode switch after a rate limit"),
  which would mean more than one model call per reservation. That would need a live check;
- the Copilot host's finish reason is never "length", so truncation there is caught by the reply's shape.

**Tests:**
- consistency 187 passed;
- `src/ai` + `src/app`: **2,535 passed, 0 failed**. The 4 skipped are all opt-in: a paid live model run and three
  local-embedding spikes;
- `tsc` and eslint clean.

**Review package (nothing staged or committed; commit only on the user's word):**

| Group | Files | State |
|---|---|---|
| Execution path | `src/ai/consistency/{judge,judgeCall,judgeLedger,judgeReply,candidates,screen}.ts` | untracked (the whole `src/ai/consistency/` is new) |
| Its tests | `judgeCall`, `judgeExecution`, `judgeCrossTab`, `judgeBatchSizing`, `judgeLedger`, `candidates`, `regressionsUnseen3`, `unseen3`, `unseen4` `.test.ts` | untracked |
| Provider / host cap plumbing | `src/ai/types.ts` (`reasoningEffort`, `outputCap`), `providers/copilot/copilotProvider.ts` + test, `host/copilot/CopilotHostRuntime.ts` + test, `src/app/api/ai/aiHost.ts` (3 lines) | tracked, modified. **`aiHost.ts` also carries another lane's `localTrust` change, as do `models/route.ts`, `route.test.ts` and `localTrust*.ts`: hand-split the hunks** |
| Evaluation harness | `src/ai/contractTests/judgeHttpTransport.ts`, `consistencyUnseen.contract.test.ts` | untracked |
| Evaluation evidence (commit first, byte for byte) | `evaluation/update-engine/consistency/unseen4/**`, plus unseen/unseen2/unseen3 and `regressions-unseen3.json` | untracked |
| Stage 5 prototype | `src/ai/router/{descent,itemIndex,…}.ts`, `locateEvaluation*.ts`, `evaluation/update-engine/locate/**` | untracked |
| Docs | this plan, `knowledge-notes-lanes.md` | modified |

### 12.29 Provider-request accounting, the reliability check (PAID, one run, PASS), screening refinements (2026-11-15)

**Review decision (2026-11-15, "Stage 4f Decision Review"):**
- approved: the bounded P3 reliability recording (≤ 6 calls, ≤ 16,800 reserved tokens, ≤ $0.02, 60 dev + regression pairs, no accuracy reported), conditional on verifying SDK retries and a frozen, offline-tested harness; no paid reruns;
- approved offline: both P2 screening refinements (fix the general logic; unseen4 is development evidence from now on);
- approved: scoped commits;
- kept: the 90,000-token day, 10 pairs per call, the provider configuration;
- **Stage 4f stays OFF.**

The two release gates stay separate:
- **execution reliability**, which this check addresses;
- **semantic quality**, on fresh sealed data: contradiction recall ≥ 85 %, strict recall ≥ 85 %, conflict precision ≥ 90 %, context false positives ≤ 10 %.

Passing the first doesn't satisfy the second.

**P1 — provider-request accounting (offline, plus a local-mock measurement; no model).**

*Measured:* `copilotRetry.spike.test.ts` (opt-in `COPILOT_RETRY_SPIKE=1`) points a BYOK connection at a **local** mock OpenAI-compatible server and counts what arrives. @github/copilot-sdk 1.0.14:

| Mock reply | Physical POSTs for one call, unguarded | With the guard |
|---|---|---|
| success | 1 | 1 (`providerRequests: 1`) |
| 429 | **6** ("retried 5 times", 5.3 s) | 1, call fails |
| 500 | **6** ("retried 5 times", 15–17 s) | 1, call fails |

So on the app path one reservation could become up to 6 billable requests. The SDK exposes no setting to turn that off.

*Control:* `src/ai/host/copilot/attemptGuard.ts`, a `SingleAttemptRequestHandler`. It uses the SDK's experimental `requestHandler` hook, which sees every outbound model-layer request before it leaves the process:
- the first POST is forwarded;
- every repeat is answered locally with a non-retryable 400 and never reaches the provider;
- WebSocket model transports are refused, since one connection can carry several requests;
- GETs pass through and aren't counted.

How it is wired:
- `AIRequest.singleAttempt` asks for the guard;
- `AICapabilities.providerAttempts: "single"` declares support (the Copilot provider);
- `AIResponse.providerRequests` returns the count;
- `aiHost.ts` passes the flag through.

*Execution core:* a `JudgeTransport` must declare `singleAttempt`, or nothing is sent. The new status is `no_single_attempt`, with pending reason `single_attempt_unavailable`; no reservation is made.
- `JudgeTransportRequest.onProviderRequest` counts requests at the transport's physical boundary.
- `JudgeCallResult.providerRequests` is the larger of the boundary count and the count reported by the layer below. `extraProviderRequests` flags more than one.

*Recording transport:* raw `fetch`, which never retries a POST. Redirects are refused (`redirect: "error"`), because a 307 would re-send. A real local server sees one request for each of 429, 500 and 307.

*Limits:*
- the WebSocket refusal is unit-tested only (the SDK builds those handlers internally);
- the guard is an experimental SDK API, so re-run the spike after any SDK upgrade;
- on a failed app-path call the count isn't returned (the AIError crosses HTTP), but the guard bounds it to 1 by construction.

**P2 — the reliability check (PAID, one run, done — never rerun).** `src/ai/contractTests/reliabilityHarness.ts` (vendor-neutral core), `consistencyReliability.contract.test.ts` (runner), `wireCounter.ts` (undici `undici:request:create` diagnostics channel: model POSTs counted *below* fetch, independently of the transport). Workload `reliability/workload.json` = dev.json (56) + regressions.json (2) + the first 2 of regressions-unseen1.json, **statements only, no labels** (a test checks), 6 fixed groups of 10. Offline simulations against a real local server (`reliabilityHarness.test.ts`, 12): all-pass; 500 → its 10 pairs fail, reservation kept, not retried; truncation; missing usage; unreadable reply (no repair); timeout; **a hidden retry below the transport is caught on the wire (transport 1, wire 2)**; call/token/dollar ceilings enforced before sending; code caps (6 / 16,800 / $0.02) can't be raised. Frozen in `reliability/FREEZE.json` (11 files incl. judgeCall/judgeLedger/judgeReply/judge/candidates/transport/workload), pinned in `reliabilityFreeze.test.ts`; the runner refuses on any change, any earlier run folder, or a missing ceiling, and writes `started.json` before the first request.

**Result — run `reliability/runs/2026-11-15-reliability`: PASS.**

| Criterion | Observed |
|---|---|
| ≥ 95 % pairs classified (≥ 57/60) | **60/60** |
| no call reached the 90 s timeout | none |
| p95 latency ≤ 60 s | **40.4 s** (p50 19.1 s; 18.5, 30.1, 40.4, 18.0, 19.1, 29.0 s) |
| no `finish_reason: length` | none |
| complete usage accounting | all 6 calls reported prompt + completion tokens |
| usage within 16,800 | reserved 12,888 · used/charged 8,818 |
| requests: application / transport boundary / wire | **6 / 6 / 6** (1/1/1 per call) |
| cost | **$0.000802** (worst case $0.00219, ceiling $0.02) |

All 9 failure-handling assertions held. They held trivially where nothing failed, so the failure paths are covered by the offline simulations only.

Caveats:
- 6 samples: p95 is the largest value, an operational check, not a latency estimate;
- AICredits reported no reasoning-token breakdown;
- latency is end to end (queue time can't be separated);
- one day, one provider: this qualifies the path for further review, **not long-term reliability**;
- semantic accuracy was not measured and must not be inferred.

Outputs are pinned byte for byte.

**P3 — screening refinements (offline; no AI call).** Two general fixes for the unseen4 misses:

1. **`different metrics` excludes only on positive evidence.** The pair must have both sides naming a statistic, and the two must differ (`statisticsDiffer` in screen.ts).
   - "Average", "mean", "typically", "usually" and "normally" are one central-value class.
   - Period words count only when both sides use them, and not when they are the sentence's own frequency.
   - A bound is not a statistic.
   - A statistic word on one side only is forwarded with its own reason and never dropped as an extension.
   - The tier-1 rules' verdict and the live panel are unchanged.
2. **Limit phrasing is parsed as a maximum** in the shared bound parsing (rules.ts `valuesOf`).
   - Covered: a limiting verb with its object between ("caps … at", "limits … to", "restricts … to"), plus "a cap of" and "a ceiling of".
   - Two different maxima become the existing `limit` near-miss and are forwarded.
   - An observation inside a cap still agrees.
   - "The limit to N" after an article stays a value.

Effect:
- **dev + regression files (75 pairs):** 0 changes.
- **unseen1–3 (diagnostic):** 8 compatible or ambiguous pairs change: 7 now forwarded, 1 now `same_frequency`. No contradiction is newly excluded.
- **unseen4, now development evidence (never reported as unseen):** x04, x24, x60 and x71 are forwarded, plus 6 compatibles (10 of 90 changed, none newly excluded).

Pinned in `regressions-unseen4.json` and `regressionsUnseen4.test.ts`: the 4 unseen4 pairs copied word for word, 6 authored variants and 4 counter-cases. The historical unseen4 result (8 calls, 32/72 classified, 42 % recall) is unchanged. **Whether these fixes generalise needs a fresh, independently authored sealed set.** No paid semantic evaluation is approved.

**Tests:**
- `src/ai` + `src/app`: **2,564 passed, 0 failed**;
- 10 skipped (opt-in spikes, including the 6 SDK-retry spike tests);
- 6 expected-fail (other lanes' known gaps), 4 todo;
- `tsc` and eslint clean.

**Commits:** all lanes' work was committed and pushed (GowthamrajSrinivasan/acute-notes) as 7 lane-scoped commits, the frozen unseen evaluation history first. This section's work is committed after it. `.gitattributes` now pins LF for `evaluation/**` and `src/ai/**`, because FREEZE hashes are byte-exact and a Windows clone with `autocrlf` would otherwise break them.

**What still blocks Stage 4f:**
1. **Semantic quality** on a fresh, independently authored sealed set with blind labels. Preparing it is approved; the paid run needs its own approval.
2. **Execution, still open:**
   - wire `judge_consistency` into the app only through `providerJudgeTransport` (the guard);
   - live behaviour of the guard against a real BYOK provider and of the Copilot subscription path. A subscription connection is still refused by the cap rule, so the check never runs there.

### 12.30 Integration checkpoint accepted; fresh-clone verification, SDK pin, guard wire fix, live smoke prepared, unseen5 frozen (2026-11-15, no paid call)

**Review decision (2026-11-15, "Integration Checkpoint Review"):**
- accepted: the committed checkpoint, the six-call result, the screening fixes (as offline regression fixes) and the `.gitattributes`/`.gitignore` changes;
- approved: preparing a narrowly scoped live SDK verification; the paid smoke test needs a separately stated call and spending ceiling;
- keep the SDK pinned and rerun the retry regression on any upgrade;
- recommended: a fresh-clone verification of the pushed HEAD; document, rather than rewrite, intermediate commits that may not build;
- next semantic set: independently authored, sealed, blind labels; no tuning after seeing its labels or routing;
- **Stage 4f stays OFF.**

**1. Fresh-clone verification of `36480d0`:**
- `npm ci`, `tsc` and eslint: clean (0 errors; 2 warnings in another lane's file);
- vitest over `src`: **16 files failed**, 3,623 tests passed.

| Finding | Cause | Effect |
|---|---|---|
| **Line endings** | 751 of 2,046 tracked files differ from the dev worktree: 214 CRLF files were stored as LF (git `autocrlf` normalises on add); 537 LF files are checked out as CRLF (machine `core.autocrlf=true`, outside the `eol=lf` paths) | All 16 failures. Copying the worktree bytes for the 743 line-ending-only files into the clone makes all 16 pass (139 tests). Frozen CRLF files (e.g. `unseen3/pairs.json`, `unseen4/frozen-code/**`) are **not held byte for byte in git**: their FREEZE hashes are of CRLF bytes, the blobs are LF |
| **Path length** | Longest tracked path is 133 characters (`evaluation/knowledge-notes/experiments/claim-conditions-…/adjudication-packets/…`); a clone under a ~120-character directory exceeds Windows' 260 limit | Checkout fails without `core.longpaths=true`. Clones in ordinary locations are fine |

**Proposed fix (NOT applied — needs your go-ahead: a repository-wide policy change and a commit):**
- `.gitattributes` becomes `* -text`, so every file is stored and checked out byte-exact on every platform;
- the 213 CRLF files whose content is otherwise unchanged are re-stored with their CRLF bytes;
- after that, a fresh clone equals the worktree.

The commit was attempted and blocked by the session's safety classifier. `.gitattributes` was restored to HEAD and nothing was changed in git.

**2. SDK pin (offline):**
- `@github/copilot-sdk` is exactly `1.0.14` in `package.json` and the lock root; its platform binaries were already pinned by the SDK;
- `src/ai/host/copilot/retryGuardVerification.json` records what was verified at that version;
- `sdkPin.test.ts` fails if the declared, locked or installed version differs. On an upgrade, rerun the spikes and update the record before enabling model calls.

**3. New finding — the output cap never reached the wire (fixed offline):** `copilotWireFields.spike.test.ts` (opt-in, local mock) shows the SDK runtime's BYOK request carries `model`, `messages`, `reasoning_effort` and **`temperature: 1`**:
- **no `max_tokens`**: `ProviderConfig.maxOutputTokens` never reaches the request;
- not the caller's `temperature: 0`.

So the provider's `outputCap: "passed"` (§12.25) was **not true on the wire**. The reliability run wasn't affected: it used the direct HTTP transport, which sends `max_tokens`.

*Fix:* for `singleAttempt` calls on a BYOK connection, `SingleAttemptRequestHandler` writes `max_tokens` (replacing any `max_completion_tokens`) and the caller's `temperature` into the one request it forwards, and records what it applied. Verified through the real SDK runtime: `max_tokens: 512, temperature: 0`. Other BYOK requests stay uncapped, as before; only the consistency check relies on the cap, and it always sets `singleAttempt`.

**4. Live SDK retry-guard smoke test — PREPARED and FROZEN, not run.**

Files:
- `contractTests/countingProxy.ts`: a local forward proxy used as the BYOK `baseUrl`. **Every** provider-bound request passes through it, including any from the SDK's separate runtime process, so it counts below the SDK boundary.
- `guardSmoke.ts`: the three cases (below).
- `guardSmoke.contract.test.ts`: the paid runner.
- `guardSmoke.rehearsal.test.ts` (opt-in, free, real SDK + local mock upstream) and `countingProxy.test.ts` (6).

The proxy:
- can inject a 429 or 500 locally, so retries are tested without paying for them;
- has a hard forward cap;
- refuses any request whose worst case (bytes ÷ 3 + `max_tokens`) breaks the token or dollar ceiling, **before** forwarding it.

Three cases through the real host runtime (pinned SDK, guard on):

| Case | Expected |
|---|---|
| injected 429 | 1 arrival at the proxy, 0 forwarded, the call fails without a retry |
| injected 500 | the same |
| live | 1 arrival, 1 forwarded, answered, `providerRequests: 1`, usage reported |

The rehearsal passes. The SDK's request is about 7 KB (its own system prompt + ours), about 2,900 worst-case tokens with the 512 cap.

Frozen:
- `evaluation/update-engine/guard-smoke/FREEZE.json` (12 files: harness, proxy, guard, host runtime, client, hardening, error mapping, verification record), pinned in `guardSmokeFreeze.test.ts`;
- the runner also refuses unless the installed SDK is the verified version.

**Proposed ceiling for the paid run (needs your explicit approval):**
- **≤ 1 forwarded provider request**, **≤ 4,000 worst-case tokens**, **≤ $0.01**;
- gpt-oss-120b on AICredits, BYOK through the Copilot SDK;
- one run, no reruns; expected cost ≈ $0.0003.

**5. unseen5, the sealed semantic set — authored and INPUTS frozen.** The protocol of §12.25:
- **Author:** an isolated fresh agent, given only a coverage spec. Its only tool use was writing three files.
- **The set:** 90 pairs (10 batches of 5 + 40 singles). Draft 38 contradiction / 44 compatible / 8 ambiguous, over the same 16 categories.
- **Script check (ids only):** batch B7 (y31–y35) shared ≥ 0.60 of its words with an unseen2 statement and was rewritten by the same author, unseen. After that, max Jaccard is 0.50 against every earlier set, including unseen4 and the regression files.
- **Frozen:** `DATA-FREEZE.json` (pairs, draft key, sheet); `unseen5.test.ts` pins the inputs and checks shape, a blind sheet, independence, and that no labels, code freeze or run exist yet.
- **I have not read the statements.** The author's draft key is not the truth.

**Next for unseen5:**
1. Blind labels from you or the reviewer, written in `unseen5/labelling-sheet.md`.
2. The code freeze.
3. The free route step: exact candidate and call counts, with candidate overflow fully accounted for.
4. The paid proposal.

No implementation change may be made on the basis of its labels or routing.

**Tests:**
- `src/ai` + `src/app`: 2,586 passed, 0 failed;
- 13 skipped (opt-in spikes);
- `tsc` and eslint clean.

**Not committed** (the session's commit was blocked; awaiting your word): the SDK pin, the guard wire fix, the smoke harness + freeze, unseen5 + its test, this section.

### 12.31 Byte-exact repository, live-guard harness hardened, unseen5 labels + code frozen + free route step (2026-11-15)

**Review decision (2026-11-15, "Stage 4f Review"):**
- approved: the byte-exact line-ending repair (own commit; verify blob hashes, frozen hashes and fresh clones with `core.autocrlf` true and false);
- approved: scoped commits after verification;
- approved: ONE live SDK retry-guard test at ≤ 1 provider request, ≤ 4,000 tokens, ≤ $0.01.

Extra acceptance criteria for the live test:
- the provider-bound payload carries the intended `max_tokens` and temperature;
- usage is settled against the budget reservation;
- a late response can't overwrite a terminal result;
- a second execution is refused;
- **any unexpected retry, fallback or repair request fails the test, even within budget.**

Not approved: the unseen5 paid recording, tuning, routing-weight changes, 4f activation.

**P0 — line-ending repair, committed locally as `5d68cb1` (its own commit).**
- `.gitattributes` is the single rule `* -text`;
- **383 files** whose content equals HEAD apart from line endings are re-stored with their exact worktree bytes. §12.30's 213 counted only files whose clone bytes differed under `autocrlf=true`; files that are CRLF in the worktree but stored LF also need re-storing under `-text`.
- `git diff --cached --ignore-cr-at-eol` showed no change but `.gitattributes`;
- all 384 staged blobs equal `git hash-object --no-filters` of the working file.

Excluded:
- `package.json` (CRLF plus the SDK pin) goes into the functional commit;
- another lane's `src/ai/reconcile/update.ts` is LF in its worktree while its stored blob had CRLF, so its owner's next commit shows a whole-file change.

**P1 — live guard test, hardened, frozen, NOT YET RUN (ceiling blocker).**
- Each case is now one consistency check through the app's own path: `runJudgeCheck` (plan → reserve in a real `JudgeBudget` → one call → settle, `JudgeLedger`) over `providerJudgeTransport` over the real Copilot SDK host runtime. A test-only `hostRuntimeProvider` stands in for the Next route.
- The proxy records each request's `max_tokens`, `temperature` and field names.

Checks per case:
- **Injected 429 / 500:** exactly one arrival, nothing forwarded, the call fails, the pair fails, the whole reservation is kept, no extra provider requests.
- **Live:** exactly one arrival and one forward, carrying `max_tokens` = the call's output budget and `temperature: 0`; answered; pair classified; `providerRequests` 1; usage reported; the budget settled to the reported usage; a late reading for another reservation is ignored.
- **Overall:** exactly 3 arrivals, 1 forwarded, 0 refused.

The free rehearsal (mock upstream) passes every check: `max_tokens` 760, temperature 0. Re-frozen in `guard-smoke/FREEZE.json` (15 files, now including the judge path; the verification record is left out so it can be updated after the run).

**Blocker:** the live judge request through the SDK is **9,799 bytes**: our judge prompt plus about 7 KB of the Copilot runtime's own system prompt.
- The conservative pre-send estimate (bytes ÷ 3 + `max_tokens` 760) is **4,027 tokens**, 27 over the approved 4,000, so the proxy refuses to forward it (as designed).
- The realistic size is about 3,200 tokens (bytes ÷ 4 + 760); about $0.0003.
- Options:
  - (a) raise the token ceiling to **4,500** (worst case $0.003 at gpt-oss rates; still ≤ 1 request, ≤ $0.01);
  - (b) an exact token count, which needs the gpt-oss tokenizer file (a download);
  - (c) a smaller output cap, which tests a different configuration than the app uses (not recommended).

**Related finding:** `callTokens` reserves only our prompt, so on the Copilot path every consistency-check call under-reserves by about 1,800 input tokens (the SDK's system prompt). Overruns are charged and flagged by design (§12.28), but the 90k day would be consumed faster than planned. Open, no change made: candidates.ts and judge.ts are frozen by the reliability and unseen5 freezes.

**P3 — unseen5:**
- **Labels:** from your `Claude outputs/unseen5-labels.md`, converted verbatim into `unseen5/labels.json` with the source file's hash: **40 contradiction / 45 compatible / 5 ambiguous**. I didn't draft or edit them, or compare them with the author's draft.
- **Code freeze:** `unseen5/FREEZE.json` holds the same 18 code files as unseen4's freeze, at current bytes (including the §12.29 screen and limit fixes and the single-attempt call path), plus the 4 data files. Byte copies are in `frozen-code/`, and `unseen5.test.ts` pins everything.
- **Free route step, run once** (`runs/2026-11-15-unseen5`; do not rerun):

| Measure | Result |
|---|---|
| rules-only routing | 4 rule conflict, 10 near-miss, 76 excluded |
| §12.21 pipeline screen | **85 forwarded, 5 excluded** (y19 different scope; y36, y39 different metrics; y76, y78 values agree) |
| pipeline generation recall | **40 / 40** contradictions reach the AI |
| budgeted selection, all 90 as competing changes | 39 / 40; **y24 waits** (rank 12, outranked by 11) |
| candidate overflow, pool | 125 pairs pending over 13 calls, about 3 days at the cap; per change: median 8, max 22 candidates |
| batches (50 pairs, 10 changes) | 16 / 16; nothing pending |
| planned paid calls | **9 calls, 86 pairs, ≤ 20,930 reserved tokens** (max 2,441 a call) |

The rules-only "expected compatible" lines in routing.md are the frozen recorder's placeholder and mean nothing (§12.22).

**Paid unseen5 proposal (NOT approved):**
- ≤ 9 calls, ≤ 21,000 reserved tokens, ≤ $0.05;
- gpt-oss-120b on AICredits over the direct one-request HTTP transport (as unseen4), no retries, once;
- measured against the review's gates: recall ≥ 85 %, strict ≥ 85 %, precision ≥ 90 %, context FP ≤ 10 %, overflow accounted.

**Suite:** `src/ai` + `src/app` give 2,606 passed. 1 failure (`noVendorLeak`) is another lane's untracked `src/mcp/tools/publishedTools.ts`; repo-wide `tsc` errors only in another lane's mid-edit `src/mcp/tools/repoMap/index.ts`. Neither is in this lane's commits.

### 12.32 Live SDK guard test PASS; unseen5 preflight (B blocked); SDK reservation correction (offline, not wired) (2026-11-15)

**Review decision (2026-11-15, "Stage 4f Decision Review"):**
- accepted: the byte-exact repair (fresh-clone verification passed: 2 clones, `autocrlf` true and false, 2,086 files byte-identical to their blobs; 3,714 tests passed, 0 failed);
- approved: the live SDK test at **4,500 tokens for this test only**, 1 request, $0.01;
- **conditionally approved: unseen5** (9 calls, 21,000 tokens, $0.05, gpt-oss-120b, once, frozen), subject to (A) reconciling 85 vs 86 candidates and (B) verifying transport-specific token accounting;
- approved offline: including the SDK system prompt in reservations, versioned, without touching frozen artifacts;
- **4f OFF.**

**Order changed, deliberately:** the reservation correction must edit `judgeCall.ts`/`candidates.ts`, which unseen5's code freeze covers. So the correction is built as a new versioned module and **wired only after the unseen5 recording**. The live SDK test didn't depend on it: its own proxy bounds the complete request before sending.

**1. Live SDK retry-guard test — run once, PASS** (`guard-smoke/runs/2026-11-15-guard-smoke`, pinned; a second run is refused, verified).
- The code cap was raised 4,000 → 4,500 for this test only and re-frozen before the run (`refrozen` in FREEZE.json). The rehearsal passed at 4,500 first.

| Case | Arrivals at proxy | Forwarded to AICredits | Result |
|---|---|---|---|
| injected 429 | 1 | **0** | SDK retries suppressed; call failed (transport); pair failed; reservation 1,424 kept |
| injected 500 | 1 | **0** | same |
| genuine | 1 | **1** | `max_tokens` 760 and `temperature` 0 on the request; answered; pair classified; `providerRequests` 1; budget settled 1,424 → **2,201** (reported usage); a late reading for another reservation ignored |

- Every check ✓; 3 arrivals, 1 forwarded, 0 refused.
- Cost ≤ $0.000374. The request was 9,844 bytes.
- `retryGuardVerification.json` records the live result, and `sdkPin.test.ts` now also requires it (PASS, forwarded 1, providerRequests 1).

**2. unseen5 preflight.**
- **A — reconciled.** 86 planned = 85 pipeline forwards + **y19**: the near-miss routing's candidate, which the pipeline excludes (different scope). The frozen recorder plans the union so all three routings are scored on the same answers (since §12.16/§12.21).
  - No duplicates (86 unique). No extra call: 85 pairs would also need 9 calls (8 × 10 + 5).
  - The pipeline still scores y19 as excluded.
  - The 125 pending pairs belong only to the budget simulation (90 changes competing). The recall denominators are the 90 labelled pairs (40 contradictions), **y24 included**.
- **B — NOT passed (strictly).** The recorder uses the direct HTTP transport (no SDK overhead). But its estimate (characters ÷ 4) excludes the chat template: on the current prompt, the reported prompt tokens exceeded the estimate on every reliability call (+6 to +39).
  - The worst case if every output hit its cap: 20,930 + 9 × 39 ≈ **21,281 > 21,000**.
  - Realistic use is about 14–15k (no completion has come within 575 tokens of its cap).
  - The recorder can't add the margin without a frozen-file edit. **Not run.** Needs either a ceiling of **≤ 21,300 tokens** (dollar ceiling unchanged, $0.05) or the recording run with the 9th call dropped (loses 6 pairs; not recommended).

**3. SDK reservation correction — `src/ai/consistency/requestOverhead.ts` (version 1, new file, NOT wired).**
- Measured: the SDK request for a one-pair check is 9,844 bytes, against 2,912 for the same check sent directly. That's **6,932 bytes of SDK system prompt**: 2,311 tokens conservatively (bytes ÷ 3), about 1,730 realistically.
- `REQUEST_OVERHEAD`:
  - `copilot_sdk_byok` 2,311;
  - `direct_http` 64 (the chat template, measured up to 39);
  - `reservationWithOverhead(callTokens, kind)`.
- Tests pin: the live call would have been fully reserved (1,424 + 2,311 ≥ 2,201).

**Finding:** under the unchanged 2,800-token per-call ceiling, **not even a one-pair check fits the Copilot SDK path** (1,424 + 2,311 = 3,735). The direct path fits.

Options for the SDK path (your decision; nothing done):
- (a) **`systemMessage` mode `"replace"`** for the consistency-check task only. Our judge prompt becomes the whole system message, so the overhead is about 0. The SDK documents that replace "removes all SDK guardrails including security restrictions". Our hardening (zero tools, deny-all permissions, empty isolated directory, `mode: "empty"`) stays.
- (b) `"customize"` mode, removing sections (size unmeasured).
- (c) a transport-specific per-call ceiling of about 5,200 on the SDK path. That contradicts "don't raise the per-call limit globally" unless scoped to it.
- (d) consistency checking only over direct connections.

Wiring follows the unseen5 recording either way.

**unseen5's frozen files:** unchanged (all 22 verified).

**Tests:** consistency, contract, host and provider tests: 329 passed, 10 skipped (opt-in).

## 13. Stage 5 — semantic locate and anchor (plan, 2026-11-14)

**Status: planned, nothing built.** Goal: find the card and the exact item a piece of new information belongs to,
and append or update there, at the lowest cost that stays accurate. Stage 4f is unaffected and takes priority where
the two touch (§13.7).

### 13.1 The second design, compared

"AI Topic Accumulation Design" (the user's doc, 2026-11-14) is a server design: PostgreSQL with pgvector and ltree, a
workspace → topic → section → block tree, a small-model call on every capture, provisional threads, clustering.

| Its idea | Acute today | Decision |
|---|---|---|
| PostgreSQL, pgvector, ltree, triggers, job table | `frameId`, `stableNodeKey`, `WorkspaceIndex`, `VectorTier`, baseline fingerprint, `CommitJournal`, `afterCommit` | **Not adopted.** Local-first already has each equivalent; its own SQLite variant was never run |
| Placement contract, version guard, minimal patch, one transaction | `ChangeSet`, `patch_block`, `accept.ts`, `commit.ts` | Already built |
| Cheapest-first lookup, stop at the first confident hit | `routeContent` scores one flat pool by a weighted sum | **Adopt** — 5c |
| Entity inverted index as a shortcut | none in the router; descriptors hold tf·idf keywords | **Adopt, deterministically** — 5c (keyword postings, no model call) |
| Items as rows with hash, embedding, position; anchor modes append / after_item / replace_item / new_block | units are diffed per sentence / list item / table row, but placement offers only "update a sentence" or "new card at the bottom of the section" | **Adopt** — 5b, 5d |
| A block updater per kind (list and table need no model) | `patch_block` has `cell` and `caption` targets, unused by the router for inserts | **Adopt** — 5d |
| One combined small-model call; judge only on a small margin | three separate tasks (`route_content`, intent refinement, `judge_consistency`) | **Adopt** — 5e |
| Provisional threads, 48-hour working memory, community clustering | overlaps the topic-merge plan (`chat-share-import-plan.md`) | **Out of scope here** |
| Facts table and fan-out | Stage 3 impact discovery, offered per card as a decision | **Not adopted** (that design defers it too) |
| Labelled evaluation set before feature code | exists for consistency, not for placement | **Adopt** — 5f |

**Why this, why now.** Four places match by shared words: the router's "contains the claim" test (≥ 50 % shared
words, §10), impact discovery (≥ 0.5 overlap, §11), the intent pre-pass, and the consistency screen's relatedness
(§12.21). §12.20 measured what that costs on a new author's wording, and §10 recorded a paraphrase scoring 0.09.
A missed "contains the claim" turns an update into a duplicate card. One better retrieval layer serves all four.

### 13.2 5a — the embedding provider seam and the local model

**The seam is the deliverable; the model is its first implementation.**

The built `Embedder` (`src/ai/router/embedding.ts`) is synchronous and returns sparse vectors. A model is
asynchronous, batched and dense, so the seam is widened in a **new file** (`embedding.ts` is frozen, §13.7):

    EmbeddingProvider
      id          stable name, e.g. "local-hash-v1", "local-<model>-v1", "provider-<name>-<model>"
      dims        vector length
      kind        "local" | "remote"      (remote = leaves the device, counts as AI spend)
      embed(texts[])  →  Promise<vectors[]>   (batched; order preserved)
      ready()     →  Promise<"ready" | "unavailable">

Rules that keep it swappable:
- **One factory picks the implementation** from configuration. No caller imports a concrete embedder.
- **Every stored vector carries `id` and `dims`.** Vectors from two embedders are never compared. Changing the
  configured embedder marks the vector tier stale and re-embeds in the background (the 4b index-health states:
  fresh / stale / rebuilding / failed).
- **Callers see only vectors and cosine.** Dense or sparse is hidden behind one similarity function.
- **The hashed embedder stays** as an adapter on the same interface: the fallback when the model is unavailable,
  and the embedder the frozen Stage 4f code keeps using.
- **Similarity thresholds are per embedder**, stored beside its id — a cosine of 0.2 does not mean the same thing
  for two models.
- **A provider embeddings API**, if ever needed, is a third implementation with `kind: "remote"`. It then also
  needs: the existing `AICapabilities.embeddings` flag, the AI-spend guards and budget, an explicit user opt-in
  (text leaves the device), and the hosted-deployment "AI off" switch. None of that is built now.

The local model:
- Runs in a worker, never on the UI thread. Embeds only items whose content hash changed.
- Vectors persist in idb keyed by (embedder id, content hash), so a reload does not re-embed.
- Stored quantised (one byte per dimension) to bound memory at item level.
- **Candidates for the spike, none verified yet:** small sentence-embedding models of about 384 dimensions that
  run in-process through an ONNX runtime. The spike measures download size, cold start, per-item time and memory
  on the desktop and web builds, and records the pick.
- Desktop build constraints from earlier work apply (webpack-only, the after-pack copy step).

**Gate for making the model the default** (offline, no paid call): on the development material and the router
fixtures it must (1) rank the §10 paraphrase cases above the 0.2 line the hashed embedder missed, (2) not lower any
existing router or screen test, (3) keep a routed placement under the §12.6 budget once vectors are cached.
Never measured on, or tuned against, the third unseen set; the first two unseen sets stay diagnostic only.

### 13.3 5b — item-level index

- One entry per sentence, list item and table row: content hash, vector, owning card (`stableNodeKey`), block id,
  position. Keys are the existing unit keys — no new identity.
- Maintained by the 4a–4b commit hook (`afterCommit` → index sync), incrementally, like the card-level tier.
- **Exact duplicate = hash match → `DUPLICATE`, no model call, no vector search.**
- It is a derived cache: deleting it loses nothing, and it rebuilds from the canvas.

### 13.4 5c — router descent with early exits

Order, stopping at the first confident step:
1. **Explicit context** — the open frame, the selection, or the card the content was written beside.
2. **Exact duplicate** (5b).
3. **Keyword postings** — the descriptors' distinctive keywords as an inverted list from keyword to cards. One
   card whose kind fits is final.
4. **Sections** — top two by centroid, name and summary.
5. **Cards** in those sections, by vector and the index's retrieval.
6. **Items** in the top cards — the anchor.
7. **Model step** (5e) only when the top two are within the margin.

Kept from Stage 2: the two confidences never blended, `NEEDS_CLARIFICATION`, canvas-only destinations, routing
signals, and the user confirming every placement. **Routing weights are not changed until 5f exists** (the standing
rule from §12.9).

### 13.5 5d — anchor actions

| Anchor | When | Emitted as |
|---|---|---|
| `replace_item` | an item holds the claim (SUPERSEDES / EXTENDS) | `patch_block` on that item — built in Stage 1–2 |
| `after_item` | an item is the closest match and the content is new | `patch_block` inserting after it — **new** |
| `append` | the card is a list, or no item is closer | `patch_block` adding at the end — **new** |
| `table_row` / `cell` | the card is a table; row matched by keyword, column by attribute | `patch_block` with the `cell` target (1d) or a new row — **new for inserts** |
| `new_block` | the section fits but no card does | `create_block` in the section — today's `insert_near` |

List and table inserts are deterministic. Every anchor goes through the same review, the same accept-time checks
and one undo step. Locked and user-worded cards keep their Stage 1e rules.

### 13.6 5e — one "relate" call, and 5f — the locate evaluation set

**5e.** One task: a new claim plus up to 10 candidate items → for each, the relation (NEW / SUPERSEDES / EXTENDS /
CONTRADICTS / DUPLICATE / UNCLEAR), and the one best target. It would replace `route_content`, the `UNCLEAR`
refinement and `judge_consistency`.
- Called only on a small margin, or for the after-commit consistency check; never on every placement.
- The deterministic result is shown first; the model's answer arrives after and only preselects. The recorded
  call took about 15 s (§12.14, §12.20), so it must never block.
- The Stage 4 guards (context, non-exclusive swap, thin) apply to its answers unchanged.
- **Not designed in detail until the third unseen recording is reported** — that result decides whether the
  consistency half is worth merging or stays rules-only.
- Any live check needs its own proposal and approval, as always.

**5f.** Labelled placements: content, a canvas, the expected card, anchor and action, including paraphrases,
duplicates, list and table targets, and "belongs nowhere". Built before 5c–5e are tuned, with a held-out part
fixed first, as in §12.12.

### 13.7 Order of work, against Stage 4f in progress

**Frozen until the third unseen recording is done** (`unseen3/FREEZE.json`): `rules.ts`, `quantities.ts`,
`information.ts`, `meaning.ts`, `router/embedding.ts`, `screen.ts`, `judge.ts`, `candidates.ts`, the three
scorers, the recorder, the pairs and the draft key. Stage 5 work before then is **new files only**.

| # | Step | Blocked on | Touches frozen files |
|---|---|---|---|
| 1 | **4f:** transcribe the 90 blind labels, freeze, free route step, approval, one paid run, report (§12.22) | the user's labels | no |
| 2 | **5a spike:** the `EmbeddingProvider` interface, the hashed adapter, model candidates measured — new files. **Done 2026-11-14 (§13.9): MiniLM-L6 recommended** | — | no |
| 3 | **5f:** locate evaluation set, held-out fixed first. **Built 2026-11-14 (§13.11)** | — | no |
| 4 | **5a wiring:** `VectorTier` reads the provider; the default switches if the gate passes | step 1 done | yes (`embedding.ts`) |
| 5 | **5b** item index, then **5c** descent, then **5d** anchors | step 4 | `screen.ts` only if relatedness moves to the new vectors |
| 6 | **5e** relate call — design, then a proposal for any live check | step 1 reported, step 5 | yes (`judge.ts`) |

**The third unseen set measures the frozen pipeline with the hashed embedder.** Its result stands for that
configuration only. Swapping the embedder under the consistency screen later is a new configuration and would need
new evidence before any claim about it — it is not a rerun, and the third set is never reused for it.

### 13.8 Open questions

1. Which local model; bundled weights or first-use download (build size against a first-run wait).
2. Web build: the model, or the hashed embedder only.
3. Whether languages other than English must be covered by the first model.
4. After the third unseen recording: does AI consistency checking move into the relate call, get a limited live
   test as it is, or stay off with the rules-only panel.

*(Q1 and Q3 are answered provisionally by the spike, §13.9; Q2 and Q4 stay open.)*

### 13.9 5a spike — results (2026-11-14, offline, no AI call)

**Recommendation: `all-MiniLM-L6-v2` (q8) as the local model, English first.** On notes with little shared wording it
put 22 of 25 on the right card, against 6 of 25 for the hashed embedder, and a word-sharing decoy card never won
(0 of 14, hashed 10 of 14). It is also the smallest and fastest candidate. Not wired: the default is still the hashed
embedder.

**Built** (new files only; nothing frozen for the third unseen set was touched — `unseen3.test.ts` passes):
- `src/ai/router/embeddingProvider.ts` — the `EmbeddingProvider` seam (§13.2): `similarity` refuses vectors from two
  embedders, one-byte quantised storage, the hashed embedder as an adapter, `withFallback`, and the one factory
  `createEmbeddingProvider(config)`. A provider API plugs in through `deps.remote`; it is not built.
- `src/ai/router/localModelEmbedding.ts` — `LocalModelProvider` over transformers.js 4.3.2 (pinned) and the ONNX
  runtime. The library loads on first use. **No network unless `allowDownload`**; offline it reads bundled weights
  or the download cache. If the model can't load, the factory falls back to the hashed embedder.
- `embeddingProvider.test.ts` — 13 offline tests: hashed parity, the mismatch refusal, quantisation, configuration,
  a fake provider API swapped in by configuration, fallback, and no download when downloads are off.
- `embeddingSpike.test.ts` — the measurement, **opt-in** (`EMBEDDING_SPIKE=1`). Weights are cached under
  `node_modules/.cache/acute-embedding-models` (about 330 MB for all five).
- `evaluation/update-engine/embedding-spike/` — `probes.json` (the blind probe set), `results.json`, `report.md`,
  `memory.json`.

**Material.**
- The meaning paraphrase set (352 pairs, development material). **Too easy to rank anything:** every embedder,
  hashed included, scores AUC 1.0, because the cards reuse their source's words. Kept in the report as a sanity check.
- **The blind probe set**, written by an isolated agent that saw no code, model or earlier set:
  - 80 pairs in four classes of 20: paraphrase (≤ 1 shared content word), same topic, decoy (≥ 2 shared words, a
    different subject), unrelated;
  - a 20-card, 5-section canvas with 25 notes to place, 17 of them low-overlap and 14 with a word-sharing trap card.
- The `router.test.ts` fixture with the Stage 2 cases.
- Never any unseen consistency set.

**Results** (CPU, Windows x64, Node 22; full tables in `report.md`):

| Embedder | Weights | Load from cache | Per text, batched / single | Memory added | Blind routing: card / section / trapped | Cross-language |
|---|---|---|---|---|---|---|
| hashed (today) | — | — | 0.04 / 0.08 ms | — | 6 / 9 / 10 of 14 | 0/3 |
| **MiniLM-L6** | **22.6 MB** | **0.24 s** | **2.0 / 3.6 ms** | **86 MB** | **22 / 23 / 0 of 14** | 0/3 |
| BGE-small-en | 33 MB | 0.40 s | 2.8 / 8.2 ms | 96 MB | 22 / 23 / 2 of 14 | 0/3 |
| Arctic-embed-xs | 22.6 MB | 0.25 s | 2.0 / 4.3 ms | not isolated | 19 / 22 / 3 of 14 | 0/3 |
| e5-small multilingual | 129 MB | 1.35 s | 3.6 / 7.1 ms | not isolated | 20 / 21 / 4 of 14 | 0/3 |
| MiniLM-L12 multilingual | 129 MB | 1.22 s | 8.7 / 11 ms | 364 MB | 15 / 17 / 7 of 14 | **3/3** |

Card and section counts are out of 25. The first download took 0.6–34 s depending on size and network. Memory was
measured in a separate process per model (`memory.json`). Timings vary from run to run: a later rerun gave MiniLM-L6
1.75 / 4.47 ms per text and a 0.25 s load. `results.json` holds the latest run; the accuracy figures don't change between runs.

**What it shows:**
1. **Ranking is where a model wins.** Choosing among the cards of a canvas, MiniLM-L6 went from 6 to 22 of 25 and
   was never fooled by a word-sharing card. That is exactly the Stage 2 router's weakness (§10 limits).
2. **Absolute "same fact" judgments don't improve.** Paraphrase vs decoy pairs score an AUC of 0.37–0.56 for every
   model, which is chance level. Out of context, a model can't tell "same fact, other words" from "same words,
   other subject". So use the model to **rank** and as a **recall-first relatedness line**, never to decide alone
   that two statements are the same claim. That stays with Stage 1's rules and the AI step.
   - MiniLM-L6 at 0.3 passes 95 % of paraphrases, 45 % of same-topic pairs, 90 % of decoys and 0 % of unrelated pairs.
   - For the consistency screen (recall-first, §12.21) that is the right direction. The cost is decoys forwarded to
     the AI step.
3. **Blending the hashed score in at equal weight makes it worse.** Every hybrid lost: MiniLM-L6 went from 22 to
   18 of 25 and from 0 to 7 trapped. The shared words *are* the trap. For 5c, word overlap belongs in the early
   exits (exact duplicate, keyword postings), not mixed into the similarity.
   - This bears on the router's 0.25 lexical weight (§10), but weights stay unchanged until 5f measures it (§12.9 rule).
4. **Only the multilingual MiniLM-L12 matches translations.** It costs 4× the memory and is worse at English
   routing (15 of 25). If other languages are needed, it is a separate configuration, not the default.
5. **Score ranges differ a lot between models** (unrelated text averages 0.06 with MiniLM-L6, 0.79 with e5). Per-embedder
   thresholds (§13.2) are required, not optional. Only MiniLM-L6's 0.3 line was checked; the others are marked
   uncalibrated in code.
6. **The Stage 2 router cases**, by embedding alone:
   - "Credentials are rotated every thirty days" → keys, 0.56 (hashed 0.21);
   - "Jitter spreads retries out…" → timeouts by 0.023, a miss the full router's other signals cover today. Recorded,
     not tuned.

**§13.2 gate, status:**
1. Paraphrase cases rank above the line: **met** on the blind probes; one Stage 2 case is a near-miss by embedding
   alone.
2. No existing router or screen test lowered: **not measurable until wiring** (step 4); the hashed embedder is
   still the default, and all router tests pass.
3. Under the §12.6 latency budget: **met for cached vectors.** One new text embeds in about 4 ms; comparing it with
   cached vectors is microseconds.

**Risks and limits found:**
- `sharp`, a hard dependency of transformers.js used only for images, carries a high-severity advisory
  (CVE-2026-96889, in its SVG decoder). Embedding never calls it, but it would ship in the build. Resolve before
  wiring: an override to a fixed version, or exclude it from the desktop package.
- transformers.js settings are global; the factory allows one configured model at a time.
- The web (Next.js) bundle and an Electron build were **not tried**, and the worker isn't built. Both belong to
  wiring (§13.7 step 4).
- The probe set is small (80 pairs, 25 notes) and has one author. The figures are indicative; 5f decides the
  thresholds.
- `npm install` reported 43 advisories across the tree; one (`sharp`) is from the new packages.

**Answers to §13.8, provisional:**
- Q1: MiniLM-L6. At 22.6 MB its weights can ship in the desktop build, so there is no first-run wait; the web build
  can download on first use.
- Q3: English first. Multilingual is a separate configuration (MiniLM-L12) with its cost stated above.

### 13.10 Latency and perceived speed — UX rules for 5a–5e (proposal, 2026-11-14)

**Status: design proposal, nothing built or measured.** Every figure here is an estimate until the 5a spike measures
it. The one measured number is the model call: p50 about 15 s (§12.14, §12.20).

**The principle.** The user never waits on the slow part. A fast, deterministic answer appears at once. The slow
work finishes in the background and shows up only when it adds information. It **suggests**; it never moves anything
on its own. §13.6 already works this way (the deterministic result first, the model only preselects). The rules below
apply it to every step. The same pattern is common elsewhere: optimistic updates reconciled later (Linear,
Superhuman), "underline first, explain on demand" (Grammarly), compute-ahead suggestions (Copilot ghost text), and
non-blocking review bots with a count badge.

#### 13.10.1 Two-phase answers

| Rule | Detail |
|---|---|
| **R1. Answer first, refine later** | The 5c descent's pick appears in "Where should this go?" right away. When a relate call runs and agrees, a small "AI agrees" mark appears. When it disagrees, a quiet chip appears: "AI suggests *X* instead". The list never re-sorts and the selection never moves under the cursor. |
| **R2. A late answer after the user has acted** | If the user has already pressed Place, a disagreeing answer becomes a review-panel entry: "Move to *X*?", offered as a reviewed change set with one undo step. It is never a silent move. |
| **R3. Stale answers are dropped** | Each request carries a request id and the baseline fingerprint. If the input text, the dialog or the canvas has changed by the time the answer arrives, the answer is thrown away. Closing the dialog or editing the text cancels the request (abort). |
| **R4. A time budget, not a spinner** | Only the explanation line says "checking…". After a fixed limit (proposed 20 s), it changes to "not checked" and the check is recorded as pending and retryable, as §12.9 already does for consistency. Nothing waits indefinitely. |
| **R5. Optimistic commit** | Accept applies at once, as today (`commit.ts`, `afterCommit`). Consistency findings arrive later as a badge or panel entry, never as a blocking dialog. This is already built for 4a–4e. The rule extends it to the relate call. |
| **R6. Status language** | "Placed" (instant, deterministic) and "Checked by AI" (later) are separate states. "AI agrees" appears only when a call actually ran. Most placements never call the model (§13.6), and showing nothing for them is correct. |

#### 13.10.2 Speculative precompute: local work is free, remote work is gated

| Rule | Detail |
|---|---|
| **R7. Embed while the user types or pastes** | Debounce about 300 ms and embed the draft in the worker, so candidates are ready when the user presses Place. This is local and costs no AI spend. |
| **R8. Pre-route on selection, not hover** | When a card or an Ask AI answer is selected, compute its top candidates in the background, so "Place in notes…" opens already filled. Hover is excluded: it fires too often and would churn the worker for little gain. |
| **R9. A speculative model call only under three conditions** | The relate call may start when the dialog opens, not when the user clicks, only if: (a) the user has opened the place dialog, which is explicit intent; (b) the deterministic margin is already inside the band that will need the model anyway; (c) AI is enabled and the spend guards and budget allow it. It counts against the same budget as a clicked call. It never runs on hover, selection or typing, because text would leave the device before the user asked for anything. |

#### 13.10.3 An invisible embedder (5a)

| Rule | Detail |
|---|---|
| **R10. Warm up during idle time** | Load the model in the worker after startup, using `requestIdleCallback` with a `setTimeout` fallback where it is missing. Never load it on first use. Until it is ready, the hashed embedder answers, so the user sees no cold start. |
| **R11. One embedder per request** | A request is answered entirely by one embedder (§13.2: vectors from two embedders are never compared). When the model becomes ready, an open dialog is **not** re-ranked. The next request uses the model. |
| **R12. Download consent** | If the weights are downloaded on first use rather than bundled (§13.8 Q1), the idle warm-up does not start a large download on a metered connection or without the user's setting. Until then, the hashed embedder stays in use. |
| **R13. Incremental, prioritised indexing** | Re-embed only changed items after commit, through the existing 4a–4b hook. A full rebuild after an embedder switch runs at low priority. The worker serves interactive queries (R7, R8, Place) before background rebuild batches. The index-health badge (fresh / stale / rebuilding / failed) shows progress. |
| **R14. Persisted, quantised vectors** | Vectors are stored in idb, keyed by (embedder id, content hash), one byte per dimension, as in §13.2. A reload never re-embeds. |
| **R15. Exact search, no ANN** | Brute-force scoring scoped to a section, or to the whole workspace at about 10k items × 384 dimensions, is expected to take milliseconds. No approximate-nearest-neighbour index is planned. **The 5a spike measures this.** If the measured p95 exceeds about 20 ms at 10k items, the plan is revisited. |

#### 13.10.4 Make the slow call smaller, or rarer

| Rule | Detail |
|---|---|
| **R16. Cache by content** | A pair verdict is cached under (claim hash, item hash, model id, prompt version). The pick of "the one best target" depends on the whole candidate set, so it is cached only under the hash of the full set. A prompt or model change invalidates the cache. |
| **R17. Coalesce background work only** | Consistency checks after several commits within a few seconds share one relate call, using the ≤ 10-pair batches. An interactive placement is **never** held back to join a batch, because that would add latency to the one call the user is watching. |
| **R18. Streaming only into the explanation line** | If the provider supports streaming structured output, each candidate's verdict may fill the explanation line as it arrives. It never re-ranks the list mid-stream (R1). This is not verified for our provider setup and is optional. |
| **R19. Measure the call before working around it** | 15 s is the recorded latency of one configuration (gpt-oss-120b on AICredits, with reasoning tokens). For the 5e design, the spike compares a small, fast model and a low reasoning setting, and keeps output to the relation codes only. A 1–3 s call would change which of R1–R4 matter. **Needs a proposal and approval before any paid measurement.** |
| **R20. A local reranker as the middle tier (option, not decided)** | A small local cross-encoder could score the top few candidates in the worker, typically within a few hundred milliseconds, when the embedding margin is small. It would sit between descent step 6 and the model step (§13.4), and could resolve most small-margin cases without a paid call. It only reranks and never produces a relation: CONTRADICTS still needs rules or the model. It is evaluated on 5f like any other change. |
| **R21. "Learn to skip" is deferred** | Using past user choices to raise confidence, so fewer placements need the model, changes the routing weights. That waits for 5f (the §12.9 standing rule). It also carries a feedback-loop risk: accepted preselects raise confidence, which removes the check that would have caught them. If it is built, it needs a small, budgeted audit sample. |

#### 13.10.5 Asynchronous review

- **R22. Queue, don't interrupt.** Consistency findings and "update elsewhere" suggestions (Stage 3) collect in the
  review panel with a count badge, or in a digest. Nothing opens a modal after commit.

#### 13.10.6 Assessment

**Adopt.** The two-phase, deterministic-first, suggest-never-move pattern is the right approach for this product. It
is local-first, it matches §13.6, it keeps the human confirmation in Stage 2, and it reuses built pieces: `afterCommit`,
the pending/retryable check, the index-health states and the review panel. Most of the perceived speed comes from
R1, R5, R7, R10 and R14, all of which are local and cost no AI spend.

**Changes from the proposal as first written:**
- Stale-answer handling, cancellation and a time budget (R3, R4) were missing. Without them, a two-phase UI shows
  outdated suggestions.
- Speculative model calls are restricted to an opened dialog inside the margin band, within budget (R9). Calls on
  selection or hover would spend money and send text off the device before the user asked.
- Pre-routing on hover is dropped (R8).
- Coalescing is limited to background checks (R17).
- "Learn to skip" is deferred to 5f, because it changes the routing weights (R21).
- Two additions: measure and shrink the call itself (R19), and a local reranker as an optional middle tier (R20).

**Main risks:** UI churn when a suggestion changes after the user has acted (addressed by R1–R3), wasted speculative
spend (R9), and worker contention during a rebuild (R13).

**Where it lands:**

| Rules | Built in | Order (§13.7) |
|---|---|---|
| R10–R15 | 5a | after step 4 |
| R7, R8 | 5b–5c | step 5 |
| R1–R4, R6, R9, R16–R21 | 5e | step 6 |
| R5, R22 | extend existing 4a–4e | step 6 |

None of it touches a frozen file before the third unseen recording.

**Additional open questions:**

5. The R4 time budget (20 s is proposed).
6. Whether R20, the local reranker, is evaluated in the 5a spike or after 5f.
7. Whether R19's model comparison becomes a paid proposal before the 5e design or as part of it.

### 13.11 5f — the locate evaluation set (built 2026-11-14, offline, no AI call)

**The set** (`evaluation/update-engine/locate/`, README there; code `src/ai/router/locateEvaluation.ts`):
- **dev:** 5 canvases (mobile release, support operations, security programme, marketing launch, cloud costs), 60
  cases. Tune on this only.
- **held-out:** 4 canvases (research lab, restaurant, open-source governance, home renovation), 40 cases.
  - **Sealed:** its SHA-256 (`bf726cbe…`) was pinned the moment it was written, before anything was scored, and it
    is never scored in the default run.
- **Authors:** each split by its own isolated agent, which opened no repository file.
- **Contents:** every case names the expected card, section, action, item and relation.
  - 8 of 100 cases are ambiguous, with an alternative answer.
  - 85 are low-overlap: they share at most one content word with their card.
  - 33 have a trap card that shares words with the note.
- **Actions:** `replace_item`, `after_item`, `append`, `table_row`, `cell`, `duplicate`, `new_block`, `new_section`.
- **No shared material:** no sentence appears in the other split, the spike probes or any consistency set (tested).

**Labels.** A third isolated agent labelled all 100 cases blind, from the canvases and note text only.
- **Strict agreement** (main answers only):
  - destination: dev 56/60, held-out 38/40;
  - destination and action: dev 52/60, held-out 35/40;
  - item: every case where both name one.
- **With alternatives:** destination 100/100, action 96/100.
- `label-comparison.md` lists the 4 differences for the user (2 dev, 2 held-out; the held-out rows were not read by
  the code author). Neither key was changed.
- **One edit after authoring:** the brief contradicted itself on "clarify", so dev's five ambiguous cases now carry
  their real action, as held-out's do (README).

**Dev baselines** (held-out not scored):

| Predictor | Section | Expected card ranked first | In top 3 | Trap card won | Edit went into the right card |
|---|---|---|---|---|---|
| Today's Stage 2 router | 30/54 (56 %) | 11/47 (23 %) | 27/47 (57 %) | 16/20 (80 %) | 1/47 (2 %) |
| Hashed embedder, similarity alone | 29/54 (54 %) | 14/47 (30 %) | 27/47 (57 %) | 17/20 (85 %) | — |
| MiniLM-L6, similarity alone | **42/54 (78 %)** | **25/47 (53 %)** | **35/47 (74 %)** | **11/20 (55 %)** | — |

Full tables, by overlap and by action: `baseline-dev.md` and `rankers-dev.md`.

**What it shows:**
- **Dev is much harder than the spike's probes.** MiniLM-L6 ranks the right card first 53 % of the time here, against
  88 % on the probes, and a trap still wins 55 % of the time. Embeddings alone are not enough; that is what 5b–5d are for.
- **It depends on the action:**
  - **updates are found well** (`replace_item` 82 %): a changed fact looks like the item it changes;
  - **appends are found badly** (25 %): a new item for a list is about something no existing item says, so it looks
    unlike the whole card.
  - So the 5c descent must use **section** evidence (MiniLM-L6 gets the section right 78 % of the time) and
    **item-level** vectors (5b), not whole-card similarity alone.
- **Today's router almost never edits into the right card** (2 %). It has no append, insert-after or table-row
  action: it makes a new card beside the right one. That is the 5d gap, measured.
- **Duplicates are never recognised** by today's router (0/7). An exact hash (5b) plus item vectors should address it.

**Not done:** held-out not scored; nothing wired. Routing weights stay unchanged until a change is measured on dev
and confirmed once on held-out. (Dev tuning of the 5c prototype: §13.13.)

### 13.12 Review of 5f (2026-11-14) — decisions

**Decision: 5f accepted provisionally; 5b–5c design approved; Stage 4f stays frozen until unseen3 is done.** The
reviewer named two separate problems: retrieval is not yet accurate enough, and the router lacks the actions to
place content correctly even when it finds the card. **The priority for Stage 5 is the right card + the right item +
the right operation, not higher similarity.**

| Workstream | Decision |
|---|---|
| 5f fixtures and the explainer doc | Accepted provisionally |
| `.ai/docs/how-it-works/` as the doc folder | Approved (no top-level `docs/`) |
| 5b item-index design | Approved |
| 5c hierarchical router design | Approved |
| 5b–5c code that touches frozen files | Deferred until unseen3 closes |
| The four placement label decisions | Dev: decided by the reviewer's rules (below); held-out: a separate reviewer |
| Unseen3 free route step | Approved |
| Unseen3 paid recording | Waits for the route counts and the budget |
| Stage 4f live AI checking | Stays OFF |

**The local embedder and the AI switch.** For now, the AI build switch off means **no local model inference and no
model download either**. Done in the factory (`createEmbeddingProvider` returns the hashed embedder whenever
`isAIFeatureEnabled()` is false; tested); the switch itself is unchanged. Later, three separate controls:

| Capability | Future control |
|---|---|
| Deterministic keyword / hash search | Always on |
| Local semantic embeddings | Its own "local semantic search" setting |
| Hosted AI routing and judgment | The AI feature setting and provider authorization |

**Label adjudication rules** (applied as an overlay, `locate/adjudications-dev.json`; split files never edited):
- **Cell vs whole row:** the smallest edit that keeps the row's meaning and structure. A cell when only that cell
  changes; a row when several cells, or the row's relationship, change. → **D019 = `cell`** (Pro, First response),
  relation CONTRADICTS kept. **Confirmed by the reviewer (2026-11-14).** The original label stays in `dev.json`.
- **Append vs insert-after:** insert-after when order or adjacency matters; append when the entry is independent.
  → **D058 needs no decision:** inserting after the last item of a two-item list is the same edit as appending. The
  scorer now reads "after the last item" as an append, for expected and predicted answers alike. **Accepted by the
  reviewer**, with a condition for the app: the two count as one only when they give the same ordered content and
  keep formatting and item identity.
- **The two held-out differences** stay unread by the implementation agent; a separate reviewer decides them before
  any held-out scoring, keeping both original labels and reasons. They are in `locate/label-comparison.md` (held-out
  section).

**Unseen3 — not run, and why.** The review says the 90 blind labels were supplied earlier, with reasons, totalling
35 contradiction / 46 compatible / 9 ambiguous (ambiguous: w06, w11, w23, w25, w48, w55, w60, w70, w90). **The per-pair
table never reached this session** (it is not in the conversation, and no labels file exists on disk). Totals and
the ambiguous ids can't be transcribed into 90 per-pair labels, and they must not be reconstructed. **Blocked on the
table itself**; the free route step runs as soon as it arrives.

**5c constraint added:** never stop at a confident card match when the operation needs an append, an insertion or a
table edit — destination and action are evaluated together. **Metrics to report:** card, section, exact anchor,
action, and end-to-end placement ("placed", added to the scorer).

### 13.13 5b–5c design and prototype, measured on dev (2026-11-14, offline, no AI call)

**Status: prototype in new files, not wired.**
- `src/ai/router/itemIndex.ts` (5b) and `descent.ts` (5c);
- 12 unit tests (`descent.test.ts`) and the dev measurement (`locateEvaluation.test.ts`; the MiniLM-L6 part and the
  settings search are opt-in);
- report: `evaluation/update-engine/locate/descent-dev.md`.

Nothing frozen was edited; `router.ts` is untouched.

**5b — the item index (design as built in the prototype):**
- **Identity:** an item is keyed the way `patch_block` already edits it:
  - `card#block` for a list or todo item;
  - `card#block.<sentence>` for a sentence;
  - `card#block.r<row>` for a table row.

  The app version uses BlockNote block ids; the prototype uses positions.
- **Content:** a normalised content hash (`normalizeForCompare`). Vectors are cached under `<embedder id>:<hash>`.
- **Writes:** `setCard` (synchronous, hashing only) on every accepted change, undo and redo; `removeCard` on deletion.
  `refresh()` embeds what is missing, in the background after the commit.
- **Reuse:** a restored item (undo / redo) or an unchanged one embeds nothing (tested). Another embedder re-embeds.
  A failed refresh leaves items pending and the content untouched (tested).
- **Exact duplicates** are found by hash, without any model call (tested).
- **No second source of truth:** the index is derived and rebuildable.
- **For wiring:** feed it from the 4a–4b commit hook; persist vectors in idb by `<embedder>:<hash>`.

**5c — the descent (the review's order), destination and action together:**
1. Selection / open frame → a prior for that card or section.
2. Exact duplicate → done. Named things (codes, product names, numbers) shared with a card → a small capped bonus.
3. Section → card. A card's score is (1 − w)·card similarity + w·best item similarity + s·section similarity +
   entities.
4. For each of the best four cards, the best item picks the action:
   - Stage 1's intent (`classifyClaimChange`): SUPERSEDES / EXTENDS / CONTRADICTS → `replace_item`; DUPLICATE →
     `duplicate`;
   - a changed value in a table → `cell`, with the column found by value or header;
   - new information → `after_item` next to a close item, else `append`, or `table_row`;
   - a prose card can't take new information, so the next card is tried.
5. Below the card floor: a new card in the best section, or a new section. Two sections within the margin: ask.

Kept from Stage 2: two confidences (routing, update), never blended.

**Results on dev** (60 cases; held-out not scored):

| | Today's router | Descent, hashed | Descent, MiniLM-L6 | Descent, MiniLM-L6, best dev settings |
|---|---|---|---|---|
| **Placed end to end** | 8 (13 %) | 5 (8 %) | 13 (22 %) | **15 (25 %)** |
| Right section | 56 % | 50 % | 78 % | 81 % |
| Right card first | 23 % | 30 % | 55 % | 64 % |
| Right card in top 3 | 57 % | 62 % | 83 % | 81 % |
| Right action | 15 % | 17 % | 32 % | 32 % |
| Trap card won | 80 % | 55 % | 55 % | 50 % |

**Per action, best dev settings:**
- placed: `table_row` 3/5, `after_item` 2/8, `append` 3/12, `replace_item` 2/10, `cell` 1/5, `duplicate` 1/7,
  `new_block` 2/7, `new_section` 1/6;
- anchor (item) right when the card was right: 10/19.

**What it shows:**
1. **Retrieval is close to useful; action choice is the bottleneck.** The right card is in the top three for 81 % of
   cases, but the action is right for only 32 %.
2. **No similarity threshold tells "already said" from "changed" from "new detail".**
   - Duplicates: 1 of 7, at any duplicate line from 0.6 to 0.9.
   - Updates: 2 of 10. Stage 1's lexical intent rules read paraphrased updates as UNCLEAR.
   - This is the spike's finding (§13.9: same-claim judgments at chance), now on real placements.
3. **The search over settings bought little:** 22 % → 25 %. The optimum is flat (140 of 654 settings within two
   placements), so this isn't a tuning problem, and more dev tuning would only fit dev.
4. **"Belongs nowhere" is rarely recognised** (1/6). One floor on the best card can't separate "no card fits" from a
   weak paraphrase.
5. **The hashed embedder makes the descent worse than today's router** (8 % vs 13 %). The descent assumes meaningful
   similarities.

**Design conclusion: deterministic descent narrows; a judgment chooses the action.**
- The descent reliably brings the right card into the top three (81 %) and handles what it can decide exactly:
  - exact duplicates by hash;
  - table rows and changed table values;
  - list structure;
  - the user's open frame.
- The remaining decision — for a note and the best items of the top three cards: same / changed / new / contradicts /
  none of these — is the **5e "relate" call**. Upper bound with a perfect judgment over the top three: 81 % of
  card cases; over the top card alone: 64 %.
- One call per placement that falls in the uncertain band, ≤ 10 items. The recorded rate is about 1,700 tokens and
  $0.0002 a call (§12.20), and it runs in the background per §13.10.
- **Not run:** a measurement needs a paid recording, and 5e is gated on the unseen3 result (§13.6). Proposal to follow
  once unseen3 is reported.

**Reviewer's decision (2026-11-14):** the prototype is accepted as development evidence; move action interpretation
toward the 5e judgment rather than searching similarity weights further. **5e constraint:**
- the model chooses from valid, **typed operations** (the 5d actions) and names the target item, with supporting
  evidence;
- it **never modifies content itself**: the deterministic planner turns its choice into a reviewed `patch_block`.

Free dev work on duplicate detection and "belongs nowhere" is approved; held-out stays sealed.

**Next free work (dev only):** a deterministic "nowhere" signal from the section and card margins together;
duplicate detection with quantities and negation held equal; app identity (block ids) in the index. Held-out stays
sealed for the one final evaluation.

### 13.14 "Belongs nowhere" and duplicates, on dev (2026-11-15, offline, local MiniLM-L6 only, no AI call)

The approved free dev work. Held-out is not scored or read.

**Signals measured per dev case** (a throwaway probe, deleted): the top section's lead over the second, the best card,
the best item, whether quantities and negation are equal, and Stage 1's intent read.

**Duplicates: no deterministic signal separates them. A negative result.**
- The 7 duplicates' best-item similarity is 0.33–0.64, inside the range of appends, replacements and new cards.
- "Quantities equal and negation equal" holds for 4 of 7, and for many non-duplicates.
- Stage 1's intent reads 7 of 7 as UNCLEAR.

This confirms §13.13 on real placements: "already said" is a meaning judgment. It belongs to the 5e relate call; more
thresholds won't get there. Nothing was changed for duplicates.

**"Belongs nowhere": the two margins together do separate it.**
- All 6 "nowhere" cases have the top two sections within 0.05, **and** a weak best card (< 0.40) and best item
  (< 0.41).
- A near-tie between sections alone is common. It is the conjunction that marks a note no part of the canvas is about.

Built as descent step 5a: `nowhereSectionGap` / `nowhereCard` / `nowhereItem` in `DescentOptions`. Defaults 0.05 /
0.40 / 0.41 for MiniLM-L6; off for the hashed embedder; never applied when the user's open frame or selection is given.

| Dev, MiniLM-L6, descent defaults | Placed end to end | Nowhere | Duplicate | Right action |
|---|---|---|---|---|
| Nowhere off (§13.13) | 15/60 (25 %) | 1/6 | 1/7 | 19/60 (32 %) |
| **Nowhere on** | **19/60 (32 %)** | **6/6** | 1/7 | 22/60 (37 %) |

- **Cost:** one table-row case (D005) became a new section.
- **Caught wrongly:** 7 non-"nowhere" cases trip the conjunction, but 6 of them were already misplaced.
- **These thresholds were read off dev, so 32 % is an optimistic figure.** The sealed held-out split, scored once at
  the end, is what tells.
- **Product framing (for wiring):** "nowhere" should be the dialog's **first suggestion with the top card still
  offered**, not a silent new section. The 5e relate call keeps "none of these" as an answer.

**Tests:** the router tests pass (`descent.test.ts` unchanged and green with the step on by default).
