/**
 * Local deterministic tier (F28, PRD §13.15.1 "Tier 1"): when content's
 * structure is already explicit, build the `VisualPlan` directly, with no AI
 * call. Checklists become todo blocks, Markdown tables become table blocks,
 * fenced code becomes code blocks, and heading-sectioned prose becomes text
 * blocks (or pages when long). The result also says whether that is enough
 * or the content needs AI analysis (mostly prose, whose concepts and
 * relationships only a model can find).
 *
 * Pure and deterministic. Node ids are plan-local ("n1", "n2", …). Each node's
 * `stableKey` is derived from structure (heading path + kind + ordinal), never
 * from wording, so a later regeneration of edited content can recognise the
 * same node (F37–F39).
 */
import { MAX_PLAN_NODES } from "@/ai/visual-plan/validate";
import type { VisualNode, VisualPlan, VisualRelationship, VisualTemplate } from "@/ai/visual-plan/types";
import { detectAsciiTree, parseAsciiTree, treePlanParts } from "./asciiTree";
import { planAsciiTree } from "./asciiTreePlan";
import { planArchify } from "./archifyPlan";
import { codeBodyStart, planMermaid } from "./mermaidPlan";
import type { ParsedBlock, ParsedContent, ParsedListItem } from "./types";

export { MAX_PLAN_NODES };

/** Share of content in explicit structure from which the local plan is used as is. */
export const SUFFICIENT_CONFIDENCE = 0.6;
/** A structured document at least this long, with at least `AI_RECOMMENDED_MIN_SECTIONS` sections, is better regrouped by AI (F42). */
export const AI_RECOMMENDED_MIN_CHARS = 1_500;
export const AI_RECOMMENDED_MIN_SECTIONS = 3;
/**
 * Content whose meaning goes beyond its explicit structure — prose, tables, plain lists — of at least this many
 * characters is analysed by AI whenever a provider is configured (content fidelity plan, Revision 2): the local plan
 * only copies it into cards (a decision table stays a table, with no recommendation or trade-off drawn out).
 * Below it (a short note), and for checklists, code and images, the local plan is shown as is.
 */
export const ANALYSABLE_MIN_CHARS = 200;
/** Box-drawing and arrow characters of an ASCII diagram (a tree or flow drawn in a code block). */
const DIAGRAM_CHARS = /[│├└┌┐┘┬┴┼─═║→←↓↑▶▼]/g;
/** Prose longer than this in one section becomes a page instead of a text block. */
export const PAGE_THRESHOLD_CHARS = 2_000;
/** Headings at or above this level become heading nodes; deeper ones stay inside the text. */
const MAX_HEADING_NODE_LEVEL = 3;
const FLOW_MAX_STEPS = 12;
const FLOW_MAX_STEP_CHARS = 120;

export interface StructureAssessment {
  /** True when the local plan is a good representation and no AI analysis is needed. */
  sufficient: boolean;
  /**
   * The local plan would do, but AI would do much better (F42): a long document of several sections (an AI
   * answer pasted whole) whose information a model can regroup into comparisons, trees and flows, an ASCII
   * diagram only a model can redraw, or any content with enough prose, tables or plain lists to analyse
   * (`ANALYSABLE_MIN_CHARS`). Visualize then uses AI when a provider is configured, and falls back to the local
   * plan otherwise. Only present when true.
   */
  aiRecommended?: true;
  /** 0–1: share of the content (by characters) that is explicit structure. */
  confidence: number;
  /** Short, human-readable reasons ("2 checklists, 1 table", "mostly prose (80%)"). */
  reasons: string[];
}

export interface LocalPlanResult extends StructureAssessment {
  /** The plan built from explicit structure; null when there is nothing to plan or it is too large. */
  plan: VisualPlan | null;
}

const isChecklist = (b: ParsedBlock): b is Extract<ParsedBlock, { type: "list" }> => b.type === "list" && b.items.some((i) => i.checked !== null);

/** How explicit a block's structure is, 0–1 (see `assessStructure`). */
function explicitness(b: ParsedBlock, sectioned: boolean): number {
  switch (b.type) {
    case "table":
    case "code":
    case "heading":
    case "image":
      return 1;
    case "list":
      return isChecklist(b) ? 1 : 0.7;
    case "paragraph":
      // Prose under headings is still organised by them; free-standing prose is not.
      return sectioned ? 0.6 : 0;
    case "quote":
      return 0.3;
    case "divider":
      return 0;
  }
}

const sizeOf = (b: ParsedBlock) => Math.max(1, b.span.end - b.span.start);

/** How much of the content is explicit structure, and why. */
export function assessStructure(parsed: ParsedContent): StructureAssessment {
  const blocks = parsed.blocks.filter((b) => b.type !== "divider");
  if (!blocks.length) return { sufficient: false, confidence: 0, reasons: ["No content"] };
  const headings = blocks.filter((b) => b.type === "heading").length;
  const sectioned = headings >= 2 || (headings === 1 && blocks.length > 2);
  let total = 0;
  let explicit = 0;
  let prose = 0;
  for (const b of blocks) {
    const size = sizeOf(b);
    total += size;
    explicit += size * explicitness(b, sectioned);
    if (b.type === "paragraph" || b.type === "quote") prose += size;
  }
  const confidence = Math.round((explicit / total) * 100) / 100;
  const count = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : "");
  const found = [
    count(blocks.filter(isChecklist).length, "checklist"),
    count(blocks.filter((b) => b.type === "table").length, "table"),
    count(blocks.filter((b) => b.type === "code").length, "code block"),
    sectioned ? count(headings, "section") : "",
  ].filter(Boolean);
  const reasons = found.length ? [found.join(", ")] : [];
  const proseShare = prose / total;
  if (proseShare >= 0.4) reasons.push(`mostly prose (${Math.round(proseShare * 100)}%): AI analysis can find its concepts and relationships`);
  const long = parsed.length >= AI_RECOMMENDED_MIN_CHARS && headings >= AI_RECOMMENDED_MIN_SECTIONS;
  // A tree drawing is converted locally (F42 Phase 3); other ASCII art only a model can redraw.
  const diagram = blocks.some((b) => b.type === "code" && (b.source.match(DIAGRAM_CHARS)?.length ?? 0) >= 6 && !detectAsciiTree(b.source));
  const analysable = blocks.filter((b) => b.type === "paragraph" || b.type === "quote" || b.type === "table" || (b.type === "list" && !isChecklist(b))).reduce((n, b) => n + sizeOf(b), 0);
  const needsAnalysis = analysable >= ANALYSABLE_MIN_CHARS;
  if (long) reasons.push(`a long document of ${headings} sections: AI can regroup it into comparisons, trees and flows`);
  if (diagram) reasons.push("an ASCII diagram: AI can redraw it as shapes and arrows");
  if (needsAnalysis && !long && proseShare < 0.4) reasons.push("tables and lists AI can analyse: what they decide, compare or depend on");
  return { sufficient: confidence >= SUFFICIENT_CONFIDENCE, confidence, reasons, ...(long || diagram || needsAnalysis ? { aiRecommended: true as const } : {}) };
}

/** Builds the local plan for explicitly structured content (see module doc). `input` is the parsed text. */
export function planLocally(parsed: ParsedContent, input: string): LocalPlanResult {
  if (input.length !== parsed.length) throw new Error("planLocally: input does not match the parsed content");
  // One Archify architecture document becomes interactive diagram frames, with no model call (frames Phase 3).
  const archify = planArchify(input);
  if (archify) return archify;
  // One Mermaid diagram converts to native shapes and arrows deterministically (F33), with no model call.
  const mermaid = planMermaid(parsed, input);
  if (mermaid) return mermaid;
  // So does one ASCII tree drawing (F42 Phase 3).
  const tree = planAsciiTree(parsed, input);
  if (tree) return tree;
  const assessment = assessStructure(parsed);
  const builder = new PlanBuilder(input);
  let template = chooseTemplate(parsed);
  if (template === "flow") builder.flow(parsed);
  else if (builder.document(parsed)) template = "sectioned";

  const { nodes, relationships, title } = builder;
  if (!nodes.length) return { ...assessment, sufficient: false, plan: null };
  if (nodes.length > MAX_PLAN_NODES) {
    return { ...assessment, sufficient: false, reasons: [...assessment.reasons, `too many parts (${nodes.length}) for one plan; the limit is ${MAX_PLAN_NODES}`], plan: null };
  }
  return {
    ...assessment,
    plan: { version: 1, template, nodes, relationships, ...(title ? { metadata: { title } } : {}) },
  };
}

/**
 * Tables with little else → comparison; one short numbered list of steps →
 * flow; anything else is laid out as a document stack (`action_plan`: a
 * heading followed by its blocks, pages for long sections).
 */
function chooseTemplate(parsed: ParsedContent): VisualTemplate {
  const content = parsed.blocks.filter((b) => b.type !== "heading" && b.type !== "divider");
  const total = content.reduce((n, b) => n + sizeOf(b), 0);
  if (!total) return "action_plan";
  const tables = content.filter((b) => b.type === "table");
  if (tables.length && tables.reduce((n, b) => n + sizeOf(b), 0) / total >= 0.8) return "comparison";
  const lists = content.filter((b) => b.type === "list");
  // A whole-document flow only for a single list under at most one heading: with sections, `flow()` would drop the
  // rest, so the list becomes a chain inside its section instead (F42).
  const headings = parsed.blocks.filter((b) => b.type === "heading").length;
  if (headings <= 1 && lists.length === 1 && sizeOf(lists[0]!) / total >= 0.7 && isStepList(lists[0]!)) return "flow";
  return "action_plan";
}

/** A short numbered list of short, plain steps: shown as a flow of connected shapes rather than as text. */
function isStepList(b: ParsedBlock): b is Extract<ParsedBlock, { type: "list" }> {
  if (b.type !== "list" || !b.ordered) return false;
  const steps = b.items;
  return (
    steps.length >= 2 &&
    steps.length <= FLOW_MAX_STEPS &&
    steps.every((s) => s.checked === null && !s.children.length && s.text.trim() && s.text.length <= FLOW_MAX_STEP_CHARS)
  );
}

type NodeInput = { [K in VisualNode["type"]]: Omit<Extract<VisualNode, { type: K }>, "id" | "stableKey"> }[VisualNode["type"]];

class PlanBuilder {
  readonly nodes: VisualNode[] = [];
  readonly relationships: VisualRelationship[] = [];
  title: string | undefined;
  private readonly ordinals = new Map<string, number>();

  constructor(private readonly input: string) {}

  private add(path: readonly string[], kind: string, node: NodeInput): VisualNode {
    const scope = `${path.join(" › ")}#${kind}`;
    const n = this.ordinals.get(scope) ?? 0;
    this.ordinals.set(scope, n + 1);
    const out = { ...node, id: `n${this.nodes.length + 1}`, stableKey: `${scope}${n}` } as VisualNode;
    this.nodes.push(out);
    return out;
  }

  /** A numbered list of short steps: one shape per step, connected in order. */
  flow(parsed: ParsedContent): void {
    const heading = parsed.blocks.find((b): b is Extract<ParsedBlock, { type: "heading" }> => b.type === "heading");
    if (heading) this.title = heading.text;
    const list = parsed.blocks.find((b): b is Extract<ParsedBlock, { type: "list" }> => b.type === "list")!;
    const path = heading ? [heading.text] : [];
    let prev: VisualNode | null = null;
    for (const item of list.items) {
      const node = this.add(path, "step", { type: "shape", role: "step", content: { shape: "rectangle", label: item.text.trim() }, sourceSpan: item.span });
      if (prev) this.relationships.push({ from: prev.id, to: node.id, type: "flows_to" });
      prev = node;
    }
  }

  /**
   * Each section's blocks; consecutive prose is one text block (or a page when long). The top heading level
   * (below a lone H1, which is the document's title) starts a section (F42): a `group` — keyed like the heading
   * it replaces — holding the section's blocks, laid out as a grid. A deeper heading titles the blocks under it
   * rather than becoming a node of its own (it does when nothing follows it). Returns whether any section exists.
   */
  document(parsed: ParsedContent): boolean {
    const blocks = parsed.blocks;
    const path: { text: string; level: number }[] = [];
    let prose: ParsedBlock[] = [];
    const firstH1 = blocks.find((b) => b.type === "heading" && b.level === 1);
    const onlyH1 = firstH1 && blocks.filter((b) => b.type === "heading" && b.level === 1).length === 1;
    const isTitle = (b: ParsedBlock) => b === firstH1 && onlyH1;
    const levels = blocks.flatMap((b) => (b.type === "heading" && b.level <= MAX_HEADING_NODE_LEVEL && !isTitle(b) ? [b.level] : []));
    const sectionLevel = levels.length ? Math.min(...levels) : null;
    let group: string | undefined;
    /** A heading below the section level that no block has used as its title yet. */
    let pending: { text: string; path: string[]; span: ParsedBlock["span"] } | null = null;
    const texts = () => path.map((p) => p.text);
    // Inside a section the frame shows the section's heading, so a block is titled only by a deeper heading.
    const blockTitle = () => {
      const deepest = path.at(-1);
      if (!deepest) return undefined;
      return group && sectionLevel !== null && deepest.level <= sectionLevel ? undefined : deepest.text;
    };
    const member = <T extends NodeInput>(node: T): T => (group ? { ...node, parent: group } : node);
    const addBlock = (kind: string, node: NodeInput) => {
      pending = null;
      this.add(texts(), kind, member(node));
    };
    const flushPending = () => {
      if (!pending) return;
      this.add(pending.path, "heading", member({ type: "heading", role: "subsection", content: { text: pending.text }, sourceSpan: pending.span }));
      pending = null;
    };

    const flushProse = () => {
      if (!prose.length) return;
      const span = { start: prose[0]!.span.start, end: prose.at(-1)!.span.end };
      const markdown = this.input.slice(span.start, span.end).trim();
      prose = [];
      if (!markdown) return;
      const title = blockTitle();
      if (markdown.length > PAGE_THRESHOLD_CHARS) {
        // A page is opened on its own, away from its section's frame, so it's always named (by its section, at worst).
        addBlock("page", { type: "page", ...(title ? { title } : {}), content: { title: title ?? path.at(-1)?.text ?? "Notes", markdown }, sourceSpan: span });
      } else {
        addBlock("text", { type: "text", ...(title ? { title } : {}), content: { markdown }, sourceSpan: span });
      }
    };

    for (const b of blocks) {
      if (b.type === "heading" && b.level <= MAX_HEADING_NODE_LEVEL) {
        flushProse();
        flushPending();
        while (path.length && path.at(-1)!.level >= b.level) path.pop();
        path.push({ text: b.text, level: b.level });
        if (isTitle(b)) {
          this.title = b.text;
          group = undefined;
          this.add(texts(), "heading", { type: "heading", role: "title", content: { text: b.text }, sourceSpan: b.span });
        } else if (b.level === sectionLevel) {
          group = this.add(texts(), "heading", { type: "group", content: { label: b.text, arrangement: "grid" }, sourceSpan: b.span }).id;
        } else if (group) {
          pending = { text: b.text, path: texts(), span: b.span };
        } else {
          this.add(texts(), "heading", { type: "heading", role: "subsection", content: { text: b.text }, sourceSpan: b.span });
        }
        continue;
      }
      const title = blockTitle();
      const titled = title ? { title } : {};
      // Unnarrowed: \`isChecklist\`'s guard would otherwise rule every list out of the later branches.
      const block: ParsedBlock = b;
      if (isChecklist(b)) {
        flushProse();
        addBlock("todo", { type: "todo", ...titled, content: { items: checklistItems(b.items) }, sourceSpan: b.span });
      } else if (b.type === "table") {
        flushProse();
        addBlock("table", { type: "table", ...titled, content: { columns: b.columns, rows: b.rows }, sourceSpan: b.span });
      } else if (group && isStepList(block)) {
        // A sequence inside a section (F42): its steps as connected shapes, read left to right.
        flushProse();
        let prev: VisualNode | null = null;
        for (const item of block.items) {
          pending = null;
          const node = this.add(texts(), "step", member({ type: "shape", role: "step", content: { shape: "rectangle", label: item.text.trim() }, sourceSpan: item.span }));
          if (prev) this.relationships.push({ from: prev.id, to: node.id, type: "flows_to" });
          prev = node;
        }
      } else if (b.type === "code" && group && detectAsciiTree(b.source)) {
        // A tree drawing inside a section (F42 Phase 3): its labels as shapes linked parent → child; the section lays out as a tree.
        flushProse();
        pending = null;
        const drawn = parseAsciiTree(b.source);
        if (drawn.ok) {
          const parts = treePlanParts(drawn.tree, { idPrefix: `n${this.nodes.length + 1}_`, keyPrefix: `${texts().join(" › ")}#`, parent: group, sourceOffset: codeBodyStart(this.input, b) });
          this.nodes.push(...parts.nodes);
          this.relationships.push(...parts.relationships);
          const section = this.nodes.find((n) => n.id === group);
          if (section?.type === "group") section.content = { ...section.content, arrangement: "tree" };
        }
      } else if (b.type === "code") {
        flushProse();
        addBlock("code", { type: "code", ...titled, content: { ...(b.language ? { language: b.language } : {}), source: b.source }, sourceSpan: b.span });
      } else if (b.type !== "divider") {
        // Paragraphs, plain lists, quotes, images and deep headings stay as Markdown text.
        prose.push(b);
      } else {
        flushProse();
      }
    }
    flushProse();
    flushPending();
    // A section that is nothing but a sequence of steps reads as a chain; anything else keeps the grid.
    for (const g of this.nodes) {
      if (g.type !== "group") continue;
      const members = this.nodes.filter((n) => n.parent === g.id);
      if (members.length && members.every((n) => n.role === "step")) g.content = { ...g.content, arrangement: "chain" };
    }
    return sectionLevel !== null;
  }
}

/** Checklist items, nested ones flattened in order; plain items in a checklist count as unchecked. */
function checklistItems(items: readonly ParsedListItem[]): { text: string; checked: boolean }[] {
  const out: { text: string; checked: boolean }[] = [];
  for (const item of items) {
    if (item.text.trim()) out.push({ text: item.text.trim(), checked: item.checked === true });
    for (const child of item.children) if (child.type === "list") out.push(...checklistItems(child.items));
  }
  return out;
}
