# Second unseen set — author draft vs reviewer labels

Written after the 2026-11-13 recording. Neither key was changed; the reviewer's labels (`labels.json`) are the reference. The author was a separate agent that never saw the rules.

| | Contradiction | Compatible | Ambiguous |
|---|---|---|---|
| Reviewer | 22 | 29 | 5 |
| Author draft | 21 | 26 | 9 |

**6 pairs** have different labels:

| ID | Statements | Author draft | Reviewer (reference) |
|---|---|---|---|
| v10 | "Coworking members can reserve a meeting room for up to 2 hours." / "Coworking members can book a room for up to 4 hours." | ambiguous — unclear whether 'a room' is the same meeting-room type | **contradiction** — The same unqualified coworking-member booking policy is described with different maximum durations of two and four hours. |
| v28 | "The call centre's quality team reviews call recordings weekly." / "Call recordings are reviewed monthly." | ambiguous — second may refer to a different reviewer or review type | **compatible** — Weekly quality-team reviews can coexist with a separate monthly review process; neither statement excludes additional reviews. |
| v33 | "The clinic stopped offering walk-in appointments in 2023." / "The clinic currently accepts walk-in patients every weekday morning." | contradiction — stopped in 2023 vs currently offered | **ambiguous** — The clinic stopped offering walk-ins in 2023, but the service may subsequently have been reinstated. The intervening history is missing. |
| v35 | "Lab visitors must sign the safety register." / "Signing the safety register is optional." | ambiguous — second has no subject; may apply to staff rather than visitors | **contradiction** — Signing the same safety register cannot be both mandatory and optional for lab visitors. |
| v40 | "The hotel has 120 rooms." / "The hotel has 95 rooms available for booking." | ambiguous — unclear if some rooms are out of service or a count disagrees | **compatible** — A hotel with 120 rooms can have only 95 available for booking. |
| v48 | "The factory line produces 400 units per shift." / "The factory line produces 1,200 units per day." | ambiguous — consistent only if there are three shifts per day | **compatible** — Producing 400 units per shift can result in 1,200 units per day if there are three shifts. |
