# Unseen set — blind labelling sheet

Label each pair **before** looking at `author-draft-key.json` or running anything. For each: **contradiction** (they can't both be true about the same thing in the same context), **compatible** (both can be true), or **ambiguous** (can't tell without more information), and a short note if useful.

Return them as `labels.json` (or here, and I'll transcribe them verbatim): `{"reviewer": "…", "date": "…", "blind": true, "labels": {"u01": {"label": "…", "note": "…"}, …}}`.

| id | Statement A | Statement B | Label | Note |
|---|---|---|---|---|
| u01 | Payroll is processed every two weeks. | Payroll runs once a month. |  |  |
| u02 | In the sandbox, payments settle instantly. | In production, payments settle in two business days. |  |  |
| u03 | Guest users cannot export reports. | Report export is available to guest users. |  |  |
| u04 | The newsletter goes out weekly. | The newsletter is sent every seven days. |  |  |
| u05 | Reports are due on Monday. | Reports are due on Friday. |  |  |
| u06 | Each upload is limited to 25 MB. | Users can upload files of up to 100 MB. |  |  |
| u07 | Median page load time is 1.2 seconds. | The slowest 1% of page loads take over 6 seconds. |  |  |
| u08 | The certificate expires on 1 March 2027. | The certificate is valid until 30 June 2027. |  |  |
| u09 | The finance team approves refunds over 500 euros. | The support team approves refunds under 500 euros. |  |  |
| u10 | The finance team reconciles invoices every Friday afternoon. | Invoice reconciliation happens daily. |  |  |
| u11 | A ticket can be reopened up to three times. | This ticket was reopened twice. |  |  |
| u12 | The data platform team is the sole owner of the event pipeline. | The growth team is the sole owner of the event pipeline. |  |  |
| u13 | On Android, push notifications are enabled by default. | On iOS, push notifications are disabled by default. |  |  |
| u14 | The model is trained on 2 million examples. | The model's training set contains 500,000 examples. |  |  |
| u15 | The contract runs for 18 months. | The contract term is a year and a half. |  |  |
| u16 | It takes about a week. | It takes three days. |  |  |
| u17 | The mobile app does not store card numbers on the device. | Card numbers are stored on the device by the mobile app. |  |  |
| u18 | The API accepts at most 50 items per request. | Our client sends 20 items per request. |  |  |
| u19 | Two-factor authentication is mandatory for administrators. | Administrators may choose whether to turn on two-factor authentication. |  |  |
| u20 | Before the 2025 redesign, checkout had five steps. | Checkout has three steps. |  |  |
| u21 | The onboarding checklist has twelve steps, most of which new hires finish in their first week. | The onboarding checklist has seven steps. |  |  |
| u22 | The warehouse ships 300 orders a day. | The warehouse receives 300 deliveries a week. |  |  |
| u23 | The board meets twice a year. | The board meets every six months. |  |  |
| u24 | The DNS records are audited quarterly. | The DNS records are audited every month. |  |  |
| u25 | Average order value is 42 euros. | The largest order this year was 3,900 euros. |  |  |
| u26 | The team uses Postgres. | The team uses MongoDB. |  |  |
| u27 | The warehouse can hold at most 2,500 pallets. | The warehouse currently holds 4,000 pallets. |  |  |
| u28 | In Canada, phone support is offered in English and French. | In Brazil, phone support is offered only in Portuguese. |  |  |
| u29 | Guest users cannot edit reports. | Guest users can view reports. |  |  |
| u30 | All invoices are issued in euros. | All invoices are issued in US dollars. |  |  |
| u31 | Each seat costs 12 euros a month. | The whole plan costs 120 euros a month. |  |  |
| u32 | Version 2 of the SDK requires Python 3.9. | Version 3 of the SDK requires Python 3.11. |  |  |
| u33 | Sign-ups grew last quarter. | Sign-ups shrank last quarter. |  |  |
| u34 | Invoices are emailed to the billing contact. | Invoices are emailed to the billing contact and copied to the account owner. |  |  |
| u35 | Prices went up 10%. | Prices went up 4%. |  |  |
| u36 | Contractors do not have access to the payroll system. | Employees have access to the payroll system. |  |  |
