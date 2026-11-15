# OpenUI integration: manual verification (2026-11-15)

**Goal (user, 2026-11-15):**
- Make the OpenUI integration work completely, verified by hand.
- The ChatGPT integration is parked until then. Its details are in
  [chatgpt-integration-parked-2026-11-15.md](./chatgpt-integration-parked-2026-11-15.md).

**Scope:**
- Phases 1–3 of [openui-integration-plan.md](./openui-integration-plan.md) are built and testable now.
- Phases 4–5 are blocked until two items close, both in progress (§4).

## Where things stand

| Phase | State | How it's checked |
|---|---|---|
| 1 Card library | Done | `/dev/openui-demo`; `openuiDemo.local.spec.ts` passed 2026-11-15 |
| 2 Notes view, Generate, citations, Pin | Built; one live run 2026-11-13 | This checklist (§2). A no-AI rehearsal spec is being built (`e2e/local/openuiNotesFlow.local.spec.ts`) |
| 3 Interactions, Study cards | Built | This checklist (§3). Study history and the Weak view belong to the Study Mode session |
| 4 Knowledge evolution | Blocked | Stage 2 routing verification + shared-contract review (§4) |
| 5 Agent integration | Blocked | Same, plus the MCP gate (parked) |

**Automated checks, 2026-11-15:**
- `e2e/local/openuiNotesFlow.local.spec.ts` (no AI; generation answered from the kn-02 fixture): 9/9, three runs in a
  row. Screenshots are in `test-results/openui-flow/`.
- After the integrator fixes (Open in source on generated cards, Pin after Undo, Escape): flow + `notesStudy` +
  `studyChangedCard` 18/18; flow alone 9/9 twice; unit tests (openui, review, study, reconcile, domain, canvas,
  router) 895 passed; tsc and eslint clean.
- `npx vitest run src/ai/openui src/components/openui src/config`: 162/162 passed.
- `openuiDemo.local.spec.ts`: 1/1 passed.

**User focus for this run (2026-11-15):**
- Open in source;
- Pin → Undo → Pin;
- Escape;
- review status;
- citations;
- Study Mode persistence.

**Step 2.6 (Generate from source) is a paid model call. It needs your explicit authorization before it runs.**
Without it, skip 2.6–2.11 and record them as "not run".

The automated tests are readiness evidence, not user acceptance.

## 1. Setup

1. Dev server on loopback: `npx next dev -H 127.0.0.1`.
   - `.env.development` already has `NEXT_PUBLIC_OPENUI_NOTES=on`.
   - Make sure `.env.local` has no MCP session block (`AI_HOST_MODE=server` would make Visualize "Structure only").
2. An AI connection that works (Copilot or a key). **Generate from source makes one real model call per click, which
   is your own spend.** Everything else in this list is local.
3. **Dev-only popup.** Under `next dev`, the OpenUI library shows a "Ready to share your app? … deploy" box and a
   devtools button at the bottom right (`@openuidev/react-lang` auto-mounts its devtools in development). Dismiss it;
   it stays dismissed. It isn't part of Acute, and production builds don't include it.
4. Use a **new, disposable canvas.**
   - Your existing canvases (e.g. Q4 plan) have no stored source, so Generate is disabled there, by design.
   - Some hold duplicate cards, which show up twice in Notes and Study.

## 2. Phase 2: Notes view

Record pass or fail, with a note on anything confusing.

| # | Step | Expected | Result |
|---|---|---|---|
| 2.1 | **Visualize** the source `evaluation/knowledge-notes/cases/kn-01-idempotency-keys/source.md`, then Accept all | Cards in sections, with citations | |
| 2.2 | Click **Notes** in the toolbar | Reading view showing the note and section counts, a section index, Read/Study, Generate from source and Canvas | |
| 2.3 | Click a section in the index; type in **Filter notes** | Scrolls to the section; the filter narrows the notes | |
| 2.4 | **Show on canvas** on a note | Returns to the canvas with that card selected or focused | |
| 2.5 | Press Escape; then open Notes and click **Canvas** | Both return to the canvas | |
| 2.6 | **Generate from source** | Cards stream in one by one; long cards show **More** | |
| 2.7 | Click a **citation chip** on a generated card | The cited passage opens inline | |
| 2.8 | **Open in source** | The Source tab opens on those passages | |
| 2.9 | **Pin to canvas** on a generated card | Written directly, like the Source tab's Add to canvas, with no review bar. A new card on the canvas that cites exactly that card's units and is opted out of updates. The note now offers Show on canvas, which selects the card (the zoom stays where it was) | |
| 2.10 | Undo once | The pinned card is removed in one step | |
| 2.11 | Leave Notes and come back; then reload | Generated cards survive leaving and re-entering Notes. A reload clears them, by design (`generationStore.ts`) | |
| 2.12 | Browser console (F12) | No errors during 2.1–2.11 | |

**Known open decision (plan, Phase 2):**
- Pinning does not run the meaning check.
- A pinned card holds unchecked AI wording, marked as AI-created and citing its units.

## 3. Phase 3: Interactions

| # | Step | Expected | Result |
|---|---|---|---|
| 3.1 | Notes, then **Study**, then **Flashcards**; click a card | It flips to show the back | |
| 3.2 | **Quiz**: answer one right and one wrong | Feedback and explanation shown; title-only notes are skipped | |
| 3.3 | A generated card with a comparison, decision, timeline or flow (if the model produced one) | It renders and responds to clicks | |
| 3.4 | Draw an arrow between two cards on the canvas, then open Notes | A NoteLink between the two notes | |

**Seen on a real canvas, 2026-11-15:**
- A title-only note becomes a flashcard whose front and back are both the title (`src/ai/openui/study.ts`
  `flashcardLang`).
- Quizzes already skip such notes.
- `study.ts` is shared with the Study Mode session, so this goes to that session as a request.

## 4. Phases 4–5 blockers (in progress)

1. **Stage 2 routing verification.**
   - No routing acceptance criteria had been written.
   - Drafted criteria and an offline verification on the locate dev split go to
     `stage2-routing-acceptance-2026-11-15.md`.
   - The quantitative bars are PROPOSED, for your approval.
2. **Shared-contract review** (ChangeSet and provenance).
   - The integrator's review goes to `shared-contract-review-2026-11-15.md`.
   - It includes the Phase 4 decision: whether "promote insight" reuses `create_block`/`patch_block` or needs a new
     change kind.

Phase 4 starts only after both are signed off and you approve the Phase 4 change-kind decision.

## 5. Defects found during manual verification

| Found | Step | What happened | Owner | Status |
|---|---|---|---|---|
| 2026-11-15 | 3.1 | Title-only notes become flashcards with front = back | Study Mode session (`study.ts`) | Fixed 2026-11-15: title-only notes get no flashcard |
| 2026-11-15 | 2.9 + Lock | Locking, then unlocking, a pinned card cleared its opt-out, so the next update would propose removing it (shared-contract review, risk 2) | Integrator | Fixed 2026-11-15 (`lock.ts` `withCardLock`/`optedOutBesidesLock`) |
| 2026-11-15 | 2.3 | Notes read in the wrong order: a tall frame swallowed the rows below it | OpenUI (`notesModel.ts`) | Fixed 2026-11-15, with a new unit test |
| 2026-11-15 | 2.8 | Generated cards have no **Open in source** (canvas cards do) | Integrator (`NotesView.tsx`, `knowledgeActions.ts` `openSourceForUnits`) | Fixed 2026-11-15: opens the Source tab through the canvas card of the same source |
| 2026-11-15 | 2.10 | After Undo removes a pinned card, the generated card still says **Show on canvas**, which does nothing, and it can't be pinned again | Integrator (`NotesView.tsx`) | Fixed 2026-11-15: a pin whose card is gone offers Pin again |
| 2026-11-15 | 2.4 / 2.9 | Show on canvas keeps the current zoom (it can be 28%), so the card is hard to read | `components/review/knowledgeActions.ts` `showObjects` | Cosmetic, open |
| 2026-11-15 | Setup | OpenUI's dev-only deploy popup and devtools button | Library (development only) | Documented; dismiss it |
| 2026-11-15 | 2.5 | Escape did not close Notes while a canvas card was still in edit mode (the canvas took the key first) | Integrator (`NotesView.tsx`) | Fixed 2026-11-15: Notes handles Escape in the capture phase, except inside a dialog or menu |

## 6. Focus checks added 2026-11-15

| # | Step | Expected | Result |
|---|---|---|---|
| 6.1 | Pin a generated card, Undo, then Pin the same card again | The second Pin works; after Undo the card offers Pin to canvas, not Show on canvas | |
| 6.2 | Escape in Notes: with a canvas card in edit mode; while typing in Filter notes; with a header dialog open | Closes Notes; with text in the filter, Notes stays open; with a dialog open, only the dialog closes | |
| 6.3 | Review status: a card marked "needs review" in Notes, on the canvas, and in Study quiz | The same mark in all three | |
| 6.4 | Study persistence: answer a quiz wrong, reload | Still listed under Weak | |
