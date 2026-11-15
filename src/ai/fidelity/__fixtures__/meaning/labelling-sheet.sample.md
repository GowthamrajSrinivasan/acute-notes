# Paraphrase labelling sheet (rubric v2, second-labeller sample)

Each row is a **source** sentence and a **card** that restates it. For every row, answer one question:

> Would a reader of the card alone come away believing something the source does not say?

Fill in the **Answer** column with exactly one word, and the **Note** column where asked. Do not change any other column, the order of rows, or the numbers.

| Answer | Use when |
|---|---|
| `faithful` | The card says what the source says, in other words, possibly shorter. A reader who acts on the card makes the same decision as one who read the source. Shorter is fine; stronger, wider, reversed or new is not. |
| `distorted` | You can name the false belief in one sentence: a hedge removed, a condition or scope dropped or widened, a negation flipped, cause and effect swapped or reversed, a number or unit changed, a cost dropped or inverted, an absolute added. Put that sentence in Note. |
| `partly` | Mostly right, but one detail a careful reader might care about is lost or bent, and you can't point to a clearly false claim. Note why (required). |
| `unsure` | You can't decide. Note what you'd need to know (required). |

Rules: judge meaning, not style. The card stands alone: don't fill in from the source. One false belief is enough. Hedges are equivalent within their class (can / may / might / could / sometimes / often; usually / typically / generally / in most cases); a hedge turned into a certainty is distorted. Numbers are exact after formatting (`1,000` = `1000` = one thousand; `200 ms` = 200 milliseconds); a different number or unit, or a range collapsed to one end, is distorted. A requirement for N means at least N unless an exact count is stated ("two approvals are required" = "at least two"); a limit is different ("up to 3" → "3" is distorted). When unsure, say so instead of guessing.

| # | Source | Card | Answer | Note |
|---|---|---|---|---|
| P001 | Builds typically take 6 to 8 minutes. | Builds take 8 minutes. |  |  |
| P002 | Feature flags can reduce the risk of a bad release. | Feature flags remove the risk of a bad release. |  |  |
| P003 | The migration tool does not modify the original files. | The migration tool modifies the original files in place. |  |  |
| P004 | Because the index was rebuilt, queries are faster this week. | Queries are slower this week because the index was rebuilt. |  |  |
| P005 | A larger context window improves recall while raising token costs. | Bigger context windows recall more but cost more tokens. |  |  |
| P006 | Response times stay under 200 milliseconds for 95% of requests. | 95% of requests complete in under 200 ms. |  |  |
| P007 | Some customers prefer exporting reports as CSV rather than PDF. | Some customers would rather export reports to CSV than PDF. |  |  |
| P008 | Smaller containers start faster but have less headroom for traffic spikes. | Small containers boot quickly, with less headroom for traffic spikes. |  |  |
| P009 | The plan includes 1,000 API calls per day. | The plan includes 10,000 API calls per day. |  |  |
| P010 | The export does not include comments. | Comments are left out of the export. |  |  |
| P011 | The scheduler doesn't run jobs on public holidays. | The scheduler runs jobs on public holidays as well. |  |  |
| P012 | Voice notes are transcribed automatically, but the transcripts are not reviewed by a person. | Voice notes are transcribed automatically and checked by a person. |  |  |
| P013 | The beta adds offline editing, though changes made offline may conflict with edits from others. | Beta: offline editing, with possible conflicts against others' edits. |  |  |
| P014 | Because the index was rebuilt, queries are faster this week. | Queries are faster this week thanks to the rebuilt index. |  |  |
| P015 | The new pricing applies to customers who sign up after 1 March. | The new pricing applies to all customers. |  |  |
| P016 | Students can resubmit an assignment provided the deadline has not passed. | Assignments may be resubmitted as long as the deadline is still open. |  |  |
| P017 | The form saves a draft whenever the user leaves a field. | Each time the user leaves a field, the form saves a draft. |  |  |
| P018 | Thumbnails are generated in roughly 2 seconds. | Thumbnails are generated in 20 seconds. |  |  |
| P019 | When a pull request touches the schema, a database reviewer must approve it. | A database reviewer must approve every pull request. |  |  |
| P020 | Audit logs are kept for 90 days in regulated tenants. | Regulated tenants keep audit logs for 90 days. |  |  |
| P021 | Changing the theme does not reload the page. | The page stays loaded when the theme changes. |  |  |
| P022 | Tighter alert thresholds reduced the number of missed incidents. | Tighter alert thresholds increased the number of missed incidents. |  |  |
| P023 | Reports refresh every 15 minutes, except during the nightly maintenance window. | Reports update every 15 minutes outside the nightly maintenance window. |  |  |
| P024 | Reports refresh every 15 minutes, except during the nightly maintenance window. | Reports refresh every 15 minutes. |  |  |
| P025 | Smaller containers start faster but have less headroom for traffic spikes. | Smaller containers start faster. |  |  |
| P026 | Automatic backups run only for paid plans. | Automatic backups run for every plan. |  |  |
| P027 | Tighter alert thresholds reduced the number of missed incidents. | Tightening alert thresholds led to fewer missed incidents. |  |  |
| P028 | Audit logs are kept for 90 days in regulated tenants. | Audit logs are kept for 90 days. |  |  |
| P029 | Reviewers usually respond within one business day. | Reviewers respond within one business day. |  |  |
| P030 | Voice notes are transcribed automatically, but the transcripts are not reviewed by a person. | Voice notes get automatic transcripts that no person reviews. |  |  |
| P031 | Orders ship the same day if they are placed before 2 pm. | Orders always ship the same day. |  |  |
| P032 | Automatic backups run only for paid plans. | Paid plans get automatic backups; free plans don't. |  |  |
| P033 | Low test coverage results in more regressions reaching production. | More regressions reach production as a result of low test coverage. |  |  |
| P034 | Customers in remote regions often see slower downloads. | Downloads are frequently slower for customers in remote regions. |  |  |
| P035 | Draft posts are not visible to subscribers. | Subscribers can see draft posts. |  |  |
| P036 | Serverless functions cut idle costs, though cold starts add latency. | Serverless functions cut idle costs and latency. |  |  |
| P037 | Client-side rendering makes navigation feel instant, at the expense of a slower first load. | Navigation feels instant with client-side rendering, but the first load is slower. |  |  |
| P038 | Unless a reviewer objects within two days, the proposal is accepted. | The proposal is accepted once a reviewer approves it. |  |  |
| P039 | Static pages can typically be served straight from the CDN. | Static pages can usually be served directly from the CDN. |  |  |
| P040 | Exports finish within a minute for most workspaces, but very large workspaces can take an hour. | Exports finish within a minute. |  |  |
| P041 | Builds typically take 6 to 8 minutes. | A build usually takes 6–8 minutes. |  |  |
| P042 | The linter often catches unused imports that reviewers miss. | The linter catches the unused imports reviewers miss. |  |  |
| P043 | Pinning dependency versions makes builds reproducible but means security fixes arrive later. | Pinning dependency versions makes builds reproducible and keeps security fixes current. |  |  |
| P044 | Archived projects are not included in search results. | Search results include archived projects. |  |  |
| P045 | Thumbnails are generated in roughly 2 seconds. | Generating a thumbnail takes about 2 s. |  |  |
| P046 | The managed database saves operations work but costs more per month than self-hosting. | The managed database saves operations work and money compared with self-hosting. |  |  |
| P047 | Adding an index speeds up lookups by customer ID. | Adding an index slows down lookups by customer ID. |  |  |
| P048 | The mobile app does not store passwords on the device. | Passwords are never kept on the device by the mobile app. |  |  |
| P049 | The new pricing applies to customers who sign up after 1 March. | Customers signing up after 1 March get the new pricing. |  |  |
| P050 | Orders ship the same day if they are placed before 2 pm. | Orders placed before 2 pm go out the same day. |  |  |
