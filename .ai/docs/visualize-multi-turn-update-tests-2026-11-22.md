# Multi-turn update tests: tables, flows, metrics and cards (2026-11-22)

Three manual tests for "Merge into existing notes" (intelligent update engine plan §17). Each test visualizes one source, then sends
**three more updates** to the same notes. Each test aims at a different kind of visual block, so you can see whether the engine:

- finds the right element (the table cell, the step's text, the card), and
- edits it where it is, without adding a second copy next to it.

**Nothing 
here has been run.** The "Expected" columns are predictions from the §17 design and the section-kind rules
(`src/ai/visual-plan/sectionKinds.ts`), not recorded results. Rows marked **Probe** cover cases the design doesn't clearly settle.
Record what actually happens for those.

## Setup (once)

1. Restart the dev server so `.env.development` is loaded. `NEXT_PUBLIC_TOPIC_MERGE=on` makes "Merge into existing notes" appear.
2. In AI settings, make AICredits with `openai/gpt-oss-120b` your primary connection, the same as the MCP test.
3. Leave the decision model in `.env.local` as it is (`ACUTE_AI_DECISION_*`). Statement matching (`match_statements`) asks it first.
   If it fails, the app falls back to word overlap, and the review says so. Note any turn where that happens.
4. The consistency panel is off by default (§17.5), so there's no chip to open. Every change is reviewed in the review bar.
5. **Use a new, empty canvas for each test.** Otherwise one test's updates could be routed to another test's notes.

**Each turn:**

- **Turn A:** go to **More → Visualize content…** and paste the source. The canvas is empty, so it's a plain Visualize. Check what
  it drew, then **Accept all**.
- **Turns B, C and D:** go to **More → Visualize content…**, paste the update, choose **Merge into existing notes** and pick the
  test's notes under "Notes to merge into". Run it. Before accepting, read the review bar line
  (`+N new · −N removed · ~N updated · N links changed`) and the rows under it. Then **Accept all**.
- Take a screenshot after each accept. The checks compare against the state before that turn.

**Cost:** each turn is one Visualize run plus at most one `match_statements` decision call. That's 12 runs across the three tests,
cents in total on gpt-oss-120b.

## What "updated properly" means in every turn

These come from §17.3. They apply to every B, C and D turn, on top of each test's own rows.

| # | Check | Pass when |
|---|---|---|
| G1 | No second copy | The changed fact appears **once**: the old value is gone and the new one is in the same element. |
| G2 | No new frame | No new section or frame appears beside the existing notes. If one does, the part was filed as a new topic (§17.1 cause 3). |
| G3 | No choice boxes | No "Needs your call" callout or option cards appear. A contradiction replaces its statement. |
| G4 | Repeats are left out | A sentence that only repeats an existing fact changes nothing. |
| G5 | Exceptions sit beside their rule | A narrower exception is **added** next to its rule. The rule itself stays unchanged. |
| G6 | Untouched elements stay untouched | Elements the update doesn't mention keep their text, position, size and links. |
| G7 | Review line matches the canvas | The `+N new / ~N updated` counts match what changed on the canvas. A pure-revision turn shows `+0 new`. |
| G8 | Undo works | One Undo after the accept restores the previous turn's state exactly. Try it once per test, then redo. |

## Before you start: check what Turn A drew

The outline model chooses each section's kind once (**U3**). Updates keep whatever the first Visualize drew. If Turn A draws a
different kind from the one the test expects, write down what it drew and run the test anyway. The "Target element" column then
points at that block's equivalent element, for example a bullet on a card instead of a table cell.

---

## Test 1: comparison table (plans × attributes)

**What it exercises:** single-cell edits (Stage 1d), a new attribute row, an exception beside its rule, and a new entity column.
The source is prose on purpose. The comparison rule merges facts scattered across the text into one table, and updates then patch
that table's cells.

### Turn A: source

```
# Lumen Drive plans

The Free plan includes 5 GB of storage and 1 user. Free files are kept in trash for 7 days. Free support is community forum only. The Free plan costs nothing.

The Team plan includes 100 GB of storage per user and up to 50 users. Team files stay in trash for 30 days. Team support is by email within 24 hours. The Team plan costs $8 per user per month.

The Enterprise plan has unlimited storage and unlimited users. Enterprise trash is kept for 90 days. Enterprise support is by phone, 24/7. Enterprise pricing is by quote.
```

**Expected drawing:** one comparison section holding **one table**, with columns `"" | Free | Team | Enterprise` and rows for
Storage, Users, Trash, Support and Price. A text card beside the table is possible. There should be no card per plan.

### Turn B: values change

```
# Lumen Drive pricing update, March

The Team plan now includes 200 GB of storage per user.
The Team plan costs $10 per user per month.
The Free plan includes 5 GB of storage and 1 user.
```

| Statement | Expected match | Target element | Expected on canvas |
|---|---|---|---|
| Team 200 GB storage | replaces | Storage row, Team cell | `100 GB per user` becomes `200 GB per user`. Other cells unchanged. |
| Team $10 | replaces | Price row, Team cell | `$8 per user per month` becomes `$10 per user per month`. |
| Free 5 GB, 1 user | repeats | none | Nothing. |

Review line: `+0 new · ~1 updated`, because the table is one object. The rows list a cell edit like `row N, column 3: replaces …`.

### Turn C: new attribute, flip, exception

```
# Lumen Drive security and retention changes

All plans now support two-factor authentication.
Free files are now kept in trash for 14 days.
Enterprise support is by phone during business hours only.
Nonprofit teams get the Team plan free for up to 10 users.
```

| Statement | Expected match | Target element | Expected on canvas |
|---|---|---|---|
| Two-factor for all plans | new | Table, new row | **Probe.** Best case: a new "Two-factor authentication" row filled for all three plans, in the **same** table. Adding a row rewrites the whole table (Stage 1d), so check that the other cells survive word for word. Acceptable: a sentence in the text card beside the table. **Fail:** a second table. |
| Free trash 14 days | replaces | Trash row, Free cell | `7 days` becomes `14 days`. |
| Enterprise support, business hours | replaces (same-subject flip) | Support row, Enterprise cell | `phone, 24/7` becomes `phone, business hours only`. |
| Nonprofit Team free ≤ 10 users | exception | Price row, Team cell, or a note beside | The rule (`$10 per user per month`) **stays**. The exception is added beside it, in the cell or in the text card. **Fail:** the price replaced by "free". |

### Turn D: paraphrase, extension, new entity

```
# Lumen Drive notes from the sales call

Enterprise customers get as much storage as they need.
Team email support now also covers weekends.
A new Starter plan includes 30 GB of storage and up to 3 users for $4 per month; Starter trash is kept for 14 days.
```

| Statement | Expected match | Target element | Expected on canvas |
|---|---|---|---|
| Enterprise storage "as much as they need" | repeats (paraphrase of "unlimited") | none | Nothing. **Probe:** a paraphrase with no shared number or negation may come back as `adds`. If so, write down what it added. |
| Team email support covers weekends | adds | Support row, Team cell | The cell keeps "email within 24 hours" and gains "also weekends". |
| Starter plan | new | Table, new column | **Probe.** Best case: a `Starter` column with Storage, Users, Price and Trash filled, and Support **empty** because the source doesn't say. That's a whole-table rewrite, so check that all earlier edits (200 GB, $10, 14 days, business hours, the nonprofit exception, weekends) survive. **Fail:** a separate Starter card or table, or any earlier edit lost. |

**Optional Turn E (known gap U2):** paste the Starter plan as a markdown table instead of prose. Expected: it is filed whole and
appended as a second table. This is the documented U2 gap, not a new bug. Only record it if it behaves differently.

---

## Test 2: flow (steps as shapes, details in linked text)

**What it exercises:** edits inside a step's linked `explained_by` text, a step inserted between two others (the link changes), an
exception attached to one step, and a step being renamed. This is the hardest of the three: step order is carried by the links, and
§17's "new" statements go to the end of the topic, not into the middle.

### Turn A: source

```
# Release pipeline

Every release goes through these steps, in this order.

1. Build: CI compiles the app and runs the unit tests. A build takes about 8 minutes.
2. Staging deploy: the build is deployed to the staging cluster automatically.
3. QA sign-off: a QA engineer runs the smoke suite and signs off in the release ticket.
4. Production deploy: the release manager deploys to production on Tuesdays only.
5. Monitoring: the on-call engineer watches error rates for 2 hours after the deploy.
```

**Expected drawing:** one flow section with 5 shapes (Build, Staging deploy, QA sign-off, Production deploy, Monitoring), chained
with `flows_to` arrows in that order. Each shape links to a text node through `explained_by` holding its detail.

### Turn B: details change inside steps

```
# Pipeline changes, sprint 42

A build now takes about 5 minutes.
Production deploys can happen on Tuesdays and Thursdays.
The on-call engineer watches error rates for 4 hours after the deploy.
The build is deployed to the staging cluster automatically.
```

| Statement | Expected match | Target element | Expected on canvas |
|---|---|---|---|
| Build ~5 min | replaces | Build's text node | `about 8 minutes` becomes `about 5 minutes`. The Build shape's label is unchanged. |
| Tue and Thu deploys | replaces | Production deploy's text node | `on Tuesdays only` becomes `on Tuesdays and Thursdays`. |
| Watch 4 hours | replaces | Monitoring's text node | `2 hours` becomes `4 hours`. |
| Staging automatic | repeats | none | Nothing. |

Review line: `+0 new · ~3 updated · 0 links changed`. All 5 shapes and 4 arrows stay where they are.

### Turn C: a step inserted in the middle, plus an exception

```
# Security review added to the pipeline

After QA sign-off and before the production deploy, a security review now runs: the security team scans dependencies and must approve the release.
Hotfixes skip QA sign-off but still need the security review.
```

| Statement | Expected match | Target element | Expected on canvas |
|---|---|---|---|
| Security review between QA and Production | new (or adds to QA / Production) | New shape plus its text | **Probe.** Best case: a new "Security review" shape, with the arrows rewired QA → Security review → Production (the old QA → Production arrow gone, `2 links changed`) and its own text node. Likely risk: the shape is added at the **end**, after Monitoring, because §17 places `new` statements at the end of the topic. Record which happened. **Fail:** a second copy of the whole flow, or a new frame. |
| Hotfixes skip QA | exception | QA sign-off's text node, or beside it | The QA rule ("a QA engineer runs the smoke suite…") **stays**. The hotfix exception is added beside it. **Fail:** the QA step removed or its text replaced. |

### Turn D: a step renamed, an actor changed, a paraphrase

```
# Pipeline simplification

Staging is retired: the build now deploys automatically to a short-lived preview environment instead of the staging cluster.
Monitoring is now done by the rollback bot instead of the on-call engineer; it rolls back the release if the error rate goes above 2%.
A QA engineer runs the smoke suite and signs off in the release ticket.
```

| Statement | Expected match | Target element | Expected on canvas |
|---|---|---|---|
| Preview environment instead of staging | replaces | Step 2's text node, and maybe its shape label | The text says preview environment, and "staging cluster" is gone. **Probe:** whether the shape label changes from "Staging deploy" to something like "Preview deploy". A label left as "Staging deploy" while its text says "preview" is a partial pass. Write it down. |
| Rollback bot replaces on-call | replaces (plus adds the 2% rule) | Monitoring's text node | `the on-call engineer` becomes `the rollback bot`. The 4-hour watch from Turn B is either kept or dropped deliberately (the source doesn't restate it), and the 2% rollback rule is added. **Check:** the 4 h from Turn B isn't silently reverted to 2 h. |
| QA signs off in the ticket | repeats | none | Nothing. The hotfix exception from Turn C is still there. |

**Final state to check:** 5 or 6 shapes, a single chain with no orphaned arrow, and every Turn B and C edit still present.

---

## Test 3: mixed metrics table, chart and cards

**What it exercises:** one update touching **two block kinds in the same notes**. A metrics table gets a corrected value and a new
row, which the linked `acute-chart` should follow. Parallel cards get replaces, adds and an exception. It also checks that each
statement reaches the right **section**, not just the right element.

### Turn A: source

```
# Support desk weekly report

## Weekly metrics

In week 1 the desk opened 420 tickets, the median first response was 3.1 hours and CSAT was 88%.
In week 2 the desk opened 465 tickets, the median first response was 2.8 hours and CSAT was 90%.
In week 3 the desk opened 510 tickets, the median first response was 2.5 hours and CSAT was 91%.

## Teams

Tier 1 handles password resets and account access. Tier 1 is staffed from 8 am to 8 pm every day.
Tier 2 handles bugs and integrations. Tier 2 is staffed from 9 am to 5 pm on weekdays.
Billing handles refunds and invoices. Refunds over $500 need a manager's approval.
```

**Expected drawing:**

- **Weekly metrics:** a metrics section with one table, a row per week and columns Tickets opened, Median first response and CSAT.
  It probably also has a linked `acute-chart` (line, W1–W3), since the weeks are an ordered series.
- **Teams:** a cards section with 3 cards (Tier 1, Tier 2, Billing), with bullets in the source's own words.

### Turn B: a correction and a new week (metrics only)

```
# Support desk corrections

Week 3 actually opened 498 tickets, not 510.
In week 4 the desk opened 530 tickets, the median first response was 2.4 hours and CSAT was 92%.
Tier 1 handles password resets and account access.
```

| Statement | Expected match | Target element | Expected on canvas |
|---|---|---|---|
| W3 498 tickets | replaces | Metrics table, W3 row, Tickets cell | `510` becomes `498`. W3's other cells are unchanged. |
| W4 row | new | Metrics table, new row | **Probe.** A W4 row is added to the **same** table (a whole-table rewrite, so check W1–W3 survive, including 498). |
| Chart | follows the table | Linked chart | **Probe.** The chart shows 498 for W3 and has a W4 point. A chart that still shows 510 or lacks W4 is a **stale chart**. Record it as its own finding: the table is the primary record and the chart is derived from it. |
| Tier 1 duty | repeats | none | Nothing. **The Teams cards don't change.** |

### Turn C: card edits (cards only)

```
# Support team changes

Tier 2 is now staffed from 9 am to 9 pm on weekdays.
Refunds over $1,000 need a manager's approval.
Billing also handles tax exemption certificates.
```

| Statement | Expected match | Target element | Expected on canvas |
|---|---|---|---|
| Tier 2 hours | replaces | Tier 2 card, hours bullet | `9 am to 5 pm` becomes `9 am to 9 pm`. "on weekdays" is kept. |
| Refund threshold $1,000 | replaces | Billing card, refunds bullet | `$500` becomes `$1,000`. |
| Tax exemption certificates | adds | Billing card | A new bullet on the **Billing** card, next to refunds and invoices. **Fail:** it lands on Tier 1 or Tier 2, or on a new card. |

**The metrics table and chart don't change.** Review line: `+0 new · ~2 updated`.

### Turn D: one update across both sections

```
# Support desk notes from the ops review

Tier 1 also handles MFA resets.
The CSAT target is 90%; any week below target needs a review.
Refunds on annual plans always need a manager's approval, whatever the amount.
Week 2 CSAT was 90%.
```

| Statement | Expected match | Target element | Expected on canvas |
|---|---|---|---|
| Tier 1 MFA resets | adds | Tier 1 card | A bullet added to the Tier 1 card (or "MFA resets" joins the existing duty bullet). |
| CSAT target 90% | new, in **Weekly metrics** | Text beside the metrics table | **Probe.** A note beside the table, in the metrics section. **Fail:** it lands on a team card or becomes a new frame. A good analysis note would point out that W1 (88%) is below target. That's a bonus, not required. |
| Annual-plan refunds | exception | Billing card | The `$1,000` rule **stays**, and the annual-plan exception is added beside it. **Fail:** the threshold rule replaced. |
| W2 CSAT 90% | repeats | none | Nothing. |

Review line: `+0 new` (or `+1 new` if the CSAT target becomes its own text node in the metrics section), and `~2 updated` or more.

---

## Results (fill in)

| Test | Turn | Drew / matched as expected? | G1–G8 | Review line seen | Notes (probe outcomes, fallbacks, wrong targets) |
|---|---|---|---|---|---|
| 1 Table | A | | n/a | | Kind drawn: |
| 1 Table | B | | | | |
| 1 Table | C | | | | Two-factor row: |
| 1 Table | D | | | | Starter column: |
| 2 Flow | A | | n/a | | Kind drawn: |
| 2 Flow | B | | | | |
| 2 Flow | C | | | | Security review position: |
| 2 Flow | D | | | | Step 2 label: |
| 3 Mixed | A | | n/a | | Kinds drawn: |
| 3 Mixed | B | | | | Chart follows table? |
| 3 Mixed | C | | | | |
| 3 Mixed | D | | | | CSAT target placement: |

## How to read the outcomes

- **Wrong target** (an edit landed on the wrong cell, card or step): this is the most important failure. Record the statement, the
  intended target and where it landed. It's a `match_statements` or assignment bug.
- **Second copy beside the original** (G1 or G2 failed): a regression of §17.1. Note whether the review said the decision model
  fell back to word overlap.
- **Exception replaced its rule** (G5 failed): the exception guard (`guarded`, < 0.6 overlap) didn't hold. Record both sentences.
- **New element in the wrong place**, such as a new flow step at the end or a new row at the bottom: expected for `new` statements in
  §17. It's a placement gap, not a matching bug, unless the element lands in the wrong section.
- **Stale chart:** the table updated but its chart didn't. That's a separate gap from statement matching.
- **Pasted tables appended whole:** known gap U2. Not a new bug.
- **Section kind differs from the test's assumption:** known U3. Re-read the rows against the kind that was drawn.
