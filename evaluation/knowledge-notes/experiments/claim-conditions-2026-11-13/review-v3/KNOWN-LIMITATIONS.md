# Known limitations of the claim–condition experiment code

## `remapRecord` (phase 1, `claimConditions.ts`): not a trusted lineage operation

Found 2026-11-14 while the Study Mode plan was being written.

**Defects:**
- **Ambiguous units are retired, not flagged.** An ambiguous lineage entry lists its old unit ids in `candidates`, not
  `from`. `remapRecord` looks units up by `from`, so it treats them as missing and returns `retired` instead of
  `needs_review`.
- **Missing lineage is treated as removal.** A unit absent from the lineage is `retired`. The safe answer is
  `needs_review`.

**Partial removal.** It retires a record when any one of its units is removed, where `planCitationUpdate` retires a
card only when all its units are. For a claim–condition link this stricter rule may be intended, but it hasn't been
decided.

**Impact:** none on any result.
- Phases 2–4 never remapped through lineage: all cases were labelled on one fixed source version.
- Its only caller is its own phase 1 test.
- Frozen snapshots are unaffected and unchanged.

**Guard:**
- The function carries `@deprecated` with this note.
- `review-v3/guards.test.ts` fails if anything outside this experiment imports it, or anything under `src/` imports
  from `evaluation/knowledge-notes/experiments/`.

**To use it again:** correct it, with a parity test against `planCitationUpdate` / `indexLineage` on the real
fixtures in `src/ai/reconcile/__fixtures__/update-series/`. Study Mode copies the `planCitationUpdate` logic instead
(`study-mode-implementation-plan.md`).
