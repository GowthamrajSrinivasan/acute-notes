# Fixture 10: update series (knowledge-notes-plan §7.3)

`v1.md` → `v2.md`, one of each change a citation update must handle (§6.1, §7.1 "Updates"):

| Change | Where | Expected lineage | Card that cites it |
|---|---|---|---|
| Rename | `## Limits` → `## Constraints`, body identical | `unchanged`, not moved (the version's `pathIds`) | kept, a resolved flag stays resolved |
| Move | "Deploys drain one cache node…" from Operations to Writes | `unchanged`, moved | kept, proposed as a move |
| Edit | "…up to three times…" → "…up to five times…" | `changed` | resent (clean) or a conflict (edited by the user) |
| Deletion | "A miss falls through…" | `removed` | removal proposed (cites only it) or re-checked (cites it and more) |
| Duplicate | three "Check the logs carefully." → two; the one in Writes now sits after the moved sentence | Reads' pairs; Writes' and Operations' are `ambiguous`, never swapped | Needs review, never rewritten |
| Additions | "Reads are retried once…", "Rollbacks restore…" | `added` | new content for Reads and Operations |

Cards are described in `citations.fixture.test.ts` by the text they cite, so the fixture never depends on id numbering.
