# AI consistency check — pilot notes

For pilot users of the AI consistency check (Stage 4f, limited pilot approved 2026-11-17). Read this before you switch it on.

## What it does

When you accept AI changes on a canvas, Acute looks for statements that may disagree with what your other cards already say. The rules catch clear conflicts on their own. With the AI check on, Acute also queues *near-misses* — pairs the rules can't settle (two schedules, two limits, two dates). When you press **Check with AI**, up to 10 queued pairs go to your own AI connection in one request. Its reading appears on the record. **You decide** every record: "It's a conflict", "Not a conflict", or "Later". The AI never changes a record's status and never edits a card.

## What it can miss

Measured on a set of 40 known contradictions (development evidence, one model):

- **It shows 90%** of them (36/40) — 87.5% if you check only one day's worth.
- **It calls 77.5%** (31/40) "likely". The other 5 shown are marked **"Possible: AI reads a conflict, held back for you to judge"**: the AI read a contradiction, but the statements carry dates, and they may cover different times. Treat these as real leads.
- **It misses 4 in 40 entirely:**
  - 3 where one statement reads like an exception, subgroup or narrower scope of the other ("all staff…" vs "contractors…");
  - 1 numeric limit it misread ("28 max" against "a cap of 30").
- **When it says "likely", it was right** every time on that set (31/31). It never called a compatible pair a conflict (0/45).

## What it never looks at

- **Edits you make by hand.** Only accepted AI change sets (Visualize, Ask AI, updates) are checked.
- **Content already on the canvas** when you opt in, and pairs between two older cards.
- **More than 20 related cards per statement**, and at most 10 pairs per press.

A clean panel does not mean your canvas has no conflicts.

## Setup

1. **Switches (your machine only).** Add `CONSISTENCY_AI_CHECK=on` and `NEXT_PUBLIC_CONSISTENCY_AI_CHECK=on` to `.env.development.local`, then restart the dev server. Never on a hosted or public deployment.
2. **Model.** Make **gpt-oss-120b** your primary AI connection, for example AICredits with `openai/gpt-oss-120b`. It is the only model measured; the panel warns if you use another one.
3. **Opt in.** Click the **Consistency** chip, open **AI check (pilot)**, and tick **Use AI to check possible conflicts on this device**.
4. **Check.** Work as usual. When pairs are waiting, press **Check with AI**.

## What it costs

Each press sends **one request** of at most 10 pairs, about 1,900 tokens (under $0.001 on gpt-oss-120b). It is never retried. Each device has a daily limit of **50 checks or 90,000 tokens**, roughly 46 checks (460 pairs) on a typical day. The panel shows what's left today, how many pairs are waiting, how many checks and days they need, and how long the oldest has waited. If the queue fills up (200 pairs), the oldest are dropped and the panel says how many.

## What to report (weekly)

Copy the panel's **Pilot feedback** line (AI "likely": confirmed / dismissed / open; AI "possible": the same) and note which model you used. A **dismissed "likely"** is the AI being wrong. The pilot stops if those exceed 10% of decided "likely" records, counted over at least 10 decisions. Also report anything the AI changed on its own (it should be impossible).

## Turning it off

- **For your device:** untick the opt-in. It takes effect at once; nothing is queued or sent.
- **For the machine:** set either switch to `off` and restart.

## Pilot length

The pilot runs 4 weeks, or ends earlier once Phase 2 has measured its improvements on a fresh test set. Before a wider release, the share called "likely" must reach 85%.
