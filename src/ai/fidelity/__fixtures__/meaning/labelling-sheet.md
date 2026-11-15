# Paraphrase labelling sheet (rubric v2)

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
| P001 | Draft posts are not visible to subscribers. | Subscribers cannot see draft posts. |  |  |
| P002 | A warm standby could shorten recovery after a regional failure. | Recovery after a regional failure might be quicker with a warm standby. |  |  |
| P003 | The cluster runs between 4 and 8 worker nodes depending on load. | Depending on load, the cluster uses 4-8 workers. |  |  |
| P004 | Event sourcing gives a full audit trail but makes queries more complex. | Event sourcing gives a full audit trail and simpler queries. |  |  |
| P005 | The importer handles CSV and Excel files, and it skips rows with missing IDs. | The importer handles CSV and Excel files and every row in them. |  |  |
| P006 | Exported files contain no personal data. | Exported files contain personal data. |  |  |
| P007 | Two-factor login is mandatory for administrator accounts. | Two-factor login is mandatory for all accounts. |  |  |
| P008 | Automatic backups run only for paid plans. | Automatic backups run for every plan. |  |  |
| P009 | If the token expires mid-session, the client refreshes it silently. | The client silently refreshes a token that expires during a session. |  |  |
| P010 | Passwords must be at least 12 characters long. | A password needs a minimum length of 12 characters. |  |  |
| P011 | The beta adds offline editing, though changes made offline may conflict with edits from others. | The beta adds offline editing. |  |  |
| P012 | Pinning dependency versions makes builds reproducible but means security fixes arrive later. | Pinned versions give reproducible builds, while security patches land later. |  |  |
| P013 | The client retries up to 3 times before giving up. | The client gives up after at most three retries. |  |  |
| P014 | Orders ship the same day if they are placed before 2 pm. | Orders placed before 2 pm go out the same day. |  |  |
| P015 | Some customers prefer exporting reports as CSV rather than PDF. | Some customers would rather export reports to CSV than PDF. |  |  |
| P016 | The SDK no longer supports Python 3.7. | The SDK supports Python 3.7. |  |  |
| P017 | Running tests in parallel shortens the pipeline, though flaky tests become harder to debug. | Running tests in parallel shortens the pipeline. |  |  |
| P018 | The client retries up to 3 times before giving up. | The client retries 3 times before giving up. |  |  |
| P019 | Static pages can typically be served straight from the CDN. | Static pages are served straight from the CDN. |  |  |
| P020 | Batching notifications reduces noise but delays urgent alerts. | Batched notifications are less noisy, though urgent alerts arrive later. |  |  |
| P021 | Single sign-on is supported for enterprise customers. | Enterprise customers can sign in with single sign-on. |  |  |
| P022 | The queue holds up to 10,000 messages. | The queue holds 10,000 messages. |  |  |
| P023 | The importer handles CSV and Excel files, and it skips rows with missing IDs. | Importer: CSV and Excel supported; rows without IDs are skipped. |  |  |
| P024 | The new parser is likely to handle malformed headers better. | The new parser handles malformed headers better. |  |  |
| P025 | The outage was triggered by an expired TLS certificate. | An expired TLS certificate caused the outage. |  |  |
| P026 | Higher compression levels shrink archives while using more CPU. | Higher compression levels shrink archives and save CPU. |  |  |
| P027 | Deploys pause automatically if the error rate exceeds 2% for five minutes. | Deploys pause automatically whenever errors occur. |  |  |
| P028 | Pair programming tends to shorten onboarding for new hires. | Pair programming shortens onboarding for new hires. |  |  |
| P029 | Read replicas are recommended for read-only workloads. | Read replicas are recommended. |  |  |
| P030 | Memory leaks in the worker cause the nightly restarts. | The nightly restarts are caused by memory leaks in the worker. |  |  |
| P031 | The scheduler doesn't run jobs on public holidays. | The scheduler runs no jobs on public holidays. |  |  |
| P032 | Webhooks are not signed in the free plan. | Webhooks are signed in the free plan. |  |  |
| P033 | Batching notifications reduces noise but delays urgent alerts. | Batching notifications reduces noise without delaying anything. |  |  |
| P034 | Refunds are issued automatically unless the order has already shipped. | Orders that have not shipped yet get refunded automatically. |  |  |
| P035 | Students can resubmit an assignment provided the deadline has not passed. | Assignments may be resubmitted as long as the deadline is still open. |  |  |
| P036 | The free tier does not include priority support. | Priority support isn't part of the free tier. |  |  |
| P037 | The export does not include comments. | Comments are left out of the export. |  |  |
| P038 | The index holds roughly 2.5 million documents. | About 2.5 million documents are in the index. |  |  |
| P039 | Search indexing runs every hour, unless the queue is paused for maintenance. | Indexing runs hourly except while the queue is paused for maintenance. |  |  |
| P040 | Caching cut median latency by 40%, although the p99 latency did not change. | Caching cut latency by 40%. |  |  |
| P041 | The new search ranks recent documents higher, but it ignores files larger than 10 MB. | New search favours recent documents. Files over 10 MB are ignored. |  |  |
| P042 | Each report covers the last 90 days of activity. | Reports span the previous 90 days of activity. |  |  |
| P043 | Dark launches are used only for backend changes. | Dark launches are used for all changes. |  |  |
| P044 | The cleanup script deletes temporary files except those in the shared folder. | Apart from the shared folder, the cleanup script removes temporary files. |  |  |
| P045 | The beta API is open only to partner accounts. | Only partner accounts can use the beta API. |  |  |
| P046 | Unless a reviewer objects within two days, the proposal is accepted. | The proposal is accepted once a reviewer approves it. |  |  |
| P047 | Voice notes are transcribed automatically, but the transcripts are not reviewed by a person. | Voice notes get automatic transcripts that no person reviews. |  |  |
| P048 | The scheduler doesn't run jobs on public holidays. | The scheduler runs jobs on public holidays as well. |  |  |
| P049 | The linter often catches unused imports that reviewers miss. | The linter catches the unused imports reviewers miss. |  |  |
| P050 | The bulk-edit tool is limited to projects with fewer than 500 items. | The bulk-edit tool works on any project. |  |  |
| P051 | Alerts page the on-call engineer only if the outage lasts longer than ten minutes. | Alerts page the on-call engineer as soon as an outage starts. |  |  |
| P052 | Reports refresh every 15 minutes, except during the nightly maintenance window. | Reports refresh every 15 minutes. |  |  |
| P053 | Roughly half of the tickets are resolved within a day. | All tickets are resolved within a day. |  |  |
| P054 | Uploads are limited to 25 MB per file. | Each file can be at most 25 MB. |  |  |
| P055 | The cluster runs between 4 and 8 worker nodes depending on load. | The cluster runs 8 worker nodes. |  |  |
| P056 | Compressing images shrinks page weight. | Page weight goes down when images are compressed. |  |  |
| P057 | Builds typically take 6 to 8 minutes. | Builds take 8 minutes. |  |  |
| P058 | Weak passwords lead to more account takeovers. | Account takeovers lead to weak passwords. |  |  |
| P059 | The bulk-edit tool is limited to projects with fewer than 500 items. | Bulk editing works on projects of under 500 items. |  |  |
| P060 | When a pull request touches the schema, a database reviewer must approve it. | Pull requests that change the schema need a database reviewer's approval. |  |  |
| P061 | The SDK no longer supports Python 3.7. | Python 3.7 support has been dropped from the SDK. |  |  |
| P062 | Backups are copied to the second region once the nightly snapshot completes. | Backups are copied to the second region continuously. |  |  |
| P063 | Long-lived access tokens are convenient for users, but they widen the window for misuse. | Long-lived tokens are convenient, but a stolen one can be misused for longer. |  |  |
| P064 | Audit logs are kept for 90 days in regulated tenants. | Audit logs are kept for 90 days. |  |  |
| P065 | Adding an index speeds up lookups by customer ID. | Adding an index slows down lookups by customer ID. |  |  |
| P066 | Switching to HTTP/2 may lower page load times for image-heavy pages. | HTTP/2 lowers page load times for image-heavy pages. |  |  |
| P067 | Weak passwords lead to more account takeovers. | Account takeovers increase with weak passwords. |  |  |
| P068 | Backups are copied to the second region once the nightly snapshot completes. | After the nightly snapshot finishes, backups are copied to the second region. |  |  |
| P069 | Audit logs are kept for 90 days in regulated tenants. | Regulated tenants keep audit logs for 90 days. |  |  |
| P070 | On Windows hosts, the agent runs as a service. | The agent runs as a Windows service. |  |  |
| P071 | Higher compression levels shrink archives while using more CPU. | Stronger compression gives smaller archives and takes more CPU. |  |  |
| P072 | Low test coverage results in more regressions reaching production. | Regressions reaching production result in low test coverage. |  |  |
| P073 | The cache returns the stored answer when the request hash matches a previous query. | If a request's hash matches an earlier query, the cache serves the stored answer. |  |  |
| P074 | On Windows hosts, the agent runs as a service. | The agent runs as a service on every host. |  |  |
| P075 | The mobile app syncs photos over Wi-Fi only, to avoid using mobile data. | To save mobile data, photo sync happens only on Wi-Fi. |  |  |
| P076 | The form saves a draft whenever the user leaves a field. | Each time the user leaves a field, the form saves a draft. |  |  |
| P077 | Reports refresh every 15 minutes, except during the nightly maintenance window. | Reports update every 15 minutes outside the nightly maintenance window. |  |  |
| P078 | Slow disk writes cause the queue to back up. | A backed-up queue causes slow disk writes. |  |  |
| P079 | The API does not return deleted records by default. | The API returns deleted records by default. |  |  |
| P080 | The scheduler supports cron syntax, but time zones other than UTC are not supported yet. | The scheduler supports cron syntax in any time zone. |  |  |
| P081 | The new pricing applies to customers who sign up after 1 March. | Customers signing up after 1 March get the new pricing. |  |  |
| P082 | Static pages can typically be served straight from the CDN. | Static pages can usually be served directly from the CDN. |  |  |
| P083 | Alerts page the on-call engineer only if the outage lasts longer than ten minutes. | The on-call engineer is paged only for outages longer than ten minutes. |  |  |
| P084 | A larger context window improves recall while raising token costs. | Bigger context windows recall more but cost more tokens. |  |  |
| P085 | The cleanup script deletes temporary files except those in the shared folder. | The cleanup script deletes all temporary files, including the shared folder. |  |  |
| P086 | The new editor loads twice as fast, but plugins written for the old editor will not work. | The new editor loads 2x faster; old-editor plugins won't work with it. |  |  |
| P087 | Response times stay under 200 milliseconds for 95% of requests. | Response times stay under 200 seconds for 95% of requests. |  |  |
| P088 | Response times stay under 200 milliseconds for 95% of requests. | 95% of requests complete in under 200 ms. |  |  |
| P089 | The job retries only when the failure is a network timeout. | Only network timeouts trigger a retry of the job. |  |  |
| P090 | The job retries only when the failure is a network timeout. | The job retries whenever it fails. |  |  |
| P091 | The cache returns the stored answer when the request hash matches a previous query. | The cache returns the stored answer for every request. |  |  |
| P092 | Enabling verbose logging can slow the service down noticeably. | Verbose logging may noticeably slow the service. |  |  |
| P093 | Client-side rendering makes navigation feel instant, at the expense of a slower first load. | Navigation feels instant with client-side rendering, but the first load is slower. |  |  |
| P094 | Compressing images shrinks page weight. | Compressing images increases page weight. |  |  |
| P095 | Changing the theme does not reload the page. | Changing the theme reloads the page. |  |  |
| P096 | A larger context window improves recall while raising token costs. | A larger context window improves recall and lowers token costs. |  |  |
| P097 | Adding a reranker can improve answer quality on long documents. | A reranker improves answer quality on long documents. |  |  |
| P098 | Because the index was rebuilt, queries are faster this week. | Queries are slower this week because the index was rebuilt. |  |  |
| P099 | Event sourcing gives a full audit trail but makes queries more complex. | Event sourcing provides a complete audit trail, though querying gets more complex. |  |  |
| P100 | Synchronous replication protects against data loss at the cost of higher write latency. | Synchronous replication has higher write latency but protects against data loss. |  |  |
| P101 | Aggressive caching lowers costs at the expense of fresher data. | Heavy caching saves money but data is less fresh. |  |  |
| P102 | Feature flags can reduce the risk of a bad release. | Feature flags remove the risk of a bad release. |  |  |
| P103 | Strict type checking catches bugs earlier, although it slows down prototyping. | Strict type checking catches bugs earlier. |  |  |
| P104 | Client-side rendering makes navigation feel instant, at the expense of a slower first load. | Client-side rendering makes navigation and the first load instant. |  |  |
| P105 | The mobile app syncs photos over Wi-Fi only, to avoid using mobile data. | The mobile app syncs photos over Wi-Fi and mobile data. |  |  |
| P106 | Discounts apply if the basket total is above fifty dollars. | Baskets over fifty dollars qualify for the discount. |  |  |
| P107 | The new search ranks recent documents higher, but it ignores files larger than 10 MB. | The new search ranks recent documents higher. |  |  |
| P108 | Denormalising the tables makes reads simpler but complicates updates. | Reads get simpler with denormalised tables; updates get harder. |  |  |
| P109 | Single sign-on is supported for enterprise customers. | Single sign-on is supported for customers. |  |  |
| P110 | The team adopted code review after two production incidents. | Code review caused two production incidents. |  |  |
| P111 | Error rates fell after the retry policy was changed. | The new retry policy caused error rates to fall. |  |  |
| P112 | The banner appears when a user's trial has fewer than three days left. | The banner appears throughout the trial. |  |  |
| P113 | The managed database saves operations work but costs more per month than self-hosting. | The managed database saves operations work and money compared with self-hosting. |  |  |
| P114 | The release slipped since the security review took longer than planned. | A longer-than-planned security review delayed the release. |  |  |
| P115 | Smaller batch sizes generally reduce memory pressure during training. | Smaller batch sizes reduce memory pressure during training. |  |  |
| P116 | Because the index was rebuilt, queries are faster this week. | Queries are faster this week thanks to the rebuilt index. |  |  |
| P117 | Deploys pause automatically if the error rate exceeds 2% for five minutes. | An error rate above 2% for five minutes automatically pauses deploys. |  |  |
| P118 | In the EU region, logs are retained for 30 days. | EU-region logs are kept for 30 days. |  |  |
| P119 | Automatic backups run only for paid plans. | Paid plans get automatic backups; free plans don't. |  |  |
| P120 | The scheduler supports cron syntax, but time zones other than UTC are not supported yet. | Cron syntax works in the scheduler; only UTC is supported for now. |  |  |
| P121 | Smaller containers start faster but have less headroom for traffic spikes. | Smaller containers start faster. |  |  |
| P122 | Rate limits are relaxed for internal services. | Internal services get looser rate limits. |  |  |
| P123 | When a pull request touches the schema, a database reviewer must approve it. | A database reviewer must approve every pull request. |  |  |
| P124 | Read receipts are sent only if both users have enabled them. | Read receipts are always sent. |  |  |
| P125 | Cold starts might add noticeable delay to the first request. | Cold starts add noticeable delay to the first request. |  |  |
| P126 | Rate limits are relaxed for internal services. | Rate limits are relaxed for services. |  |  |
| P127 | Memory leaks in the worker cause the nightly restarts. | The nightly restarts cause memory leaks in the worker. |  |  |
| P128 | The beta adds offline editing, though changes made offline may conflict with edits from others. | Beta: offline editing, with possible conflicts against others' edits. |  |  |
| P129 | Trial accounts cannot invite more than two teammates. | A trial account can invite at most two teammates. |  |  |
| P130 | Guest accounts cannot create shared folders. | Guest accounts can create shared folders. |  |  |
| P131 | Support tickets dropped in the quarter the help centre launched. | The help centre launch caused support tickets to drop. |  |  |
| P132 | Exported files contain no personal data. | Personal data is not included in exported files. |  |  |
| P133 | At least two approvals are required before merging. | Two approvals are required before merging. |  |  |
| P134 | Reviewers usually respond within one business day. | Reviewers respond within one business day. |  |  |
| P135 | Long-running transactions cause lock contention on the orders table. | Lock contention on the orders table comes from long-running transactions. |  |  |
| P136 | Admins can restore deleted pages for 30 days, after which they are purged. | Admins can restore deleted pages at any time. |  |  |
| P137 | The plan includes 1,000 API calls per day. | The plan includes 10,000 API calls per day. |  |  |
| P138 | Thumbnails are generated in roughly 2 seconds. | Generating a thumbnail takes about 2 s. |  |  |
| P139 | Large imports may take several minutes to appear in search. | Large imports take several minutes to appear in search. |  |  |
| P140 | The index holds roughly 2.5 million documents. | The index holds 25 million documents. |  |  |
| P141 | Synchronous replication protects against data loss at the cost of higher write latency. | Synchronous replication protects against data loss with no effect on write latency. |  |  |
| P142 | Orders ship the same day if they are placed before 2 pm. | Orders always ship the same day. |  |  |
| P143 | Spot instances can lower compute bills for batch jobs. | Spot instances lower compute bills for batch jobs. |  |  |
| P144 | Changing the theme does not reload the page. | The page stays loaded when the theme changes. |  |  |
| P145 | The queue holds up to 10,000 messages. | At most 10000 messages fit in the queue. |  |  |
| P146 | Archived projects are not included in search results. | Search results include archived projects. |  |  |
| P147 | Newer GPUs may cut training time for large models. | Newer GPUs cut training time for large models. |  |  |
| P148 | The build failed because a dependency was removed from the registry. | A dependency removed from the registry broke the build. |  |  |
| P149 | Rate limiting prevents a single client from exhausting the API. | A single client can't exhaust the API thanks to rate limiting. |  |  |
| P150 | Tighter alert thresholds reduced the number of missed incidents. | Tighter alert thresholds increased the number of missed incidents. |  |  |
| P151 | Slow disk writes cause the queue to back up. | The queue backs up because disk writes are slow. |  |  |
| P152 | The gateway does not cache authenticated responses. | The gateway caches authenticated responses. |  |  |
| P153 | The banner appears when a user's trial has fewer than three days left. | If a trial has under three days left, the user sees the banner. |  |  |
| P154 | Unless the user opts out, weekly summaries are emailed on Monday. | Weekly summaries are emailed on Monday to users who haven't opted out. |  |  |
| P155 | At least two approvals are required before merging. | Merging needs a minimum of two approvals. |  |  |
| P156 | Nightly compaction usually finishes before the morning peak. | Compaction typically completes ahead of the morning peak. |  |  |
| P157 | Read replicas are not used for writes. | Writes go to the read replicas. |  |  |
| P158 | Sign-ups rose in the same month the pricing page was redesigned. | The pricing page redesign drove the rise in sign-ups. |  |  |
| P159 | Discounts apply if the basket total is above fifty dollars. | Discounts apply to every basket. |  |  |
| P160 | Running tests in parallel shortens the pipeline, though flaky tests become harder to debug. | Parallel tests shorten the pipeline but make flaky failures harder to debug. |  |  |
| P161 | Large imports may take several minutes to appear in search. | Search might take several minutes to show large imports. |  |  |
| P162 | The new parser is likely to handle malformed headers better. | The new parser should probably cope better with malformed headers. |  |  |
| P163 | Guests can view shared boards, although they cannot leave comments. | Guests may view shared boards but can't comment. |  |  |
| P164 | The new editor loads twice as fast, but plugins written for the old editor will not work. | The new editor loads twice as fast. |  |  |
| P165 | Exports finish within a minute for most workspaces, but very large workspaces can take an hour. | Exports finish within a minute. |  |  |
| P166 | Dark launches are used only for backend changes. | Only backend changes are dark-launched. |  |  |
| P167 | Price alerts are sent to premium subscribers only. | Price alerts are sent to subscribers. |  |  |
| P168 | Archived projects are not included in search results. | Search results leave out archived projects. |  |  |
| P169 | Most incidents last year were caused by configuration changes. | Configuration changes were behind most of last year's incidents. |  |  |
| P170 | Usage-based billing is available for customers on the Growth plan. | Customers on the Growth plan can use usage-based billing. |  |  |
| P171 | The migration took about 40 minutes on the staging database. | The migration took 40 minutes on the staging database. |  |  |
| P172 | The importer does not retry failed rows. | Failed rows are never retried by the importer. |  |  |
| P173 | The API returns results in pages of 100, and clients must follow the next link to get the rest. | The API returns all results in one response. |  |  |
| P174 | Two-factor login is mandatory for administrator accounts. | Administrator accounts must use two-factor login. |  |  |
| P175 | The new pricing applies to customers who sign up after 1 March. | The new pricing applies to all customers. |  |  |
| P176 | Sharding raised write throughput fourfold, but cross-shard queries became slower. | Sharding gave 4x write throughput; cross-shard queries slowed down. |  |  |
| P177 | Passwords must be at least 12 characters long. | Passwords must be 12 characters long. |  |  |
| P178 | The offline mode is only available on the desktop app. | Offline mode is available in the app. |  |  |
| P179 | Without a valid licence key, the plugin will not start. | The plugin starts without a licence key. |  |  |
| P180 | Nightly compaction usually finishes before the morning peak. | Nightly compaction finishes before the morning peak. |  |  |
| P181 | The columnar format speeds up analytics queries but uses more disk space. | Analytics queries run faster in the columnar format, at the price of extra disk space. |  |  |
| P182 | Price alerts are sent to premium subscribers only. | Only premium subscribers receive price alerts. |  |  |
| P183 | Voice notes are transcribed automatically, but the transcripts are not reviewed by a person. | Voice notes are transcribed automatically and checked by a person. |  |  |
| P184 | The beta API is open only to partner accounts. | The beta API is open to all accounts. |  |  |
| P185 | Long-lived access tokens are convenient for users, but they widen the window for misuse. | Long-lived access tokens are convenient and safer for users. |  |  |
| P186 | Users may see stale prices for a few seconds after an update. | Prices can appear stale briefly after an update. |  |  |
| P187 | Adding a reranker can improve answer quality on long documents. | A reranker may improve answer quality on long documents. |  |  |
| P188 | Uploads are limited to 25 MB per file. | Uploads are limited to 50 MB per file. |  |  |
| P189 | Some customers prefer exporting reports as CSV rather than PDF. | Customers prefer CSV exports to PDF. |  |  |
| P190 | In the EU region, logs are retained for 30 days. | Logs are retained for 30 days. |  |  |
| P191 | The dashboard switches to dark mode when the system theme is dark. | With a dark system theme, the dashboard uses dark mode. |  |  |
| P192 | The offline mode is only available on the desktop app. | Only the desktop app has offline mode. |  |  |
| P193 | The mobile app does not store passwords on the device. | The mobile app stores passwords on the device. |  |  |
| P194 | If the token expires mid-session, the client refreshes it silently. | The client refreshes the token silently on every request. |  |  |
| P195 | Denormalising the tables makes reads simpler but complicates updates. | Denormalising the tables makes reads and updates simpler. |  |  |
| P196 | Usage-based billing is available for customers on the Growth plan. | Usage-based billing is available to customers. |  |  |
| P197 | The plan includes 1,000 API calls per day. | The plan allows 1000 API calls a day. |  |  |
| P198 | The columnar format speeds up analytics queries but uses more disk space. | The columnar format speeds up analytics queries and saves disk space. |  |  |
| P199 | Guest accounts cannot create shared folders. | Shared folders can't be created by guest accounts. |  |  |
| P200 | Without a valid licence key, the plugin will not start. | The plugin won't start unless a valid licence key is present. |  |  |
| P201 | The free tier allows no more than five projects. | The free tier allows five projects. |  |  |
| P202 | Unless the user opts out, weekly summaries are emailed on Monday. | Weekly summaries are emailed on Monday if the user opts out. |  |  |
| P203 | Search indexing runs every hour, unless the queue is paused for maintenance. | Search indexing runs every hour. |  |  |
| P204 | The dashboard switches to dark mode when the system theme is dark. | The dashboard always uses dark mode. |  |  |
| P205 | Serverless functions cut idle costs, though cold starts add latency. | Serverless saves on idle costs; the trade-off is cold-start latency. |  |  |
| P206 | Draft posts are not visible to subscribers. | Subscribers can see draft posts. |  |  |
| P207 | Roughly half of the tickets are resolved within a day. | About 50% of tickets get resolved inside a day. |  |  |
| P208 | The outage was triggered by an expired TLS certificate. | The outage caused the TLS certificate to expire. |  |  |
| P209 | The linter often catches unused imports that reviewers miss. | Reviewers miss unused imports that the linter frequently flags. |  |  |
| P210 | The service never deletes data without a confirmation step. | Data is deleted only after a confirmation step. |  |  |
| P211 | The gateway does not cache authenticated responses. | Authenticated responses are never cached by the gateway. |  |  |
| P212 | Caching cut median latency by 40%, although the p99 latency did not change. | Caching reduced median latency 40%; p99 latency stayed the same. |  |  |
| P213 | The API returns results in pages of 100, and clients must follow the next link to get the rest. | Results come in pages of 100; follow the next link for more. |  |  |
| P214 | The trial lasts 14 days and converts to the basic plan if no card is added. | After 14 days, a trial without a card moves to the basic plan. |  |  |
| P215 | Admins can restore deleted pages for 30 days, after which they are purged. | Deleted pages are restorable by admins for 30 days, then purged. |  |  |
| P216 | The importer does not retry failed rows. | The importer retries failed rows. |  |  |
| P217 | Smaller batch sizes generally reduce memory pressure during training. | In general, smaller batches lower memory pressure in training. |  |  |
| P218 | Webhooks are not signed in the free plan. | On the free plan, webhooks come unsigned. |  |  |
| P219 | Smaller containers start faster but have less headroom for traffic spikes. | Small containers boot quickly, with less headroom for traffic spikes. |  |  |
| P220 | Strict type checking catches bugs earlier, although it slows down prototyping. | Strict type checks find bugs sooner but make prototyping slower. |  |  |
| P221 | The free tier allows no more than five projects. | Free accounts are capped at 5 projects. |  |  |
| P222 | Exports finish within a minute for most workspaces, but very large workspaces can take an hour. | Most workspaces export in under a minute; very large ones can take up to an hour. |  |  |
| P223 | Caching the product list reduces database load. | Caching the product list increases database load. |  |  |
| P224 | Pinning dependency versions makes builds reproducible but means security fixes arrive later. | Pinning dependency versions makes builds reproducible and keeps security fixes current. |  |  |
| P225 | Prefetching the next page can make scrolling feel smoother. | Scrolling may feel smoother with prefetching of the next page. |  |  |
| P226 | Builds typically take 6 to 8 minutes. | A build usually takes 6–8 minutes. |  |  |
| P227 | The mobile app does not store passwords on the device. | Passwords are never kept on the device by the mobile app. |  |  |
| P228 | The checkout errors were caused by a misconfigured payment webhook. | A misconfigured payment webhook was behind the checkout errors. |  |  |
| P229 | Tighter alert thresholds reduced the number of missed incidents. | Tightening alert thresholds led to fewer missed incidents. |  |  |
| P230 | Students can resubmit an assignment provided the deadline has not passed. | Students can resubmit an assignment at any time. |  |  |
| P231 | The migration tool does not modify the original files. | The migration tool modifies the original files in place. |  |  |
| P232 | The trial lasts 14 days and converts to the basic plan if no card is added. | The trial lasts 14 days and then converts to the basic plan. |  |  |
| P233 | Unless a reviewer objects within two days, the proposal is accepted. | The proposal is accepted if no reviewer objects within two days. |  |  |
| P234 | The migration took about 40 minutes on the staging database. | On staging, the migration ran for roughly 40 minutes. |  |  |
| P235 | Higher traffic leads to longer checkout times. | Longer checkout times lead to higher traffic. |  |  |
| P236 | Serverless functions cut idle costs, though cold starts add latency. | Serverless functions cut idle costs and latency. |  |  |
| P237 | Sessions expire after 30 minutes of inactivity. | After 30 minutes idle, a session expires. |  |  |
| P238 | Aggressive caching lowers costs at the expense of fresher data. | Aggressive caching lowers costs and keeps data fresh. |  |  |
| P239 | Caching the product list reduces database load. | Database load drops when the product list is cached. |  |  |
| P240 | Thumbnails are generated in roughly 2 seconds. | Thumbnails are generated in 20 seconds. |  |  |
| P241 | Long-running transactions cause lock contention on the orders table. | Lock contention on the orders table causes long-running transactions. |  |  |
| P242 | Logs are not sent to third parties. | Logs are shared with third parties. |  |  |
| P243 | Each report covers the last 90 days of activity. | Each report covers the last 9 days of activity. |  |  |
| P244 | Cold starts might add noticeable delay to the first request. | The first request may be noticeably slower due to cold starts. |  |  |
| P245 | Guests can view shared boards, although they cannot leave comments. | Guests can view and comment on shared boards. |  |  |
| P246 | Refunds are issued automatically unless the order has already shipped. | Refunds are issued automatically if the order has already shipped. |  |  |
| P247 | Users may see stale prices for a few seconds after an update. | Users see stale prices for a few seconds after an update. |  |  |
| P248 | Sessions expire after 30 minutes of inactivity. | Sessions expire after 13 minutes of inactivity. |  |  |
| P249 | The managed database saves operations work but costs more per month than self-hosting. | Managed hosting costs more monthly than self-hosting, in exchange for less operations work. |  |  |
| P250 | Sharding raised write throughput fourfold, but cross-shard queries became slower. | Sharding raised write throughput fourfold and sped up cross-shard queries. |  |  |
| P251 | Low test coverage results in more regressions reaching production. | More regressions reach production as a result of low test coverage. |  |  |
| P252 | Adding an index speeds up lookups by customer ID. | Lookups by customer ID are faster with an index. |  |  |
| P253 | Retrying a timed-out upload sometimes produces a duplicate file. | A retried upload that timed out can occasionally create a duplicate file. |  |  |
| P254 | Customers in remote regions often see slower downloads. | Downloads are frequently slower for customers in remote regions. |  |  |
| P255 | Read replicas are recommended for read-only workloads. | For read-only workloads, use read replicas. |  |  |
| P256 | Higher traffic leads to longer checkout times. | Checkout times grow as traffic rises. |  |  |
