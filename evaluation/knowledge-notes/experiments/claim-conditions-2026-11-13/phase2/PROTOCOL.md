# Phase 2 labelling protocol (fixed 2026-11-13, before any labels or extractor code)

Decision (user, 2026-11-13): expand the independently reviewed set to kn-03–kn-12, and freeze labels and cases
before tuning. Offline: no paid model call and no new generation.

## Data

- **Sources:** the source units of each case as recorded in `recordings/2026-10-19-distil-gemini-flash/<case>/run.json`.
  Card citations refer to these ids. kn-12 uses its v1 source.
- **Generated notes:** the same recording's `plan.json`: distil Visualize, gemini-2.5-flash, recorded 2026-10-19 in an
  approved run. Saved output only.
- **Packets:** `packets/<case>.md` has each case's units, every node's reader-visible text and claimed citations, and the
  visible arrows.

## Split

| Set | Cases | Use |
|---|---|---|
| **Dev** | kn-01–kn-04 | Extraction rules and the clause detector may be tuned here. kn-01/kn-02 use the phase 1 records; kn-03/kn-04 are labelled below |
| **Final (frozen)** | kn-05–kn-12 | Labelled blind, then hashed into `FREEZE.json`. Scored once, after tuning on dev stopped. Never used for tuning; any later change to the extractor is reported as a new run against the same frozen labels |

kn-13 is left out, as the decision names kn-03–kn-12.

## What a reviewer labels (per case, blind)

Reviewers see the packet and the source only: not the golden `knowledge.json` or `evaluation.json`, the prototype code,
or anyone else's labels.

### 1. Records

A **record** is a condition that limits a claim: a bound, precondition, exception, scope limit, requirement-caveat or
deciding fact.
- **Claim and condition can be in different units, or the same unit** (an intra-sentence clause: if, unless, only,
  at most, until, within, except, while).
- **Leave out:** examples, elaborations, causes, chronology, attributions, and minor adjectives.
- **Aim:** the limits a careful reader must not lose.

Every record has a `binding`:

| Binding | When |
|---|---|
| `claim` | The claim's sentence becomes **false or misleading** in a case the condition describes |
| `set` | The claim stays true without it (the condition adds a cost, a scope note or a caveat); it must only be somewhere in the notes |

### 2. Card outcomes

For each record, the reviewer labels these by **reading the visible text**, whatever the citations say:

| Field | Meaning |
|---|---|
| `claimCards` | Nodes whose visible text states the claim |
| `carriers` | Nodes (any type, including frames) whose visible text conveys the condition: paraphrase is fine, but the specific limit (number, bound, exception, scope) must be recognisable |
| `perClaimCard` | One outcome per claim card, below |

| Outcome | Meaning |
|---|---|
| `carried` | The card's own text conveys it |
| `frame` | The card's parent frame's label or takeaway conveys it |
| `linked` | A visible arrow (either direction) joins the card to a carrier |
| `separated` | A carrier exists but isn't joined to the card |
| `absent` | No node conveys it |

**Citations never count as preservation** (the user's architectural requirement).

## Metrics (fixed now)

1. **Extraction:** extracted records vs. reviewed records.
   - A pair matches when their condition units overlap and their claim units overlap.
   - Report precision and recall, plus binding accuracy on matched pairs (`claim` vs. `set` confusion).
2. **Condition integrity:** per (claim card, `claim`-binding record), the checker's outcome vs. the reviewer's.
   - A failure is `separated` or `absent`.
   - Report precision and recall, with false positives and false negatives listed.
3. **Coverage:** per record, whether the checker finds a carrier vs. the reviewer's.
   - A gap is a record with no carrier.
   - Report precision and recall.
4. **Citation completeness, separate:**
   - Share of nodes with any citation.
   - Share of reviewer claim cards citing a claim unit.
   - Share of reviewer carriers citing a condition unit.
   - Never folded into 2 or 3.

Two settings are scored:
- **oracle records:** the checker given the reviewer's records, which isolates the clause detector;
- **end to end:** the checker given the extracted records.
