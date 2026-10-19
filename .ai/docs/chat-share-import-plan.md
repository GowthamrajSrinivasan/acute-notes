# Topic Merge + Shared-Chat Import — Plan

**Status:** planned (2026-10-08). Nothing is implemented yet. Phase 0 (the ChatGPT test) is done; its findings are in §4.
**Placement:** the core merge work (G0–G3, 2b) belongs under master plan **L0, Visualize result quality**, and it absorbs
content-fidelity **Wave B2** (the ledger). Chat import is a thin input adapter on top of it (Wave 3, next to CAP-18).

## 1. Goal

Turn several sources into **one set of notes per topic**, with no redundancy. This applies to the existing paste,
import and MCP paths as well as to new ChatGPT / Gemini / Claude share links:

- Notes are organised by **topic**, never by source or conversation. Everything said about a topic, in any source,
  ends up in that topic's single section.
- New content **fits into the existing structure**: it updates or extends existing topics, and only content that
  fits no topic creates a new one. Rewording alone changes nothing.
- The notes show the **latest agreed understanding**. Replaced statements appear only in a collapsed
  "Changed over time" trail.
- Shared chats that **branch** from one another are analysed once: content that a branch shares with its parent is
  skipped before any AI call.

## 2. Decisions (user, 2026-10-08)

| # | Decision |
|---|---|
| D1 | Fix topic merging, duplicates and structure fit **in the core pipeline**, for every input. Chat import is one consumer of it |
| D2 | An import **also merges into notes the user wrote on the canvas**: existing objects are loaded into the ledger as a starting point (Phase 2b) |
| D3 | Assistant suggestions the user never confirmed are shown with status **proposed**, separately from agreed items |
| D4 | Chat providers in order: **ChatGPT first**, then Gemini, then Claude |
| D5 | Branch-skip layer, with a toggle **on by default**: "Skip content shared between branched chats" |
| D6 | The topic registry is **derived from the canvas** (frames carrying a topic id, label and contents), not a separate device-local store. It survives export and includes the user's own frames |
| D8 | Conflicts between conversations are **not decided during Visualize**. They're rendered as an options box with dotted links to each option, and the user chooses one later on the canvas (§5.4) |
| D7 | When the canvas already has notes, Visualize suggests **"Merge into existing notes"** by default; "Add as new" stays available |

## 3. Gaps in the existing pipeline (verified in code)

| Gap | Today | Where |
|---|---|---|
| Topic merge across runs | Within one paste, `outline_document` already merges parts about the same concept. Across Visualize runs it doesn't: every run creates a new source and new frames | `visualize/outline.ts`, `content/sources.ts` |
| Structure fit | Node keys are `<analysis unit> § <node key>`, and a unit key is a **heading path**. A renamed or restructured heading turns an update into remove + add. Merging *different* content into an existing structure isn't possible at all | `reconcile/units.ts`, `reconcile/keys.ts`, `reconcile/classify.ts` |
| Safety net vs. duplicates | It checks coverage only against the AI's reply. In a merge, content already on the canvas would be re-attached under "Also in the source" | `fidelity/safetyNet.ts` |
| Sources with history | A source that revises itself (a chat, a series of meeting notes) shows every version side by side | none yet |
| One source per object | Provenance has one `sourceId`. If source B updates an object owned by A, the next Update of A reads B's change as a user edit and raises a false conflict. **Avoided by design in G2:** a merge writes into A's own source | `domain/types.ts`, `reconcile/classify.ts` |

Reused as is: the **preserve protocol** (`reconcile/preserve.ts`: current representation + new text, nodes the model
marks unchanged are restored word for word), conflict review (`reconcile/conflicts.ts`), and the decision model
(`domain/canvas/nodeProject.ts`: `proposed`/`accepted`/`superseded`, `supersedes`).

## 4. Phase 0 findings — ChatGPT share links (2026-10-08)

Tested with `chatgpt.com/share/6ac75678-…` ("AI App Builder Ecosystem") and `chatgpt.com/share/6ac75691-…`
("Branch · AI App Builder Ecosystem"), in the Playwright browser.

- **No bot challenge.** Both pages loaded straight away.
- **Data, not DOM.** The whole conversation is in the server HTML, as React Router turbo-stream chunks
  (`window.__reactRouterContext.streamController.enqueue(...)`). Decoded, it's at
  `loaderData["routes/share.$shareId.($action)"].serverResponse.data`. A plain HTTP fetch may therefore be enough,
  with Playwright as the fallback; the route tries both.
- **Payload:** `title`, `create_time`, `conversation_id` (the share id), `backing_conversation_id` (the real
  conversation), `current_node`, and `mapping`, a tree of `{ id, parent, children, message }`.
- **Messages:** each has `id`, `author.role`, `create_time` (a precise timestamp, so time-based ordering works for
  ChatGPT), `recipient`, and `content.content_type` / `content.parts[0]` as **raw Markdown** (no HTML conversion).
- **Visible turns** are on the path from root to `current_node` with role `user`/`assistant`, `content_type: "text"`,
  `recipient: "all"`, not `metadata.is_visually_hidden_from_conversation`, and non-empty. Everything else is system
  messages, tool calls (`recipient: "web"`, `"web.run"`), `thoughts`, `reasoning_recap` or `model_editable_context`,
  and is dropped.
- **Branches are explicit and exact:**
  - The branch's path starts with the parent's turns, with **the same message ids and timestamps, and byte-identical
    text** (SHA-256 checked for all 4 shared turns).
  - The fork turn carries `metadata.branching_from_conversation_id`, which equals the parent share's
    `backing_conversation_id`, plus `branching_from_conversation_title`.
  - In the test: the branch has 8 visible turns, 4 shared with the parent and 4 new.
- **Still to check in Phase 1:**
  - Citation markers and `content_references` inside assistant text.
  - Images and file attachments.
  - Canvas/code-interpreter content types.
  - Very long conversations (more than one turbo-stream chunk).
  - Behaviour when a share is updated after more chatting.
- The two links supplied as the 2nd and 3rd were identical. **Duplicate links / conversation ids are removed before
  anything else.**

## 5. Core merge (all inputs)

### 5.1 Topic ledger

One structure, kept per canvas and derived from it (D6). It extends B2's "facts and the nodes that cover them" by one
level:

```ts
interface Topic { id: string; label: string; frameId?: string; items: LedgerItem[] }
interface LedgerItem {
  id: string;
  kind: "decision" | "requirement" | "fact" | "explanation" | "open_question" | "action" | "code" | "table";
  statement: string;                 // canonical text
  status: "agreed" | "proposed" | "superseded" | "open";
  supersedes?: string[];             // item ids
  sources: { sourceId: string; ref: string; at?: number; lineage?: string }[];  // ref = turn id / unit key
  covers: string[];                  // stable node keys on the canvas
}
```

### 5.2 Steps

| Step | What | Size |
|---|---|---|
| **G0** ✅ 2026-10-08 | *Done:* `src/ai/reconcile/topicMerge.test.ts`. Two `it.fails` tests (local and AI tier, a heading renamed over unchanged content) confirm today's behaviour, 5 changes including removes; they become plain `it` in G1. The other cases are `it.todo` acceptance criteria. Shared harness: `src/testUtils/reconcileHarness.ts`. *Spec:* failing mock-provider tests that define "done", with no AI spend: (a) rename a heading, then Update → update, not remove + add; (b) Visualize a related second doc with "Merge" → merged into existing topics, no new duplicate frame; (c) a doc that revises itself → only the latest version in the body, the old one in the trail; (d) merged content → no "Also in the source" duplicates; (e) B updates A's object → no false conflict on A's next Update | S |
| **G1** ✅ 2026-10-08 | *Done:* `src/ai/reconcile/topicIds.ts`. Each version stores `pathIds` (heading path → topic id; absent when nothing was renamed), carried by `ContentSourceRecord` and `ContentSourceVersion`. Renames are matched by body content under the same parent: identical, or ≥ 75% shared significant words with at least 3 words; one-to-one; repeated headings never matched. Applied in all three update paths: local tier (plan rekeyed), AI with a template, and outlined (units rekeyed, so a rename no longer re-outlines). Tests: `topicIds.test.ts`, the G1 block in `topicMerge.test.ts` (including chained versions and a different-content guard), and the rename case in `outlined.test.ts`. *Spec:* topic identity no longer tied to headings: a stable topic id becomes the section key, and node keys become `<topicId> § <node key>`. Existing heading-path keys are used as ids, so nothing needs migrating. When a key goes missing on Update, the old unit is matched to its renamed one by content (word coverage, `fidelity/information.ts`), in code | S–M |
| **G2** | "Merge into existing notes". **Design (revised 2026-10-08): merge into the target source's text, then run the normal Update.** The new content's parts are assigned to the target's topics (its analysis units). Code writes a merged text: each part's blocks are appended under its topic, new topics become new sections, and repeated passages are left out. That text is the source's next version, going through `updateFromNewContent` (preserve protocol per grown topic, new sections framed, user edits are conflicts). Everything stays one source, so the multi-source provenance and false-conflict problem is gone by design (no `contributingSources`). The safety net checks against the merged text, so already-present content isn't re-attached. Slices: **G2.1 ✅ 2026-10-08:** the engine, `src/ai/merge/` (`assign.ts`: `assign_to_topics` task + deterministic fallback; `compose.ts`; `merge.ts`: `mergeIntoSource`), tests in `merge/merge.test.ts`. **G2.2 ✅ 2026-10-08:** Visualize offers "Merge into existing notes" / "Add as new notes" when the canvas has notes (`components/ai/mergeTargets.ts`: the canvas's sources with objects still on it, newest first, named by their first heading; a picker when there are several). Merge is selected by default (D7), except for a selection's own content; the template picker is hidden while merging. Flag `NEXT_PUBLIC_TOPIC_MERGE` (`isTopicMergeEnabled`), on in `.env.development`, off elsewhere. e2e: `e2e/local/topicMerge.local.spec.ts` (no AI). **G2.3 ✅ 2026-10-08:** when an outlined source only gains parts, existing sections are kept (changed ones regenerated as before) and only the new parts are outlined and generated, as new sections, without that run's document subtitle (`updateOutlined` in `reconcile/update.ts`). A removed or regrouped part still re-outlines the whole document. **Live check ✅ 2026-10-08** (`e2e/ai/topicMerge.spec.ts`, AICredits `openai/gpt-oss-120b`): all five steps pass. It found and fixed: (1) repeats are now left out *before* any model call; (2) an **append-only guard** for merges (`reconcile/appendOnly.ts`: nodes the model drops are kept, new nodes that only restate their section are left out); (3) a merge that changes nothing says "Everything in this content is already in your notes" instead of claiming it merged. Three **pre-existing Update bugs** the merge exposed: an outlined source's update stored its plan flat, so every later update re-outlined everything (now stored grouped, `regroupSections`; flat plans already stored still read); analysis cards were fingerprinted without their "Analysis ·" tag, so every later update proposed them again (and an update stripped the tag); and placement looped forever when a model linked two new nodes as explanations of each other (`topOf` in `update.ts`). **Cross-topic repeats ✅ 2026-10-09** (live-checked, 6 steps): a passage filed under one topic that another topic already says is left out (each topic compared on its own; word for word anywhere); the assignment model sees only each part's *new* passages, so a near-copy of another topic can't pull a part there; the same call may flag a part `nothingNew` (strict: no fact, number, name, decision, example or detail added), which is left out and named in the review; topics of the notes that already repeat each other are pointed out, never changed (`notesOverlaps`). Not done: merging an existing cross-topic repeat into one place (the user's call; the review points it out) | M–L |
| **G2b** | Notes written by hand: existing frames and objects without a source are loaded into the ledger as topics and items (D2). Merges into them are always **conflicts** ("Apply update" / "Keep mine"), never clean updates | M |
| **Cost** | Merge cost reduction, 2026-10-09 (baseline: merge 130 calls, ~$0.35, in `decision-spike/chat-import-live-2026-10-09.md`). **Done:** assignment in batches of 20 parts (`ASSIGN_BATCH_PARTS`, within Jev's `ASSIGN_MAX_PARTS` 30), failed batches keep the local answer; a section that only grew (every earlier paragraph still there word for word, `appendedParagraphs`) is asked only for what its appended paragraphs add, and every node it doesn't name is kept by code (`withCurrentKept`) — in every update, not only merges; counters in `__acuteDev.lastMerge().calls` (calls by task, section plans by kind: appended / regenerated / piece / new, analysis calls, parts skipped before any call). **Not done:** the takeaway of a grown section is kept, never refreshed; new topics still go through the full first-run path (pieces + analysis check); no cache. The "after" number is one instrumented live run (chat-import session). **After run 1 (2026-10-09): $0.615 merge, higher, not lower.** Its counters showed the update re-outlined and regenerated the whole notes (0 sections reused; 30 of its 77 sections were the first chat's, already on the canvas). Three pre-existing bugs, fixed 2026-10-10: (1) a topic that grows past `MAX_UNIT_CHARS` (12,000) is split into "X ·1", "X ·2", so its key "disappeared" and any update took that as a removed part and re-outlined everything — now the same section over its numbered parts (`currentUnits`); (2) a first run with more than `MAX_GROUPS` (20) sections stores the rest without a frame, and the next update took their content for new topics and generated it again — now recognised by their keys (`unframedSections`); (3) an update's plan is flat (sections as headings), so `foldOverflow` capped it at 60 nodes and proposed removing everything past that into a "More from this section" page — now counted per section, as a sectioned plan. Tests in `visualize/outlined.test.ts`. Still open: Jev's assignment is one request per part with every topic in it (237 calls, 7.4M characters, about $0.20 of the merge); new topics still go through the full first-run path. | M |
| **G3** | Sources with history. **G3.1 ✅ 2026-10-09:** choices are `[!choice]` Markdown callouts in the source text itself (`ai/history/choices.ts`: open = options; chosen = the chosen option in bold, the others struck through). They are drawn by code, never by a model (`ai/history/choiceNodes.ts`): an open choice is a "Needs your call" box (`<section> § choice:<id>`) with one card per option (`…:option<i>`) and a dotted `option_of` link to each (new relation type); a chosen one turns the box into the chosen option, removes the cards, and adds the section's "Changed over time" page (`<section> § trail`). On AI-tier sources the callouts are left out of what the model, the change check and the safety net see. **"Use this option"** (Origin panel, on an option card) resolves the callout in the source text and runs "Update from new content" at once (auto-run), so it's reviewed and undone like any update; choosing what the notes already say costs no model call; choosing another option replaces the notes' sentence, and that section is regenerated. **G3.2 ✅ 2026-10-09:** the merge's assignment call also reports `conflicts` (topic sentence vs part sentence, quoted exactly, verified word for word); the part's sentence is not filed, and a choice callout is written into the topic; the review names it. Tests: `history/*.test.ts`, `merge/merge.test.ts`, `e2e/local/choices.local.spec.ts`; **live** `e2e/ai/choices.spec.ts` passes (AICredits `gpt-oss-120b`). **Jev (typed decision model), 2026-10-09:** measured better than the chat model on the merge questions (mergeJevCompare: 100% vs 97% relation, 14/14 vs 13/14 contradictions, 0.6 s vs 5.5 s; report in decision-spike/). The decision-model session made Jev pick the conflicting statements (decision-models-plan 9.6); this session then made round two ask per statement of the part, so a part with several contradictions gives one choice each, and anything unsure goes to the chat task (never a partial set). Two pre-existing bugs fixed on the way: several groups joining one frame gave an invalid change set (now one update_frame per frame), and the Visualize dialog swallowed errors raised after a run finished, which left "Comparing with the canvas…" on screen. Live e2e/ai/choices.spec.ts (two contradictions in one paragraph, then Use this option) passes with Jev and without. **Attribution and follow-ups, 2026-10-09:** each merge records who answered (development diagnostics, `__acuteDev.lastMerge()`); live, Jev answered the two-contradiction merge itself (role decision, 2 picked, 2 shown, 6.8 s), and a 41-statement part (over Jev's round-two limit) fell back to the chat task, which found its contradiction (1 picked, 1 shown); without Jev the chat task answered (2 picked, 2 shown). A contradiction about a statement that already has an open choice adds an option to that box; one contradicting a choice the user made reopens it, the user's choice tagged "your choice", the notes unchanged until they choose. **Bug fixed:** every new part was cut to 800 characters before the model saw it, so a contradiction at the end of a long part was missed and filed as a fact, and "nothing new" could drop an unseen tail; parts are now shown whole (shared 24,000-character budget, 800-12,000 each) and "nothing new" is never trusted for a part that was cut. **G3.3 ✅ 2026-10-09:** a document that changes its mind (`ai/history/revisions.ts`): a free phrase gate ("actually", "switched to", "Update:", "no longer", …), then Jev picks, per later statement, the earlier one it replaces (or the chat task `find_revisions` quotes it, checked word for word); unsure = no revision. The earlier statement is left out of what the model and the safety net see, and listed on the section's "Changed over time" page; the user's text is never edited (`ContentSourceVersion.revisions`). Runs on the first Visualize and on Update (unchanged sections keep their earlier answer); a merge asks nothing new. Live (`e2e/ai/revisions.spec.ts`): both changes of mind found and drawn, without Jev and with Jev (no chat call). **Bug fixed on the way:** the change set's top-level schema had its own copy of the content-source fields without `pathIds` and `revisions`, so validation dropped both from every accepted Visualize and update: G1's renamed-section ids never reached storage in the app (only the unit tests, which skip validation, passed). **Open:** a second contradiction about the same matter adds an option to the existing box; reopening a made choice; the chat rules (agreed vs proposed, lineage) with C1 | M |
relation, the "Use this option" action, and the box's stable keys. Tests: a box is rendered rather than a choice
made; choosing produces a change set that can be undone; re-import adds a third option to the same box; a new chat
contradicting an earlier choice shows a box again. Optionally, decisions become `decision` nodes with `accepted`/`superseded`/`supersedes`, so the existing decision warnings apply | M |

### 5.3 Resolution rules (G3)

1. **Who said it (D3).** An item is `agreed` only if the user stated it or agreed to it. An assistant suggestion the
   user never confirmed is `proposed`.
2. **Lineage, not just time.** "Later wins" applies only **along one lineage**: within one conversation, or from a
   parent to its branch after the fork point. **Sibling branches** forked from the same point are alternatives, not
   updates. A contradiction between them goes to "Needs your call" unless one branch explicitly settles it.
3. **Explicit reversal** ("actually, use X instead of Y") → the newer item is `agreed` and the older is `superseded`.
4. **Same topic, different answer, no explicit reversal**, in the same lineage → the latest wins and is marked
   "Changed", linked to the earlier item.
5. **Different conversations** (unrelated chats, or sibling branches) → timing is **never** used to decide. The
   options are shown on the canvas (§5.4), and the user chooses later.
6. **One exception across chats:** if one side is `agreed` (the user stated or confirmed it) and the other only
   `proposed` (the assistant suggested it), the agreed side is used without asking, and the proposed side is shown
   beneath it as "Also considered". *(Recommended default; the user can turn it off.)*
7. **Only real contradictions are flagged:** incompatible statements about the same thing (a choice, a number, a
   requirement, a yes/no). Complementary statements (different details, more depth) are merged without asking.

### 5.4 Options box on the canvas (user decision, 2026-10-08)

Visualize **never stops to ask**. A conflict between conversations is rendered into the generated content and decided
on the canvas whenever the user likes.

```
┌ Topic: Database ─────────────────────────────────────────────────────────┐
│                                                                          │
│  ┌ Needs your call ──────────────────┐       ┌ Firestore ──────────────┐ │
│  │ Database for v1                   │· · · ·│ "AI App Builder…" · 3 Oct│ │
│  │ These chats disagree, and we      │       │ You agreed   [view chat] │ │
│  │ can't tell which one is current.  │       └──────────────────────────┘ │
│  │ Select an option and choose       │       ┌ Postgres (Supabase) ────┐ │
│  │ "Use this option".                │· · · ·│ "Branch · AI App…" · 4 Oct│ │
│  └───────────────────────────────────┘       │ You agreed   [view chat] │ │
│                                              └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Where it goes:** in the topic's own frame, where the item would otherwise sit. It isn't a separate "conflicts"
  area, so the topic still holds everything about itself.
- **The box:** a card titled with what is being decided, carrying a **"Needs your call"** label (a text label, not a
  colour) and a one-line note: "These chats disagree, and we can't tell which one is current."
- **The options:** one card per option, placed beside the box in a column. Each shows the option's content, its
  source chat title and date, a "You agreed" / "Assistant suggested" tag, and a link to the message in the chat.
- **The links:** a dotted connector from the box to each option, using a new relation type **`option_of`**
  (`strokeStyle: "dotted"`, no arrowhead). It gets its own type rather than reusing `references` so that "choose" and
  reconcile can recognise it. Added to `RELATION_TYPES`, `relationStyle.ts` and the validator.
- **Choosing:** selecting an option card shows **"Use this option"** (on the card and in Properties). It produces a
  normal change set through the existing review, so it can be reviewed and undone:
  - the chosen card becomes ordinary content (`agreed`) in the box's place;
  - the box, the dotted connectors and the other options are removed from the topic. The other options move to the
    topic's collapsed "Changed over time" trail as "Not chosen", still linked to their chats;
  - the ledger records the **user's choice as the highest-priority source**, so re-imports don't ask again.
- **Undecided:** the box stays as it is, marked "Undecided". Accept never requires a choice, and the review bar shows
  a count ("2 need your call") that jumps to each box.
- **Fitting new content in:**
  - A later import that adds a third option for the same item adds **one option card and one dotted connector** to
    the existing box; it never creates a second box. The box and its options have stable keys
    (`<topicId> § choice:<itemId>`, `… § option:<itemId>`).
  - If the user already chose and a new chat contradicts that choice, a box is shown again, with the user's earlier
    choice as one of the options, tagged "Your choice".
- **Outside this box:** same-chat or same-lineage changes don't use it. Those resolve by timestamp and show the
  "Changed" trail.
- **Fidelity and export:** option contents count as coverage for the safety net (no "Also in the source"
  duplicates). Markdown export writes the box as "**Needs your call:** …" followed by a list of options with their
  sources.

## 6. Shared-chat import (adapter)

### 6.1 Pipeline

```
URLs ─► dedupe links / conversation ids
     ─► fetch (plain fetch → Playwright fallback; host allowlist; timeout and size caps)
     ─► provider extractor → ChatTranscript (turns with id, role, at, markdown, lineage info)
     ─► branch-skip layer (§6.2, toggle on by default)
     ─► remaining turns → core merge (G2/G3) as ordered sources
```

```ts
interface ChatTranscript {
  provider: "chatgpt" | "gemini" | "claude";
  url: string; shareId: string; conversationId?: string;    // ChatGPT: backing_conversation_id
  title: string; sharedAt?: number;
  branchedFrom?: { conversationId: string; title?: string; atTurnId: string };
  turns: { id: string; index: number; role: "user" | "assistant"; markdown: string; at?: number; hash: string }[];
}
```

### 6.2 Branch-skip layer (D5)

A toggle in the import list, **"Skip content shared between branched chats"**, on by default. It runs before any AI
call, so shared content is never analysed twice. It's checked in this order, exact first:

1. **Duplicate links / ids.** The same URL, share id or `backing_conversation_id` is imported once.
2. **Exact branch prefix (ChatGPT).** A branch's `branchedFrom.conversationId` matches another imported
   conversation's `conversationId` → every turn with the **same message id and content hash** is skipped in the
   branch. The branch contributes only its turns after the fork, with `lineage` = parent → branch.
3. **Exact content (any provider).** A turn whose `hash` (role + normalised text) matches a turn already kept is
   skipped. This also catches a chat shared twice, or a branch whose parent wasn't imported but whose sibling was.
4. **Near-duplicate prefix (conservative).** If two conversations start with the same user turns and their assistant
   turns are near-identical by word coverage (`coverageOf`, high threshold), the shared prefix is kept once. Covers
   regenerated answers and providers without branch metadata. Lineage is inferred from the timestamps of the first
   turn that differs.

- **A skipped turn keeps its source link.** The note links to every conversation that contains it; only the analysis
  is skipped.
- **The preview shows what was skipped**, e.g. "Branch · AI App Builder Ecosystem: 4 of 8 turns already in 'AI App
  Builder Ecosystem' — skipped". The user can turn the toggle off for that import.
- **If the parent isn't in the import**, rule 2 can't fire, so the branch's shared turns are analysed as normal (rule
  3 still applies across the other links). The preview says so: "branched from 'X', which isn't in this import".

### 6.3 Steps

| Step | What | Size |
|---|---|---|
| **C1 ✅ 2026-10-09** (ChatGPT) | *Done:* `src/ai/import/chatShare/` (`providers.ts` host allowlist + link dedupe; `turboStream.ts` decoder; `chatgpt.ts` extractor; `branchSkip.ts` rules 1–4; `fetchShare.ts` manual-redirect, 15 s / 8 MB caps; `compose.ts` Markdown for Visualize), `POST /api/import/chat-share` (one link per request, AI-feature gated, `redactSecrets` on turn text), `components/ai/SharedChatsPanel.tsx` in `VisualizeDialog` (list, reorder, remove, per-link preview, toggle on by default; "Use these chats" fills the paste box). Tests: `chatShare.test.ts` (fixtures built by `__fixtures__/sharePage.ts`, which encodes the Phase 0 payload shape), `route.test.ts`, `e2e/local/chatShare.local.spec.ts`. `noVendorLeak.test.ts` now allows `import/chatShare` (share hosts name the chat product). **Large results ✅ 2026-10-09:** a 24k-character chat made outlined Visualize emit more than 500 changes, which `PendingChanges.propose` refuses (single producer cap). `ai/changes/sectionParts.ts` (`splitIntoSectionParts`) now divides such a set into one part per top-level frame (+ an overview part, a part per existing frame that new objects join, and an "other changes" part), each ≤ 500, whole ≤ `MAX_CHANGES`→`MAX_MERGED_CHANGES` (6,000), every part carrying the same content-source record; a section over 500 or a total over 6,000 throws `ChangeSetTooLargeError` (shown by `errorInfo`, nothing proposed). Called in `VisualizeDialog` before `propose` on all three paths (new, update, merge); a notice says the result was split. Limits unchanged; sets ≤ 500 are returned untouched. Tests: `changes/sectionParts.test.ts`, `visualize/largeOutlined.test.ts`. **Known:** accepting only some parts still records the whole content version, so skipped sections come back as additions on the next update (agreed with the merge session as tolerable). **Live runs 2026-10-09 (OpenRouter + Jev):** step 1 (real import, branch-skip) passes every time; first-chat Visualize is slow with `openai/gpt-oss-120b` (outline 53 s, section calls up to 2+ min with a provider 504, not finished in 7 min) and then the key ran out of credit (`/credits`: total 0, 402 "can only afford 11168 tokens"), so steps 2–3 (and the merge-timeout diagnosis) are **not yet verified**. **Not done / open:** Playwright fallback for the fetch (plain fetch works for ChatGPT today; the paste box is the fallback); the Phase 0 "still to check" list (images/attachments, canvas content types, multi-chunk long chats, updated shares) needs real share links; ~~live smoke test~~ **done 2026-10-09** with three real shares (chat → branch → branch of branch; links in memory `chatgpt-test-share-links`): plain fetch works, 4 / 8 / 18 turns read, branches detected, branch-skip keeps 4 + 4 + 10 turns in any order (fixture `__fixtures__/liveBranchChain.json`, text trimmed). Real fork metadata sits on the *last shared turn* (`atTurnId` = parent's last turn). Citation markers (`…`) are stripped on the assumption of that format. *Original spec:* `src/ai/import/chatShare/`: `detectProvider`, the ChatGPT turbo-stream decoder and extractor, the branch-skip layer (pure, unit-tested on saved and cleaned fixtures from Phase 0), and the `POST /api/import/chat-share` route (read the route docs in `node_modules/next/dist/docs/` first). A "From shared chats" tab in `VisualizeDialog` with a URL list, reorder, per-link preview, the toggle and a paste fallback | M |
| **C2** | Feed the transcripts into G2/G3, with `ContentSource.origin: "chat_share"` (links, order, lineage). Adding a link later = "Update from new content" | S once G2/G3 exist |
| **C3** | Gemini extractor (Phase 0 test first: rendered by JavaScript, `g.co` short links) | S–M |
| **C4** | Claude extractor (Phase 0 test first: bot protection is the risk; fallback = paste) | S–M |

## 7. Order

G0 → G1 → G2 → (C1 can run alongside G1/G2) → G3 → C2 → G2b → C3 → C4.

## 8. Testing and safety

- Mock-provider unit and contract tests throughout. **No live AI runs without the user's go-ahead in that turn.**
- Extractor tests run on saved, cleaned share pages, never on live sites. E2E runs against a local fixture server.
- The fetch route only allows the providers' hosts (blocks server-side request forgery). Fetched content is
  untrusted input to prompts and goes through `context/redact.ts`.
- Local only while hosting is deferred. Playwright on a hosted server (Chromium binary, IP blocking, terms of
  service) is reconsidered with the C1 hosting step.
