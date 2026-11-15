# Unseen set — author draft vs reviewer labels

Written after the 2026-11-13 recording. Neither key was changed. The reviewer's labels (`labels.json`) are the
reference; the author's draft (`author-draft-key.json`) was never used for scoring.

| | Contradiction | Compatible | Ambiguous |
|---|---|---|---|
| Reviewer | 14 | 19 | 3 |
| Author draft | 14 | 18 | 4 |

The totals differ by one pair, but **four pairs** have different labels:

| ID | Statements | Author draft | Reviewer (reference) |
|---|---|---|---|
| u05 | "Reports are due on Monday." / "Reports are due on Friday." | ambiguous — which reports? | **contradiction** — the same unqualified deadline, no scope distinction |
| u10 | "The finance team reconciles invoices every Friday afternoon." / "Invoice reconciliation happens daily." | contradiction — weekly vs daily | **compatible** — neither excludes other days or other teams |
| u26 | "The team uses Postgres." / "The team uses MongoDB." | ambiguous — may use both | **compatible** — different workloads; no exclusivity claimed |
| u31 | "Each seat costs 12 euros a month." / "The whole plan costs 120 euros a month." | compatible — ten seats | **ambiguous** — the seat count and other charges are unspecified |

The comparison is kept here as it stands. Neither key is adjusted.
