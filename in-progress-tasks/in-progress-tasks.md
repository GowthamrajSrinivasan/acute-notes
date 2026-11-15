# In-progress tasks

Snapshot of what the open Claude sessions on canvas-notes were working on, plus what is still pending.
Source: session logs and [knowledge-notes-lanes.md](../.ai/docs/knowledge-notes-lanes.md). Nothing here is committed.

## Sessions

### 1. OpenUI audit (`18ff0566`)
- **Asked:** audit how to use `open-intelligent-ui` (OpenUI) to make notes in the canvas, similar to ChatGPT's latest notes update.
- **Done:** audit written to [.ai/docs/open-intelligent-ui-audit.md](../.ai/docs/open-intelligent-ui-audit.md).
- **Recommendation:** add OpenUI as an optional, flagged renderer for the inside of AI-made cards (`noteRender: "blocknote" | "openui"`). Do not replace Excalidraw, BlockNote or the fidelity pipeline. Main benefit: streaming and about 67% fewer tokens than JSON.
- **Waiting on you:** go-ahead to build the Option A trial (offline, no model calls).

### 2. Notes update audit (`90cd057e`)
- **Asked:** audit what makes notes updates complicated and inefficient; write a doc with tests and best practices; publish an artifact.
- **Done:** [.ai/docs/notes-update-audit-and-plan.md](../.ai/docs/notes-update-audit-and-plan.md) and artifact https://claude.ai/code/artifact/5653764e-d215-4c10-b6e8-fc16028d4801.
- **Contents:** findings A1–A2 (minor) and B1–B5 (major), a no-behaviour-change simplification plan (`UpdateMode` / `PlanResult`), test guardrails, 12 non-duplication best practices.
- **Next:** write replay-only characterization tests, then refactor (not started).

### 3. Distil quality follow-up (`32f5d516`, ended)
- **Done:** the model check now runs before the retry, so its findings feed the retry. A "Limit:" line is added back only when the check does not call the card supported. `cardGroups` kept in `runOutput.ts`.
- **Tests:** unit 379, golden 353, local e2e 14/14; `tsc` and ESLint clean.
- **Not done:** no real-model measurement. G1 still failed on 6 of 7 fixtures in the last offline estimate.

### 4. Live fixes (`ad97952b`, ended)
- Built fixes 1–4: G1 counted per card, label shapes with no explanation, dropped conditions and caveats, kn-05 dialogue. Session 3 built the follow-up decision.

### 5. Lanes F and G (`ada1570d`, ended)
- **Lane F:** closed with no code changes. kn-10's 2 links over a frame in v2 are by design (all 5,040 frame orders scored).
- **Lane G:** only WP3.4 remains; it needs a paid live run.
- Earlier in this session: Tool Shelf plan ([.ai/docs/tool-shelf-plan.md](../.ai/docs/tool-shelf-plan.md)).

### 6. Study Mode (session "Intelligent UPDATE APPROACH", Study integrator)
- **Done (accepted provisionally, 2026-11-15):** Phases 1–4, issues A–C, "Clear study history" (Study → Weak), browser
  regression `e2e/local/notesStudy.local.spec.ts` 5/5 on two runs; unit, `tsc` and ESLint clean. Plan:
  [study-mode-implementation-plan.md](../.ai/docs/study-mode-implementation-plan.md).
- **No commits and no more Study features at this stage.** Both gates stay closed; no real ChatGPT access.

#### Study Mode: what works and what's still missing (keep this updated as the pending items move)

Study Mode works fully on the device, and `get_weak_concepts` works over local MCP. The pending items add proof of the
update engine's behaviour, plus remote and ChatGPT access. If none of them get done, three things are missing: proof
that history survives a changed card, any ChatGPT access, and card links on older history.

**Already working** (all uncommitted, tested offline and in the browser):
- **Recording answers:** a quiz answer is recorded once per card, and "Try again" is never counted. A flashcard records
  only on "Got it" or "Missed it". Answers on cards that need review are flagged and capped at "learning".
- **What you see:** "Weak" and "Source changed since you studied this" badges, the Weak list ranked weakest first,
  links back to the source, and "Quiz me on these".
- **History follows the passages:** history is keyed by the passages a card cites. It survives Visualize regenerating
  a section, cards moving, and a section's other cards being replaced. A browser test confirms this across a reload.
- **Deleting and restoring:** deleting a source keeps its history as retired. Deleting a workspace, or "Clear study
  history" in Study → Weak, wipes everything. A restored source never inherits unrelated history.
- **Parity:** the citation-update rules and Study's history rules agree with the citation update switched on.
- **`get_weak_concepts` over local MCP:** read-only, limited to its own workspace, capped in size, never exposes source
  or passage ids, and always returns `verified: false`.

**Missing features** (to be updated as we proceed):

| Missing feature / unfinished item | What it means in practice | Status |
|---|---|---|
| Changed-card fix and browser check | When the passage behind a studied card is edited and the section regenerated, today's engine produces cards with no citations. The regenerated card counts as a new local concept, so its old history (kept under the passage-based concept) isn't shown on it. There's also a position-based conflict with an unrelated card. Nothing is lost or wrongly transferred, but the user may see the card as "new" instead of "Source changed since you studied this". Until the fix lands, there's no end-to-end proof of this case | Fix A in progress, Fix B next (canvas-notes-39); Study browser check with A only, then A+B |
| Restricted remote profile and full launch check | No real ChatGPT access to anything, Study included. Local MCP clients on the device still work | In progress (canvas-notes-39); gate closed |
| Revert/delete safety fixes | The full MCP gate stays closed. A general MCP risk, not specific to Study | Tests being added; fixes deferred |
| `get_weak_concepts` remote access | A remote ChatGPT session can't ask for weak concepts. This is the current decision | Excluded from the first remote allowlist |
| `cards: []` on older history (nothing to do) | History recorded before card references were added shows weak concepts with no card link over MCP until Study is opened on that canvas again | Accepted limitation |

**Changed-card verification sequence (agreed 2026-11-15):**
1. **Run 1, Fix A only (Fix B off):** citation accuracy, card regeneration, Study history kept. Review it on its own:
   does A clear the browser conflict without wrong matching?
2. **Run 2, Fix A + Fix B (B on):** the same reproduction, compared with run 1, including ambiguous and legacy-card
   behaviour.
3. **Final assessment:** correct citations, card identity, history kept, out-of-date marking, persistence after a reload.

A pass needs all of these, not just "no conflict": the regenerated card cites the right passage; the studied concept
keeps its history; changed content is marked out of date; unrelated cards don't inherit it; ambiguous matches are
reported, not silently resolved; legacy uncited cards are kept; it all survives a reload.

**A passing Fix A doesn't justify switching Fix B on.** Run 2 must show B is safe and corrects positional matching. The
Study integrator then sends a two-configuration comparison: passing and failing tests, remaining risks, and a
recommendation on whether Fix B stays disabled. Fix B stays off by default, and the MCP gate stays closed.

**Bottom line:** the on-device Study experience is complete. The pending items affect one update-engine edge case (a
card whose own text changes) and anything involving ChatGPT.

## Pending

### Study Mode and MCP gates (blocked; handle later)
| Priority | Item | Status | Owner | Next action |
|---|---|---|---|---|
| P0 | MCP launch verification | Closed (the 19:09 local pass is historical only; `src/mcp/bridge/http.ts` changed after it) | canvas-notes-39 | Repeat the full `-Verify` against the final code: remote access, restricted-allowlist enforcement, revert/delete write safety, local and remote-profile security checks |
| P0 | MCP write-safety regression | In progress | canvas-notes-39 | Revert/delete tests added to the **full** gate; they stay red until the deferred fixes land, so the full gate stays closed. The **restricted-profile** gate is checked separately |
| P0 | Restricted remote profile | In progress | canvas-notes-39 | Finalise the allowlist and verify the tool restrictions |
| P1 | `get_weak_concepts` remote exposure | **Excluded from the first restricted allowlist** (hidden and refused for remote sessions; canvas-notes-39, 2026-11-15). Local profile unchanged | user | Adding it later is the user's call, and only with the remote-path checks (workspace authorisation, retired-history filtering, no writes) in `-Verify` |
| P1 | Changed-card integration regression | Blocked. **Diagnosed (canvas-notes-39):** a pre-existing engine issue. An edited section is regenerated with the old preserve prompt, so its cards don't cite the source (`src/ai/reconcile/update.ts:746-749`). Cards are keyed by position (`keys.ts:112-115`), so an unrelated card takes the studied card's key. Expected-fail tests: `updateOwnPassage.test.ts`, `e2e/local/updateOwnPassage.local.spec.ts`. Fix (a), a labelled distil prompt for edited sections, is in progress. Fix (b), keys from citations, is proposed only: it would change keys on existing canvases. **User decision 2026-11-15: Fix A approved; Fix B approved offline**, with ambiguity and legacy safeguards, and inactive until its regression evidence is enough to switch it on. Acceptance, 0/7 verified: citations on edited-section cards · the studied card regenerates · history survives, marked out of date · still right after a reload · reordered cards can't inherit unrelated history · deleted, duplicate and uncited cards handled safely · no regressions on unaffected canvases. Plus the two updateOwnPassage tests turned to passing, and `citationParityEnabled.test.ts` and the Study regressions rerun | canvas-notes-39 (fixes); Study (history checks, matcher off and on) | After the update conflict is fixed (repro sent): mark a card Weak → change its source text → Update from new content → the intended card regenerates with no unrelated-card conflict → its history survives, marked out of date → reload, still there |

**Next checkpoint reports only two results:** (1) changed card: did regeneration succeed, and did the history persist
correctly? (2) MCP: did the new full launch check pass against the final code and restricted profile, including write
safety? A pass makes launch *eligible* for the user's explicit authorisation; it activates nothing.

### Needs your approval (costs money)
1. Live G1 confirmation run: C1c plus the 7 golden cases, about $0.70–0.75.
2. WP3.4 (Lane G): measure card-level update cost against the baseline.
3. OpenUI token-cost comparison, after the Option A trial exists (baseline $0.47, target at least 40% lower).

### Free, offline
4. Notes update audit: characterization tests, then the refactor.
5. OpenUI Option A trial: card primitives and a render host behind a flag.
6. Open requests in `knowledge-notes-lanes.md`:
   - Lane K: update plan docs to show composite Ungroup is done; fix the "Known open bug" line in `interactive-architecture-frames-plan.md:49`.
   - kn-07: reading-order check fails in v2; limit it to v1 (a person must review the case).

### Needs a person
7. Review the 12 draft golden cases. Only a model has reviewed them so far, so they cannot gate yet.
