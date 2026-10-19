/**
 * `validateVisualPlan` (F29): the one function every producer of a
 * `VisualPlan` — the local planner (F28), the in-app AI task
 * `generate_visual_plan` (F31), and an external MCP client's
 * `render_visual_plan` call — must pass its output through before it reaches
 * F30's renderer. F30 may assume the result is fully sanitized and internally
 * consistent; it never re-validates.
 *
 * Recovery is lenient by design (PRD F29), and it never decreases information
 * (content fidelity plan, Step 2): content is repaired, converted or relocated,
 * never deleted — oversized content is split across linked nodes, a node type
 * the template doesn't use becomes text, a duplicate id is renamed, a node that
 * fails its schema keeps its text, and nodes past a cap fold into "More from
 * this section" pages (`repair.ts`). What was changed is reported in
 * `warnings`; anything that genuinely could not be carried over is also listed
 * in `losses`. Relationships stay lenient (a bad one is dropped): they are
 * structure, not the content itself. The plan is rejected outright only when it
 * is fundamentally unusable: not shaped like a plan at all, an unknown
 * template, or nothing usable survives.
 */
import { parseChart } from "@/domain/content/chartData";
import type { z } from "zod";
import { planEnvelopeSchema, visualNodeSchema, visualPlanSchema, visualRelationshipSchema } from "./schema";
import { clip, convertNode, foldOverflow, repairEntry, salvage, type OverflowDetail, type RepairLink } from "./repair";
import { TEXT_LIMITS } from "./schema";
import { templateFor, type VisualTemplateDefinition } from "./templates";
import type { VisualNode, VisualPlan, VisualRelationship } from "./types";

/** F29's node-count limit (PRD: "≤ 60 nodes initially") for a plan without sections; a sectioned plan has 60 per section. */
export const MAX_PLAN_NODES = 60;
/** A sectioned plan's overall content-node limit (sections × `MAX_PLAN_NODES` would be far more than a canvas can show). */
export const MAX_SECTIONED_PLAN_NODES = 300;
/** No PRD-given number; kept well under what 60 nodes could produce (up to 60×59 pairs) while staying generous. */
export const MAX_RELATIONSHIPS = 300;
/** Sections (F42) are containers, not content: they count against their own limit, never against `MAX_PLAN_NODES`. */
export const MAX_GROUPS = 20;
/** The node limits `validateVisualPlan` applies (and a merge's capacity check asks `foldOverflow` about): one definition, so the two can't drift apart. */
export const NODE_CAPS = { plan: MAX_PLAN_NODES, section: MAX_PLAN_NODES, sectionedPlan: MAX_SECTIONED_PLAN_NODES } as const;

export interface ValidatedVisualPlan {
  /** Sanitized and internally consistent: safe to hand to F30 as is. */
  plan: VisualPlan;
  /** What was repaired, converted, relocated or dropped to get there, in plain language, most specific first. */
  warnings: string[];
  /** The part of `warnings` where information from the input could not be carried over (for the user-facing review). */
  losses: string[];
  /** What the node limits folded into "More from this section" pages, per section (empty when nothing overflowed). */
  overflow: OverflowDetail[];
  /** Existing nodes the overflow fold counted first (an update's previous nodes in this plan; 0 for a first run or a stored plan). */
  existingCounted: number;
}

export class InvalidVisualPlanError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid VisualPlan: ${problems.join("; ")}`);
    this.name = "InvalidVisualPlanError";
  }
}

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * `options.existing`: keys of nodes already on the canvas (an update's previous plan) — kept as they are, never folded into a "More from this
 * section" page, and counted first against the node limits. `options.stored`: the plan is one an earlier version stored, whose nodes are
 * all already there: its overflow is not folded again and its frames are not dropped past `MAX_GROUPS` (the limits applied when it was
 * made; a merge can add sections to it, each its own frame, and dropping their titles on the next update proposed removing them).
 */
export function validateVisualPlan(input: unknown, options: { existing?: ReadonlySet<string>; stored?: boolean } = {}): ValidatedVisualPlan {
  const envelope = planEnvelopeSchema.safeParse(input);
  if (!envelope.success) throw new InvalidVisualPlanError(issuesOf(envelope.error));
  const template = templateFor(envelope.data.template);
  const warnings: string[] = [];
  const losses: string[] = [];

  const repaired = sanitizeNodes(envelope.data.nodes, template, warnings, losses);
  let nodes = dropUnreadableCharts(sanitizeGroups(repaired.nodes, warnings, options.stored ? Infinity : MAX_GROUPS), warnings);
  const overflow = options.stored ? { nodes, folded: 0, details: [] as OverflowDetail[], existingCounted: 0 } : foldOverflow(nodes, template, NODE_CAPS, options.existing);
  if (overflow.folded) {
    const kind = template.allowedNodeTypes.includes("page") ? "pages" : "blocks";
    warnings.push(`too many nodes; ${overflow.folded} past the limit were kept in "More from this section" ${kind}`);
    nodes = overflow.nodes;
  }

  const liveIds = new Set(nodes.map((n) => n.id));
  const rawRelationships = Array.isArray(envelope.data.relationships) ? [...envelope.data.relationships, ...repaired.links] : envelope.data.relationships;
  let relationships = sanitizeRelationships(rawRelationships, liveIds, template, warnings, losses);
  if (!options.stored) relationships = [...relationships, ...linkLabelsToBlocks(nodes, relationships)];
  if (relationships.length > MAX_RELATIONSHIPS) {
    const message = `too many relationships (${relationships.length}); kept the first ${MAX_RELATIONSHIPS}`;
    warnings.push(message);
    losses.push(message);
    relationships = relationships.slice(0, MAX_RELATIONSHIPS);
  }

  if (!nodes.some((n) => n.type !== "group")) throw new InvalidVisualPlanError([...warnings, "the plan has no usable nodes"]);
  checkTemplateFit(template, nodes, warnings);

  const metadata = sanitizeMetadata(envelope.data.metadata, warnings);
  return { plan: { version: 1, template: template.id, nodes, relationships, ...(metadata ? { metadata } : {}) }, warnings, losses, overflow: overflow.details, existingCounted: overflow.existingCounted };
}

/**
 * A short label heading ("Finance") that the AI left unlinked, directly followed in the same section by an unlinked block (its list), is
 * linked to it with `explained_by`. Layout keeps linked pairs together (the block hangs under its label); unlinked, a section's grid
 * scatters labels and their blocks apart.
 */
export function linkLabelsToBlocks(nodes: readonly VisualNode[], relationships: readonly VisualRelationship[]): VisualRelationship[] {
  const linked = new Set(relationships.flatMap((r) => [r.from, r.to]));
  const out: VisualRelationship[] = [];
  nodes.forEach((n, i) => {
    const next = nodes[i + 1];
    if (!next || n.type !== "heading" || n.role === "title" || n.role === "subtitle" || n.role === "section" || !n.parent) return;
    if (next.type === "group" || next.type === "heading" || next.parent !== n.parent) return;
    if (linked.has(n.id) || linked.has(next.id)) return;
    out.push({ from: n.id, to: next.id, type: "explained_by" } as VisualRelationship);
  });
  return out;
}

/** Relationship labels that only name a node's form (live run: arrows labelled "paragraph", "list", "table"). */
const NODE_KIND_LABELS = new Set(["paragraph", "paragraphs", "list", "lists", "table", "tables", "text", "node", "card", "block", "page", "code", "shape", "item", "items"]);

/**
 * A chart (`acute-chart` code) whose JSON isn't a chart — values that aren't numbers, a missing series — would show
 * as raw JSON. It only redraws a table's numbers (the metrics rule), so with a table in the plan it is left out:
 * nothing is lost. Without one, it stays as it is.
 */
function dropUnreadableCharts(nodes: VisualNode[], warnings: string[]): VisualNode[] {
  if (!nodes.some((n) => n.type === "table")) return nodes;
  return nodes.filter((n) => {
    if (!isUnreadableChart(n)) return true;
    warnings.push(`node "${n.id}": a chart that isn't valid chart data (it repeats a table, which is kept) left out`);
    return false;
  });
}

/** A node validation drops when the plan holds a table (`dropUnreadableCharts`): a chart whose data isn't valid chart data. */
export function isUnreadableChart(n: VisualNode): boolean {
  return n.type === "code" && n.content.language === "acute-chart" && !parseChart(n.content.source);
}

/**
 * Parses each node on its own so one bad entry never sinks the rest. Oversized content is split first
 * (`repairEntry`); a node that still fails its schema keeps its text (`salvage`); a duplicate id is renamed; a node
 * type the template doesn't use is converted (`convertNode`). Returns the nodes and the links the repairs added.
 */
function sanitizeNodes(raw: readonly unknown[], template: VisualTemplateDefinition, warnings: string[], losses: string[]): { nodes: VisualNode[]; links: RepairLink[] } {
  const seen = new Set<string>();
  const nodes: VisualNode[] = [];
  const links: RepairLink[] = [];
  const parse = (entry: unknown): VisualNode | null => {
    const parsed = visualNodeSchema.safeParse(entry);
    return parsed.success ? (parsed.data as VisualNode) : null;
  };
  const expand = (entry: unknown): unknown[] => {
    const r = repairEntry(entry);
    warnings.push(...r.notes);
    links.push(...r.relationships);
    return r.entries;
  };
  const add = (node: VisualNode): void => {
    if (seen.has(node.id)) {
      let k = 2;
      while (seen.has(`${node.id}~dup${k}`)) k++;
      const renamed = `${node.id}~dup${k}`;
      warnings.push(`node "${node.id}": duplicate id, kept as "${renamed}"`);
      node = { ...node, id: renamed };
    }
    if (!template.allowedNodeTypes.includes(node.type)) {
      const converted = convertNode(node, template);
      const valid = converted.nodes.flatMap((n) => {
        const parsed = visualNodeSchema.safeParse(n);
        return parsed.success ? [parsed.data as VisualNode] : [];
      });
      if (!valid.length) {
        // Nothing to show (an empty checklist, an empty table): no information is lost by leaving it out.
        warnings.push(`node "${node.id}": an empty "${node.type}" node, which the "${template.name}" template doesn't use, dropped`);
        return;
      }
      warnings.push(`node "${node.id}": a "${node.type}" node isn't used by the "${template.name}" template, so it is shown as ${valid[0]!.type}`);
      links.push(...converted.relationships);
      for (const n of valid) {
        seen.add(n.id);
        nodes.push(n);
      }
      return;
    }
    seen.add(node.id);
    nodes.push(node);
  };
  raw.forEach((original, i) => {
    for (const entry of expand(original)) {
      const parsed = visualNodeSchema.safeParse(entry);
      if (parsed.success) {
        add(parsed.data as VisualNode);
        continue;
      }
      const problem = issuesOf(parsed.error).join(", ");
      const rescued = salvage(entry, i);
      const recovered = rescued ? expand(rescued).map(parse) : [];
      if (!recovered.length || recovered.some((n) => !n)) {
        warnings.push(`node ${i}: dropped (${problem})`);
        losses.push(`node ${i}: dropped (${problem})`);
        continue;
      }
      warnings.push(`node ${i}: invalid (${problem}), so its text is kept as a text block`);
      for (const n of recovered) add(n!);
    }
  });
  return { nodes, links };
}

/**
 * Group membership (F42), leniently: a group is never nested (its own `parent` is dropped), a `parent` that isn't a
 * live group is dropped (the node becomes top-level), groups past `MAX_GROUPS` are dropped (their members become
 * top-level), and a group left with no members is dropped — an empty frame shows nothing.
 */
function sanitizeGroups(nodes: readonly VisualNode[], warnings: string[], maxGroups: number): VisualNode[] {
  const without = (n: VisualNode): VisualNode => {
    const { parent: _parent, ...rest } = n;
    return rest as VisualNode;
  };
  let groups = 0;
  const liveGroups = new Set<string>();
  let out = nodes.flatMap((n): VisualNode[] => {
    if (n.type !== "group") return [n];
    if (++groups > maxGroups) {
      warnings.push(`group "${n.id}": more than ${maxGroups} groups, dropped (its members stay, ungrouped)`);
      return [];
    }
    liveGroups.add(n.id);
    if (n.parent === undefined) return [n];
    warnings.push(`group "${n.id}": groups can't be nested, so it was made top-level`);
    return [without(n)];
  });
  out = out.map((n) => {
    if (n.type === "group" || n.parent === undefined || liveGroups.has(n.parent)) return n;
    warnings.push(`node "${n.id}": its group "${n.parent}" isn't in the plan, so it was made top-level`);
    return without(n);
  });
  const occupied = new Set(out.flatMap((n) => (n.parent ? [n.parent] : [])));
  return out.filter((n) => {
    if (n.type !== "group" || occupied.has(n.id)) return true;
    warnings.push(`group "${n.id}": has no members, dropped`);
    return false;
  });
}

/** Parses each relationship on its own; drops ones with a missing endpoint, a disallowed self-loop, or a type the template doesn't use. */
function sanitizeRelationships(raw: unknown, liveIds: ReadonlySet<string>, template: VisualTemplateDefinition, warnings: string[], losses: string[]): VisualRelationship[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`relationships wasn't a list, ignored`);
    return [];
  }
  const relationships: VisualRelationship[] = [];
  raw.forEach((original, i) => {
    let entry = original;
    // A label over its limit is shortened, never the relationship dropped for it.
    if (typeof entry === "object" && entry !== null && typeof (entry as { label?: unknown }).label === "string") {
      const label = (entry as { label: string }).label;
      // A label that only names what the target is ("table", "list") says nothing about the link: shown without one.
      if (NODE_KIND_LABELS.has(label.trim().toLowerCase())) {
        const { label: _label, ...rest } = entry as Record<string, unknown>;
        entry = rest;
      } else if (label.length > TEXT_LIMITS.relationshipLabel) {
        entry = { ...entry, label: clip(label, TEXT_LIMITS.relationshipLabel) };
        const message = `relationship ${i}: label over ${TEXT_LIMITS.relationshipLabel} characters shortened`;
        warnings.push(message);
        losses.push(message);
      }
    }
    const parsed = visualRelationshipSchema.safeParse(entry);
    if (!parsed.success) {
      warnings.push(`relationship ${i}: dropped (${issuesOf(parsed.error).join(", ")})`);
      return;
    }
    const rel = parsed.data as VisualRelationship;
    if (!liveIds.has(rel.from) || !liveIds.has(rel.to)) {
      warnings.push(`relationship "${rel.from}" → "${rel.to}": refers to a node that isn't in the plan, dropped`);
      return;
    }
    if (rel.from === rel.to && !template.allowSelfLoops) {
      warnings.push(`relationship "${rel.from}" → itself: self-loops aren't allowed by "${template.name}", dropped`);
      return;
    }
    if (!template.allowedRelationTypes.includes(rel.type)) {
      warnings.push(`relationship "${rel.from}" → "${rel.to}": type "${rel.type}" isn't used by "${template.name}", dropped`);
      return;
    }
    relationships.push(rel);
  });
  return relationships;
}

/** Soft template conformance: `role` is itself optional on `VisualNode`, so a missing recommended role is only ever a warning. */
function checkTemplateFit(template: VisualTemplateDefinition, nodes: readonly VisualNode[], warnings: string[]): void {
  if (template.recommendedMinNodes && nodes.length < template.recommendedMinNodes) {
    warnings.push(`only ${plural(nodes.length, "node")}; "${template.name}" is usually clearer with at least ${template.recommendedMinNodes}`);
  }
  const missing = (template.recommendedRoles ?? []).filter((r) => !nodes.some((n) => n.role === r));
  if (missing.length) warnings.push(`no node has role ${missing.map((r) => `"${r}"`).join(" / ")}, which "${template.name}" is usually built around`);
}

/** Shortens an over-long title/summary; drops (never fails the plan for) metadata otherwise shaped wrong — a plan's title/summary are a nicety, not load-bearing. */
function sanitizeMetadata(raw: unknown, warnings: string[]): VisualPlan["metadata"] {
  if (raw === undefined) return undefined;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const m = { ...(raw as Record<string, unknown>) };
    if (typeof m.title === "string" && m.title.length > TEXT_LIMITS.planTitle) {
      m.title = clip(m.title, TEXT_LIMITS.planTitle);
      warnings.push(`metadata: title over ${TEXT_LIMITS.planTitle} characters shortened`);
    }
    if (typeof m.summary === "string" && m.summary.length > TEXT_LIMITS.planSummary) {
      m.summary = clip(m.summary, TEXT_LIMITS.planSummary);
      warnings.push(`metadata: summary over ${TEXT_LIMITS.planSummary} characters shortened`);
    }
    raw = m;
  }
  const parsed = visualPlanSchema.shape.metadata.safeParse(raw);
  if (!parsed.success) {
    warnings.push(`metadata: dropped (${issuesOf(parsed.error).join(", ")})`);
    return undefined;
  }
  return parsed.data;
}
