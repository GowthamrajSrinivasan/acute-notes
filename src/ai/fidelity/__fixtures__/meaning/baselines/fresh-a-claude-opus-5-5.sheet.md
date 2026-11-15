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
| P001 | The dashboard refreshes every minute, although the revenue widget updates only hourly. | Dashboard data refreshes each minute. The revenue widget is the exception, updating once an hour. | faithful |  |
| P002 | Refunds are not issued for partially used subscription months. | Partially used subscription months are non-refundable. | faithful |  |
| P003 | Latency at p99 stayed under 250 ms. | The 99th-percentile latency remained below 0.25 seconds. | faithful |  |
| P004 | Some Android devices from older vendors fail to deliver push notifications while in battery-saver mode. | Older-vendor Android devices don't deliver push notifications in battery-saver mode. | distorted | Reader believes all older-vendor Android devices fail, whereas the source says only some do. |
| P005 | Orders are held for manual review unless the billing and shipping addresses match. | Orders are held for manual review if the billing and shipping addresses match. | distorted | Reader believes orders are held when addresses match, the reverse of the source. |
| P006 | We have never had a breach involving payment card data. | Our one breach involved payment card data. | distorted | Reader believes there was a payment-card breach, whereas the source says there never was one. |
| P007 | The nightly export runs only when the previous day's ledger has been closed. | Until the prior day's ledger is closed, the nightly export does not run. | faithful |  |
| P008 | Sessions expire after 30 minutes of inactivity. | After half an hour idle, a session expires. | faithful |  |
| P009 | The courier picks up from all depots daily, but not on public holidays. | Depots get a daily courier pickup; public holidays are skipped. | faithful |  |
| P010 | The recommendation model improved click-through rate, but conversions stayed flat. | The recommendation model improved click-through rate and lifted conversions too. | distorted | Reader believes conversions rose, whereas they stayed flat. |
| P011 | Candidates referred by employees are typically hired faster than applicants from job boards. | Employee referrals generally move through hiring more quickly than job-board applicants. | faithful |  |
| P012 | Unverified sellers cannot list items above $500. | Items above $500 may be listed by unverified sellers. | distorted | Reader believes unverified sellers may list items above $500, whereas they cannot. |
| P013 | Password-reset emails are often flagged as spam by corporate mail filters. | Corporate mail filters treat password-reset emails as spam. | distorted | Reader believes corporate filters always flag reset emails as spam, whereas the source says often. |
| P014 | Retrying a failed webhook delivery can occasionally produce duplicate events on the receiver side. | Receivers may sometimes see the same event twice when a failed webhook is retried. | faithful |  |
| P015 | A four-day work week improved retention but stretched response times on support. | A four-day work week improved retention and kept support response times fast. | distorted | Reader believes support response times stayed fast, whereas they were stretched. |
| P016 | The API allows at most 100 requests per minute per key. | The API allows at most 100 requests per second per key. | distorted | Reader believes the limit is 100 per second, whereas it is 100 per minute. |
| P017 | Single sign-on is available on the Enterprise plan. | Enterprise-plan customers can use single sign-on. | faithful |  |
| P018 | The training run used 8 GPUs for 36 hours. | The training run used 8 GPUs for 36 minutes. | distorted | Reader believes the run took 36 minutes, whereas it took 36 hours. |
| P019 | Each workspace supports up to 50 members. | Each workspace has 50 members. | distorted | Reader believes each workspace has exactly 50 members, whereas 50 is only the maximum. |
| P020 | If the battery falls below 15%, the app pauses background sync. | Background sync is suspended once battery drops under 15 percent. | faithful |  |
| P021 | Higher-resolution thumbnails look sharper on retina screens but increase page weight. | Higher-resolution thumbnails look sharper on retina screens and keep pages light. | distorted | Reader believes higher-resolution thumbnails keep pages light, whereas they increase page weight. |
| P022 | Storage is billed at $0.02 per GB per month. | Each gigabyte stored costs two cents a month. | faithful |  |
| P023 | Guest users can comment on shared documents. | Guest users can comment on documents. | distorted | Reader believes guests can comment on any document, whereas the source limits it to shared documents. |
| P024 | Customers can cancel at any time, but annual plans are not refunded pro rata. | Customers can cancel at any time and get a pro-rata refund on annual plans. | distorted | Reader believes annual plans get a pro-rata refund, whereas they do not. |
| P025 | Retry storms from clients overloaded the authentication service. | The authentication service was overwhelmed by waves of client retries. | faithful |  |
| P026 | Admins in the EU region can export audit logs as CSV. | Admins can export audit logs as CSV. | distorted | Reader believes all admins can export audit logs as CSV, whereas the source limits it to EU-region admins. |
| P027 | Managers can approve expense reports under $1,000. | Managers can approve expense reports. | distorted | Reader believes managers can approve expense reports of any amount, whereas only those under $1,000. |
| P028 | Trial accounts are deleted after 14 days if no payment method has been added. | Trial accounts are deleted after 14 days. | distorted | Reader believes all trial accounts are deleted after 14 days, whereas only those without a payment method are. |
| P029 | Two approvals are required to merge into main. | Merging into main needs at least a pair of approvals. | faithful |  |
| P030 | Encryption at rest is enabled by default, except for volumes created before 2022. | Encryption at rest is enabled by default on every volume, whatever its creation date. | distorted | Reader believes all volumes are encrypted by default, whereas pre-2022 volumes are excepted. |
| P031 | Caching product pages speeds up load times at the cost of showing prices that may be up to five minutes old. | Caching product pages speeds up load times while keeping prices current. | distorted | Reader believes prices stay current, whereas they may be up to five minutes old. |
| P032 | The new retention policy affects only logs from the staging environment. | Staging logs are the sole target of the new retention policy. | faithful |  |
| P033 | Raising the learning rate made training diverge. | Training diverged as a result of a higher learning rate. | faithful |  |
| P034 | Offline sync works across all devices, though attachments larger than 25 MB are left on the server. | Offline sync covers every device. Attachments over 25 MB remain on the server. | faithful |  |
| P035 | Ticket volume spiked in the same week the new pricing page went live. | The new pricing page caused ticket volume to spike. | distorted | Reader believes the pricing page caused the spike, whereas the source only says they coincided. |
| P036 | Accounts lock after five failed logins, though admins are exempt. | Every account, admins included, locks after five failed logins. | distorted | Reader believes admin accounts lock too, whereas admins are exempt. |
| P037 | Shorter onboarding reduced first-week drop-off. | First-week drop-off fell thanks to a shorter onboarding. | faithful |  |
| P038 | The warehouse ships roughly 12,000 parcels per day. | The warehouse ships roughly 1,200 parcels per day. | distorted | Reader believes about 1,200 parcels ship per day, whereas it is about 12,000. |
| P039 | Refund requests are usually processed within three business days. | Refunds are normally handled in three business days or fewer. | faithful |  |
| P040 | Adding an index on customer_id cut the report's query time from minutes to seconds. | The report's query went from minutes to seconds because of a new index on customer_id. | faithful |  |
| P041 | Cold starts on the serverless tier typically add between one and two seconds to the first request. | On the serverless tier, a cold start delays the first request by one to two seconds. | distorted | Reader believes every cold start adds one to two seconds, whereas the source says typically. |
| P042 | Synchronous replication guarantees zero data loss on failover but adds write latency. | With synchronous replication, failover loses no data; the price is slower writes. | faithful |  |
| P043 | Delivery takes 3 to 5 business days. | Delivery takes 5 business days. | distorted | Reader believes delivery takes 5 business days, whereas it ranges from 3 to 5. |
| P044 | The API is backward compatible, apart from the removal of the legacy /v1/export endpoint. | The API stays backward compatible with one exception: the old /v1/export endpoint is gone. | faithful |  |
| P045 | Full-time employees in Canada receive a wellness stipend. | Full-time employees receive a wellness stipend. | distorted | Reader believes all full-time employees get the stipend, whereas the source limits it to Canada. |
| P046 | A stale cache entry might be served for up to a minute after an update. | After an update, readers could still get the old cached value for as long as sixty seconds. | faithful |  |
| P047 | Contractors do not have access to payroll data. | Payroll data is off-limits to contractors. | faithful |  |
| P048 | Quantizing the model to 4 bits shrinks its memory footprint, though accuracy drops slightly. | A 4-bit quantized model takes less memory and is marginally less accurate. | faithful |  |
| P049 | Event sourcing gives a full audit history but makes the storage footprint grow considerably. | Event sourcing gives a full audit history with a compact storage footprint. | distorted | Reader believes event sourcing keeps storage compact, whereas it grows considerably. |
| P050 | The express carrier is faster but charges twice as much as standard shipping. | Standard shipping costs half what the express carrier charges, and it is less fast. | faithful |  |
| P051 | The migration script never modifies existing rows. | The migration script rewrites existing rows in place. | distorted | Reader believes the script rewrites existing rows, whereas it never modifies them. |
| P052 | Enabling compression may reduce backup size by roughly half for text-heavy databases. | For text-heavy databases, turning on compression halves the backup size. | distorted | Reader believes compression definitely halves backup size, whereas the source says it may roughly halve it. |
| P053 | Overtime is paid at 1.5x only when the employee has worked more than 40 hours that week. | Overtime is paid at 1.5x whenever an employee works extra hours. | distorted | Reader believes any extra hours earn 1.5x, whereas only hours beyond 40 in a week do. |
| P054 | Support tickets are escalated to tier 2 only when the customer is on an enterprise contract. | Support tickets are escalated to tier 2 regardless of the customer's contract. | distorted | Reader believes all tickets escalate to tier 2 regardless of contract, whereas only enterprise-contract ones do. |
| P055 | Drivers may skip the signature step when the parcel is under $50 in value. | Drivers may skip the signature step for parcels of any value. | distorted | Reader believes signature can be skipped for any value, whereas only for parcels under $50. |
| P056 | Dark mode is available in the iOS app. | iOS app users can switch to dark mode. | faithful |  |
| P057 | High memory pressure causes the garbage collector to run more often. | Frequent garbage collection runs cause high memory pressure. | distorted | Reader believes frequent GC causes memory pressure, whereas memory pressure causes frequent GC. |
| P058 | Rotating the signing key could invalidate sessions that are still in flight. | Rotating the signing key invalidates in-flight sessions. | distorted | Reader believes key rotation always invalidates in-flight sessions, whereas the source says it could. |
| P059 | Running the analysis on spot instances lowers compute cost but risks jobs being interrupted. | Running the analysis on spot instances lowers compute cost and keeps jobs running without interruption. | distorted | Reader believes spot jobs run without interruption, whereas they risk being interrupted. |
| P060 | Enabling the CDN reduced origin bandwidth costs. | Origin bandwidth costs grew after the CDN was switched on. | distorted | Reader believes origin bandwidth costs grew, whereas they fell. |
| P061 | The upload limit is 2,000 files per batch. | A batch can contain up to two thousand files. | faithful |  |
| P062 | The vendor's SDK does not collect device identifiers. | The vendor's SDK gathers device identifiers. | distorted | Reader believes the SDK collects device identifiers, whereas it does not. |
| P063 | Automatic virus scanning applies to uploaded PDF and Office files. | Uploaded PDFs and Office documents are scanned for viruses automatically. | faithful |  |
| P064 | Clock skew between nodes can cause token validation to fail. | Token validation may fail when node clocks drift apart. | faithful |  |
| P065 | Requests cannot exceed 10 MB. | Requests are capped at 10 MB. | faithful |  |
| P066 | The free tier does not include API access. | API access is excluded from the free tier. | faithful |  |
| P067 | Longer warehouse pick routes lead to slower order fulfilment. | Order fulfilment slows down as a consequence of longer pick routes in the warehouse. | faithful |  |
| P068 | Between 5% and 10% of uploads fail checksum validation. | Roughly 10% of uploads fail checksum validation. | distorted | Reader believes about 10% fail, whereas the range is 5% to 10%. |
| P069 | Deleted files are not recoverable after the 30-day retention period. | Deleted files can be restored after the 30-day retention period. | distorted | Reader believes files can be restored after 30 days, whereas they cannot. |
| P070 | The migration tool copies all tables automatically, except those with custom triggers, which must be moved by hand. | The migration tool copies tables automatically. Tables that have custom triggers have to be moved manually. | faithful |  |
| P071 | Batching notifications cuts send costs but delays delivery by up to an hour. | Batching notifications cuts send costs. | distorted | Reader believes batching has no downside, whereas it delays delivery by up to an hour. |
| P072 | Shipments to remote postcodes are likely to miss the next-day window. | Shipments to remote postcodes will miss the next-day window. | distorted | Reader believes remote shipments will certainly miss next-day, whereas the source says likely. |
| P073 | The autoscaler adds nodes when CPU stays above 80% for five minutes. | The autoscaler adds nodes whenever CPU goes above 80%. | distorted | Reader believes any spike over 80% CPU adds nodes, whereas it must persist for five minutes. |
| P074 | Fine-tuning is supported for the base models in the 7B family. | The 7B family's base models can be fine-tuned. | faithful |  |
| P075 | Most customers who churn in the first month never complete the onboarding checklist. | The majority of first-month churners don't finish the onboarding checklist. | faithful |  |
| P076 | Two-day shipping is offered on orders within the contiguous United States. | Two-day shipping is offered on orders within the United States. | distorted | Reader believes two-day shipping covers all of the US, whereas it is limited to the contiguous US. |
| P077 | Employees accrue 1.5 vacation days per month. | Each month, staff earn a day and a half of vacation. | faithful |  |
| P078 | Most payments settle the same day, but international transfers can take up to three days. | Most payments settle the same day, including international transfers. | distorted | Reader believes international transfers settle same day, whereas they can take up to three days. |
| P079 | Offline mode lets field staff work without signal, with the downside that conflicting edits must be resolved by hand later. | Field staff can keep working with no signal in offline mode; any conflicting edits then need manual resolution. | faithful |  |
| P080 | Unless the user opts in, location data is not uploaded. | Location data stays on the device for anyone who hasn't opted in. | faithful |  |
| P081 | Weekend phone support is offered to premium-support subscribers in North America. | North American premium-support subscribers get phone support on weekends. | faithful |  |
| P082 | Staff can work remotely up to three days a week, but new hires must be on-site for their first month. | Staff, new hires included, can work remotely up to three days a week from day one. | distorted | Reader believes new hires can work remotely from day one, whereas they must be on-site for their first month. |
| P083 | No customer data leaves the EU region. | Customer data stays within the EU region. | faithful |  |
| P084 | The model checkpoint is uploaded only after validation loss improves. | No checkpoint is uploaded unless validation loss gets better. | faithful |  |
| P085 | Frequent schema changes slowed down the data team's releases. | The data team's slow releases led to frequent schema changes. | distorted | Reader believes slow releases caused schema changes, whereas schema changes slowed releases. |
| P086 | The scheduler did not retry jobs that failed with a validation error. | The scheduler gave up immediately on jobs that hit a validation error. | faithful |  |
| P087 | Except during a declared incident, production deploys require two reviewers. | Two reviewers must sign off on production deploys, a requirement waived while an incident is declared. | faithful |  |
| P088 | The iOS app works without a network connection. | The iOS app requires a network connection. | distorted | Reader believes the iOS app needs a network connection, whereas it works offline. |
| P089 | Larger batch sizes tend to speed up training but can hurt final accuracy on small datasets. | On small datasets, bigger batches generally train faster, though final accuracy might suffer. | partly | Card scopes the training speed-up to small datasets only, whereas the source states it generally; not false but narrowed. |
| P090 | Tightening rate limits decreased abuse traffic. | Abuse traffic rose once rate limits were tightened. | distorted | Reader believes abuse traffic rose, whereas it decreased. |
| P091 | Free returns apply provided that the item is sent back within 30 days. | Items sent back inside 30 days qualify for free returns. | faithful |  |
| P092 | Longer password-reset token lifetimes improve usability while widening the window for misuse. | Making reset tokens last longer is friendlier for users, but gives attackers more time to abuse them. | faithful |  |
| P093 | Self-hosting the search cluster avoids licence fees but means the team must handle upgrades and on-call. | A self-hosted search cluster has no licence fees; upgrades and on-call become the team's job. | faithful |  |
| P094 | Read replicas are available for PostgreSQL databases on the Pro tier. | Read replicas are available for databases on the Pro tier. | distorted | Reader believes read replicas are available for any Pro-tier database, whereas only PostgreSQL. |
| P095 | Poor sleep was correlated with lower productivity scores in the survey. | In the survey, poor sleep lowered productivity scores. | distorted | Reader believes poor sleep caused lower productivity, whereas the survey only found a correlation. |
| P096 | Tests pass on Linux and macOS, while two suites still fail on Windows. | On Windows, two test suites remain broken; Linux and macOS are green. | faithful |  |
