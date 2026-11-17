# Per-card modes: editable cards and AI-layout cards (2026-11-17)

**Status: DIRECTION AGREED, not started.** Design from the user, 2026-11-17. Builds on the canvas Cards view
([openui-canvas-rendering-plan-2026-11-16.md](./openui-canvas-rendering-plan-2026-11-16.md), committed `005e8b8`).

## The idea

A whiteboard will usually mix ordinary text cards with richer laid-out ones, so the choice is made **per card** (or per
section), not by one global switch.

| | Editable mode ("option 2") | AI layout mode ("option 3") |
|---|---|---|
| What's stored | Rich text, as today | OpenUI layout text (a new stored field) |
| Who edits | People directly; AI through the existing update tools | AI rewrites it on request; people ask rather than type |
| Looks | Text cards with citations | Timelines, decisions, comparisons |
| Cost | No model calls | A model call per layout and per AI edit |

## What makes it work

1. **A per-card mode flag.** Each card records `editable` or `ai-layout`. The header's View setting only changes how
   cards are drawn; this flag decides what the card is.
2. **Switching modes on a card.**
   - AI layout → editable: the layout becomes rich text. Some visual structure is lost; tell the user before it
     happens.
   - Editable → AI layout: AI regenerates the layout from the card's text and citations. It's a paid call, so ask first.
3. **Rich text stays underneath AI-layout cards.** Search, export, the Notes view, citations and Study keep working, and
   a broken layout falls back to the plain view.
4. **Separate edit paths.** Double-click on an editable card opens the editor. On an AI-layout card it offers "Ask AI to
   change" or "Switch to editable".
5. **Review covers both modes.** AI changes to layouts go through the same review-before-accept and undo as text edits.

## Order

1. **Ship option 2:** distil becomes the Visualize default, so ordinary Visualize cards cite their source and show as
   OpenUI cards in View → Cards with no extra canvas work.
2. **Add the per-card mode flag,** with AI layout behind a developer flag.
3. **Build AI layout mode for one layout first** (for example a timeline) to test the experience before covering all.

## Constraints found when recording this (2026-11-17)

- **Step 1 is release gate R1 of the knowledge-notes plan** ([knowledge-notes-plan.md](../knowledge-notes-plan.md) §9,
  S2.6). It isn't a config flip: `FIDELITY_CONFIG.noteModel: "distil"` plus `showNoteModelChoice: true` are allowed only
  after gates G1–G10 pass. The last live run (2026-10-20) had **G1 not met on 6 of 7 fixtures**, and S2.6 (R1 live runs,
  judge rubric, comprehension study) is pending approval. So step 1 needs either those gates passed (paid live runs, with
  approval) or an explicit decision to ship distil earlier, behind a flag.
- `src/config/fidelity.ts`, `src/domain/types.ts` and `contracts.ts` belong to the knowledge-notes integrator lane
  ([knowledge-notes-lanes.md](../knowledge-notes-lanes.md)). The mode flag (step 2) is a new domain field, so it goes
  through that lane.
- Step 2 can be built offline: the flag, the "Switch to editable" path and the developer flag. Step 3 needs its own plan:
  stored field and migration, Lang generation, review and undo on the new field, and the convert actions. It also needs
  paid test runs, each approved first.
