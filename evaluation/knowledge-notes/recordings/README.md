# Recordings

Real model output for the golden cases, recorded once in an **approved** run and replayed offline by
`npm run test:golden`. Empty until the first run is approved.

One directory per run, `YYYY-MM-DD-<name>/`:

```
2026-11-02-distil-gemini-flash/
  meta.json                      recording-meta.schema.json: approvedBy, provider, model, pipeline {noteModel, promptVersion, appVersion}, gate, cases[]
  kn-01-idempotency-keys/plan.json        the merged, validated VisualPlan of the Visualize run
  kn-01-idempotency-keys/scene.json       the accepted canvas (elements + documents): Lens is derived from it offline
  kn-01-idempotency-keys/run.json         optional: KnowledgeRunOutput without the plan (units, cites, omitted, accounting, flags)
  kn-08-helpdesk-answers-hld-lld/lens.json optional: a normalised Lens projection (else derived from scene.json)
  kn-12-flag-rollout-update/scene-before.json the v1 canvas with the user's edit; with scene.json gives the update outcome
  kn-12-flag-rollout-update/reconcile.json optional: a normalised update outcome (else derived from the two scenes)
  …/replies.json                 optional: the raw replies (prompt + reply per AI call), for debugging
  <case>/attempt-N/…             when a case is recorded several times (`attempt` in meta.json)
```

Made by `e2e/ai/recordGolden.spec.ts`, which refuses to run unless the approved run is named
(`GOLDEN_RECORD_RUN=YYYY-MM-DD-name`, a new directory) and its approver given (`GOLDEN_RECORD_APPROVED_BY`); the
command is in the dataset README. `npm run test:golden` replays every directory here; `UPDATE_GOLDEN=1` writes the
per-gate results to `reports/gates.md`. Test fixtures never go here: the replay tests write synthetic runs to a
temporary directory.

Rules:
- Never re-record silently. A prompt, model or pipeline change is a **new** run directory with its own approval.
- `gate: false` (default for a first run): reported only. Set `gate: true` once the run's results have been reviewed
  and it should hold the line.
- Each case is recorded 3 times per run when it is used for a release gate (knowledge-notes-plan §7.3); critical
  gates must hold on every one.
