# OpenUI integration — phased plan

Status: **draft** · Date: 2026-11-13 · Owner: Gowthamraj
Related: [[open-intelligent-ui-audit]] (`.ai/docs/open-intelligent-ui-audit.md`, the original audit and
verdict), [[intelligent-update-engine-plan]] (`.ai/docs/intelligent-update-engine-plan.md`, the parallel
reconciliation work this plan sequences against — see §2), knowledge-notes-plan

There was no phased plan before this — the audit recommended an approach (Option A) and the user then gave
a 5-phase roadmap verbatim in conversation on 2026-11-10. This doc is that roadmap, written down, with
Phase 1's actual outcome recorded and an explicit sequencing decision against the parallel reconciliation
work (§2), which the user asked for directly: *"if this work would be affected with that parallel work,
then we shall take up this work after completing that work."*

---

## 0. The two things being validated independently

Per the user's framing: this isn't one bet, it's two, and they fail independently.

1. **Does OpenUI improve generation economics?** (token/cost — Phase 1)
2. **Does it improve the user's ability to understand and work with knowledge?** (Phases 2–3)

Phases 4–5 are a third, later question — whether OpenUI-rendered interaction should feed back into the
canvas's durable content model — and that one is where the sequencing conflict in §2 lives.

---

## 1. The five phases

### Phase 1 — Technical validation ✅ **done (2026-11-13)**

Option A from the audit: card-interior renderer, isolated.

- [x] Installed `@openuidev/react-lang` 1.1.0; verified peer-dep compatibility (zod ^4, React 19).
- [x] 5-component library (`src/ai/openui/library.tsx`): IdeaCard, CitationChip, SourceLink, Callout,
      ComparisonTable — real Zod schemas, verified against the actual installed package API.
- [x] Read-only render host (`src/components/openui/OpenUiCardRenderer.tsx`), not mounted anywhere live.
- [x] Feature flag (`src/config/openui.ts`, `OPENUI_CONFIG`) — off by default, inert.
- [x] Deterministic + streaming tests (`src/ai/openui/library.test.tsx`) — real parser/runtime, no mocks.
- [x] Benchmark **scaffold** only (`scripts/openui-benchmark.mjs`) — cannot call a model; the real cost A/B
      still needs an approved live run.
- [x] Dev-only demo page (`src/app/dev/openui-demo/page.tsx`) + Playwright spec
      (`e2e/local/openuiDemo.local.spec.ts`), run headed, screenshots verified.

**Acceptance (audit's bar): no fidelity regression, no loss of editing capability, measurable cost
improvement.** The first two hold by construction (nothing touched).

**Measured live on 2026-11-13** ([openui-live-2026-11-13.md](./openui-live-2026-11-13.md), gemini-2.5-flash, kn-02):
- One OpenUI call cost ≈$0.007 and took 11 s for 14 cards.
- Today's distil Visualize cost $0.067 and took ≈178 s of model time over 34 calls for 34 cards.
- Output tokens per card are about 60% lower.

These are **not the same work**: the OpenUI cards skip layout and the fidelity meaning check. So this confirms the
generation-economics hypothesis for a reading view, not a Visualize replacement.

**Explicitly not done:** nothing wired into `RichBlockHost` / `ExcalidrawCanvas` / `domain/types.ts` /
`visualize/tasks.ts`. A real Visualize run today looks exactly as it did before this work.

### Phase 2 — User experience validation ✅ **built offline (2026-11-13)** — live UX check pending

Option B from the audit (streaming notes reading view), extended. Behind `NEXT_PUBLIC_OPENUI_NOTES` (`isOpenUiNotesEnabled`
in `src/config/openui.ts`; "on" in `.env.development` only, off everywhere else).

- [x] Notes/Canvas switching — a **Notes** pill in the canvas toolbar (`NotesViewHost`, mounted in `ExcalidrawCanvas.tsx`);
      Escape or **Canvas** returns. A view mode in memory (`notesViewStore.ts`), not a canvas primitive.
- [x] Reading view (`src/components/openui/notes/NotesView.tsx`): sections from frames, notes in reading order, a
      section index, a filter (`notesModel.ts`: `buildNotes`, `readingOrder`, `noteLang`). Deterministic, no model.
- [x] Stream generated notes into the reading view — **Generate from source** (AI mode on, the canvas's newest stored
      source with units): new task `generate_openui_notes` (`src/ai/openui/notesTask.ts`), a `text` task so the runtime
      streams it; cards are `---`-separated Lang blocks rendered as they arrive. **Mock-tested only; never run live.**
- [x] Progressive disclosure — long cards split into body + `detail` behind **More** (`splitBody`); `IdeaCard` gained
      the appended optional props `detail` and `extras`.
- [x] Expandable sources — a citation chip opens its cited passage inline (units loaded from the stored source
      version); **Open in source** opens the Source tab on those passages.
- [x] Promotion — **Pin to canvas** on a generated card → one `create_block` through the same `passage` change-set
      path as the Source tab's Add to canvas (`promotion.ts` / `promote.ts`): one undoable step, linked to the source
      version, citing its units, **opted out of updates** (`excludeFromReconciliation`). Notes already on the canvas
      offer **Show on canvas** instead.
- **§4 decision (provisional):** a pinned card persists the *rendered content* (Markdown in an ordinary rich block) plus
  existing provenance and the `passage` link — not the OpenUI Lang, and no new `AIMetadata` field.

**Verified:** unit tests (`notesModel.test.ts`, `promote.test.ts`, `notesTask.test.ts`); `tsc` clean; eslint clean on the
new files; checked by hand in a browser on a real 113-card canvas (Read, Study, Quiz; no console errors).
**Verified live on 2026-11-13** ([openui-live-2026-11-13.md](./openui-live-2026-11-13.md), `e2e/ai/openuiNotes.spec.ts`), on kn-01
and kn-02:
- Generate from source streamed 5 and 14 cards, all pinnable.
- Pin to canvas created one linked card: it cites its units, is opted out of updates, and one undo removes it.

Two fixes came out of the run: named-argument replies are rewritten to positional (`positional.ts`, plus a prompt rule),
and generated cards survive a remount (`generationStore.ts`).

**Open:** the generated cards are not run through the meaning checker (`check_card_meaning`). Pinning puts unchecked
AI wording on the canvas, marked as AI-created and citing its units. Decide whether pinning should run the check first.

**Acceptance:** users can understand and navigate imported conversations without having to arrange the canvas first.

### Phase 3 — Knowledge interactions ✅ **built offline (2026-11-13)**

Built in parallel by a second lane (`src/ai/openui/interactions.tsx`, `study.ts`, `components/openui/interactions.css`,
dev demo section 3). All interaction is component-local state, a bound `$variable`, or what the host offers — no model calls.

- [x] Comparison and decision cards — `ComparisonTable` (Phase 1), `DecisionCard(question, options, chosen?, rationale?, citations?)` + `DecisionOption(name, pros?, cons?)`.
- [x] Interactive timelines and diagrams — `Timeline(title, events)` + `TimelineEvent(when, label, detail?, unit?)`; `FlowDiagram(title, steps, details?)`.
- [x] Learning cards and quizzes — `QuizCard(question, choices, answer, explanation?, unit?, selected?)`, `Flashcard(front, back, unit?)`; the Notes view's **Study** mode builds them from the canvas's notes (`flashcardLang`, `quizLang`; title-only notes are skipped for quizzes).
- [x] Cross-note navigation — `NoteLink(target, label?)`; the Notes view adds a link for every arrow drawn between two cards on the canvas, and the generation prompt can link `g1…gN`.
- [x] Local interaction state — `QuizCard.selected` is `reactive()`: a `$variable` binding updates the Renderer's store with no round trip (tested).

**Verified:** `interactions.test.tsx` and `study.test.ts`, rendered through the real `Renderer` and clicked (happy-dom).
**Gap:** only one card per `root`, so two cards sharing a `$variable` across separate Renderers isn't demonstrated.

> **Parked by the user, 2026-11-16:** Phases 4–5, including promotion P1+, are parked. The new goal is OpenUI-rendered
> blocks on the canvas itself: [openui-canvas-rendering-plan-2026-11-16.md](./openui/openui-canvas-rendering-plan-2026-11-16.md).
> Already-landed work stays:
> - P0 promotion fixes;
> - placement defaults (decisions 1 and 3);
> - the `update_block` before/after view, formatting carry-over and auto-accept guard (decision 2);
> - the Repo Map hold.

### Phase 4 — Knowledge evolution ⏸ **blocked — see §2**

- [ ] Connect interactive decisions to reconciliation.
- [ ] Connect comments and review status.
- [ ] Track source changes.
- [ ] Promote important insights into canonical notes.
- [ ] Preserve version history and provenance.

**Acceptance:** users can safely evolve their knowledge rather than creating disconnected summaries.

> **User decisions, 2026-11-15** (Phase 4):
> 1. **Router default.** When the router says new card, don't preselect "A new card on its own". The dialog starts
>    with nothing selected and needs the user's confirmation. No changes to routing weights.
> 2. **Agent edits.** Whole-block proposals go through the existing reviewed ChangeSet path, with a before/after diff
>    and unrelated content kept. A destructive replacement is never auto-accepted. Claim-level agent edits are a
>    separate Phase 5 capability; no new agent write tool.
> 3. **Contradictory, ambiguous or unclear placements.** Nothing is preselected; the user picks the target and the
>    action. The dialog has a Keep existing / No change option, and nothing is silently overwritten.
> 4. **Promotion.** A separate promotion record, plus tracking modes `managed` / `excluded` / `canonical`. No new
>    `ProposedChange` kind. The `AIMetadata` change needs the integrator's approval first, covering schema and
>    migration, compatibility with `excludeFromReconciliation`, the provenance readers, reconciliation in each mode,
>    and undo, reload and source-version behaviour. Production activation is separate.
>
> **Conditions.** Phase 4 is neither committed nor activated before the manual results and the shared-contract
> sign-off. No paid generation without explicit authorization.
>
> **Status, 2026-11-15:** decisions 1–3 are being implemented. The promotion-contract proposal is being drafted
> (`promotion-contract-proposal-2026-11-15.md`).

### Phase 5 — Agent integration ⏸ **blocked — see §2**

- [ ] Expose semantic notes through MCP.
- [ ] Allow agents to retrieve related concepts and sources.
- [ ] Support explicit knowledge updates through controlled tools.
- [ ] Add traceability for agent-generated modifications.

**Acceptance:** coding agents can reuse the user's accumulated knowledge reliably.

---

## 2. Sequencing against the Intelligent Update Engine work

The parallel work the user means is **[[intelligent-update-engine-plan]]** — "updating existing content
with new content" is exactly its subject (claim-level patching, the patch contract, the Node Router). It's
active right now: Stage 0–1 (the claim-level patch engine, `patch_block`) was built and gated offline
*today*, 2026-11-13. Stages 2–4 (Node Router, multi-location sync, continuous consistency) are not started.

> **Gate status, 2026-11-14:** the text above is the 2026-11-13 snapshot. Current status, from a review of
> the engine plan and its tests:
>
> - **Stage 1: gate CLOSED 2026-11-15** by the integrator after the stale-patch fix (see the engine plan's Stage 1 gate note). Earlier recommendation kept below for the record.
> - (2026-11-14) **Stage 1:** recommended for closing; the closure is **yours to accept**.
>   - The five gate scenarios all run through deterministic code: claim patch planning, the lexical intent
>     classifier, and fingerprint checks. Each has a named offline test (`claimPlanner.test.ts` gates 1, 2, 3
>     and 5; `claimPatch.test.ts` gate 4), and all pass (174/174 across `claimPlanner` and `src/ai/changes`).
>   - The approved live run (`e2e/ai/updatePolicy.spec.ts`, 5/5, engine plan §8) covered what depends on the
>     model: changed facts update cards, an identical re-run makes no AI call, an edited card keeps the
>     user's words, and a locked card is left alone.
>   - **App-level evidence added 2026-11-14:** `e2e/local/stage1Gate.local.spec.ts` (no AI) drives all five gates in the
>     real app as claim-level patches; all pass, traces kept in `test-results/stage1-gate-2026-11-14/`. It found two
>     defects after gate 4: a skipped stale patch's fact is lost (the source version is recorded anyway), and the
>     wrong "deleted object" message. Both are filed to the engine lane in the lanes file Requests.
>   - **Caveat:** that spec doesn't assert that the update was a claim-level patch; only the written §8
>     account says so. No recording or trace of the run was kept, so there was no recording to review.
>   - Gate 4 covers `patch_block` only. The `update_block` stale-target overwrite is a separate P0, still
>     open.
> - **Stage 2:** built, with local checks only (no AI). **Implementation complete, verification
>   pending** until its routing acceptance criteria pass.
> - **Shared contracts:** ChangeSet and provenance not yet reviewed by the integrator.
> - **Phases 4–5 stay blocked.**

**Checked phase by phase, against what that plan actually touches** (`src/ai/changes/{changeSet,claimPatch}.ts`,
`src/ai/reconcile/**`, `accept.ts`):

| Phase | Touches the same machinery? | Verdict |
|---|---|---|
| 1 (done) | No — zero shared files, confirmed by what was actually edited. | Clear |
| 2 (notes view, promotion) | "Promotion" creates a *new* object via `create_block` — the stable, un-churned side of the change-set writer. The patch-contract work only extends the *update* path (`patch_block`, `update_block`). | **Clear — can proceed now.** |
| 3 (knowledge interactions) | None of it touches reconciliation, patching, or source versioning at all — it's canvas-local interaction state. | **Clear — can proceed now.** |
| 4 (knowledge evolution) | Every bullet *is* the update-engine's subject: "connect to reconciliation," "track source changes," "preserve version history and provenance" means building against `patch_block`'s contract, the intent classifier, and the baseline-fingerprint rules — all of which are still being hardened (Stage 1 gate passed offline only; not yet live-verified) and extended (Stages 2–4 not started). | **Blocked.** Building this now means building against a contract that's still moving. |
| 5 (agent integration) | "Retrieve related concepts" needs the **Node Router** (update-engine Stage 2 — embeddings + retrieval), which doesn't exist yet regardless of our own work. "Explicit knowledge updates through controlled tools" again goes through the same patch contract as Phase 4. | **Blocked**, and partly blocked on *both* plans regardless of sequencing. |

**Decision:** Phases 2–3 are cleared to start whenever prioritized — they don't touch anything the
update-engine plan is changing. **Phases 4–5 wait** until the Intelligent Update Engine reaches:
- Stage 1 (claim-level patch) **live-verified**, not just offline-gated (its own plan's open item), *and*
- Stage 2 (Node Router) **built**, since Phase 5 needs it outright and Phase 4's "canonical promotion" is
  far more useful once routing exists (today it would only ever target the one source-anchored card).

This isn't a hard dependency on every line of the update-engine plan — Stages 3–4 (multi-location sync,
continuous consistency) can still be in flight when Phase 4–5 of this plan starts. The gate is Stage 1
live-verified + Stage 2 shipped.

---

## 3. Running order

1. Phase 1 — done.
2. Phase 2 and Phase 3 — built offline 2026-11-13 (live generation check pending). Independent of the update engine; can also run
   concurrently with the update-engine's own Stage 1 live-verification or Stage 2 build.
3. **Checkpoint:** before starting Phase 4, confirm the Intelligent Update Engine has a live-verified Stage 1
   and a shipped Stage 2 (Node Router). Re-read that plan's §7/current status at that point — don't assume
   this doc's snapshot is still accurate.
4. Phase 4, then Phase 5.

Fidelity follow-up (2026-11-13): the meaning check missed the separated conditions (live write-up Step 4), so an offline
claim–condition prototype was evaluated: [claim-condition-prototype-2026-11-13.md](./claim-condition-prototype-2026-11-13.md). Not active;
its recommendation (cite-based condition linkage at generation, clause checks, records derived automatically) awaits a decision.
Phase 2 (offline, frozen blind labels for kn-03–kn-12): [claim-condition-phase2-2026-11-13.md](./claim-condition-phase2-2026-11-13.md). Extraction isn't
credible yet, and validation works only given reviewed records. Condition-aware generation stays gated.
Phase 3 (reviewer agreement, visibility v2, OpenUI coverage): [claim-condition-phase3-2026-11-13.md](./claim-condition-phase3-2026-11-13.md).
The v2 prompt cut Needs review flags, but 8 of 10 claim-bound OpenUI v2 cards still lack their condition, and the rules catch 2.
Phase 4 (rubric v3, clause-level snapshot): [claim-condition-phase4-2026-11-14.md](./claim-condition-phase4-2026-11-14.md). OpenUI v2 improved coverage over v1
(11 gaps to 3) but not integrity (66% to 73% failing). The evaluation spec awaits review; condition-aware generation stays gated.

## 4. Open questions

- Phase 1's real cost benchmark (the audit's actual business case) is still unrun — needs the user's
  go-ahead for a live model call before any Phase 2 prioritization decision leans on it being validated.
- *(Provisionally decided 2026-11-13, Phase 2 above.)* A pinned card persists the rendered content plus the `passage`
  link, not the Lang. Revisit if Phase 4 needs the Lang for provenance.
- Whether Phase 4 reuses `patch_block` directly for "promote insight → canonical note," or needs its own
  change kind, is an open question for whoever picks this phase up — don't presume the answer is `patch_block`
  just because it's the nearest contract; it was designed for source-reconciliation, not card promotion.
