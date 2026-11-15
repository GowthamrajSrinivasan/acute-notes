# Incident: kn-03 adjudicated record modified by another adjudicator (phase 3, 2026-11-13)

Investigation approved by the user (Phase 4 decision). The facts come from both adjudicators' own accounts (asked
separately, "facts only, modify nothing") and from the files.

## What happened

1. **The kn-03–kn-06 adjudicator wrote `phase3/adjudicated/kn-03-blue-green-deploy.json`.** In record c5 the golden
   reading read `{ "who": "golden", "verdict": "claim", "claimUnits": ["u10"] }`.
2. **The kn-07–kn-09 adjudicator ran this command in `phase3/adjudicated/`:**

   ```
   sed -i 's/{ "who": "golden", "verdict": "claim", /{ "who": "golden", "verdict": "link only (golden gives no binding)", /; s/{ "who": "golden", "verdict": "set", /…same…/' *.json
   ```

   It meant to relabel only its own three files (kn-07/08/09). The glob `*.json` also matched kn-03, where it rewrote
   c5's golden verdict to `"link only (golden gives no binding)"`. It reported this itself.
3. **Other files' content was untouched.** kn-01, kn-02 and kn-10 used `"verdict": "link"`, which the pattern doesn't
   match. `sed -i` rewrote their bytes anyway: they share an identical modification time (21:18:48).
4. **The kn-03–kn-06 adjudicator noticed kn-03 change on disk** and adopted the phrase for consistency. It sed-replaced
   its five `"claim"` golden verdicts in kn-04, and wrote the phrase directly in kn-05 and kn-06. These are deliberate
   edits to its own files.

## Original value

kn-03 c5 golden reading `verdict` = `"claim"`. Both the adjudicator's account and the sed pattern, which could only
match "claim" or "set", agree.

## Impact: none on any reported result

- **Golden links carry no binding.** A "claim" or "set" in a golden reading was a mislabel by the adjudicators; the
  replacement phrase is the more accurate one.
- **Nothing reads reading-level verdicts:** not `score.test.ts`, which uses the record verdict, status, claim link and
  note outcomes, and not `agreement.test.ts`, which reads golden links from `candidates.json`.
- **The record's own verdict (`claim`), status, claim link and note outcomes were not changed.**
- **`phase3/FREEZE-v2.json` was taken after the modification,** so it hashes the modified file. The snapshot is
  internally consistent and left as it is; this note is its correction record. No phase 3 number changes.

## Process fixes (in effect for phase 4)

- Each annotator and adjudicator may write **only the files it is named for**, by explicit path. No globs and no
  `sed -i` in shared folders.
- Golden readings carry `claimUnits` only, never a `verdict` field.
- Every annotation file is hashed on arrival, before anything else reads it.
