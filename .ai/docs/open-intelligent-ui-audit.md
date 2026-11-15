# Audit — adopting `open-intelligent-ui` / OpenUI for note-making in Acute

Status: Draft · 2026-11-10 · owner: Gowthamraj

**Phased implementation plan:** [[openui-integration-plan]] (`.ai/docs/openui-integration-plan.md`) — Phase 1
(this audit's Option A) done 2026-11-13; Phases 2–5 and their sequencing against the parallel Intelligent
Update Engine work are there, not here.

**Question asked:** can we use [thesysdev/open-intelligent-ui](https://github.com/thesysdev/open-intelligent-ui)
to make notes in the canvas "as the default way," the way ChatGPT's recent update makes notes — and
how do we take complete advantage of it?

**Verdict in one line:** Yes, but as a *new optional generative-UI rendering layer for AI-authored note
cards (and a document/"notes" view)* — **behind a flag, fed by the existing `VisualPlan`** — **not** as a
replacement for the Excalidraw canvas, BlockNote editing, or the knowledge-notes fidelity pipeline. The
single biggest concrete win is **streaming + ~67% fewer tokens than JSON**, which lands directly on our
cost targets.

---

## 1. First, untangle two different ChatGPT things

The request conflates two separate OpenAI features. Being precise matters because they pull us in
different directions:

| ChatGPT feature | What it is | OSS analogue |
|---|---|---|
| **Notes / "writing blocks"** (Jun 2026) | Answers saved as editable **markdown documents** in your Library; full-screen editor; canvas was *retired* from GPT-5.5 in favour of this | **BlockNote** — which we already use |
| **"Intelligent UI"** (what `open-intelligent-ui` recreates) | Answers stream as **interactive generative UI** — maps, charts, tables, forms, working tools the model composes itself | **OpenUI / `open-intelligent-ui`** |

So "make notes like ChatGPT's latest update" is really the *writing-blocks/markdown-notes* direction, and
**we already have that engine (BlockNote + Yjs).** `open-intelligent-ui` is the *other* feature — generative
interactive UI. The honest framing for Acute: use OpenUI to make **AI-authored note cards richer and
interactive** (and to offer a linear "notes document" view), not to reproduce ChatGPT's markdown editor —
we have that.

Sources: [OpenAI release notes](https://openai.com/products/release-notes/) ·
[ChatGPT Canvas in 2026](https://www.ai-toolbox.co/chatgpt-management-and-productivity/how-to-use-chatgpt-canvas-guide-2026) ·
[ChatGPT Notes / markdown editor](https://thewincentral.com/chatgpt-notes-feature-markdown-editor/)

---

## 2. What `open-intelligent-ui` / OpenUI actually is (facts)

- **`open-intelligent-ui`** = a sample app (Next.js chat demo) recreating ChatGPT's Intelligent UI. The
  *reusable* value is the standard it's built on: **OpenUI**.
- **OpenUI** = "The Open Standard for Generative UI," **MIT-licensed**. Two packages matter to us:
  - **`@openuidev/lang-core`** — framework-agnostic parser, prompt-generation, runtime evaluation, type
    layer. No React/Vue/Svelte dependency. Usable server/edge-side.
  - **`@openuidev/react-lang`** — React bindings: `defineComponent` + `createLibrary` (you define the
    components the model is allowed to emit, with **Zod** prop schemas), `library.prompt()` (generates the
    system prompt), and a streaming `Renderer`. **Reached 1.0.0 on 2026-10-12.**
- **OpenUI Lang** = a compact, streaming-first DSL. Output looks like variable assignments:
  ```
  root  = Stack([title, content])
  title = TextContent("Hello", "large-heavy")
  ```
  Each child streams and validates independently; the shell renders immediately while children arrive.
  Claims **up to ~67% fewer tokens than equivalent JSON.**
- **Model composes the layout** from your primitives — "no layout is fixed in the components." Interactive
  bits use `action()` + `useTriggerAction`, and local state via `$variables` / `@Set` (no server round-trip).
- **Thesys C1 is the *paid* hosted gateway — we do NOT need it.** The OSS path runs the renderer against
  **any OpenAI-compatible endpoint, Azure, or a local model (Ollama)**. C1 only adds a managed gateway +
  tuned model (`OUI-1`). This is important given our cost posture — we stay on our own provider registry.

Sources: [open-intelligent-ui README](https://github.com/thesysdev/open-intelligent-ui) ·
[openui repo](https://github.com/thesysdev/openui) ·
[Defining Components docs](https://www.openui.com/docs/openui-lang/defining-components) ·
[`@openuidev/react-lang` on npm](https://www.npmjs.com/package/@openuidev/react-lang) ·
[How C1 works](https://www.openui.com/docs)

---

## 3. Fit against Acute's actual architecture

Our note pipeline is already cleanly layered (this is the good news):

```
parse → outline → generate_visual_plan  →  VisualPlan / VisualNode   (provider-neutral AI plan)
                                             │  src/ai/visual-plan/types.ts
                           mapNode.ts  ──────┤  markdown → RichContent via injected parseMarkdown
                                             ▼
                        AcuteObject / RichContent (RichBlockObject)   (renderer-neutral domain)
                                             │  src/domain/types.ts
             domain/canvas/adapter.ts  ──────┤
                                             ▼
        Excalidraw canvas  +  BlockNote editor hosts  (RichBlockHost.tsx)   (concrete UI libs)
```

Only three places bind to concrete UI libraries: `ExcalidrawCanvas.tsx`, `domain/canvas/adapter.ts`, and
the BlockNote `RichBlockHost`/`RichBlockEditor`. **The AI pipeline and domain model never import a
renderer.** That means a generative-UI layer can be added at the rendering seam without touching
generation — *provided it can consume (or produce) `AcuteObject`/`RichContent` plus the knowledge-notes
`sourceUnits`/`review` metadata.*

### Where OpenUI plugs in — two candidate seams

1. **Card interior** (recommended first prototype). Today `mapNode.ts` turns a `VisualNode` into a
   `RichBlockObject` whose body is BlockNote block-JSON. Alternative: for AI-authored cards, let the model
   emit **OpenUI Lang** from an Acute component library, and render it inside a new host variant alongside
   `RichBlockHost`. The card stops being fixed paragraph/heading/list blocks and becomes a composed
   "idea card" (callout + citation chip + mini-table + source link) the model arranges itself.

2. **"Notes" document view** (the ChatGPT-notes analogue). A linear, streaming panel (not the spatial
   canvas) that renders a whole distilled note set as generative UI — a reading/summary surface over the
   same `VisualPlan`. This is the closest literal match to "notes as the default output," and it sidesteps
   the spatial-layout mismatch (below).

### Technical compatibility — strong

| Dimension | Acute | OpenUI | Fit |
|---|---|---|---|
| UI framework | React 19.3, Next 16.3 (App Router) | React + Next App Router | ✅ exact |
| Language | TypeScript 6 | TypeScript | ✅ |
| Schema lib | **Zod ^4** | **`zod/v4`** | ✅ same major — schemas interop |
| Providers | own registry (Copilot/OpenAI/Azure/Anthropic/Ollama/Gemini…) | any OpenAI-compatible / Ollama | ✅ reuse registry |
| Streaming | task runtime already streams | streaming-first DSL | ✅ |
| Node | — | sample app wants Node 24+ | ⚠️ that's the *demo app*, not the libs |

---

## 4. The mismatches to be honest about

These are why OpenUI is an **augmentation, not a replacement**:

1. **OpenUI does not do 2D spatial canvas layout.** It composes *nested/linear* document UI. Our
   `VisualPlan` → `layout.ts`/`place.ts`/`measure.ts`/`frameSplit.ts` engine does spatial placement on an
   Excalidraw canvas (flow, concept_map, timeline, architecture…). OpenUI replaces the *inside of a card*
   or a *document view* — it is not a substitute for the canvas layout engine.

2. **OpenUI Lang is an ephemeral render format, not a persistence/collab format.** Notes at rest are
   **BlockNote block-JSON backed by Yjs** (collaborative, versioned, exportable). OpenUI output would have
   to be either (a) persisted as-is and treated as read-mostly AI output, or (b) mapped back to
   `RichContent`. You lose in-place rich-text editing + Yjs collaboration on any card rendered purely as
   OpenUI. **Conclusion: good for AI-generated, read-mostly cards; poor for user-editable collaborative
   notes.**

3. **The knowledge-notes fidelity machinery is built on `RichContent`/`Idea`.** Coverage (`accounting.ts`),
   exactness (`exactness.ts`), meaning (`meaning.ts`), source units, review queue — all consume the domain
   content model, not OpenUI Lang. OpenUI is an *extra rendering surface* over that pipeline; the citation /
   coverage / review system stays as-is. Any OpenUI card must still carry `sourceUnits`/`review` so the
   Source panel + two-way highlighting keep working.

4. **Dependency / maintenance surface.** `@openuidev/*` is 1.0.0 as of 2026-10-12 — young. Adds a parser +
   renderer runtime we don't control. Mitigate by (a) gating behind a flag like `noteModel`, (b) keeping it
   read-path only at first, (c) `lang-core` is MIT so we can vendor if needed.

---

## 5. How to take "complete advantage" — where it genuinely wins

Ranked by payoff for Acute specifically:

1. **Token/cost reduction on generation.** Today the detailed `VisualPlan` shape lives *in the prompt text*
   because most providers lack native structured output (`tasks.ts` lines ~20–26), and output is loosely
   JSON-ish. OpenUI Lang is streaming-first and ~67% lighter than JSON. Emitting cards as OpenUI Lang —
   with a prompt generated by `library.prompt()` — could cut both prompt and completion tokens.
   **This maps straight onto the chat-import cost benchmark (baseline $0.47, target ≥40% lower) and the
   deterministic-pipeline cost work.** → *Measure this first; it's the business case.*

2. **Richer AI note cards without hand-coding every layout.** Define an Acute component library mirroring
   `VISUAL_TEMPLATES` (IdeaCard, CitationChip, ComparisonTable, Callout, MiniMermaid, Timeline,
   DecisionTree, SourceLink…). The model arranges them per card — more expressive than fixed BlockNote
   blocks, with zero bespoke layout code per template.

3. **Interactive, zero-round-trip cards.** `$variables` + `@Set` give toggles, "show/hide source," expand
   /collapse, step-throughs — local state with no server call. Good for distilled idea cards with an
   expandable source excerpt.

4. **A streaming "notes" reading view** as the default *output* surface (the ChatGPT-notes framing), while
   the spatial canvas remains the *workspace*.

---

## 6. Options (ranked)

| # | Option | Effort | Risk | What it buys |
|---|---|---|---|---|
| **A** | **Prototype: card-interior renderer + token A/B** behind a flag (`noteRender: "blocknote" \| "openui"`). Define a minimal Acute OpenUI library; render AI cards via `@openuidev/react-lang` in a `RichBlockHost` variant; keep BlockNote for editing. Measure tokens vs today. | **S–M** | Low (read-path, flagged) | Validates the cost win + richer cards with minimal blast radius |
| B | **Streaming "Notes" document panel** over `VisualPlan` (non-canvas reading view) | M | Low | Literal "notes as default output"; sidesteps spatial mismatch |
| C | Adopt **OpenUI Lang as the AI output DSL** (replace prompt-embedded JSON VisualPlan with `library.prompt()` + Lang), still mapping Lang → `AcuteObject` for the canvas | M–L | Med | Biggest token win across *all* generation, canvas unaffected |
| D | Replace BlockNote/Excalidraw with OpenUI | — | **High** | ❌ Not recommended — loses editing, Yjs collab, spatial layout, fidelity pipeline |

Recommended path: **A → measure → then B and/or C** if the token numbers hold.

---

## 7. Concrete next steps for Option A

1. **Spike the component library.** New `src/ai/openui/library.ts`: `defineComponent` for 4–5 card
   primitives (IdeaCard, CitationChip, Callout, MiniTable, SourceLink) with Zod props that carry
   `sourceUnits`. `createLibrary({ root: "IdeaCard", ... })`.
2. **Generate the prompt** via `library.prompt({ preamble, additionalRules, examples })` and wire it as an
   alternative output mode in `visualize/tasks.ts` (new task variant, flagged — do **not** touch the
   default path).
3. **Render host.** `src/components/blocks/OpenUiBlockHost.tsx` using `@openuidev/react-lang` `Renderer`,
   mounted the same way `RichBlockHost` is from `ExcalidrawCanvas.tsx`, for cards flagged `openui`.
4. **Persistence decision.** Store the emitted OpenUI Lang on the `RichBlockObject` (new field) and treat
   those cards as AI-authored/read-mostly; editing falls back to regenerate or to a BlockNote conversion.
5. **Measure.** Run the existing cost harness on the chat-import benchmark set: tokens + $ for
   BlockNote-JSON path vs OpenUI-Lang path, same inputs. **Gate the decision on ≥ the 40% target.**
6. **Keep fidelity intact.** Ensure OpenUI cards still emit `sourceUnits`/`review` so Source panel,
   coverage chips, and the review queue are unaffected.

> Per repo policy: **no AI/model runs, no paid generation, and no commits** without explicit go-ahead in
> the same turn. Steps 1–4 are offline/scaffolding; step 5 needs approval before any model spend.

---

## 8. Open questions

- Does `@openuidev/react-lang` tolerate `zod ^4` exactly as we pin it, or does it need `zod/v4` subpath? (verify on install)
- Can OpenUI Lang be persisted + re-rendered deterministically (for export `portability/**` and Electron offline)?
- Editing story: do we ever let users edit an OpenUI card, or are these strictly AI-authored read surfaces?
- Does emitting Lang actually reduce *our* tokens given we'd still inline per-card source-unit citations?
