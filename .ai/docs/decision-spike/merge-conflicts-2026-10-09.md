# Live check — topic merge, duplicates and conflicts, with Jev (2026-10-09)

## Part 1 — the merge as it runs

Answered by: **openrouter** (role decision; the fallback primary was set to always fail, so this was the typed model). 4 Jev requests in 1118 ms.

| new part | handled by | result |
|---|---|---|
| Pricing recap | Jev | filed under **Pricing** and judged to add nothing new → left out, named in the review |
| Keys and storage | Jev | filed under **Security** and judged to add nothing new → left out, named in the review |
| Support | Jev | filed under **Pricing** |
| Team offsite | Jev | filed under **NEW topic** |

Report: merged into {"Pricing":["Support"]}; new topics ["Team offsite"]; blocks left out as repeats 1 (0 under another topic); notes' own overlapping topics 0.

### The merged text the merge would write (what then goes through Update)

```markdown
# Product notes

## Pricing

The Free plan includes 10 AI actions per month. The Pro plan costs 12 dollars per month and includes 200 AI actions. Annual billing gives two months free.

Pro subscribers also get priority email support within one business day.

## Security

API keys are stored encrypted in the browser and are never sent to our servers. Exports do not include keys.

## Roadmap

Version 2 ships in March. The team of four is focused on the canvas editor first, and the mobile app starts after launch.

## Team offsite

Book the venue for the second week of June for 12 people.
```

## Part 1b — the same notes with the two contradicting parts

Outcome: **stepped aside: the chat task was asked (the test's primary refuses on purpose)**.

| part | Jev relation to its topic (P contradicts) |
|---|---|
| Pricing recap | repeats (0.00) |
| Keys and storage | repeats (0.00) |
| Support | adds (0.01) |
| Price change | contradicts (0.99) |
| Schedule | contradicts (0.92) |
| Team offsite | adds (0.01) |

## Part 2 — could a typed decision model flag contradictions?

16 labelled statements against the notes' topics (8 contradictions, 4 additions, 4 restatements). This is **not** part of the merge today (plan G3).

| answerer | 3-way right | contradictions caught | false alarms (additions/repeats called contradictions) | time per statement |
|---|---|---|---|---|
| Jev: 3-way choice (repeats / adds / contradicts) | 100% (16/16) | 100% (8/8) | 0% (0/8) | 609 ms |
| Jev: yes/no 'contradicts' (P ≥ 0.5) | n/a | 100% (8/8) | 0% (0/8) | 609 ms |
| gpt-oss-120b (chat, 3-way) | 100% (16/16) | 100% (8/8) | 0% (0/8) | 2540 ms |
| Gemini lite (chat, 3-way) | 88% (14/16) | 88% (7/8) | 13% (1/8) | 955 ms |

| statement | truth | Jev 3-way (conf) | Jev P(contradicts) | gpt-oss | Gemini lite |
|---|---|---|---|---|---|
| Pricing: Pro costs 15 dollars per month. | contradicts | contradicts (1.00) | 0.97 | contradicts | contradicts |
| Pricing: The Free plan now includes 25 AI actions per month. | contradicts | contradicts (1.00) | 0.96 | contradicts | adds ✗ |
| Pricing: Annual billing no longer gives any free months. | contradicts | contradicts (1.00) | 0.97 | contradicts | contradicts |
| Security: API keys are stored on our servers so they can sync ac | contradicts | contradicts (1.00) | 0.97 | contradicts | contradicts |
| Security: Exports include the user's keys for convenience. | contradicts | contradicts (1.00) | 0.97 | contradicts | contradicts |
| Roadmap: Version 2 ships in April. | contradicts | contradicts (1.00) | 0.97 | contradicts | contradicts |
| Roadmap: The mobile app will be built first, before the canvas  | contradicts | contradicts (1.00) | 0.98 | contradicts | contradicts |
| Roadmap: The team is now six people. | contradicts | contradicts (0.95) | 0.87 | contradicts | contradicts |
| Pricing: Pro also includes priority email support. | adds | adds (1.00) | 0.07 | adds | adds |
| Security: Keys are encrypted with AES-256 before they are stored | adds | adds (1.00) | 0.06 | adds | adds |
| Roadmap: Version 2 will include a dark mode. | adds | adds (1.00) | 0.06 | adds | adds |
| Pricing: Annual billing is charged once, in January. | adds | adds (0.91) | 0.12 | adds | contradicts ✗ |
| Pricing: The Pro plan is twelve dollars a month and has 200 AI  | repeats | repeats (1.00) | 0.03 | repeats | repeats |
| Security: Our servers never see API keys; they stay encrypted in | repeats | repeats (0.97) | 0.05 | repeats | repeats |
| Roadmap: V2 is planned for March. | repeats | repeats (0.98) | 0.03 | repeats | repeats |
| Pricing: Free users get ten AI actions each month. | repeats | repeats (1.00) | 0.03 | repeats | repeats |