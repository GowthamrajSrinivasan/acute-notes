I've stopped at hand-off 1. Phases 1 and 2 are built and committed on the `-sr3` branches. I haven't merged into `feat/results-dictionary`, told Chat B, or pushed anything; that waits for your go. I also haven't started the scripted answerer or Phase 9a.

**Tests before the hand-off**
- `dotnet build` for cmg-sr3: 0 warnings, 0 errors.
- `pixi run verify-ci` passes, with results identical to the untouched base commit (388518a): 32/32 fixtures, 1628/1628 field checks. The type-check is clean.
- I also replayed the new trace through Layer A with and without the dictionary fields: 0 differences.
- The 5 new data-service tests pass, and so do its commit hooks.

**Branches and worktrees** (new worktrees, so your existing checkouts are untouched)
- cmg-code: `../cmg-code-results-dictionary-sr3` on `feat/results-dictionary-sr3`, 3 commits. I created `feat/results-dictionary` at 388518a, because the cmg-verify code isn't on `main`.
- data-service: `../data-service-results-dictionary`, 1 commit on `feat/results-dictionary-sr3`. I kept that commit off `feat/results-dictionary` (which sits at `origin/main`) to follow the "don't commit to it directly" rule.

**What's built**
- **Phase 1:** a data-service export script writes the dictionary as JSON, with `schema_version`, a content hash and a collapse report. Result: 4020 keywords, 0 conflicts.
- It's pinned in `scripts/dist-pins.json` as `18-a22b2e607694`.
- `pixi run sr3-dictionary` makes the gitignored local copy. `dist-stage` stages it into `mcp-bin/`: a stale copy fails the stage, and a missing one only warns while the shipping question is open.
- All 32 registry keywords have a deterministic quantity.
- **Phase 2:** every variable and curve now carries `quantity`, `phase`, `conditions`, `dictSource` and `dictVersion`. In a live run that was all 556 variables on the tutorial pair.
- A missing or unreadable snapshot marks every curve `dictSource: "unavailable"`, and the server still starts.
- There's no measurable slowdown; loading the snapshot adds about 165 ms at startup.
- **Fixture trace for Chat B:** `eval-fixtures/traces/base-water-enriched.yaml` holds 17 real BASE/WATER calls. The eval runner doesn't replay files in that subfolder. The script that captured it is in `scripts/verify-harness/`.

**Things that differ from the plan or need a decision**
1. **Name lookup.** SR3 gives no keyword for 73 of the 141 distinct variables (Water Cut SC, `Liquid Prod Rate SCTR`, the monthly rates…). A keyword-only lookup would leave half of each file unclassified, so those variables are looked up by exact name. For Chat B: a curve with `keyword: ""` was matched by name.
2. **`list_variables` output is 3.2× larger** (68k → 216k characters over 10 listings), which means more tokens every session. I followed the plan's layout. It could be cut by putting `dictVersion` once per response and shortening `dictSource`, but that changes the format Chat B consumes, so it should be decided before Phase 4.
3. **Water Cut's quantity comes from Gemini.** Under the proposed rule (gate only on deterministic fields), Water Cut will be "not checked" unless `variable_overrides` confirms it. The breakthrough ask (A4) depends on it.
4. **Wrong phase in the dictionary.** `LIQRATSC` and `Liquid Prod Rate SCTR` are deterministically marked `phase: OIL`, which is wrong for a liquid rate. The existing `variable_overrides` draft already covers the first.
5. **`dictSource` has a fourth value, `CONFLICT`.** It's used when collapsed rows disagree. None do today, and it fails closed.

**Status tracker:** no rows changed. None of the 37 rows belongs to Phase 1 or 2: the dictionary rows land in Phase 4, and my rows (#25, #27) are Phase 9.

Shall I do hand-off 1 now: merge both `-sr3` branches into `feat/results-dictionary` and tell Chat B the trace is ready? Then I'd continue with the scripted answerer, the H5.5 harness and Phase 9a.

Separately, the GitHub connection failed with a bad authorization header, and the Figma, HubSpot, Lucid and NetSuite connectors need authorizing in your claude.ai connector settings. None of this work needed them.
