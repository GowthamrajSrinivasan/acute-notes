# Recordings

Real model output for the golden cases, recorded once in an **approved** run and replayed offline by
`npm run test:golden`. Empty until the first run is approved.

One directory per run, `YYYY-MM-DD-<name>/`:

```
2026-11-02-distil-gemini-flash/
  meta.json                      recording-meta.schema.json: approvedBy, provider, model, pipeline {noteModel, promptVersion, appVersion}, gate, cases[]
  kn-01-idempotency-keys/plan.json        the merged, validated VisualPlan of the Visualize run
  kn-08-helpdesk-answers-hld-lld/lens.json the normalised Lens projection of the accepted canvas
  kn-12-flag-rollout-update/reconcile.json the normalised update outcome
  …/replies.json                 optional: the raw per-section replies, for debugging
```

Rules:
- Never re-record silently. A prompt, model or pipeline change is a **new** run directory with its own approval.
- `gate: false` (default for a first run): reported only. Set `gate: true` once the run's results have been reviewed
  and it should hold the line.
- Each case is recorded 3 times per run when it is used for a release gate (knowledge-notes-plan §7.3); critical
  gates must hold on every one.
