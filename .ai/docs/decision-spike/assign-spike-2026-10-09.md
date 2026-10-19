# Spike — typed decision model for assign_to_topics (2026-10-09)

Labelled set from the 4 sample documents: restatements, extensions (one new fact) and unrelated notes, 34 parts. Typed model: `typesafe/jev-1.13` via `hostDecide`.

| answerer | right topic (or NEW) | …of unrelated parts → NEW | "adds nothing new" right | content lost (extension called nothing-new) | time per document | tokens |
|---|---|---|---|---|---|---|
| gpt-oss-120b (chat) | 100% (34/34) | 100% (8/8) | 85% (22/26) | 8% (1/13) | 17078 ms | 15294 |
| Gemini lite (chat) | 100% (34/34) | 100% (8/8) | 27% (7/26) | 46% (6/13) | 1581 ms | 12591 |
| local heuristic | 47% (16/34) | 100% (8/8) | n/a | n/a | ~0 | — |
| Jev (typed) | 100% (34/34) | 100% (8/8) | 100% (26/26) | 0% (0/13) | 972 ms | 91747 |

Content lost matters most: a part wrongly judged to add nothing is dropped from the merge.

## Per part

### cmg-verify-cheatsheet.txt — 8 topics, 10 parts (chat gpt-oss 21013 ms, Gemini lite 1641 ms, Jev 1182 ms for all parts in parallel, avg 1000 ms per request)

| part | truth | gpt-oss | Gemini lite | local | Jev (conf) | Jev says nothing-new |
|---|---|---|---|---|---|---|
| rest-1 | restatement: cmg-verify cheat sheet | cmg-verify cheat sheet (nn) | cmg-verify cheat sheet | cmg-verify cheat sheet | cmg-verify cheat sheet (1.00) | yes |
| ext-1 | extension: cmg-verify cheat sheet | cmg-verify cheat sheet | cmg-verify cheat sheet (nn) | NEW ✗ | cmg-verify cheat sheet (0.84) | no |
| rest-2 | restatement: Checks 0–7 | Checks 0–7 | Checks 0–7 | Checks 0–7 | Checks 0–7 (1.00) | yes |
| ext-2 | extension: Checks 0–7 | Checks 0–7 | Checks 0–7 | NEW ✗ | Checks 0–7 (0.89) | no |
| rest-3 | restatement: Hook points (the deter | Hook points (the deter | Hook points (the deter | Hook points (the deter | Hook points (the deter (1.00) | yes |
| ext-3 | extension: Hook points (the deter | Hook points (the deter | Hook points (the deter (nn) | NEW ✗ | Hook points (the deter (1.00) | no |
| rest-4 | restatement: A1–A6 codes (what happ | A1–A6 codes (what happ | A1–A6 codes (what happ | A1–A6 codes (what happ | A1–A6 codes (what happ (1.00) | yes |
| ext-4 | extension: A1–A6 codes (what happ | A1–A6 codes (what happ | A1–A6 codes (what happ | NEW ✗ | A1–A6 codes (what happ (1.00) | no |
| new-1 | unrelated: NEW | NEW | NEW | NEW | NEW (1.00) | no |
| new-2 | unrelated: NEW | NEW | NEW | NEW | NEW (1.00) | no |

### handoff-status.md — 5 topics, 10 parts (chat gpt-oss 20433 ms, Gemini lite 1694 ms, Jev 1070 ms for all parts in parallel, avg 975 ms per request)

| part | truth | gpt-oss | Gemini lite | local | Jev (conf) | Jev says nothing-new |
|---|---|---|---|---|---|---|
| rest-1 | restatement: Overview | Overview (nn) | Overview | NEW ✗ | Overview (1.00) | yes |
| ext-1 | extension: Overview | Overview | Overview (nn) | NEW ✗ | Overview (0.99) | no |
| rest-2 | restatement: Tests before the hand- | Tests before the hand- (nn) | Tests before the hand- | NEW ✗ | Tests before the hand- (1.00) | yes |
| ext-2 | extension: Tests before the hand- | Tests before the hand- | Tests before the hand- (nn) | NEW ✗ | Tests before the hand- (1.00) | no |
| rest-3 | restatement: Branches and worktrees | Branches and worktrees (nn) | Branches and worktrees | Branches and worktrees | Branches and worktrees (1.00) | yes |
| ext-3 | extension: Branches and worktrees | Branches and worktrees | Branches and worktrees (nn) | NEW ✗ | Branches and worktrees (1.00) | no |
| rest-4 | restatement: What's built | What's built (nn) | What's built | What's built | What's built (1.00) | yes |
| ext-4 | extension: What's built | What's built | What's built (nn) | NEW ✗ | What's built (1.00) | no |
| new-1 | unrelated: NEW | NEW | NEW | NEW | NEW (1.00) | no |
| new-2 | unrelated: NEW | NEW | NEW | NEW | NEW (1.00) | no |

### decision-table-reply.txt — 1 topics, 4 parts (chat gpt-oss 7980 ms, Gemini lite 1216 ms, Jev 660 ms for all parts in parallel, avg 621 ms per request)

| part | truth | gpt-oss | Gemini lite | local | Jev (conf) | Jev says nothing-new |
|---|---|---|---|---|---|---|
| rest-1 | restatement: Overview | Overview (nn) | Overview | Overview | Overview (1.00) | yes |
| ext-1 | extension: Overview | Overview | Overview | NEW ✗ | Overview (1.00) | no |
| new-1 | unrelated: NEW | NEW | NEW | NEW | NEW (1.00) | no |
| new-2 | unrelated: NEW | NEW | NEW | NEW | NEW (1.00) | no |

### unit-checks-reply.md — 7 topics, 10 parts (chat gpt-oss 18884 ms, Gemini lite 1773 ms, Jev 974 ms for all parts in parallel, avg 906 ms per request)

| part | truth | gpt-oss | Gemini lite | local | Jev (conf) | Jev says nothing-new |
|---|---|---|---|---|---|---|
| rest-1 | restatement: 1. Units (Check 3a v3) | 1. Units (Check 3a v3) (nn) | 1. Units (Check 3a v3) | 1. Units (Check 3a v3) | 1. Units (Check 3a v3) (1.00) | yes |
| ext-1 | extension: 1. Units (Check 3a v3) | 1. Units (Check 3a v3) | 1. Units (Check 3a v3) | NEW ✗ | 1. Units (Check 3a v3) (1.00) | no |
| rest-2 | restatement: 2. Wording (Check 1-pr | 2. Wording (Check 1-pr (nn) | 2. Wording (Check 1-pr | NEW ✗ | 2. Wording (Check 1-pr (1.00) | yes |
| ext-2 | extension: 2. Wording (Check 1-pr | 2. Wording (Check 1-pr | 2. Wording (Check 1-pr | NEW ✗ | 2. Wording (Check 1-pr (1.00) | no |
| rest-3 | restatement: How it stays safe | How it stays safe (nn) | How it stays safe | NEW ✗ | How it stays safe (1.00) | yes |
| ext-3 | extension: How it stays safe | How it stays safe | How it stays safe | NEW ✗ | How it stays safe (1.00) | no |
| rest-4 | restatement: Tests | Tests (nn) | Tests | NEW ✗ | Tests (1.00) | yes |
| ext-4 | extension: Tests | Tests (nn) | Tests | NEW ✗ | Tests (1.00) | no |
| new-1 | unrelated: NEW | NEW | NEW | NEW | NEW (1.00) | no |
| new-2 | unrelated: NEW | NEW | NEW | NEW | NEW (1.00) | no |
