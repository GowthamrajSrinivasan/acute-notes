# Live comparison — Jev vs the chat model on the merge's questions (2026-10-09)

36 labelled statements against three topics: 14 contradictions, 13 additions, 9 repeats (20 of them hard: soft contradictions, additions that sound like changes, repeats with one new detail, repeats in other words). Jev: `typesafe/jev-1.13` (OpenRouter, typed). Chat: `openai/gpt-oss-120b` (AICredits).

| answerer | relation right | on the hard ones | contradictions caught | false alarms (additions/repeats called contradictions) | **additions dropped as 'nothing new'** | repeats left out as 'nothing new' | contradicted sentence right | misquotes (quote not in the notes) | time / statement |
|---|---|---|---|---|---|---|---|---|---|
| Jev (P ≥ 0.5 for 'nothing new') | 100% (36/36) | 100% (20/20) | 100% (14/14) | 0% (0/22) | 0% (0/13) | 100% (9/9) | 100% (14/14) | n/a (picked) | 613 ms |
| Jev (P ≥ 0.8 for 'nothing new') | 100% (36/36) | 100% (20/20) | 100% (14/14) | 0% (0/22) | 0% (0/13) | 78% (7/9) | 100% (14/14) | n/a (picked) | 613 ms |
| gpt-oss-120b (chat) | 97% (35/36) | 95% (19/20) | 93% (13/14) | 0% (0/22) | 0% (0/13) | 100% (9/9) | 93% (13/14) | 0% (0/14) | 5529 ms |

| # | topic: statement | truth | Jev relation | Jev P(nothing new) | Jev picked | chat relation | chat nothing new | chat quote |
|---|---|---|---|---|---|---|---|---|
| 1 | Pricing: Pro costs 15 dollars per month. | contradicts (s1) | contradicts | 0.04 | s1 | contradicts | no | “The Pro plan costs 12 dollars per month and includ” → s1 |
| 2 | Pricing: The Free plan now includes 25 AI actions per month. | contradicts (s0) | contradicts | 0.03 | s0 | contradicts | no | “The Free plan includes 10 AI actions per month.” → s0 |
| 3 | Pricing: Annual billing no longer gives any free months. | contradicts (s2) | contradicts | 0.04 | s2 | contradicts | no | “Annual billing gives two months free.” → s2 |
| 4 | Security: API keys are stored on our servers so they can sync across devices. | contradicts (s0) | contradicts | 0.02 | s0 | contradicts | no | “API keys are stored encrypted in the browser and a” → s0 |
| 5 | Security: Exports include the user's keys for convenience. | contradicts (s1) | contradicts | 0.02 | s1 | contradicts | no | “Exports do not include keys.” → s1 |
| 6 | Roadmap: Version 2 ships in April. | contradicts (s0) | contradicts | 0.05 | s0 | contradicts | no | “Version 2 ships in March.” → s0 |
| 7 | Roadmap: The mobile app will be built first, before the canvas editor. | contradicts (s1) | contradicts | 0.04 | s1 | contradicts | no | “The team of four is focused on the canvas editor f” → s1 |
| 8 | Roadmap: The team is now six people. | contradicts (s1) | contradicts | 0.03 | s1 | contradicts | no | “The team of four is focused on the canvas editor f” → s1 |
| 9 | Pricing: Pro also includes priority email support. | adds | adds | 0.04 | none | adds | no | — |
| 10 | Security: Keys are encrypted with AES-256 before they are stored. | adds | adds | 0.05 | none | adds | no | — |
| 11 | Roadmap: Version 2 will include a dark mode. | adds | adds | 0.03 | none | adds | no | — |
| 12 | Pricing: Annual billing is charged once, in January. | adds | adds | 0.06 | none | adds | no | — |
| 13 | Pricing: The Pro plan is twelve dollars a month and has 200 AI actions. | repeats | repeats | 0.89 | none | repeats | yes | — |
| 14 | Security: Our servers never see API keys; they stay encrypted in the browser. | repeats | repeats | 0.83 | none | repeats | yes | — |
| 15 | Roadmap: V2 is planned for March. | repeats | repeats | 0.84 | none | repeats | yes | — |
| 16 | Pricing: Free users get ten AI actions each month. | repeats | repeats | 0.88 | none | repeats | yes | — |
| 17* | Roadmap: We had to push version 2 back to late April. | contradicts (s0) | contradicts | 0.03 | s0 | contradicts | no | “Version 2 ships in March.” → s0 |
| 18* | Pricing: Pro now comes with 500 AI actions a month. | contradicts (s1) | contradicts | 0.03 | s1 | contradicts | no | “The Pro plan costs 12 dollars per month and includ” → s1 |
| 19* | Security: For backup, keys are uploaded to our cloud. | contradicts (s0) | contradicts | 0.03 | s0 | contradicts | no | “API keys are stored encrypted in the browser and a” → s0 |
| 20* | Pricing: Yearly plans are billed at the full monthly rate, with no discount. | contradicts (s2) | contradicts | 0.03 | s2 | contradicts | no | “Annual billing gives two months free.” → s2 |
| 21* | Roadmap: Mobile app development starts now, in parallel with the editor. | contradicts (s1) | contradicts | 0.02 | s1 | contradicts | no | “the mobile app starts after launch.” → s1 |
| 22* | Pricing: The Free plan is being discontinued; every account will need Pro. | contradicts (s0) | contradicts | 0.03 | s0 | adds ✗ | no | — ✗ |
| 23* | Pricing: Pro now also includes a shared team workspace. | adds | adds | 0.03 | none | adds | no | — |
| 24* | Roadmap: Version 2 also adds offline mode. | adds | adds | 0.04 | none | adds | no | — |
| 25* | Pricing: A new Team plan costs 30 dollars per user per month. | adds | adds | 0.02 | none | adds | no | — |
| 26* | Roadmap: After version 2, a version 3 is planned for September. | adds | adds | 0.03 | none | adds | no | — |
| 27* | Security: Exports can be password-protected. | adds | adds | 0.04 | none | adds | no | — |
| 28* | Pricing: Pro costs 12 dollars per month, billed through Stripe. | adds | adds | 0.05 | none | adds | no | — |
| 29* | Roadmap: Version 2 ships in March, with a public beta in February. | adds | adds | 0.03 | none | adds | no | — |
| 30* | Security: Keys are never sent to our servers, and they are wiped on sign-out. | adds | adds | 0.05 | none | adds | no | — |
| 31* | Pricing: The Free plan has 10 AI actions a month, and unused actions don't roll over. | adds | adds | 0.04 | none | adds | no | — |
| 32* | Roadmap: The four-person team works on the canvas editor before anything else. | repeats | repeats | 0.81 | none | repeats | yes | — |
| 33* | Security: Exported files leave the keys out. | repeats | repeats | 0.76 | none | repeats | yes | — |
| 34* | Pricing: Paying yearly gets you two free months. | repeats | repeats | 0.86 | none | repeats | yes | — |
| 35* | Roadmap: Mobile work begins once version 2 is out. | repeats | repeats | 0.83 | none | repeats | yes | — |
| 36* | Security: The browser keeps API keys encrypted, and nothing about them reaches our servers. | repeats | repeats | 0.73 | none | repeats | yes | — |

\* hard case. ✗ marks a wrong answer (for 'nothing new', only additions count: saying yes to one drops content).