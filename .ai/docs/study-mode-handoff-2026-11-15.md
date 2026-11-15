# Study Mode: handoff from canvas-notes-39 to the Study Mode session (2026-11-15)

From canvas-notes-39 to the session handling Study Mode ("Pending Study mode work" / the Study Mode integrator
the user named in "Intelligent UPDATE APPROACH").
- **User decision (2026-11-15):** all Study Mode work belongs to that session. canvas-notes-39 no longer counts it
  as its own and won't edit Study files again.
- **Nothing is committed.** The user said not to commit for now.

## What canvas-notes-39 built (uncommitted, offline, no AI or paid calls)

**Phase 2: store**
- New `src/ai/study/store.ts` with `store.test.ts` (19 tests):
  - sharded meta keys: `study.<ws>` (index), `study.<ws>.<sourceId>`, `study.<ws>.local.<canvasId>`;
  - bounds of 20 attempts per concept, 500 concepts per shard and 2,000 per workspace, evicting retired concepts
    first, then the least recently attempted;
  - a lenient reader;
  - the collision rule from §4;
  - `clearStudy` and `snapshotCardStatus`;
  - flags bit0 marks an attempt as unverified.

**Phase 3: UI**
- **`hostContext.tsx`:** an optional `NotesHost.recordStudy?`, so the static demo is unchanged.
- **`interactions.tsx`** (+4 tests):
  - a quiz records its first pick per mount; "Try again" records nothing;
  - **issue B:** a flashcard shows "Got it" / "Missed it" only after the reveal; only a self-grade records, once
    per reveal; a flip alone records nothing.
- **`NotesView.tsx`** (+5 tests):
  - the badges "Weak", "Source changed since you studied this" and "Needs review";
  - the **Weak** toggle;
  - the wiring that records attempts.
- **New `src/components/openui/notes/WeakConcepts.tsx`** (8 tests):
  - links back through the existing source actions;
  - retired concepts behind a toggle;
  - local concepts shown without passages.
- **Answers on cards under review** are flagged, and their band is capped at `learning`, which carries issue A
  through.

**Issue C: deletion cleanup**
- **`src/workspaces/hierarchy.ts`:** `deleteWorkspace` clears the study index and all its shards (+1 test in
  `hierarchy.test.ts`).
- **New `src/ai/study/cleanup.ts`** (3 tests): deleting a content source removes its study shard and its
  `sourceReview:<sourceId>@*` keys. That fixes the existing leak. The `@<v>` keys are found from the source's
  `latestVersion`, read before the delete.
- **`src/components/canvas/ExcalidrawCanvas.tsx`:** one line. The app's only content-source delete is the dev hook
  `__acuteDev.deleteContentSource`, and it now calls the cleanup.

**e2e:** new `e2e/local/notesStudy.local.spec.ts`, 3 passed, against the 127.0.0.1:3000 dev server with
`NEXT_PUBLIC_OPENUI_NOTES=on`.
- **What it checks:** answer, reload, still weak; a flagged card's quiz shows the mark after a reload; a flashcard
  flip alone records nothing.
- **Mock AI:** it answers AI calls with the scripted mock distiller through `page.route`. No network or model is
  involved, but it isn't a pure local-tier run.

**Plan doc:** only the "Build status (2026-11-15)" table in `study-mode-implementation-plan.md` was updated, plus
the "Decisions and sign-off (2026-11-15)" section written then. That sign-off named canvas-notes-39 as integrator;
the user has since moved Study Mode to your session, so treat it as superseded by your own.

## Deviations from the plan (all also in the plan's Build status table)

1. **Write ordering:** writes are serialised per workspace, not per key. Index updates and eviction touch several
   shards, and this avoids deadlocks.
2. **Index writes:** the index is written only when a shard's concept count changes. A normal attempt is one `set`.
3. **`cardStatus` shape:** it is `{ status: "open" | "none", at, version? }`, not `{ review: … }`. Reading `.review`
   would trip the provenance guard.
4. **Under-review attempts:** marked by flags bit0, not an `underReview: true` field.
5. **Source cleanup location:** `src/ai/study/cleanup.ts`, not `src/ai/content/sources.ts`, which has Stage 1 edits
   from canvas-notes-39 in it.
6. **Remap target:** concepts are remapped to the source's latest version, not to the version a live card cites.
7. **Clearing `needs_review`:** a new answer clears it when the card has no open review. A simplification of the §1
   rule.
8. **Narrowing collision:** the old record keeps its key, but its units and version move to the survivors, so a
   second remap changes nothing.
9. **No CSS edits:** the new controls reuse existing classes.
10. **e2e:** uses the scripted mock distiller, as above. The plan's "regenerate a section, history kept" e2e is
    **not written**.

## Open items for your session

- **`deleteWorkspace` leaves content sources behind.** It still doesn't delete the workspace's content sources, so
  their `sourceReview:` keys stay too. This predates the work, and the integrator owns the delete path.
- **No "Clear study history" button** in Settings yet. `clearStudy` exists.
- **The "regenerate a section, history kept" e2e** from the plan's Phase 3 test list is not written.
- **Phase 4:** your session reports `get_weak_concepts` built and registered locally, with no passages, under the
  user's decision in your session.
  - Any `src/mcp/**` change alters the MCP launch gate's fingerprint (`scripts/chatgpt-mcp-session.ps1`), so it
    needs a fresh isolated `-Verify` run before exposure.
  - canvas-notes-39 runs `-Verify` next. Further `src/mcp` edits after that invalidate it.
- **The provenance guard** must stay green with no allowlist change: `src/ai/study/**` names no guarded identifier.

## Checks to rerun when you pick it up

```
npx vitest run src/ai/study src/ai/openui src/components/openui src/workspaces src/domain/provenanceGuard.test.ts
npx tsc --noEmit -p .
npx playwright test --project=local e2e/local/notesStudy.local.spec.ts --trace off --output <your scratch dir>
```

- The dev server must stay loopback-only (`npx next dev -H 127.0.0.1`).
- **Pre-existing type error:** another session's `src/ai/consistency/judgeReply.ts:76`, not Study's.

## Files

**This session's Study changes:**

| Status | Files |
|---|---|
| New | `src/ai/study/store.ts`, `store.test.ts`, `cleanup.ts`, `cleanup.test.ts`; `src/components/openui/notes/WeakConcepts.tsx`, `WeakConcepts.test.tsx`; `e2e/local/notesStudy.local.spec.ts` |
| Edited | `src/ai/openui/hostContext.tsx`; `src/ai/openui/interactions.tsx` and its test; `src/components/openui/notes/NotesView.tsx` and its test; `src/workspaces/hierarchy.ts` and its test; one line in `src/components/canvas/ExcalidrawCanvas.tsx` |

**Built earlier by a different session:** `src/ai/study/concept.ts`, `mastery.ts` (+ tests), and issue A in
`study.ts` and `NotesView.tsx`.
