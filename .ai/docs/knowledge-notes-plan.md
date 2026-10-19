# Knowledge Notes Plan: ideas over words

Status: **Approved, v3** (2026-10-19). All seven open decisions are approved, two with refinements (§12). Phase 0
has started; see §11 for its status. Behaviour stays exactly as it is until R1, and citation-based updates stay off
until R2. v2 answered the first design review (§0.2), stated what stays as it is (§0.3), and added the
implementation plan (§11) and the usability checks (§10). v3 records the decisions, two changes to promised
behaviour (export with sources, and uncertain cards never shown as verified), and splits §11 into small steps with
checkpoints. Other open work and how it relates to this plan is at the end of §11.

**The experience this plan is for:** a user understands a card quickly, checks it against the original in seconds,
and trusts that a later update changes only what really needs to change. Cards alone don't deliver that; the source,
the checks and the updates do.

Scope: how Acute turns content into notes (Visualize, Update, chat import), and the product direction those notes
serve. This is **Revision 3** of the [content fidelity plan](./content-fidelity-plan.md). It replaces that plan's
"Visualize, do not summarize" rule and its word-level coverage measure. Everything else from it stays: references
for tables and code, the analysis layer, honest fallbacks, layout and signalling.

---

## 0. Summary

**Goal:** the best note app for building and maintaining knowledge. It takes the best of Heptabase (cards you can
see, arrange and link, each traceable to its source) and of Notion (structured pages, properties, templates). It
keeps Acute's own strengths: AI output arrives already structured, and later AI updates merge in instead of
replacing.

**The change in one line:**

> **Distil on the canvas. Keep the source whole. Link every idea back.**

The canvas makes knowledge easy to understand. The source and the checks make it trustworthy. Acute needs both,
but it doesn't need to show the whole source on the canvas to achieve either.

Today the pipeline is built to prove that the source's words survived:

- the prompt asks for details "in the content's own words";
- a sentence counts as covered when 70% of its words appear on the canvas;
- whatever falls short is copied back onto the canvas.

The result is accurate, but it reads like a reshuffled transcript, and it is hard to update. Under this plan:

- cards hold **ideas**, in the model's own words;
- the source is kept unchanged in a **source panel**, at the version each card was made from;
- every card **cites** the source units it represents, and the citations drive coverage, review and updates.

**Acceptance criterion:** a reader understands the subject more easily than from the original text, can still check
any important claim, and can recover the original wording whenever it matters. §9 sets the release gates, and §10
how the usability promises are checked.

### 0.1 What we promise users, and where each promise is delivered

| Promise | Delivered by | Checked by |
|---|---|---|
| "My notes are easier to read than the source" | Distilled single-idea cards (§4) | Comprehension study and judge rubric (§10) |
| "I can check any card against its source in one click" | Source chip → panel at the card's own version (§5) | e2e U1 (§10) |
| "I can see what was left out, and why" | Unit states and omission reasons in the panel (§3.2, §5) | e2e U2 |
| "Anything the app isn't sure about is shown to me, briefly" | "Needs review" queue (§5.3) | e2e U3 and the review-time measure |
| "Exact details are never changed" | Protected content (§3.3) | Gate G4 (§9) |
| "An update changes only what changed, and never my edits" | Citation-driven reconcile (§6.1) | Gate G6 |
| "My existing canvases keep working" | `preserve` mode, no migration of saved content (§6.3) | Gate G7 |
| "Uncertain is never shown as verified" | A flagged card stays in Needs review until the user resolves it, whether or not the model check is on (§3.4) | Gate G2, e2e U3 |
| "My notes stay checkable when I export them" | Optional "Include sources" in export, with a warning when it is off (§6.4) | Gate G10, e2e U7 |

### 0.2 Response to the design review (2026-10-19)

| Review point | Change in v2 | Where |
|---|---|---|
| A. A citation isn't proof of correctness; word rules miss rephrased condition changes ("when the cache holds a valid result" → "whenever the cache is used") | Two new deterministic rules (changed condition, changed cause or effect). A labelled set of faithful and distorted paraphrases, measured for precision and recall of the rules. A model judge and human labels used **offline** for evaluation. The runtime model check stays flagged-only | §3.4, §7.2 |
| B. 100% accounted ≠ every important idea kept; a 30% threshold won't catch one critical omission | Three user-facing outcomes: **Represented**, **Intentionally omitted**, **Needs review**. **Critical units** (limits, warnings, requirements) can't be omitted without review, however small the share. The share threshold drops to a secondary signal. Tests plant one small critical omission | §3.2, §7.1 |
| C. IDs built on the heading path break on renames and cross-section moves; duplicates are fragile | IDs are opaque and independent of the heading. Section identity comes from the existing topic ids (`pathIds`, [topicIds.ts](../../src/ai/reconcile/topicIds.ts)). Matching runs over the whole document. Ambiguous matches become "changed, needs review", never a silent rebind. A full identity test matrix is a prerequisite for phase 3 | §3.1, §7.1 |
| D. Distil must not be the default before its replacement UI exists | Distil becomes the default only at release gate **R1**: phases 1 and 2 done, gates G1–G9 met. Until then the old safety net stays on in every mode the user can reach | §6.3, §9 |
| Source panel must show the right version | Cards store the source version. The panel opens that version (`getVersion`) and offers the newer version and the difference | §5.1 |
| Exactness: harmless formatting differences; names and action items escape | Numbers, quotes and paths are normalised before comparing. Named terms are a warning tier. Action items in prose are detected | §3.3 |
| Navigation with long sources and many citations | Section outline, "1 of 3" stepping, filters, windowed rendering, performance budgets | §5.2 |
| 50% word-count ceiling isn't a measure of readability | Kept only as an observed number with an alarm for transcript-like output. Readability is judged by the rubric and the study | §9, §10 |
| A few fixtures and one live run aren't evidence | Ten fixtures across kinds of content, each run 3 times. Critical gates must hold on **every** run, not on the median | §7.3, §9 |
| Phases 4–6 and runtime checks on every card can wait | Agreed; unchanged | §8 |

### 0.3 What stays as it is

This plan changes **how notes are written, checked and traced**. It doesn't remove or redesign existing features.
Three rules hold throughout:

1. **Additive or behind the switch.** Every change is either new (the Source tab, the review queue, unit IDs) or
   applies only when `noteModel` is `distil`. `preserve` is exactly today's behaviour, checked by snapshot tests (G7).
2. **Existing building blocks are reused, not replaced.** Topic ids, `getVersion`, source references, the analysis
   retry, the dense walk-through, conflict cards and the indicator budget carry the new behaviour.
3. **Anything outside Visualize and Update is out of scope.** Chat import follows only after R1, with its own check
   (OD6). The other features listed below don't change at all.
4. **Selection actions stay scoped** (the rule set on 2026-10-12). Anything started from a selected frame or card
   changes only that section: Re-visualize, Re-arrange, Regenerate, the review queue's Include / Add to canvas, and
   card-level updates. Each new action gets a test that nothing outside the selection changes, like
   [regenerateScope.test.ts](../../src/ai/reconcile/regenerateScope.test.ts). Re-arrange breaks this rule today, and
   Phase 0 fixes it first (§11).

| Feature (already built) | In this plan |
|---|---|
| Visualize: outline, section kinds, 9 templates, local tier, "Keep as text", "Visualize better" | Unchanged. Distil mode changes only the wording rule inside section prompts (§4.4) |
| Analysis layer: takeaways, `origin: "analysis"` cards, the analysis check and retry | Unchanged; in distil mode its retry is merged with the new reasons (WP1.10), still one retry per section |
| Tables and code placed by reference (`{"type":"source"}`), table repair | Unchanged; they become the exact tier (§3.3) |
| Honest fallbacks (Wave A): structure-only notice, Retry, logged causes | Unchanged; `pending` units use them |
| Regenerate, once per section, never worse (A2) | Unchanged; in distil mode "better" is judged by fewer Needs review items and no protected item lost, instead of AI-placed share |
| Layout and signalling: relation styles, numbered steps, overview cards, landscape packing, routing, `mergeDetailCards` | Unchanged |
| Indicators: dense markers and walk-through, stale markers, added dots, one bottom bar | Unchanged; Needs review joins the same budget (one marker per object) |
| Review bar: Accept / Reject, one-step undo, Review never blocks Accept | Unchanged; chips change wording in distil mode only |
| Update from new content: section diff, `preserve.ts`, conflict cards, "Keep mine", removals never silent | Unchanged until R2; phase 3 narrows the same flow from sections to cards |
| Topic ids for renamed sections, "Changed over time" pages (`revisions.ts`) | Reused (§3.1, the `superseded` reason) |
| Content sources: device-local, append-only versions | Unchanged; versions gain `units` and `lineage`, and old records still load |
| Chat import / topic merge, economy mode | Unchanged until after R1 (OD6) |
| MCP tools, `render_visual_plan`, Repo Map, auto-accept for Repo Map sessions | Not affected: their agents address nodes by key, and they don't use these prompts |
| Lens (profiles, project kinds, `refs`, "Move to canvas…") | Not affected; phase 4 builds on it later |
| Pages, blocks, editing, export, search, provenance (Origin section) | Unchanged; the Source tab sits beside Origin. Export gains one option, "Include sources" (§6.4); every existing option and older bundles stay as they are |
| Summarize | Unchanged, still a separate action |
| Saved canvases, including their "Also in the source" cards and "Source details" pages | Never changed by the app (§6.3) |

**What does change, for the record:** the distil prompt rule, the coverage measure and the safety net's on-canvas
copies (distil mode only); the review chips' wording (distil mode only); and, new, the Source tab, the review queue,
unit IDs and lineage, the "Include sources" export option, and card-level updates from R2.

---

## 1. Why the current approach falls short

| Today | Where | Effect |
|---|---|---|
| "Every piece of information … in the content's own words" | `FIDELITY_RULE`, `analysisRule` ([tasks.ts](../../src/ai/visualize/tasks.ts)) | The model copies instead of distilling |
| A unit is covered at ≥ 70% of its significant words | `COVERAGE_THRESHOLD`, `coverageOf` ([information.ts](../../src/ai/fidelity/information.ts)) | A faithful paraphrase fails; a copy that drops "only if" passes |
| Uncovered units are attached word for word as "Also in the source" cards or "Source details" pages | `attachUncovered` ([safetyNet.ts](../../src/ai/fidelity/safetyNet.ts)) | The canvas carries a second copy of the source |
| "AI placed N%" leads the review; condensing models get a warning | `CoverageRow.tsx`, `FIDELITY_CONFIG.modelGuidance` | Distilling is shown as a failure |
| Source blocks are numbered per run (`T1`, `P1`) and then forgotten | `numberSource` ([sourceBlocks.ts](../../src/ai/fidelity/sourceBlocks.ts)) | A card can't say which passage it came from once the run ends |
| Units are keyed by heading path; spans are kept only by the local tier | [units.ts](../../src/ai/reconcile/units.ts), [keys.ts](../../src/ai/reconcile/keys.ts) | Updates work per section, not per idea |
| No view shows the original source next to the notes | — | People keep the source on the canvas because it can't be found anywhere else |

The content fidelity plan already named the gap. Its ledger design (§3.2: facts, `covers`, and checks on
qualifiers) and the "reference, don't regenerate" work in Wave B1 are the foundation of this plan. What changes is
where preservation happens: **in the source panel, not on the canvas.**

---

## 2. What we take from other tools (and what we don't)

| From | Idea | In Acute today | This plan |
|---|---|---|---|
| **Heptabase** | Cards are the unit of knowledge, arranged on whiteboards and linked | Cards, frames and typed arrows: built | Cards become single ideas with citations (§4) |
| **Heptabase** | Highlights in a source link to the cards made from them | None | Source panel with two-way highlighting (§5) |
| **Heptabase** | One card can appear on several whiteboards | No: every block belongs to exactly one canvas (`DocumentHome`). Lens `refs` can point across canvases | Phase 4 (§8) |
| **Notion** | Pages of rich blocks; templates | BlockNote pages; 9 Visualize templates: built | Unchanged |
| **Notion** | Properties (type, status, tags, dates) and views over them | Only `ObjectMetadata.tags` (no UI) and the Lens project kinds | Phase 5 (§8), in panels and lists, not as canvas chrome (PRD §1.1) |
| **Notion, Obsidian** | Backlinks and mentions | None | Phase 4 (§8) |
| **NotebookLM, Perplexity** | Every claim cites its source | `{"type":"source","ref":…}` for whole blocks only | Citations on every card (§3) |
| **Ragas, LLM evaluation practice** | Faithfulness judged claim by claim against the context, over repeated trials | Word overlap, one run per fixture | Labelled paraphrase set, offline judge, repeated runs (§7) |
| **Zettelkasten** | One idea per note, in your own words | Prompts ask for the source's own words | The default card (§4.2) |
| **Progressive summarization** | Headline → key points → detail → original | Takeaway → analysis → source detail (Revision 2) | Same layers; the last one moves to the source panel |
| **Obsidian** | Local-first, portable, links that survive renames | Local-first: built; JSON export without content sources; section renames keep topic ids | IDs survive renames (§3.1); export is OD3 |

**What we don't take:** a Notion-style canvas UI, a database builder, or nested sidebars. PRD §1.1 ("The canvas
must not become a Notion-style UI") still applies. Notion's structure comes in through pages, properties and the
side panel. The canvas keeps the Excalidraw feel.

---

## 3. The fidelity model

Three separate questions, each with its own check. Tracing a card to a source unit does not make the card
correct, so these are never merged into one score.

| Dimension | Question | How it's checked | Runtime cost |
|---|---|---|---|
| **Coverage** | Is every important idea represented, deliberately omitted, or shown for review? | Deterministic: unit accounting and critical units (§3.2) | None |
| **Exactness** | Did the protected details survive exactly? | Deterministic: protected-item check (§3.3) | None |
| **Fidelity** | Does each card keep the meaning of what it cites, including qualifiers, conditions and causes? | Deterministic rules (§3.4), proven offline against a labelled set (§7.2); optional model check for flagged cards only | None by default |

### 3.1 Source units with stable IDs

A **unit** is a paragraph sentence, a list item, a table row, a code block or a block quote, as the safety net
already splits them (`sentences`, `itemText` in [safetyNet.ts](../../src/ai/fidelity/safetyNet.ts)).

**IDs are opaque** (`u` + a short counter per source, e.g. `u17`) and never contain the heading. Each unit also
records:

- `hash`: cyrb53 of the normalised text (the `fingerprint.ts` hash);
- `topic`: its section's topic id, the existing `pathIds` mechanism, so a renamed heading keeps its identity
  ([topicIds.ts](../../src/ai/reconcile/topicIds.ts));
- `kind` and `span` (character range in that version's text);
- `prev` / `next`: its neighbours' IDs, used for matching.

**Matching a new source version to the previous one** runs over the whole document, in order. Each step is
one-to-one: a matched old unit can't be used again.

| Step | Rule | Result |
|---|---|---|
| 1 | Same hash, and the hash is unique in both versions | Same ID, `unchanged` (a move to another section is still `unchanged`; its `topic` updates) |
| 2 | Same hash, repeated: pair the repeats in document order, using neighbours to break ties | Same ID if the neighbours agree; otherwise `ambiguous` |
| 3 | No hash match: same topic, ≥ 0.8 significant-word overlap, a neighbour matched in step 1 or 2 | Same ID, `changed` |
| 4 | No hash match, any topic: ≥ 0.9 overlap and exactly one candidate | Same ID, `changed` (moved and edited) |
| 5 | None of the above | New ID. An old ID left over is `removed` |

**Ambiguity is never resolved silently.** An `ambiguous` unit gets a new ID. Every card that cited the old
candidates is marked "source changed" and goes to **Needs review** (§5.3), so it is never bound to the wrong
passage.

**Stored** with the source version: `ContentSourceVersion.units` and `ContentSourceVersion.lineage` (old ID → new
ID and state). Source text stays append-only, as today.

**In the prompt**, units get short labels per section (`P2.3` = paragraph 2, sentence 3; `L1.4` list item; `T1.r4`
table row; `C1` code) that the app maps to IDs. The model never sees or retypes IDs, so citations cost little output.

**Units stay at sentence level for now.** Splitting a sentence into separate claims would need a model call or
fragile clause rules. Compound sentences are protected by the condition and cause rules (§3.4) and by critical
units (§3.2). A compound-sentence fixture (§7.3) checks this. Claim-level units come later only if it fails.

### 3.2 Coverage: what the reader sees

**Internal states,** one per unit at the end of a run:

| State | Meaning | Set by |
|---|---|---|
| `cited` | At least one card cites it, and its checks pass | Model's `cites`, checked by the app |
| `omitted` | Left off the canvas for an allowed reason | Model, checked by the app |
| `restored` | The app put protected content back after the model left it out (§3.3) | App |
| `review` | The app can't confirm it was safely represented or omitted | App |
| `pending` | Not processed (a failed section, an over-long reply) | App |

**User-facing outcomes:** three words, the same everywhere (chips, panel, review bar):

| Outcome | Internal states | Shown as |
|---|---|---|
| **Represented** | `cited`, `restored` | Plain in the panel; counted in the chip |
| **Intentionally omitted** | `omitted` | Grey in the panel, with the reason |
| **Needs review** | `review`, `pending`, and `cited` with a fidelity flag | Amber in the panel; listed in the review queue (§5.3) |

**Omission reasons** are a fixed list: `filler` (greetings, sign-offs, "as discussed"), `duplicate` (names the unit
it repeats), `superseded` (a later statement wins: [revisions.ts](../../src/ai/history/revisions.ts)), `meta` (talk
about the text rather than its subject).

**Critical units.** Some units carry what a reader must not lose, however short they are. A unit is critical when
it is any of these:

- a limitation, warning or caveat: *however, but, although, limitation, caveat, risk, warning, note that, beware,
  does not, cannot, not suitable*;
- a requirement or prohibition: *must, must not, never, do not, required, only, at least, at most*;
- a condition on a claim: *if, when, unless, only when, provided that*;
- the section's takeaway source sentence (the unit the model's takeaway cites);
- protected content (§3.3).

The cue words are only an indicator. They are tuned on the labelled set (§7.2), and the list lives in
`FIDELITY_CONFIG` so it can be changed without a release.

**Omission rules:**

- A critical unit omitted for any reason except `duplicate` (of a cited unit) or `superseded` → **Needs review**,
  even if it is the only omission in the document.
- A protected unit omitted → `restored` (§3.3).
- `duplicate` must name a unit that is itself cited; otherwise → Needs review.
- `pending` is never shown as complete. It always gets the Wave A notice and a Retry.
- A high omitted share (default 30% of a section's units) adds a section note. It is a secondary signal, never the
  only one.

This replaces `coverageOf` / `COVERAGE_THRESHOLD` as the coverage measure. The word-bag functions stay for the
other rules and for diagnostics.

### 3.3 Exactness: protected content

| Tier | Protected | Detected by | Rule |
|---|---|---|---|
| **Exact** | Numbers with units, versions, paths, identifiers | `keyTerms` (exists) | Appear in a card citing the unit, after normalisation |
| **Exact** | Tables of data, code | Block kind | Placed by reference (`{"type":"source"}`: exists), never retyped |
| **Exact** | Direct quotes | `"…"` / `“…”` spans, block quotes | Exact inside quotation marks, after normalisation |
| **Exact** | Decision and item IDs (D1, A1, HK-3, #25) | `itemIds` (exists) | Appear in a card citing the unit |
| **Exact** | Action items | Checklist items; prose with an owner (`@name`, "Alice to …"), a due date ("by Friday", a date), or "TODO / Action:" | Can't be omitted; owner, date and verb kept |
| **Warn** | Named terms: product, technology and proper names | Back-ticked terms, and capitalised terms not at sentence start that occur in the source | A missing or changed one is a fidelity flag, not an insertion |

**Normalisation before comparing**, so harmless formatting doesn't fail the check: thousands separators
(`1,000` = `1000`), Unicode quotes and dashes, back-ticks and bold markers, trailing punctuation, whitespace, and
case for words (never for paths or identifiers). Unit spelling variants (`ms` / `milliseconds`, `%` / `percent`) come
from a small table.

A missing exact item gets **one targeted retry** ("T1.r4's `0.5` is missing"), merged with the other retries of that
section (§11, WP1.10). If it is still missing, the item is added to the citing card as a short "From the source" line,
and the chip says so. Nothing protected is lost silently.

### 3.4 Fidelity: does the card keep the meaning?

**Deterministic rules,** run for each card against the units it cites:

| Rule | Example it catches |
|---|---|
| **Dropped qualifier:** a hedge or limit in the unit (*can, may, might, often, typically, some, at most, at least, up to*) is in no card citing it | "**can** improve retrieval" → "improves retrieval" |
| **Dropped or changed condition:** the unit has a condition (*if, when, unless, only when, provided that*). Either no citing card has one, or the card's condition shares < 50% of the unit's condition's significant words, or it widens it (*whenever, always, in any case*) | "reduces latency **when the cache contains a valid result**" → "reduces latency **whenever the cache is used**" |
| **Changed cause or effect:** the unit links two parts with a causal marker (*because, so, causes, leads to, reduces, increases, prevents, depends on*); the card has the same marker, or its opposite, with the parts swapped, or with the opposite direction (*reduces* ↔ *increases*) | "A **causes** B" → "B **causes** A"; "**reduces** load" → "**increases** load" |
| **Added absolute:** *always, never, all, every, none, guaranteed* on the card but not in the cited units | → "Hybrid search **always** improves …" |
| **Negation flip:** the unit and the card disagree on *not / no / never / without* about the same key words | "does **not** retry" → "retries" |
| **Unsupported number:** a number or identifier on the card that none of its cited units contains | A made-up "3×" |
| **Citation sanity:** a card cites a unit with no overlap in significant words or key terms | A citation added only to satisfy coverage |

These rules are an inexpensive first layer. They are not assumed to be enough: §7.2 measures how often they catch
real distortions (recall) and how often they flag faithful paraphrases (false alarms). Rules are tuned until both
targets are met, or a rule is dropped if it can't reach them.

Analysis cards (`origin: "analysis"`, D-R2.1) may infer, so the "unsupported" rules don't apply to them. The
qualifier, condition, cause and negation rules still do.

A flagged card gets one retry with the reason (merged with the section's other retries), then **Needs review** if
it is still flagged. It is never blocked or deleted.

**Optional runtime model check** (`FIDELITY_CONFIG.semanticCheck`, **off** by default): one batched call per section,
only for cards still flagged after the retry. It asks whether each card is supported by its cited text and returns
supported / partly / not supported with a reason. "Not supported" stays in Needs review. It needs the user's explicit
setting and is counted in usage, because it costs money.

**Uncertain is never shown as verified (OD5, approved 2026-10-19).**
- With the model check off (the default), a card the rules flag stays in **Needs review**, amber, until the user
  resolves it. It is never counted as Represented, and no chip or total hides it.
- With the check on, "supported" lets the card leave Needs review automatically. The chip then says "checked by AI"
  and keeps the rule's reason in its tooltip. "Partly" and "not supported" stay in Needs review.
- The app never uses the words "verified" or "correct" for a card. A card is *represented*, *needs review*, or
  *checked by AI*, and only the user's own action marks it resolved.

**Human review is the exception, not a step.** Only Needs review items ask for a look (§5.3).

---

## 4. Cards

### 4.1 What a card carries

- `cites: string[]` on `VisualNode` (unit labels in the reply, mapped to IDs). On the object:
  `AIMetadata.sourceUnits` (IDs) with `contentSourceId` / `contentSourceVersion`. It is a reconciliation field: dropped
  for export, MCP and search by `normalizeAIMetadata`, like the others.
- `origin: "analysis"` where it applies (unchanged).
- `review?: { reasons: string[]; resolved?: "kept" | "edited" | "included" | "dismissed" }`, so a resolved flag
  doesn't return on every update unless its cited units change.
- Tables and code keep arriving by reference, with their unit IDs.

### 4.2 Default card shape (a guide, not a template)

- **Title states the point:** "Hybrid search combines complementary signals", not "Hybrid search".
- **Body:** as much as the idea needs. That may be one sentence for a definition, or a few bullets, a small table or
  a trade-off line for a mechanism. There is no length cap that would push out nuance. A card over the existing
  dense limit is split into linked cards, never shortened.
- **Optional parts,** only when the content has them: *how it works*, *trade-off*, *limits*, *example*, *open
  question*. Never empty headings, and no fixed labels on every card.
- **Limits stay with their claim.** A critical unit's condition or caveat goes on the same card as the claim it
  limits, not on a separate card the reader might skip.
- **One idea per card.** Two ideas become two cards, linked when the source relates them.
- **A source chip,** not raw IDs: "3 sources" in the card's corner, amber when the card needs review. Clicking it
  opens the source panel on those passages.

### 4.3 When the source's wording goes on the card

Only for protected content (§3.3), or when the user pins a passage ("Pin quote" in the source panel). Everything
else is distilled.

### 4.4 Prompt changes

- `FIDELITY_RULE` → `DISTIL_RULE`, used only when `noteModel` is `distil`:
  - "Write each idea in your own words, one idea per card, title states the point."
  - "Cite every source unit you represent; omit a unit only for the listed reasons, and list your omissions."
  - "Keep protected details exact. Keep every condition, limit and caveat with the claim it applies to."
- `analysisRule`: in distil mode, drop "in its own words, nothing left out". Takeaway and analysis stay.
- `REFERENCE_RULE`: unchanged for tables and code.
- Section kinds (`sectionKinds.ts`): the detail channel stays, filled with distilled cards rather than source text.
- Reply shape: `cites` per node and `metadata.omitted: [{ unit, reason, of? }]` per section. Both are parsed
  leniently: a missing or malformed list degrades the section to Needs review, never fails generation.
- Merge / chat import (`merge.ts`, `compose.ts`): the same rule, after Visualize passes R1 (OD6).

---

## 5. Source panel and review

### 5.1 The panel

A **"Source" tab beside Properties** in the side panel (OD1). It shows the content source of the selected card or
frame.

- **The right version:** the panel opens the version the card was made from (`AIMetadata.contentSourceVersion`,
  loaded with `ContentSourceRepository.getVersion`). If a newer version exists, a bar says "Source updated since this
  card" with **View latest** and **What changed** (the unit lineage, §3.1).
- **Two-way highlighting:**
  - select a card → its cited passages are highlighted and scrolled into view;
  - select a passage → the cards citing it are outlined on the canvas (camera moves, honouring reduced motion).
- **Marks,** one per outcome (§3.2): Represented (plain), Intentionally omitted (grey, reason on hover), Needs review
  (amber, reason on hover). The colours follow the indicator budget: amber already means "look at this".
- **Actions on a passage:**
  - **Add to canvas:** a card from the passage, made by the local tier, with no AI call;
  - **Pin quote:** the passage, word for word, on the selected card;
  - **Include:** on an omitted unit, moves it to Represented and adds a card.
- **Unavailable source:** a canvas from another device or an import has no local source. The tab says "Source not on
  this device", and cards keep their chips in grey. An import that included its sources restores them (§6.4), so
  this happens only with exports made without sources.
- Built on [sources.ts](../../src/ai/content/sources.ts) and the Origin section
  ([ProvenanceSection.tsx](../../src/components/properties/ProvenanceSection.tsx)).

### 5.2 Long sources and many citations

Sources can be up to 200k characters, and a card can cite passages far apart.

- **Section outline** at the top of the panel (the topic headings), with counts per outcome; click to jump.
- **Step through citations:** "Passage 1 of 3 ‹ ›" when a card cites more than one.
- **Filters:** All · Needs review · Omitted · Not on canvas.
- **Collapsed sections:** sections with nothing selected or flagged fold to their heading.
- **Windowed rendering:** only visible sections are rendered, so a 200k-character source stays responsive.
- **Budgets** (checked in e2e, §10): the panel opens within 300 ms on a 200k-character source, and a selection
  highlights within 100 ms.

### 5.3 Review

**Section chips** (`SectionChips.tsx`): instead of "AI placed N% · +N from source", a section reads
"**38 represented · 3 omitted · 1 needs review**". The bar totals change the same way. The model-tier warning becomes:
"This model may drop conditions; check the items that need review."

**Review queue:** "Review 4" in the bar steps through Needs review items one by one, like the existing dense-block
walk-through. Each step shows the card and its cited passage side by side, with the reason ("condition changed:
source says *when the cache contains a valid result*"). The user resolves it with one action:

| Action | Effect |
|---|---|
| **Keep** | The card stays as it is; the flag is resolved |
| **Edit** | Opens the card; saving resolves the flag |
| **Use source wording** | Pins the passage on the card |
| **Include** (omitted unit) | Adds a card for it |
| **Dismiss** (omitted unit) | Confirms the omission |

Review never blocks Accept (as decided in Revision 2). Unresolved items stay amber on the canvas until resolved or
until their source changes. They go in the indicator budget: one marker per object.

**Safety net:** in distil mode it no longer adds "Also in the source" cards or "Source details" pages. The units it
would have attached are visible in the panel as Needs review or Intentionally omitted, one click from Add to canvas
or Include.

---

## 6. Updates, versions and migration

### 6.1 Updates driven by citations

The reconciler today diffs **sections** (topic units) and resends a changed section. With unit lineage (§3.1) it
narrows to the **cards** affected:

| Unit lineage | Effect on the cards citing it |
|---|---|
| `unchanged` (also when moved) | Untouched, no model call (the `preserve.ts` path). A move between sections is proposed as a move of the card, never as remove + add |
| `changed` | Resent with their current text and the unit's old → new text; the other cards in the section are kept |
| `ambiguous` | Not rewritten. Marked "source changed" and put in Needs review |
| `removed` | All its cited units removed → the card's removal is proposed (never silent). Some removed → the card is re-checked and marked "source changed" |
| New unit | Sent as new content for its section; may become a new card or join one |
| Card edited by the user | Conflict card, as today (`classify.ts`). User edits always win |

A resolved review flag stays resolved while its cited units are `unchanged`.

**Cost:** fewer cards resent per update is expected but is only claimed once measured against the chat-import cost
baseline (§9, G9).

### 6.2 Versions

- Source text: append-only, unchanged (`ContentSourceVersion`), now with `units` and `lineage`.
- Notes: `noteModel: "preserve" | "distil"` on `ChangeSet.metadata` and on each object's AI metadata, so the app
  knows which rules a card was made under. A later change to summarization or layout never touches the stored
  source.

### 6.3 Migration and the switch

- **Saved canvases are not changed.** Existing "Also in the source" cards and "Source details" pages stay. They are
  ordinary content the user may have edited.
- **First update of an old canvas:** no unit IDs yet → the existing section-level reconcile runs, and the new version
  gets unit IDs. Later updates use §6.1.
- **The switch:** `FIDELITY_CONFIG.noteModel`.
  - Until **R1** (§9): `preserve` is the only mode users can reach. `distil` is a developer setting, used by tests.
    The old safety net stays on.
  - At **R1**: `distil` becomes the default for Visualize, and "Keep full detail" (`preserve`) is a choice in the
    Visualize dialog, for content that must stay near-verbatim (legal text, specs).
  - At **R2**: citation-driven updates (§6.1) are turned on.
- **Visualize ≠ Summarize, revised:** Visualize now distils, but it can't silently lose anything. The source is
  kept, every unit is accounted for, and anything uncertain is shown. "Summarize" (shorter, may drop detail) stays a
  separate action.
- **The old metric:** the 70% word coverage stays in the fidelity e2e report as a diagnostic until R1, then is removed
  from the review UI.

### 6.4 Export and import with sources (OD3, approved 2026-10-19)

Content sources are device-local today and left out of every export, so an exported canvas would lose its
citations. Export gets one new option, in the same pattern as the existing ones
([exportOptions.ts](../../src/portability/exportOptions.ts)):

- **"Include sources"** (`ExportOptions.sources`): the canvas's content sources with **every version's text**, the
  version numbers, `units`, `lineage`, `pathIds` and `revisions`, plus the reconciliation fields needed to resolve
  citations (`contentSourceId`, `contentSourceVersion`, `sourceUnits`). Today `normalizeAIMetadata` drops those
  fields on export; they are kept only when this option is on.
- **Default:** on for a workspace backup and a canvas export, because those are the user's own files. Any future
  share flow (a link, a hosted copy, which is deferred) starts with it **off**, because sources can hold sensitive
  material the canvas doesn't show.
- **Warning when off:** "This file won't include the original sources. Citations in it can't be checked." Shown in
  the export dialog, not as a blocker.
- **Size:** the dialog shows the sources' size beside the option, since source text can be large.
- **Import:** sources in a bundle are restored to the device store under the imported canvas, with new source IDs
  mapped consistently, so every card's citations resolve. A bundle without sources imports as today, and the
  Source tab says "Source not on this device".
- **Format:** a new optional `sources` section in the `.acute.json` bundle, with a schema version bump. Older files
  still import, and older app versions ignore the section.
- `preserve` canvases benefit too: their Origin section can also show the source after an import.

---

## 7. Test and evaluation strategy

Unit tests and local e2e run with a mock AI and cost nothing. **Any run against a real model, including the offline
judge, needs explicit approval for that run.**

### 7.1 Deterministic tests

| Area | Cases |
|---|---|
| Unit identity | Insert a sentence at the top: no other ID changes · reword a sentence: same ID, `changed` · **rename a heading**: same IDs · **split a section** in two: IDs follow their text · **move a paragraph to another section**: same IDs, `unchanged` · move and edit: `changed` · repeated identical sentences: stable IDs · **delete one of three duplicates**: the other two keep theirs, or are `ambiguous` (never swapped) · heavy rewrite: new IDs, old cards "source changed" |
| Coverage | All units accounted · `filler` accepted · **one critical caveat omitted among 40 units → Needs review** · protected unit omitted → `restored` · `duplicate` of an uncited unit → Needs review · failed section → `pending`, never complete |
| Exactness | Numbers, paths, quotes, item IDs and action items survive · `1,000` vs `1000` and curly quotes pass · a missing one → retry → "From the source" line · a changed named term → flag |
| Fidelity rules | Run against the labelled set (§7.2) in CI: recall and false-alarm targets enforced |
| Cards | Titles are statements · a caveat stays on its claim's card · no raw IDs shown · over-dense cards split, not cut |
| Updates | One changed sentence resends only the cards citing it · a move is proposed as a move · ambiguous → Needs review, no rewrite · removed unit → removal proposed · edited card → conflict · old canvas → section path, then IDs · resolved flag stays resolved |
| Migration | `preserve` output identical to today (snapshot) · saved canvases load unchanged |

### 7.2 The labelled paraphrase set

A versioned file, `src/ai/fidelity/__fixtures__/meaning/pairs.json`: each entry is a source unit, a card text, and a
label (`faithful`, or `distorted` with the kind of distortion). Target size: **at least 200 pairs**, about half
distorted, covering:

| Kind | Faithful example | Distorted example |
|---|---|---|
| Qualifier | "can improve" → "may improve" | "can improve" → "improves" |
| Condition | "when the cache holds a valid result" → "if a valid result is cached" | → "whenever the cache is used" |
| Negation | "does not retry" → "never retries" | → "retries" |
| Cause and effect | "A causes B" → "B results from A" | → "B causes A" |
| Quantity | "up to 3 retries" → "at most three retries" | → "3 retries" |
| Trade-off | "faster but uses more memory" → "speed costs memory" | → "faster and lighter" |
| Scope | "for read-only workloads" kept | scope dropped |
| Compound sentence | Claim and caveat on one card | caveat lost |

How it's used:

1. **Deterministic rules (every CI run, no cost):** recall on distorted pairs and false-alarm rate on faithful ones,
   per kind. Targets: **recall ≥ 90%** on qualifier, condition, negation and quantity; **≥ 75%** on cause and
   trade-off; **false alarms ≤ 10%** overall.
2. **Model judge (offline, approved runs only):** the same pairs judged by a model with a fixed rubric (supported /
   partly / not supported). It is used to find distortions the rules miss, which become new pairs or new rules,
   and to check the runtime check's prompt before OD5 is revisited. The judge is never part of the CI gate.
3. **Human labels (OD7, approved with a refinement):** I draft the pairs and a written labelling rubric (what counts
   as faithful, partly faithful or distorted, with worked examples per kind). The user or team labels every pair
   against the rubric. A 50-pair sample is labelled twice to check agreement. **Every disagreement is resolved,** by
   rewriting the pair, removing it or clarifying the rubric, **before the set becomes a release gate.** The rubric is
   versioned with the set.

**Balance and reporting.**
- Each kind has at least **20 pairs, with at least 8 faithful and 8 distorted**, so each failure mode is measured
  on its own. 200 pairs is the starting size, not a guarantee; kinds that turn out to be weak get more pairs.
- Results are always reported **per kind** (recall, false alarms, pair count). There is no single aggregate score,
  and no gate passes on an average that hides a weak kind.

### 7.3 Fixtures and repeated runs

Ten fixtures, so the evidence covers more than one kind of content:

| # | Fixture | Tests mostly |
|---|---|---|
| 1–3 | Cheat sheet, hand-off note, decision-table reply (existing, `src/ai/fidelity/__fixtures__/`) | Tables, decisions, key terms |
| 4 | Hedged technical prose (the hybrid-search text) | Qualifiers, conditions |
| 5 | Technical documentation with code and config | Code by reference, paths, named terms |
| 6 | Compound sentences with caveats and causes | Condition and cause rules, critical units |
| 7 | Meeting notes with action items in prose | Action items, owners, dates |
| 8 | An argument with trade-offs and limitations | Critical omissions, trade-offs |
| 9 | A ChatGPT shared reply (from the test share links) | Real AI output |
| 10 | Update series: v1 → v2 with a rename, a move, an edit, a deletion and a duplicate | Identity, citation updates |

Each fixture is run **3 times** per approved live check (Wave F1). Results are reported as median and worst run.

---

## 8. Roadmap: Heptabase and Notion, in order

| Phase | What | Depends on | Size |
|---|---|---|---|
| **0. Prerequisites** | Scope Re-arrange to the selection, green the provenance guard, bring plan docs up to date (§11) | — | S |
| **1. Idea fidelity** | Unit IDs (§3.1), accounting (§3.2), exactness (§3.3), fidelity rules and the labelled set (§3.4, §7.2), `DISTIL_RULE` and `cites` (§4), behind `noteModel` | — | M–L |
| **2. Source panel and review** | Panel, versions, long-source navigation, chips, review queue, Add / Pin / Include (§5) | 1 | M |
| **R1** | **Release gate: distil becomes the Visualize default** (§9) | 1, 2 | — |
| **3. Citation updates** | Unit lineage in reconcile, card-level updates (§6.1) | 1, identity tests (§7.1) | M |
| **R2** | **Release gate: citation updates on** (§9) | 3 | — |
| **4. Cards as knowledge** | A card on several canvases (relaxes the one-canvas rule in `DocumentHome`; builds on Lens keys and D59), "Mentioned in" backlinks, a card library | R1 | L: own plan |
| **5. Structure** | Card properties (type, status, tags, date) from `tags` and the Lens kinds; saved lists and filters in the side panel; templates that set properties | 4 | M–L: own plan |
| **6. Retrieval** | Search indexes source text and units; "Ask the workspace" answers with citations to cards and passages | R1 | M: own plan |

Phases 1–3 are this plan. Phases 4–6 are direction only; each gets its own plan before work starts. They improve
organisation, not the correctness of new notes, so waiting doesn't weaken the core change.

---

## 9. Release gates

All gates run on the ten fixtures (§7.3) and the labelled set (§7.2). Gates marked **every run** must hold on each of
the 3 runs of each fixture, not on the median.

| Gate | Required evidence | Needed for |
|---|---|---|
| **G0 Labelled set ready** | Rubric written; every pair labelled; double-labelled sample agreed; all disagreements resolved; at least 20 pairs per kind | G1, G2 |
| **G1 Faithful paraphrases** | False alarms ≤ 10% **in each kind**; on fixtures, the median share of cards in Needs review ≤ 15% | R1 |
| **G2 Distortions** | Recall targets of §7.2 met **in each kind**; every distortion planted in fixtures 4, 6 and 8 flagged (**every run**); with the model check off, no flagged card is counted as Represented | R1 |
| **G3 Important coverage** | Every critical unit Represented or in Needs review, none silently omitted (**every run**); `pending` always has a notice | R1 |
| **G4 Exact details** | Zero exact-tier items missing after the retry step (**every run**) | R1 |
| **G5 Source access** | Every card's chip opens the cited passage of the version it was made from; e2e U1–U5 pass; panel budgets met | R1 |
| **G6 Updates** | Fixture 10: only cards citing changed units are resent; moves proposed as moves; ambiguous matches in Needs review; no card bound to the wrong passage; edited cards conflict | R2 |
| **G7 Compatibility** | `preserve` output identical to today; saved canvases load unchanged; typecheck, lint, the full unit suite and local e2e green | R1, R2 |
| **G8 Readability** | Judge rubric median ≥ 4/5 on fixtures (§10); comprehension study done before R1 is announced as Built in the positioning doc | R1 |
| **G9 Cost and work** | Generation tokens and per-update resent cards compared with today's baseline (the chat-import cost benchmark); savings claimed only where measured | R1, R2 |
| **G10 Portability** | Export with sources → import on a clean store: every card's chip opens the right passage of the right version. Export without sources: the warning shows, and the import shows "Source not on this device" with no broken links. Older bundles still import | R1 |

**Observed, not gated:** canvas words as a share of source words (excluding tables and code by reference). An alarm
above 70% suggests transcript-like output and is investigated, but it neither passes nor fails a release.

---

## 10. Usability: how each promise is checked

### 10.1 Automated (local e2e, mock AI, every run)

| # | Promise | Test |
|---|---|---|
| U1 | Check any card in one click | Click a card's chip → the Source tab opens on the cited passage, highlighted, at the card's version; with a newer version, the "Source updated" bar shows |
| U2 | See what was left out | Filter "Omitted" → each omitted passage shows its reason; Include adds a card |
| U3 | Review only what's uncertain | "Review N" steps through every Needs review item; each action resolves it; resolved items stay resolved after a reload |
| U4 | Long sources stay usable | 200k-character source: panel open ≤ 300 ms, highlight ≤ 100 ms, outline jump works, "1 of 3" stepping works |
| U5 | Passage → card | Select a passage → its cards are outlined; with reduced motion, the camera jumps |
| U6 | Source not available | A canvas without a local source shows "Source not on this device" and no broken links |
| U7 | Export keeps notes checkable | Export with "Include sources", import into a clean workspace, click a chip → the cited passage opens. Untick the option → the warning shows |
| U8 | Uncertain stays visible | With the model check off, a flagged card stays amber and in "Review N" after Accept and after a reload, until resolved |

### 10.2 Judged (approved live runs)

A fixed rubric, scored 1–5 per section by a model judge and, for a sample, by a person: *the title states the point*
· *one idea per card* · *limits stay with claims* · *no transcript-like copying* · *structure shows how the ideas
relate*. G8 needs a median ≥ 4.

### 10.3 Comprehension study (before R1 is announced)

Wave F's 5-person study, extended. Each person sees one fixture as the source text and another as Acute's notes
(alternated), then:

- answers 3 recall and 3 "apply it" questions (measures understanding);
- finds the source of two claims (measures verification: target ≤ 2 clicks, ≤ 30 seconds);
- reviews the Needs review queue of one result (measures review burden: target ≤ 2 minutes for a typical document).

The result goes into the positioning doc only as measured.

---

## 11. Implementation plan

Work packages in order. Each lists its files and its tests; "new" marks a new file. Every package ends green on
typecheck, lint and the unit suite, and keeps the `preserve` snapshots identical (§0.3). Nothing user-visible
changes before R1.

### 11.0 Steps and checkpoints

Each step is small enough to build and test in one sitting and ends in a state that can be left as it is. A
**checkpoint** is where testing happens and the user is told the results. Steps marked **approval** need the user's
go-ahead because they cost money.

| Step | Work packages | Done when | Checkpoint |
|---|---|---|---|
| **S0.1** | WP0.1 Re-arrange scope | New scope tests pass; Re-arrange on one frame proposes nothing outside it | |
| **S0.2** | WP0.2 Provenance guard | `provenanceGuard.test.ts` 7/7 | |
| **S0.3** | WP0.3 Plan docs | Master plan says "next: Knowledge Notes Phase 1"; Oct 12 work written up | **C0:** typecheck, lint, full unit suite green; by-hand check of Re-arrange on one frame in the app |
| **S1.1** | WP1.1, WP1.2 | Unit splitter and identity matrix (§7.1) pass, all offline | |
| **S1.2** | WP1.3 | Types, storage and guard updated; old records load | |
| **S1.3** | WP1.6, WP1.7, WP1.8 | Accounting, exactness and meaning rules unit-tested on hand-written cases | |
| **S1.4** | WP1.9 (draft) | Labelled set and rubric drafted; per-kind report runs in CI | **C1a:** the user labels the set (OD7); G0 |
| **S1.5** | WP1.4, WP1.5 | `DISTIL_RULE` and reply parsing behind the developer setting; `preserve` prompt snapshot unchanged | |
| **S1.6** | WP1.10, WP1.11 | One merged retry, report v2, safety net off in distil mode; mock-AI tests | |
| **S1.7** | WP1.12 | Fixtures 4–10 and report v2 | **C1b:** full offline suite; distil mode with the mock AI end to end; G1/G2 rule measures on the labelled set |
| **S1.8** | — **approval** | First live run of distil mode: fixtures × 3, with the chosen provider (L1/L2) | **C1c:** first real-model results, per kind and per fixture |
| **S2.1** | WP2.1, WP2.2 | Source tab, versions, two-way highlighting | |
| **S2.2** | WP2.3, WP2.4 | Long sources, chips, budgets | |
| **S2.3** | WP2.5, WP2.6, WP2.7 | Chips in outcome words, review queue, Add / Pin / Include | |
| **S2.4** | WP2.9 | Export and import with sources | |
| **S2.5** | WP2.8 | "Keep full detail" in the dialog (hidden until R1) | **C2:** e2e U1–U8; by-hand walk-through of the review flow |
| **S2.6** | — **approval** | R1 live runs; judge rubric; comprehension study | **R1** decision with the user |
| **S3.1–S3.4** | WP3.1–WP3.4 | Citation updates, fixture 10 | **C3** offline; then **approval** for live runs; **R2** decision with the user |

### Phase 0: prerequisites (offline, no AI spend; next)

These fix what is already wrong in the parts this plan builds on. They're small, and phase 1 starts after them.

| WP | Work | Why it comes first | Files | Tests |
|---|---|---|---|---|
| 0.1 | **Re-arrange layout only touches the selected sections.** *Built 2026-10-19:* the handler passes the selection's frames (`RearrangeInput.frames`: a selected frame, or the frame a selected object sits in), and `rearrangeSource` skips every group whose frame isn't one of them. Scoped by frame rather than by `sectionsOfObjects`, because that reads the AI-tier key prefix and returns nothing for local-tier sources, which Re-arrange is offered for. A selection outside any frame shows a toast. Moves and the removal and redrawing of sub-topic backdrops stay inside those frames. Checked 2026-10-19: the `rearrange_layout` handler ([AIPanel.tsx:631-646](../../src/components/ai/AIPanel.tsx#L631-L646)) passes no section, and `rearrangeSource` loops over every group ([rearrange.ts](../../src/ai/reconcile/rearrange.ts)), so re-arranging one frame proposes changes across the whole canvas | It breaks rule 4 (§0.3), the same kind of failure that wiped most of a canvas with Re-visualize. Phase 3's card-level updates and the review queue's actions depend on the same rule | `components/ai/AIPanel.tsx`, `ai/reconcile/rearrange.ts` (`RearrangeInput.frames`) | `rearrange.test.ts` "on a selection": two frames from one source, re-arrange one, no change targets the other (moves, backdrop removals and creations); without a selection both change (so the test isn't vacuous); a selection with none of the source's frames proposes nothing |
| 0.2 | **Green the provenance guard.** Add the test-only helper `testUtils/repoMapWorld.ts` to both allowlists in [provenanceGuard.test.ts](../../src/domain/provenanceGuard.test.ts), beside its sibling `reconcileHarness.ts`. Checked 2026-10-19: 2 of the file's 7 tests fail on exactly this file | The guard is what keeps the new reconciliation fields (`sourceUnits`, `review`, `noteModel`, WP1.3) out of export, MCP and search. It must be green before they're added, and G7 needs a green suite | `domain/provenanceGuard.test.ts` | The file passes 7/7; then the full unit suite |
| 0.3 | **Bring the plan docs up to date.** Write up the 2026-10-12 work (Re-visualize on a selection, Re-arrange, sub-topic backdrops) in the plan it belongs to. In the [master plan](./pending-work-master-plan.md), last updated 2026-10-09: mark G3.3 and C1 done, replace "next G3.3 or C1" with this plan's Phase 0, and link this plan | The master plan should say what's next, and this plan's §0.3 refers to the Oct 12 rule | `.ai/docs/pending-work-master-plan.md`, `.ai/docs/chat-share-import-plan.md` (or wherever the Oct 12 work belongs) | — |

### Phase 1: idea fidelity (behind `noteModel: "distil"`)

| WP | Work | Files | Tests |
|---|---|---|---|
| 1.1 | Unit splitter, normalisation, hashing, opaque IDs, neighbours | `src/ai/fidelity/sourceUnits.ts` (new); reuses `safetyNet.ts` splitting and `fingerprint.ts` | `sourceUnits.test.ts` (new) |
| 1.2 | Version matching and lineage (§3.1 table), topic ids from `pathIds` | `sourceUnits.ts`, `reconcile/topicIds.ts` | the identity matrix of §7.1 |
| 1.3 | Types and storage: `ContentSourceVersion.units` / `lineage`, `AIMetadata.sourceUnits` / `review`, `noteModel`; repository schema bump with old records readable | `domain/types.ts`, `persistence/repositories/*`, `ai/content/sources.ts`, `ai/changes/changeSet.ts` | repository tests, old-record load test; add `sourceUnits`, `review` and `noteModel` to `RECONCILIATION_FIELD` in `provenanceGuard.test.ts`, and each new reader to its allowlist on purpose |
| 1.4 | Prompt labels per unit (`P2.3`, `L1.4`, `T1.r4`) mapped to IDs | `fidelity/sourceBlocks.ts` (`numberSource`) | `sourceBlocks.test.ts` |
| 1.5 | `DISTIL_RULE`, reply shape (`cites`, `metadata.omitted`), lenient parsing | `visualize/tasks.ts`, `visual-plan/sectionKinds.ts`, `visual-plan/schema.ts`, `validate.ts` | `tasks.test.ts`, `validate.test.ts`; `preserve` prompt snapshot unchanged |
| 1.6 | Accounting, critical units, user-facing outcomes | `fidelity/accounting.ts` (new), cue lists in `config/fidelity.ts` | `accounting.test.ts` (new) |
| 1.7 | Exactness tiers, normalisation, action items, named terms | `fidelity/exactness.ts` (new), reuses `information.ts` `keyTerms`, `analysisCheck.ts` `itemIds` | `exactness.test.ts` (new) |
| 1.8 | Meaning rules (§3.4) | `fidelity/meaning.ts` (new) | `meaning.test.ts` (new) |
| 1.9 | Labelled set and the CI measure of recall and false alarms | `fidelity/__fixtures__/meaning/pairs.json` (new), `meaning.eval.test.ts` (new) | runs in the unit suite |
| 1.10 | Distil mode only: **one** retry per section that combines analysis, exactness and fidelity reasons; keep the better reply (as Wave A2). `preserve` keeps today's retries | `visualize/outlined.ts`, `fidelity/analysisCheck.ts` | `outlined.test.ts` |
| 1.11 | Report v2 (outcomes, flags, lineage); safety net skipped in distil mode | `fidelity/report.ts`, `fidelity/safetyNet.ts`, `outlined.ts` | `report.test.ts`, `safetyNet.test.ts` |
| 1.12 | Fixtures 4–10 and the e2e fidelity report v2 (median and worst of 3 runs) | `fidelity/__fixtures__/`, `e2e/fidelityScore.ts`, `e2e/ai/fidelity.spec.ts` | mock-AI e2e; live only with approval |

### Phase 2: source panel and review

| WP | Work | Files | Tests |
|---|---|---|---|
| 2.1 | Source tab: load by card version, newer-version bar, "What changed" from lineage, unavailable state | `components/source/SourcePanel.tsx` (new), `components/properties/*` (tab), `ai/content/sources.ts` (`loadVersion`) | component tests; U1, U6 |
| 2.2 | Two-way highlighting and canvas outline | `SourcePanel.tsx`, the provenance camera code, selection state | U1, U5 |
| 2.3 | Long sources: outline, filters, collapsed sections, windowed rendering, stepping | `components/source/*` (new) | U4 with the budgets |
| 2.4 | Card source chip | renderer overlay beside the existing markers (indicator budget) | e2e |
| 2.5 | Section chips and bar totals in outcome words | `SectionChips.tsx`, `CoverageRow.tsx`, `fidelity/sectionReview.ts` | `sectionReview.test.ts` |
| 2.6 | Review queue with Keep / Edit / Use source wording / Include / Dismiss, stored resolutions | `components/ai/ReviewQueue.tsx` (new), reuses the dense walk-through pattern | U3 |
| 2.7 | Add to canvas, Pin quote, Include (local tier, no AI call) | `SourcePanel.tsx`, `ai/content/localPlanner.ts` | U2 |
| 2.8 | "Keep full detail" in the Visualize dialog (shown from R1) | Visualize dialog component | e2e |
| 2.9 | Export and import with sources (§6.4): `ExportOptions.sources`, the bundle's `sources` section and schema bump, warning and size in the dialog, restore on import with mapped IDs, reconciliation fields kept only with sources | `portability/exportOptions.ts`, `portability/bundle.ts`, `portability/workspaceBundle.ts`, `portability/canvasExport.ts`, `export/ExportDialog.tsx`, `export/CanvasExportDialog.tsx`, `normalizeAIMetadata` | `workspaceBundle.test.ts`, `canvasExport.test.ts` (round trip, without sources, older bundle); U7 |

**→ R1:** run G0–G5, G7–G10 (live parts with approval); then switch the default.

### Phase 3: citation updates

| WP | Work | Files | Tests |
|---|---|---|---|
| 3.1 | Lineage-driven affected-card selection; card-level resend prompt | `reconcile/update.ts`, `reconcile/preserve.ts`, `reconcile/mapSection.ts` | `update.test.ts` |
| 3.2 | Moves as moves; ambiguous → Needs review; stale marks; removal proposals | `reconcile/classify.ts`, `changes/changeSet.ts` | `classify.test.ts`, fixture 10 |
| 3.3 | Resolved flags kept across unchanged units | `reconcile/update.ts`, `accounting.ts` | `update.test.ts` |
| 3.4 | Cost and work measure against the baseline | `e2e/fidelityScore.ts` | approved live run |

**→ R2:** run G6, G7 and G9; then turn citation updates on.

---

### Other open work, in terms of this plan

Open items from the other plans, as of 2026-10-19 (typecheck clean; 2,365 unit tests pass, the only failures being
WP0.2's two). None of them blocks phases 0–2. Items marked **approval** cost money or reach outside this machine, so
they wait for the user's go-ahead.

| Workstream | What's open | How it relates to this plan | When |
|---|---|---|---|
| Topic merge + ChatGPT import (G0–G3.3, C1 done and checked live) | **G2b**: merging into notes written by hand | Hand-written cards have no citations. In distil mode a merge must treat them as the user's own: never rewritten, with new AI cards proposed beside them and citations only on AI cards. G2b's design should use `cites` and unit lineage rather than a separate mechanism | After R1, with OD6 |
| | Importing Gemini and Claude chats | Each becomes a fixture (extends #9 in §7.3), so distil mode is judged on more than ChatGPT output | With OD6 |
| Merge cost (closed: run 4 $0.2527 against the $0.28 target; runs 5–7 $0.23–0.28) | **Option A** (skip the orphan sections' AI calls): not approved. **approval** for any more paid runs | These runs are G9's merge baseline. Option A is independent of this plan, but if it is approved, G9 compares against the run after it | User's decision |
| Shared ingest service + MCP import tools (built, with guards) | MCP setup instructions don't list the import tools; a long import may time out in an MCP client | Ingest is where an MCP import would pick `noteModel`. Until OD6 it stays `preserve`. When it switches, the setup instructions should state the mode | Docs and timeout: any time (offline); the mode: after OD6 |
| Chat-update limits (4 items, all done offline) | Live recording of real Jev answers, estimated under $0.002. **approval** | No direct link. Recorded answers could be a fixture for update tests (fixture 10) | User's decision |
| Lens design review (5b; built, tested offline with canned replies) | `e2e/ai/lensReview.spec.ts` not written; the 8 live checks (**approval**); project decisions not passed in; results not saved | Not affected (§0.3). Phase 4 builds on Lens keys later, so these gaps should close before phase 4 starts | Spec: offline, any time; live checks: approval |
| ChatGPT MCP connector (local proof of concept) | Never tested with real ChatGPT; opening a tunnel needs **approval** | Not affected | User's decision |
| Master plan L1–L3 | L1: run the AI e2e specs that were written but never run; L2: validate OpenAI, Azure and Anthropic with real keys; L3: by-hand Repo Map check with a real client (all **approval**) | L1 and L2 matter for R1. The live gates need a validated provider, and model tiers condense differently (Wave F2). R1 states which provider and model its live runs used and claims nothing for the others | Before R1's live runs |
| Ungrouping a composite shape (cylinder etc.) breaks it into loose lines | Bug, not started | Not affected | Any time (offline) |
| Test hygiene (found at C0, 2026-10-19) | Two `ai/merge/layoutDReuse.test.ts` tests time out at vitest's 5 s default under full-suite load; alone they pass (12/12 in 20 s) | G7 needs a green suite. Give them an explicit timeout, as Wave F3 did for the other load-sensitive tests | Any time (offline); before C1b |
| Hosted deployment | Deferred by the user | Not affected. OD3 (export of sources) would matter there later | Deferred |

## 12. Decisions (approved 2026-10-19)

All seven are approved. The user's final position: begin Phase 0; keep existing behaviour intact until R1; don't
turn on citation-based updates until R2.

| # | Decision | Refinement from the review | Where |
|---|---|---|---|
| OD1 | The source panel is a **"Source" tab beside Properties** | Selecting a passage highlights its cards, and selecting a card highlights its passages | §5.1, U1, U5 |
| OD2 | **`distil` becomes the default at R1**; "Keep full detail" stays for precision-sensitive content (specs, legal text) | — | §6.3 |
| OD3 | **Sources go into export as an option** | Includes the source text, version IDs, unit IDs, lineage and the metadata needed to resolve citations. Explicit option, warning when off, and off by default in any future share flow, for sensitive material | §6.4, WP2.9, G10, U7 |
| OD4 | **30% omitted share as a secondary signal** | Critical-unit checks and review flags come first | §3.2 |
| OD5 | **Runtime model check off by default**, flagged cards only when on | Flagged cards stay visibly uncertain with the check off, and are never treated as verified | §3.4, G2, U8 |
| OD6 | **Chat import switches after R1**, with its own live check | Its merge behaviour and hand-written content carry risks Visualize tests don't cover | §4.4, "Other open work" |
| OD7 | **I draft the paraphrase pairs; the user or team labels them** | Labels follow a written rubric; disagreements are resolved before the set becomes a gate; categories are balanced and reported separately, with no single aggregate score | §7.2, G0 |

## 13. Risks

| Risk | Mitigation |
|---|---|
| Rewording distorts meaning in ways the rules miss | Labelled set with recall targets; offline judge finds new cases; Needs review; optional runtime check |
| Too many false alarms make review a chore | False-alarm target (G1); "Needs review ≤ 15% of cards" gate; resolutions remembered |
| A short critical caveat is dropped while the ledger looks complete | Critical units can't be omitted without review (G3) |
| The model cites carelessly to satisfy coverage | Citation-sanity rule; omission rules; citations visible in the panel |
| Identity mislinks after heavy edits | Whole-document matching with neighbours; ambiguous → new ID and Needs review, never a silent rebind (G6) |
| Distil ships before users can inspect the source | R1 needs phase 2 and G5; the safety net stays on until then |
| Users who want near-verbatim notes | `preserve` mode stays ("Keep full detail") |
| Run-to-run variance | Ten fixtures × 3 runs; critical gates on every run |
| Cue-word lists are English-only | Stated limitation for v1; lists live in config; non-English sources default to a lower Needs review threshold (more items shown) |
