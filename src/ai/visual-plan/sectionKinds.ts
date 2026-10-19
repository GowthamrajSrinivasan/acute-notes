/**
 * Section kinds (F42 Phase 2): what a section of a document *is*, decided by
 * the `outline_document` task — never a layout the model invents. Each kind is
 * deterministic code: the arrangement its frame uses, the node types that
 * express it, and the rules its section is generated with. New kinds are
 * added here by the Acute-Notes team, like templates (`templates.ts`).
 *
 * The outline's classification follows a fixed order of questions (a
 * relationship? a comparison? a sequence? parallel concepts? metrics? a
 * decision? prose needing its own annotations? supporting detail?), so the
 * same content lands in the same kind.
 */
import type { GroupArrangement, VisualNodeType } from "./types";

export const SECTION_KINDS = ["comparison", "hierarchy", "flow", "cards", "decision", "metrics", "annotated", "supporting", "notes"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Primary sections carry the main idea and come first; supporting ones (reasoning, evidence, detail) follow. */
export const SECTION_PROMINENCE = ["primary", "supporting"] as const;
export type SectionProminence = (typeof SECTION_PROMINENCE)[number];

export interface SectionKindDefinition {
  id: SectionKind;
  /** When the outline should pick it — shown to the model as the kind's definition. */
  when: string;
  arrangement: GroupArrangement;
  /** The node types this kind is expressed with (a guide for the model; the validator stays lenient). */
  nodeTypes: readonly VisualNodeType[];
  /** How a section of this kind is represented — added to its `generate_visual_plan` prompt. */
  rules: string;
  /**
   * The analysis a reader needs from a section of this kind at a glance (content fidelity Wave B): what the model
   * adds on top of the content's own details, in "text" nodes marked `"origin":"analysis"`.
   */
  analysis: string;
}

export const SECTION_KIND_REGISTRY: Readonly<Record<SectionKind, SectionKindDefinition>> = {
  hierarchy: {
    id: "hierarchy",
    when: "a hierarchy, branching, categorisation or parent/child structure (A contains or branches into B), including an ASCII/box-drawing tree",
    arrangement: "tree",
    nodeTypes: ["shape", "text", "page"],
    rules:
      `Represent the hierarchy as "shape" nodes (one per concept, a short label) connected parent → child with "relates_to" (or a more specific type when stated). ` +
      `What the content says about a concept beyond its name goes in a "text" node linked from its shape with "explained_by". ` +
      `Never an ASCII drawing, a code block or a paragraph describing the tree.`,
    analysis: `How the parts relate: what the structure groups together and why, and which branch matters most for the reader.`,
  },
  comparison: {
    id: "comparison",
    when:
      "several entities (options, plans, tiers, products, alternatives) described by the same attributes, even when those facts are scattered across the text — " +
      "including a change described case by case: how several cases, inputs or checks behaved before and how they behave now (old vs new, v2 vs v3)",
    arrangement: "compare",
    nodeTypes: ["table", "text"],
    rules:
      `When the entities are already a table in the content, that table IS the comparison: place it as it is (every row and cell), never a re-arranged or ` +
      `shortened copy — its rows and columns stay the content's. ` +
      `A change described case by case is ONE "table" with one row per case and the columns ["<what the cases are, e.g. Case>", "Before", "Now"]: ` +
      `"Before" is what the content says happened before for that case — a general "before" statement, or "instead of X" / "no longer X" / "used to X" ` +
      `about the case, says it (X is its Before). A general "before" statement covers every case it names or includes: when the content says ` +
      `"Before, A was rejected. That included B and C", the rows for A, B and C all have "rejected" as Before — fill it for each, never only the first row. ` +
      `"Now" is its new behaviour with its ` +
      `full detail (examples, units, quoted messages, exceptions). Leave "Before" empty for a case the content gives no before for. ` +
      `The table replaces the list or paragraphs it was made from: don't also place them as text — their full wording is in the cells. ` +
      `Otherwise, when the facts are scattered in prose: ` +
      `represent it as ONE "table": the first column names the attribute, then one column per entity, named as the content names it (e.g. ["", "<entity 1>", "<entity 2>"] — never column names the content doesn't use), one row per attribute. ` +
      `Merge every fact the content gives about an entity into its column, wherever it appears, with its full value (numbers, limits, conditions). ` +
      `Leave a cell empty when the content doesn't say — never guess a ✓ or a value. ` +
      `Anything the content says around the comparison (context, a recommendation, caveats, footnotes) goes in a "text" node beside the table, never left out. ` +
      `Never one card or one section per entity.`,
    analysis:
      `What actually differs between the entities and what that means for choosing between them (which fits when) — for a change, which case changed most, ` +
      `what is still an exception or left unchecked, and what the reader must now do differently. Never a restatement of the table or of the takeaway.`,
  },
  flow: {
    id: "flow",
    when: "a sequence: steps, stages or a chain of cause and effect, where the order is the point",
    arrangement: "chain",
    nodeTypes: ["shape", "text", "page"],
    rules:
      `Represent each step as a "shape" with a short label, linked from each step to the next one ("flows_to", or "depends_on"/"caused_by" when stated), in order. ` +
      `What the content says about a step (what happens, who does it, conditions, outputs) goes in a "text" node linked from that step with "explained_by" — never another step.`,
    analysis: `Where the sequence branches, waits or can fail, and what the whole sequence achieves.`,
  },
  cards: {
    id: "cards",
    when: "2–6 parallel, independent concepts of similar weight, each short (personas, categories, principles, options without shared attributes)",
    arrangement: "grid",
    nodeTypes: ["text", "todo"],
    rules:
      `Represent each concept as its own "text" node with the concept's name as its "title" and, as its body, everything the content says about it — as bullets, in the content's own words. ` +
      `When a concept's body is long, keep its first points on the card and put the rest in a "page" linked from it with "explained_by".`,
    analysis: `What the concepts have in common, how they differ, and which one matters most.`,
  },
  decision: {
    id: "decision",
    when:
      "a recommendation, decision, conclusion or chosen direction — including a set of decisions or proposals (D1, D2, …; question → proposal), even when they are numbered",
    arrangement: "grid",
    nodeTypes: ["shape", "text", "table"],
    rules:
      `When the decisions are already a table in the content, that table IS their structure: place it (every row and cell) and don't add a shape or card per decision. ` +
      `When they are prose: one "shape" per decision (importance "high"), labelled with what is being decided in a few words, and its proposal or answer, reasons, ` +
      `conditions and trade-offs — every one the content gives — in a "text" node linked from its shape with "explained_by". ` +
      `Decisions are NOT a sequence: link two only when the content says one depends on, blocks or follows from another ("depends_on", "blocks"), never in list order.`,
    analysis:
      `The overall recommendation, and a "text" node titled "Status" with ONE line per decision, by its id or name: its status as the content implies it ` +
      `(decided · proposed · needs <whom>'s agreement · deferred until <what> · blocked by <which>) and why, in a few words — e.g. "D2 — needs the engineer's agreement: rerunning the full test set". ` +
      `Every decision gets its line.`,
  },
  metrics: {
    id: "metrics",
    when: "numbers, measurements, metrics, costs or things to track",
    arrangement: "compare",
    nodeTypes: ["table", "text", "code"],
    rules:
      `Represent the metrics as ONE "table" with a column per metric (or a row per metric when there are many), every metric the content gives — the table is mandatory, always the primary record, and is never replaced. ` +
      `Keep numbers, units and qualifiers exactly as written. Any explanation of the metrics goes in a "text" node beside the table. ` +
      `When the numbers also show a trend over an ordered series (dates, steps, versions) or a comparison worth seeing at a glance, additionally add ONE "code" node with "language":"acute-chart" linked from the table with "explained_by", its "source" this exact JSON (no other text): {"chartType":"bar"|"line","categories":[...every category, in the table's order...],"series":[{"name":"<metric name>","values":[...the table's own numbers, same order...]}]}. ` +
      `A line is for a trend over an ordered series; a bar is for comparing categories. Never invent numbers the table doesn't have, and never omit the table in favour of the chart.`,
    analysis: `What the numbers show: the notable result, trend or outlier, and whether it is good or bad against a target the content gives.`,
  },
  annotated: {
    id: "annotated",
    when: "running prose where specific phrases or claims need their own explanation, caveat or source attached, without breaking the prose into cards",
    arrangement: "stack",
    nodeTypes: ["text"],
    rules:
      `Keep the prose as ONE "text" node, lightly edited, with a small numbered marker ("¹", "²", "³"…) right after each phrase that needs its own note — never breaking the prose into separate cards. ` +
      `A second "text" node, linked from the first with "explained_by", lists each marker's note in order, one line per marker (e.g. "¹ <the note>"). ` +
      `Every marker in the prose has exactly one line in the notes card, in the same order.`,
    analysis: `What the annotations add that the prose alone wouldn't tell a reader — the one thing worth noticing across all of them.`,
  },
  supporting: {
    id: "supporting",
    when: "reasoning, evidence, examples, caveats or background that supports another section rather than being a main idea",
    arrangement: "stack",
    nodeTypes: ["text", "page"],
    rules:
      `Keep it visually secondary, not shorter: one "text" node with all of its points as bullets in the content's own words, or a "page" when it is long. ` +
      `It supports the main sections, so it must not compete with them for attention.`,
    analysis: `Which main point it supports, and how.`,
  },
  notes: {
    id: "notes",
    when: "anything else",
    arrangement: "grid",
    nodeTypes: ["text", "todo", "table", "code", "page", "shape"],
    rules: `Use the node types that fit: a checklist is a "todo", a table a "table", code a "code" block, prose a "text" with all of it (a "page" when it is long).`,
    analysis:
      `For a status or hand-off note: what is done, pending, blocked, and what needs a decision or someone's action (whose) — one line per item the content names (D1, D2 …, each request). ` +
      `Otherwise: the main point and what the reader should do with it.`,
  },
};

/** What a frame's own name (its small label above the frame) says a section is — never a repeat of its title. */
const KIND_NAMES: Readonly<Record<SectionKind, string>> = {
  comparison: "Comparison",
  hierarchy: "Structure",
  flow: "Flow",
  cards: "Overview",
  decision: "Decision",
  metrics: "Metrics",
  annotated: "Annotated",
  supporting: "Supporting detail",
  notes: "Notes",
};

/**
 * A frame's name: its reading-order position and what the section is ("2 · Comparison"), so the label above
 * the frame adds information instead of repeating the XL title inside it. Sections without a kind (local tier)
 * are just "Section".
 */
export function frameName(kind: string | undefined, position: number): string {
  const name = kind && (SECTION_KINDS as readonly string[]).includes(kind) ? KIND_NAMES[kind as SectionKind] : "Section";
  return `${position} · ${name}`;
}

export function sectionKind(id: SectionKind): SectionKindDefinition {
  return SECTION_KIND_REGISTRY[id];
}
