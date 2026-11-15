# MCP write surface audit — 2026-11-15

Read-only audit of every operation an MCP client can cause that modifies the canvas or workspace, for the
"first real ChatGPT session" gate. Code read at the working tree of 2026-11-15; unit tests run:
`staleTarget`, `accept`, `changeSet`, `pendingChanges`, `agentState`, `tools`, `projectTools`, `studyTools`
(8 files, 125 tests, all pass). No AI, e2e or MCP session was run. Anything not confirmed by code or a test is
marked **UNVERIFIED**.

**Verdict: NOT YET safe for a first real ChatGPT session.** `update_block` is properly protected. Two remote-reachable
operations can still destroy user content edited after the proposal without asking: **`delete_object`/`delete_connection`
(`remove`)** and **`revert_agent_changes` (`restore`/`remove`)**. The second is worse because its tool description
promises "an object edited since comes back as a conflict… never overwritten", and that is false for in-place block/page
edits. Everything else that overwrites (`move`, `update_connection`, `update_node`, `set_lens`, `group_objects`) touches
only metadata or position. Those are acceptable for a first session if the limitation is documented.

---

## 0. What a ChatGPT session can reach

- **Remote sessions** (any non-bearer principal, or a non-loopback host: `src/mcp/bridge/http.ts:75`) get **no repo-map
  tools and no ingest tools** (`src/mcp/server.ts:115-116`). They can **never auto-accept**, because `markRemote` runs at
  `server.ts:114` and `isOn`/`isSessionOn`/`enable*` all ignore remote sessions (`src/ai/changes/autoAccept.ts:49-87`).
  As a result, `update_shape`, `patch_block`, `update_frame{name}`, `rebaseline` and `mark_review` **cannot be produced
  by ChatGPT**. They are listed below for completeness and marked "local only".
- Writes require `allowWrites && scope === "propose"` (`src/components/shell/McpBridgeHost.tsx:126`). Every proposal
  goes through `proposeChangeSet` (`src/mcp/tools/writeTools.ts:165-227`), which validates the set, re-checks the
  canvas and policy, and then calls `live.propose` → `PendingChanges.propose`. Nothing is written before the user
  accepts. The exceptions are the direct writes in §3.
- **Rejecting a proposal** writes nothing for any kind, because the set is only settled. The "rejection preserves"
  column below therefore asks a different question: **does Accept (or Keep mine) preserve an edit the user made after
  the proposal?**
- **Undo:** every Accept is one `history.record` step (`src/ai/changes/accept.ts:59`, `parts.ts:171`). Every accepted
  MCP set is also logged with its inverse for `revert_agent_changes` / History → Revert (D30).

### Registered tools (verified)

| Group | Read tools | Write tools |
|---|---|---|
| core (`readTools.ts:22`, `writeTools.ts:60`) | search_workspace, get_canvas, get_page, get_selected_content, get_related_objects, suggest_placement, get_consistency, **get_weak_concepts** | create_block, create_page, create_table, create_todo, create_connection, move_object, update_block, render_visual_plan, delete_object |
| objects (`objectTools.ts:20-21`) | list_blocks, get_block | update_connection, delete_connection, group_blocks |
| project (`projectTools.ts:60-72`) | get_project, list_projects, get_decisions, get_open_questions, get_implementation_plan, get_session_context, get_recent_changes, get_session_history, get_session_review, get_lens_impact | create_project, record_decision, log_finding, update_knowledge, annotate, update_progress, sync_session, revert_agent_changes |
| lens (`lensTools.ts:29-30`) | get_lens, trace_lens_path, focus_lens (UI-only side effect: opens the Lens panel, `lensFocus.ts:6-7`) | link_lens_detail |
| repo map, **local only** (`repoMap/index.ts:29-31`) | get_map_status | begin_repo_map, upsert_map_section, link_map_nodes, remove_map_nodes, tidy_map_section |
| ingest, **local only** (`ingestTools.ts:29`) | find_import_targets | import_content |

`get_weak_concepts` is confirmed read-only. Its deps type the meta store as `Pick<MetaRepository, "get">`
(`studyTools.ts:37-38`, `readTools.ts:34-35`), it registers with `READ_ANNOTATIONS` (`studyTools.ts:203`), and it has
no write call. The other read tools only read through `ResourceReader`/`WorkspaceScan`. The `.set` calls in
`search.ts:128,170` fill in-memory caches only.

---

## Table A — operations that update or remove existing content

Column key: Review = goes through the proposal flow. Baseline = an Accept-time baseline check against the live target.
Conflict = a stale change produces a visible Keep mine / Use proposed (or equivalent). Preserves = Accept or Keep mine
preserves an edit the user made after the proposal.

| # | Operation | MCP tool(s) | Change kind | Review | Baseline | Conflict | Preserves | Undo | Evidence | Risk |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Replace block/page content (+ page title) | update_block | `update_block` | Yes | **Yes**: tool sets `expectedFingerprint` (`writeTools.ts:400-408`), `PendingChanges` stamps it if missing (`pendingChanges.ts:75-79`), compared at Accept (`changeSet.ts:886-890`) | **Yes**: `staleConflict` → follow-up set (`staleTarget.ts:110-144`, `acceptPending.ts:153-160`) | **Yes**: Keep mine writes nothing; stale targets are withheld from the step (`staleTarget.ts:16-20`) | 1 step; other targets in the set are still written atomically, stale ones wait | tests: `staleTarget.test.ts` | **Low**. Done. |
| A2 | Delete objects | delete_object | `remove` | Yes (destructive annotation) | **No**: only `isLive` (`changeSet.ts:877-880`); the writer sets `isDeleted` unconditionally (`changeSetWriter.ts:446-455`) | No. Only an already-deleted target is dropped and reported (`object_deleted`) | **No**: a block whose content the user edited during review is deleted with that edit | 1 step; Revert via log | `writeTools.ts:458-471` | **High**. Destroys post-proposal edits without a decision. Also deletes an Acute-drawn section frame left empty (`changeSetWriter.ts:537-544`), which is not itemised in the review. |
| A3 | Delete connections | delete_connection | `remove` | Yes (destructive) | No | No | No (an arrow label edited during review is lost) | 1 step | `objectTools.ts:120-129` | **Medium**. Small content, but same class as A2. |
| A4 | Revert agent changes | revert_agent_changes | `restore`, `remove` (+ revert conflicts) | Yes, never auto-accepted (`agentState.ts:342`) | **Proposal time only**: `planRevert` compares element `version` with the record's `afterVersion` (`agentState.ts:283-297`, called at `projectTools.ts:781`). No re-check at Accept: `resolveChangeSet` passes `restore` through and never drops it (`changeSet.ts:877-879`) | Only for edits detected at proposal time (conflict with apply only, no `keep`) | **No**, in two ways: (a) edits made after the revert was proposed are overwritten by `restore` (full element reset from snapshot, `changeSetWriter.ts:525-535`) or deleted by `remove`; (b) **in-place block/page content edits never bump the element version** (`documentSession.ts:54` writes only the document store), so even at proposal time a block the agent created or updated and the user then edited is treated as "unchanged" and silently removed or reset to the old document | 1 step | `projectTools.ts:770-797`; tests cover version-based edits only (`agentState.test.ts:139-186`) | **High**. Contradicts the tool's own "never overwritten" promise. Code-read; no test exercises a document-only edit (**UNVERIFIED by test**). |
| A5 | Move object | move_object | `move` | Yes | No | No | No: a user's move made during review is overwritten (position only; content untouched) | 1 step | `writeTools.ts:362-375`; writer `changeSetWriter.ts:284-303` | **Low**. Position only. Lock is checked at proposal (`writeTools.ts:369`), not at Accept. |
| A6 | Reflow moves from creates | create_block/page/table/todo, render_visual_plan (with a selection) | `move` | Yes (shown as "N moves") | No | No | No (as A5) | 1 step | `render.ts:144,164`; context carries `objects` (`renderPlanContext.ts:26`) | **Low**. Not in the residual list: create tools can also move existing user objects to make room. |
| A7 | Update connection | update_connection | `update_connection` | Yes | No | No | No: label/relation/explanation the user changed during review is overwritten; `label: null` deletes the label text | 1 step | `objectTools.ts:91-114`; writer `changeSetWriter.ts:471-503` | **Low–Medium**. Short text, undoable. |
| A8 | Patch node fields | update_knowledge; record_decision (`supersedes` → status) ; update_progress / sync_session `items`/`progress`; sync_session `focus` | `update_node` | Yes | No | No | No: field-level patch; only the named fields are replaced, but a concurrent user change to the same field is lost | 1 step | `projectTools.ts:374, 495, 530, 658`; writer `changeSetWriter.ts:423-428`; `applyNodePatch` (`nodePatch.ts:32-36`) | **Medium**. Status and decision fields drive later agents' warnings. *Correction to the plan doc's residual list:* `annotate` produces no `update_node` (only `create_shape` + `connect`, `projectTools.ts:509-511`); `update_progress` does (via `progressUpdates`). |
| A9 | Set Lens fields | link_lens_detail | `set_lens` | Yes, never auto-accepted | No | No | No (a drill link or level changed during review is overwritten) | 1 step | `lensTools.ts:478-535`; writer `changeSetWriter.ts:429-435` | **Low**. Navigation metadata. |
| A10 | Re-frame existing objects | group_blocks | `group_objects` (creates a frame and sets `frameId` on existing objects) | Yes | Partial: at Accept, members now in a frame, deleted, or turned into frames/arrows are skipped (`changeSetWriter.ts:507-509`); dropped if no member is live (`changeSet.ts:878`) | No | Yes for content; only membership changes | 1 step | `objectTools.ts:131-152` | **Low**. Not in `touches()`, so two sessions may both group the same objects (`pendingChanges.ts:57-61`). The second is skipped harmlessly. |
| A11 | Add new objects to an existing frame | record_decision, log_finding, annotate, update_progress, sync_session, create_project (via `addProjectNodes`) | `update_frame{add}` | Yes | n/a (adds only) | No | n/a | 1 step | `projectChanges.ts:78` | Low (see B). |
| A12 | Rename frame | upsert_map_section (**local only**) | `update_frame{name}` | Yes | Proposal-time check only: skipped if the user renamed the frame (`mapSection.ts:265-274`) | No | Rename during review is overwritten | 1 step | `mapSection.ts:272-273` | Low; not ChatGPT-reachable. |
| A13 | Re-type map arrow / remove map nodes / tidy | upsert_map_section, remove_map_nodes, tidy_map_section (**local only**) | `update_connection` (`mapSection.ts:300`), `remove` (`mapSection.ts:191, 331, 339`), `move` (`repoMap/service.ts:1028`) | Yes (merged set, parts) | No | No | No | 1 step per accepted part | as cited | Low for this gate; not ChatGPT-reachable. |
| A14 | Relabel shape | upsert_map_section, import_content (**local only**) | `update_shape` | Yes | **Yes** (`changeSet.ts:891-895`) | Single set: yes. **Merged/parts set: no.** The stale change is dropped as `target_changed` and reported (`parts.ts:160-161`) | Yes | 1 step | `staleTarget.ts` | Low; not ChatGPT-reachable. |
| A15 | Claim-level patch | import_content (**local only**) | `patch_block` | Yes | **Yes**: `resolvePatch` compares `expectedFingerprint` (`claimPatch.ts:73-75`, `changeSet.ts:881-885`) | No. Dropped whole and reported ("precise edit skipped… update again"), with no Keep mine / Use proposed | Yes | 1 step | as cited | Low; not ChatGPT-reachable. |
| A16 | Keep-mine baseline / review marker | (reconciliation; repo-map conflict `keep`) | `rebaseline`, `mark_review` | Yes | n/a | n/a | metadata only | 1 step | `changeSetWriter.ts:436-445, 456-468` | Not ChatGPT-reachable. |

## Table B — operations that only create new objects

All go through review. Reached from create_block/page/table/todo, render_visual_plan, create_connection, create_project,
record_decision, log_finding, annotate, update_progress, sync_session and group_blocks (frame).

| Risk | Handled? | Evidence |
|---|---|---|
| **Duplicate on retry** | Partly. Every call gets a fresh `operationId` (`writeTools.ts:173`), so the commit journal's once-per-operation guard (`commit.ts:172-178`) does not dedupe client retries. While the first proposal is under review, a retry is refused ("still reviewing", `writeTools.ts:143,191`). After the user accepts or rejects it, a retry proposes a duplicate, which the user sees in review. Tools are annotated `idempotentHint: false` (`common.ts:48`). | Medium-low |
| **Placement over user content** | Placement and layout checks run at proposal time only (`writeTools.ts:193`, `renderPlan`). Nothing is re-placed at Accept (`commitOnCanvas.ts`, `accept.ts`). Anything the user draws in that spot during review gets overlapped (visual only; the review preview shows the target spot). Project nodes go into the state frame, which grows to fit (`changeSetWriter.ts` `refit`). | Low |
| **Creating inside a frame the user deleted** | Project nodes: `update_frame{add}` targets the state frame captured at proposal. If that frame is deleted, the `update_frame` is dropped (`object_deleted`) and the nodes are **still created at the old frame position, frameless**. This is reported as "1 change was skipped". | Low–Medium (orphaned knowledge nodes; Lens/project membership may be lost, **UNVERIFIED** whether `project` field alone keeps them in the project) |
| **Frame renamed since proposal** | Not checked. Creates still join the renamed frame. Harmless. | Low |
| **Links to targets deleted since proposal** | `connect` with a deleted `existing` end is dropped and reported (`changeSet.ts:879-880`). It is never half-written. `refs` on knowledge nodes are strings and are kept as "unresolved" (D53). | Handled |
| **ID / key collisions** | Element ids are random at write (`randomId`). Lens keys are assigned from `takenKeys(g)` at proposal (`projectTools.ts` `addProjectNodes`), with no re-check at Accept. Two sessions proposing into the same state frame collide on `update_frame`'s target and the second is refused (`pendingChanges.ts:88-95`). A user-created node taking the same key during review is **UNVERIFIED** (probably low). | Low |
| **Create that also changes existing objects** | Reflow `move`s (A6) and `group_objects` re-framing (A10) ride along with "create" tools. They are shown in the summary but are not creates. | see A6/A10 |
| **Duplicate project** | `create_project` refuses an existing name at proposal (`projectTools.ts` create_project), with no re-check at Accept. | Low |

## 3. Direct writes (no review)

| Write | Trigger | Store | Reachable by ChatGPT | Notes |
|---|---|---|---|---|
| Session report (`summary`, `changed`, `next`) | `sync_session` | Agent State session record, `putSession` (`projectTools.ts:676-689`) | **Yes** (gated only by `allowWrites`, `:627`) | Durable and unreviewed. Read back by the **next** session's `get_session_context` / `get_project.lastNext`. This is a cross-session channel for unreviewed agent text. It is read-modify-write and races `recordUsage` on the same record (lost-update possible, low). |
| Per-tool usage (calls, chars) | every tool call, including reads | Agent State session record (`agentLog.ts:90-98`, wired at `McpBridgeHost.tsx:132`) | Yes | Metadata only. |
| Repo-map record and map canvas creation | `begin_repo_map` (creates and opens a canvas, `repoMap/service.ts:187-221`); `upsert_map_section` etc. update the map record before Accept (`:261, 585, 635, 782, 947`) | repoMaps store, canvases | **No** (local only) | Bookkeeping plus a new empty canvas. |
| Lens panel focus | `focus_lens` | UI state | Yes | No data written. |
| Commit journal, agent change log, content-source versions | **user Accept**, not the tool | meta / agentState | — | A consequence of Accept, not a direct MCP write. |
| Auto-accept writes (D44) | record_decision, log_finding, update_progress, update_knowledge, annotate, sync_session, when the user turns it on (`autoAccept.ts:40`, `writeTools.ts:203-206`) | canvas | **No** (remote never auto-accepts) | Local caveat: `autoAcceptable` lets `update_node{status:"superseded"}` through, including superseding a constraint via `update_knowledge` (`agentState.ts:339-346`). |

`record_decision`, `log_finding` and `update_progress` write **no** workspace data directly: they only propose (`proposeNodes` → `proposeChangeSet`).

## 4. Gaps, prioritised

### Blocking a first real ChatGPT session

1. **`revert_agent_changes` can overwrite or delete in-place user edits without a conflict (A4).** Edit detection uses
   element `version` only, and block/page content edits do not change it. There is also no re-check at Accept. Fix:
   in `planRevert`, compare the live content fingerprint with the one recorded at accept for embeddable targets. Then
   re-check `restore`/`remove` at Accept the same way `update_block` is checked (baseline → `staleConflict`). The
   `Baselined` union and the `ConflictItem.apply` union already allow `restore`/`remove`. Add a test with a
   document-only edit. Alternative for the first session: disable `revert_agent_changes` for remote sessions.
2. **`delete_object` removes objects edited during review (A2).** Fix: stamp an `expectedFingerprint` on `remove` of
   blocks, pages and shapes (`liveFingerprints` already reads them) and turn a mismatch into a Keep mine / Delete
   anyway conflict. Alternative: list deleted objects explicitly and refuse to apply if any changed since proposal.
   Fold `delete_connection` (A3) into the same mechanism.

### Acceptable with a documented limitation (state these in the ChatGPT test plan)

3. `move` / reflow `move` (A5, A6): overwrites position only. Also note that create tools can move user objects when
   something is selected.
4. `update_node` (A8): field-level, last writer wins on the same field. Medium; the cheapest next fix is a per-field
   baseline (`semantics` before-values) checked at Accept.
5. `update_connection` (A7), `set_lens` (A9), `group_objects` (A10): metadata or membership only, undoable.
6. `sync_session` direct, unreviewed session record (§3): document that the summary/next text is agent-authored and
   unreviewed. Consider showing it in the review bar or History tab before the next session consumes it.
7. Creates: duplicate on retry after settle; orphaned project nodes if the state frame is deleted during review;
   proposal-time-only placement (Table B).
8. Annotation mismatch: `WRITE_ANNOTATIONS` claims `destructiveHint: false` and the comment says "never delete or
   overwrite" (`common.ts:47-48`). Yet `update_block`, `update_connection`, `move_object`, `update_knowledge`,
   `link_lens_detail` and `revert_agent_changes` overwrite, and `revert_agent_changes` can delete. ChatGPT uses these
   hints to decide when to confirm. Recommend `destructiveHint: true` at least for `revert_agent_changes` and
   `update_block`.
9. Empty Acute-drawn section frame auto-removed with its last member on delete (A2 note). It is not itemised in the
   review.

### Not relevant to a ChatGPT session (local only)

`update_shape` stale changes in merged (repo-map) sets are dropped and reported rather than asked about (A14).
`patch_block` stale changes are dropped and reported (A15). Repo-map `remove`/`move`/`update_connection`/frame rename
have no baseline (A12, A13).

## 5. Residual-list check (vs. `chatgpt-mcp-architecture-and-test-plan.md` "Stale-target fix")

Confirmed: `update_connection` (`objectTools.ts:108`, `mapSection.ts:300`, given as :298), `remove` (`writeTools.ts:470`,
`objectTools.ts:128`, `mapSection.ts:191/331/339`, given as 190/329/337), `update_node` (`projectTools.ts:374/495/530/658`),
`set_lens` (`lensTools.ts:484`), `update_frame{name}` (`mapSection.ts:273`), `move` (`writeTools.ts:371`,
`repoMap/service.ts:1028`), `patch_block` (`resolvePatch`). `restore` is produced in `agentState.ts:292`, with its
check called at `projectTools.ts:781` (given as :788).

Corrections:
- `annotate` produces no `update_node`; `update_progress` does.
- `restore`'s "own check" is proposal-time and version-only (gap 1).
- Reflow `move` from the create tools (`render.ts:144`) is missing from the list.
- `group_objects` (existing objects' `frameId`) is missing from the list.

## Full-gate regression spec (2026-11-15)

User-approved. These tests define the behaviour that gaps 1, 2 and 9 require. The defects themselves are **deferred and not fixed**. Unrestricted
remote MCP (`MCP_REMOTE_PROFILE=full`) stays closed until the fixes land and every mark below is removed.
`scripts/chatgpt-mcp-session.ps1` requires the spec for `-Profile full`, and its mark check refuses any
`test.fail` / `it.fails`.

- **`e2e/local/mcpRemoveRevert.local.spec.ts`** has 6 tests, each marked `test.fail(true, "<deferred defect …>")`. They drive
  the real tools over a local bearer MCP session.
  1. `delete_object` with block content edited before Accept: the review asks, and Delete anyway deletes as one undo step (A2).
  2. The same with Keep mine: the block and the edit survive, and nothing is written (A2).
  3. `delete_connection` with the label retyped before Accept: the review asks, and Keep mine keeps the arrow and label (A3).
  4. A `delete_object` that empties an Acute section frame: the frame's removal is listed in the review (gap 9).
  5. `revert_agent_changes` after a content-only edit (element version unchanged, checked as a precondition): the revert asks,
     and Keep current leaves the content exactly as the user left it (A4, gap 1b).
  6. A content edit after the revert is proposed but before Accept: Accept asks instead of resetting the content (A4, gap 1a).
  **Not executed yet.** Another agent was using the shared dev server. The integrator runs the spec in `-Verify`. The expected
  failure points were worked out from the code: no decision is shown, because `remove`/`restore` pass straight through
  `resolveChangeSet` and `planRevert` sees no version change.
- **`src/ai/changes/removeRevertBaseline.test.ts`** has 6 `it.fails` tests and 2 controls on the real pipeline
  (`PendingChanges` → `withDecisions` → `acceptChangeSet` → `afterAccept`). They cover: `remove` with no baseline and no
  Accept re-check (block content, arrow label, Keep mine, Delete anyway with undo); a revert's `restore`/`remove` with no
  Accept re-check; and `planRevert` missing content-only edits. The last test uses a proposed API: `touched[].afterFingerprint`
  plus a third `contentFingerprint` argument. If the fix ships a different API, adapt the setup and keep the assertions.
  Run 2026-11-15: 2 passed and 6 expected to fail. Unmarked, all 6 failed because the change was written; none failed for
  a setup error.
