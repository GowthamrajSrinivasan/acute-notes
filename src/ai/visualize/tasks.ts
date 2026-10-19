/**
 * The AI tasks behind Visualize (F31, PRD §13.15.1/§13.15.8), registered
 * with the task registry (F26):
 *
 * - `outline_document` (`outline.ts`) — the document's semantic sections and
 *   what kind each one is; run for every document without a forced template.
 * - `generate_visual_plan` — populate one section (its kind's rules) or a
 *   forced template from the content;
 *   always the primary provider (never the decision model — this is
 *   authoring, not routing). On an update (F38b) it also gets the section's
 *   `current` nodes and is asked for *conceptual* changes only: keep what
 *   still means the same (`"unchanged": true`, which the app expands back to
 *   the exact previous node), change only concepts that changed, and put
 *   added explanation into child nodes linked by `explained_by` rather than
 *   into the concept itself.
 *
 * `generate_visual_plan`'s registered `outputSchema` is the full `VisualPlan` shape:
 * it's `planEnvelopeSchema` (F29) — just enough to know the reply is
 * plan-shaped at all (an object, the right `version`, a real `template`, a
 * `nodes` array). That mirrors exactly F29's own "reject only if unusable"
 * boundary, so the runtime's one repair retry catches genuinely broken
 * output while every per-node/per-relationship leniency stays where it
 * belongs: `validateVisualPlan`, run once after the runtime returns (see
 * `visualize.ts`). Most providers here have no native structured output
 * (§13.15.11), so the detailed shape lives in the prompt text, not a schema
 * attached to the request.
 */
import { z } from "zod";
import { getTaskRegistry, type TaskDefinition, type TaskRegistry } from "@/ai/tasks";
import { planEnvelopeSchema } from "@/ai/visual-plan/schema";
import { templateFor } from "@/ai/visual-plan/templates";
import { VISUAL_TEMPLATES } from "@/ai/visual-plan/types";
import { SECTION_KINDS, sectionKind } from "@/ai/visual-plan/sectionKinds";
import { outlineDocumentTask } from "./outline";
import { analysisPatchEnvelope, analysisPatchInput, needsAnalysisNodes, type AnalysisPatchInput } from "./analysisPatch";

/** A section's current representation, as the model sees it on an update: plan-local ids ("p1", …) and unit-local keys. */
export const currentRepresentation = z.object({
  nodes: z.array(z.record(z.string(), z.unknown())),
  relationships: z.array(z.object({ from: z.string(), to: z.string(), type: z.string(), label: z.string().optional() })),
});
export type CurrentRepresentation = z.infer<typeof currentRepresentation>;

/** How the section's text changed, paragraph by paragraph (computed by the app, not guessed by the model). */
export const textChanges = z.object({ edited: z.array(z.string()), added: z.array(z.string()) });
export type TextChanges = z.infer<typeof textChanges>;

export const generateVisualPlanInput = z.object({
  template: z.enum(VISUAL_TEMPLATES),
  text: z.string().min(1),
  /** One section of an outlined document (F42 Phase 2): generated with its kind's rules instead of a template's. */
  section: z.object({ label: z.string().min(1), kind: z.enum(SECTION_KINDS) }).optional(),
  /**
   * `text` is one piece of a large section, generated on its own (`pieces.ts`): it places only its own content, and the
   * section's takeaway and analysis are written afterwards for the whole section.
   */
  part: z.object({ index: z.number().int().min(1), total: z.number().int().min(2) }).optional(),
  current: currentRepresentation.optional(),
  changes: textChanges.optional(),
  /**
   * With `current`: `text` is only the paragraphs appended to the section (every earlier one is unchanged), so the reply
   * gives only what they add; the app keeps every current node as it is (`withCurrentKept`).
   */
  appended: z.literal(true).optional(),
  /** One block the user asked to see better (F42 Phase 4, "Visualize better"): it held too much to read, for `reason`. */
  dense: z.object({ reason: z.string().min(1).max(200) }).optional(),
  /** "Regenerate" in the review: the points of this section an earlier plan left out (which this one must place). */
  retry: z.object({ missing: z.array(z.string().min(1).max(20_000)).min(1).max(500) }).optional(),
  /** The analysis check (Wave B): what an earlier plan of this section lacked ("takeaway", "analysis"). */
  analysisRetry: z.object({ missing: z.array(z.string().min(1).max(400)).min(1).max(10) }).optional(),
  /**
   * The section's text numbered block by block ([T1] tables, [L1] lists, [C1] code, [P1] paragraphs;
   * `numberSource`), shown instead of `text`, so blocks can be placed by reference (Wave B1).
   */
  numbered: z.string().min(1).optional(),
});
export type GenerateVisualPlanInput = z.infer<typeof generateVisualPlanInput>;

export const NODE_SHAPES = `{"id":"n1","type":"heading","content":{"text":"..."}}
{"id":"n2","type":"text","content":{"markdown":"..."}}
{"id":"n3","type":"todo","content":{"items":[{"text":"...","checked":false}]}}
{"id":"n4","type":"table","content":{"columns":["..."],"rows":[["..."]]}}
{"id":"n5","type":"code","content":{"language":"typescript","source":"..."}}
{"id":"n6","type":"page","content":{"title":"...","markdown":"..."}}
{"id":"n7","type":"shape","content":{"shape":"rectangle","label":"..."}}`;

/**
 * Architecture plans become interactive diagram frames (interactive architecture frames, Phase 2): each component
 * shape gets a kind (which colours it) and a short sublabel, and each link a label, so selecting a component shows
 * what it is and how it connects. The metadata's cards sit under the diagram.
 */
export const ARCHITECTURE_RULE =
  `Architecture: draw each component (service, UI, store, queue, external system) as a "shape" with a short "label", and add to its content ` +
  `"kind" — one of "frontend", "backend", "database", "cloud", "security", "messagebus", "external" — plus, where the content says, ` +
  `"sublabel" (its technology or file, e.g. "FastAPI :8000"), "tag" (a short note, e.g. "cached") and "details" (up to 8 short responsibilities). ` +
  `Link components with "flows_to" / "depends_on" and a short "label" saying what passes (e.g. "SQL", "question"), and an "explanation" of why when the content gives one. ` +
  `Optionally add "cards" to "metadata": up to 6 {"title":"...","items":["..."]} summarising cross-cutting points (security, cost, deployment) the content states.

`;

/**
 * Visualize, never summarize (content fidelity plan §1): the structure is short, the information is complete.
 * Concepts stay short-labelled (PRD §13.15.19a); what the content says about them becomes a linked child at the
 * right level of detail — never a longer concept, and never dropped.
 */
export const FIDELITY_RULE =
  `Visualize the content — do not summarize it. Every piece of information in it must appear somewhere in your plan: ` +
  `facts, numbers and units, names, conditions and qualifications ("only", "unless", "except", "not", "at most"), examples, exceptions, steps and relationships. ` +
  `Short labels are encouraged; missing information is not. You may shorten wording, reorder and group, but never leave out a detail because it seems minor.
` +
  `Represent only what the content says: never add steps, items, examples, pages or facts it doesn't contain, and never pad a short content out.
` +
  `Put each piece of information at its level:
` +
  `- Structure (the concepts, steps, options, components): one node each, with a short label.
` +
  `- What the content says about one of them (how it works, why, conditions, examples, caveats): in the content's own words, in the body of its "text" node — ` +
  `or, for a "shape" (which holds only a label), in its own "text" node linked from it with {"from":"<concept id>","to":"<detail id>","type":"explained_by"}. ` +
  `Never folded into the concept node's label, and never added as another step of a flow.
` +
  `- Long background, examples or code: a "page" node (or "code" node) linked the same way.
` +
  `- A list item that only introduces a nested list ("**Example:**", "**Significance:**", "**Key challenges:**" followed by sub-bullets) is ONE unit with its sub-bullets: ` +
  `keep the label and every sub-bullet together in the same "text" node — the label as its bold first line (or its "title"), the sub-bullets as bullets beneath it. ` +
  `Never a node holding only the label, and never its sub-bullets as separate nodes away from it: a reader must see which label each point belongs to. ` +
  `The same goes for a bold label with its own items in a list (e.g. "**What it is:** …" / "**Significance:** …" / "**Example:** …" of one concept): they are the parts of ONE concept's node, not separate cards.
` +
  `A table in the content stays a "table" with every row and every cell's full text (numbers, names, paths, conditions) — never a shortened copy. ` +
  `You may add a visual of it (a flow, a tree) beside the table, but not instead of it.
` +
  `A link between steps of a sequence goes from the earlier step to the later one ("flows_to"), so arrows follow the order of the steps. Use "relates_to" only for an association with no direction or order.

`;

/** An analysis node as the reply's JSON shape shows it (the same node the analysis patch's shape and `analysisRule` ask for). */
const ANALYSIS_NODE_EXAMPLE = `{"id":"a1","type":"text","origin":"analysis","title":"...","content":{"markdown":"..."}}`;

/**
 * Analyse on top, preserve underneath (content fidelity plan, Revision 2): the model's own reading of a section — its
 * takeaway and the analysis its kind calls for — on top of the content's details, marked as analysis (D-R2.1) so it
 * is never read as a fact the content states.
 */
export function analysisRule(kindAnalysis: string | null): string {
  return (
    `Then analyse it — the reader must understand it at a glance, not only find its details:\n` +
    `- "metadata.takeaway": the section's main point in one line of your own words (at most 15 words), e.g. "Merge v3 now; two decisions wait on the engineer". Always give one.\n` +
    (kindAnalysis ? `- ${kindAnalysis}\n` : `- What it means: the conclusions, what is decided or open, and the trade-offs the content implies.\n`) +
    `- Put this analysis in "text" nodes marked "origin":"analysis" (e.g. {"id":"a1","type":"text","origin":"analysis","title":"Status","content":{"markdown":"..."}}), ` +
    `linked to what it is about where that helps. It may state what the content implies but doesn't say; it must never contradict the content or add facts it doesn't contain.\n` +
    `- The takeaway and analysis are specific to this content: name its own things (its checks, files, numbers, decisions). Never add a generic benefit or outcome it doesn't state ` +
    `("improves user experience", "increases efficiency", "enhances reliability"); when the content gives no outcome, say what changed or what is open instead.\n` +
    `- The content's own details stay as they are above (in its own words, nothing left out). Analysis is added on top, never instead of them.\n\n`
  );
}

/**
 * Reference, don't regenerate (Wave B1): the content is numbered block by block, and a block placed as it is goes
 * in by reference — the app inserts it verbatim (`expandSourceRefs`), so a retyped copy can't lose a column or a
 * condition, and the model's output goes to structure and analysis.
 */
export const REFERENCE_RULE =
  `The content below is numbered block by block: [T1], [T2] … tables, [L1] … lists, [C1] … code, [P1] … paragraphs. ` +
  `To place a block exactly as it is, use {"id":"n9","type":"source","ref":"T1"} (it takes "title", "importance" and links like any node) instead of retyping it: ` +
  `the app inserts the whole block, word for word. Place every table this way, with all its rows and columns — never a shortened copy — ` +
  `and any list, code or paragraph you would otherwise copy. Place each block at most once. ` +
  `The numbers are for placing blocks only: never write "[P1]", "[T1]" or the like in your own text. ` +
  `Never restate a block you placed: no shape, card or node repeating its rows, items or sentences — the block already shows them, and a second copy only crowds the canvas. ` +
  `Your own nodes are for what the content doesn't already show: structure the blocks don't have (shapes and links for a flow, a tree, dependencies between items) and your analysis.

`;

/**
 * How the reference rule applies to paragraphs appended to a section already drawn (`appended`): a block that is a new concept is
 * placed by reference like any other, but one that adds to what an existing node already describes (another row of its table, another
 * item of its list) is never placed beside it — that node is replied in full, as the appended rules say.
 */
export const APPENDED_REFERENCE_NOTE =
  `These blocks are new paragraphs added to a section that is already drawn (below). Place a block that is a new concept by reference. ` +
  `A block that adds to what an existing node already describes (another row of its table, another item of its list, another clause of its sentence) is not placed by reference: ` +
  `reply that node in full with the addition, as described below.\n\n`;

/** "Visualize better" (F42 Phase 4): one dense block, split into a more visual form without losing or adding anything. */
const denseRules = (reason: string) =>
  `This content was one block on a canvas with too much in it to read (${reason}). Split it into a more visual form — every fact kept, nothing added:
` +
  `- A table whose cells are paragraphs: one card per row, for every row — a "text" node whose "title" is the row's short name (its name or item, a few words) and whose markdown ` +
  `starts with the row's short values in bold labels on one line (e.g. "**Size:** M · **Status:** ✅ Done"), then the rest of the row. ` +
  `When a cell is long, the card keeps its opening sentences and the whole cell goes in a "page" node (titled with the row's name) linked from the card with "explained_by".
` +
  `- Rows, items or steps whose order matters (a numbered order, a sequence): link them in that order with "flows_to".
` +
  `- A checklist whose items are paragraphs: a "todo" of each item's lead (its first sentence, keeping checked/unchecked), with each item's detail as a "text" node linked "explained_by".
` +
  `- Prose: every point as its own "text" card in the content's own words (or a "shape" for a few-word idea, with its detail linked "explained_by"), linked only where the text relates them; long background in a "page".
` +
  `Keep cards readable: when a card would pass about 400 characters, move the rest into a "page" linked from it — never cut it.

`;

/** "Regenerate" (content fidelity): an earlier plan of this section left these points out; this one places each. */
function retryRules(missing: readonly string[]): string {
  const quote = (p: string) => `  «${p.length > 600 ? `${p.slice(0, 599)}…` : p}»\n`;
  return (
    `An earlier plan of this section left out these points of the content. This time, place every one of them in the plan, ` +
    `at its level (a node's label, its detail, a table row, a step), together with everything else:\n${missing.map(quote).join("")}\n`
  );
}

/** The analysis check's one retry (Wave B): the earlier plan only restated the section. */
function analysisRetryRules(missing: readonly string[]): string {
  return (
    `An earlier plan of this section fell short of an analysis: it lacked ${missing.join(" and ")}. ` +
    `This time give "metadata.takeaway" and "text" nodes marked "origin":"analysis" that cover all of it, as described above, together with every detail.\n\n`
  );
}

/** The update rules (F38b): report conceptual changes to the section's current representation, not a regeneration. */
function updateRules(current: CurrentRepresentation, changes?: TextChanges): string {
  return (
    (changes ? textChangeFacts(changes) : "") +
    `This section is already on the user's canvas as the representation below. The content has since changed. ` +
    `Update the representation for what changed in *meaning*, not in wording:\n` +
    `- A node whose concept is unchanged — the content states the same facts about it, only worded differently: reply with only {"id":"<its id>","unchanged":true}.\n` +
    `- A node whose concept changed — any fact it states is now different, added or corrected, however small (a number, a duration, a name, a condition, a step): reply with the full node, keeping its "id" and "stableKey", and with that fact in the node itself.\n` +
    `- A new fact that belongs to what an existing node already describes (another row of its table, another item of its list, another clause of its sentence) changes that node — it is not a new concept.\n` +
    `- A new concept (something the section didn't cover at all): a new node with a new "id" and a new, unique "stableKey" (keys are identities, not positions — never renumber existing ones).\n` +
    `- A concept no longer in the content: leave it out.\n` +
    `- New explanation of an existing concept: a new explanation node linked with "explained_by", never a change to the concept node.\n` +
    `Relationships: reply with the full set for the section, using these ids (e.g. a new step inserted between two others replaces the old link between them).\n\n` +
    `Current representation:\n${JSON.stringify(current)}\n\n`
  );
}

/**
 * The rules for paragraphs appended to a section (`appended`): only what they add is replied, since every node shown stays as
 * it is. Replying with the whole section again is what made a merge's grown topics cost as much as new ones.
 */
function appendedRules(current: CurrentRepresentation): string {
  return (
    `This section is already on the user's canvas as the representation below, and it stays exactly as it is. ` +
    `New paragraphs were appended to the section; the content below is ONLY those paragraphs. Reply with only what they add:\n` +
    `- A new concept: a new node with a new "id" and a new, unique "stableKey".\n` +
    `- New explanation of an existing concept: a new node linked from that concept's id with "explained_by".\n` +
    `- A new fact that belongs to what an existing node already describes (another row of its table, another item of its list): the full node, ` +
    `keeping its "id" and "stableKey", with the fact added and everything it said before kept.\n` +
    `Never repeat an existing node you don't change, and never leave one out on purpose: every node you don't mention is kept. ` +
    `Relationships: only those that involve a node you reply with (they may refer to the ids below).\n\n` +
    `Current representation:\n${JSON.stringify(current)}\n\n`
  );
}

/** What changed in the section's text, as facts:an edited paragraph updates the node showing it; only an added one can be a new node. */
function textChangeFacts(changes: TextChanges): string {
  const quote = (p: string) => `  «${p.length > 400 ? `${p.slice(0, 399)}…` : p}»\n`;
  const edited = changes.edited.length
    ? `Edited — the same point as before, now corrected or reworded (reflect it in the existing node that shows it; never add a node for it):\n${changes.edited.map(quote).join("")}`
    : "";
  const added = changes.added.length
    ? `Added — new paragraphs with no counterpart before (each is an explanation of the concept it elaborates, linked explained_by, or a genuinely new concept):\n${changes.added.map(quote).join("")}`
    : "No paragraph was added to this section — so no new node is needed.\n";
  return `How this section's text changed since the current representation:\n${edited}${added}\n`;
}

function withRepair(prompt: string, repairFeedback?: string): string {
  return repairFeedback ? `${prompt}\n\n${repairFeedback}` : prompt;
}

export const generateVisualPlanTask: TaskDefinition<GenerateVisualPlanInput, unknown> = {
  task: "generate_visual_plan",
  inputSchema: generateVisualPlanInput,
  outputSchema: planEnvelopeSchema,
  // A long section's plan is a large JSON reply: slower models took over the 60s default (live run, 2026-10-07).
  timeoutMs: 180_000,
  buildPrompt: ({ input, repairFeedback }) => {
    const t = templateFor(input.template);
    const roles = t.recommendedRoles?.length ? ` Roles it's usually built around: ${t.recommendedRoles.map((r) => `"${r}"`).join(", ")} (optional).` : "";
    const k = input.section ? sectionKind(input.section.kind) : null;
    // A section of an outlined document is described by its kind: what it is and how it is represented.
    const framing = k
      ? `This is one section, "${input.section!.label}", of a larger workspace. It is a "${k.id}" section: ${k.when}.
` +
        `${k.rules}
` +
        `Node types to use: ${k.nodeTypes.map((n) => `"${n}"`).join(", ")}. Relationship types: ${t.allowedRelationTypes.map((r) => `"${r}"`).join(", ")}. ` +
        `The app shows the section's label as its title, so don't repeat it as a heading node.
` +
        (input.part
          ? `The content below is part ${input.part.index} of ${input.part.total} of this section, generated on its own: place everything in it, and nothing about the other parts ` +
            `(don't summarize the section, don't refer to the other parts, and give no takeaway or analysis — those are written for the whole section afterwards).
`
          : "") +
        `
`
      : `Template: "${input.template}" (${t.name}) — ${t.description}
` +
        `Node types this template uses: ${t.allowedNodeTypes.map((n) => `"${n}"`).join(", ")}.${roles}
` +
        `Relationship types this template uses: ${t.allowedRelationTypes.map((r) => `"${r}"`).join(", ")}.

`;
    // Sections of an outlined document are analysed; a user-forced template, a dense block, an update or a piece is only restructured.
    const analysed = Boolean(k && !input.dense && !input.current && !input.part);
    return {
      systemPrompt:
        "You turn content into a VisualPlan: a structured description of what it means, for an app to render as native objects. " +
        "You never generate an image, HTML, or any UI yourself — only this JSON structure. You never invent a node type, relationship type, or template beyond the ones given.",
      prompt: withRepair(
        framing +
          `Reply with JSON only, exactly this shape:\n` +
          `{"version":1,"template":"${input.template}","nodes":[<node>, ...${analysed ? `, ${ANALYSIS_NODE_EXAMPLE}` : ""}],"relationships":[{"from":"n1","to":"n2","type":"depends_on","label":"optional"}],"metadata":{"title":"optional"${k && !input.part ? `,"takeaway":"..."` : ""}}}\n\n` +
          `Each node is one of (pick freely, mixing types is normal):\n${NODE_SHAPES}\n\n` +
          `Give every node a unique "id" ("n1", "n2", ...); relationships refer to those ids. Use as many nodes as the content needs. ` +
          `Use "role" on a node (e.g. "problem", "cause") where the template calls for it. ` +
          `Optionally give a node a "stableKey": a short structural label from its role and position (e.g. "cause#2", "step#1"), never its wording. ` +
          `A "title" on a node becomes a small heading above it, when it helps.\n\n` +
          FIDELITY_RULE +
          (input.template === "architecture" && !k ? ARCHITECTURE_RULE : "") +
          (input.numbered ? REFERENCE_RULE + (input.appended ? APPENDED_REFERENCE_NOTE : "") : "") +
          (analysed && k ? analysisRule(k.analysis) : "") +
          (input.analysisRetry ? analysisRetryRules(input.analysisRetry.missing) : "") +
          (input.dense ? denseRules(input.dense.reason) : "") +
          (input.retry ? retryRules(input.retry.missing) : "") +
          (input.current ? (input.appended ? appendedRules(input.current) : updateRules(input.current, input.changes)) : "") +
          `Content to visualize:\n\n${input.numbered ?? input.text}`,
        repairFeedback,
      ),
    };
  },
  policy: { limitConcurrency: true },
};

/**
 * The analysis check's light retry (`analysisPatch.ts`): only the takeaway and analysis a section's plan lacks, for
 * the plan it already has — a short reply instead of the whole plan again.
 */
export const generateSectionAnalysisTask: TaskDefinition<AnalysisPatchInput, unknown> = {
  task: "generate_section_analysis",
  inputSchema: analysisPatchInput,
  outputSchema: analysisPatchEnvelope,
  timeoutMs: 90_000,
  buildPrompt: ({ input, repairFeedback }) => {
    const k = SECTION_KINDS.includes(input.kind as never) ? sectionKind(input.kind as (typeof SECTION_KINDS)[number]) : null;
    const nodes = input.nodes.map((n) => `- ${n.id} (${n.type}): ${n.label}`).join("\n");
    const wantNodes = needsAnalysisNodes(input.missing);
    const prompt =
      `A plan of one section, "${input.label}"${k ? ` (a "${k.id}" section: ${k.when})` : ""}, already exists, but it lacks ${input.missing.join(" and ")}. ` +
      `Do not redo the plan: give only what is missing, from the content below.

` +
      `The plan's nodes:
${nodes || "(none)"}

` +
      analysisRule(k?.analysis ?? null) +
      `Reply with JSON only, exactly this shape:
` +
      `{"takeaway":"..."${wantNodes ? `,"nodes":[{"id":"a1","type":"text","origin":"analysis","title":"...","content":{"markdown":"..."}}],"relationships":[{"from":"a1","to":"<a node id above>","type":"relates_to"}]` : ""}}
` +
      (wantNodes ? `Give the analysis in "text" nodes with "origin":"analysis" (new ids a1, a2, …), and link each to the node above it is about.
` : `Give only "takeaway".
`) +
      `
Content:

${input.text}`;
    return {
      systemPrompt:
        "You analyse one section of a document for a visual workspace: its main point and what it means, specific to its own content. You never invent facts the content doesn't contain, and you reply with JSON only.",
      prompt: withRepair(prompt, repairFeedback),
    };
  },
  policy: { limitConcurrency: true },
};

/** Registers the Visualize tasks once (idempotent, so hot reload and tests can call it freely). */
export function registerVisualizeTasks(registry: TaskRegistry): void {
  if (!registry.has(generateVisualPlanTask.task)) registry.register(generateVisualPlanTask);
  if (!registry.has(outlineDocumentTask.task)) registry.register(outlineDocumentTask);
  if (!registry.has(generateSectionAnalysisTask.task)) registry.register(generateSectionAnalysisTask);
}

registerVisualizeTasks(getTaskRegistry());
