/**
 * Sections (F42): `group` nodes are the plan's containers — a titled frame on
 * the canvas holding the nodes that name it as `parent`, laid out with the
 * group's own arrangement. These helpers are the few places the rest of the
 * pipeline needs to know about them:
 *
 * - `groupByUnit` wraps each AI analysis unit (a document section) in a group,
 *   so AI-tier plans are sectioned even when the model emits no group at all.
 * - `ungroup` turns a grouped plan back into a flat one for reconciliation
 *   (F38): each group becomes the heading node its title object is on the
 *   canvas (same id and `stableKey`), so matching works exactly as before.
 *   Frames themselves carry no content-source link and are never reconciled.
 */
import { UNIT_SEPARATOR } from "@/ai/reconcile/keys";
import type { RelationType } from "@/domain/types";
import type { SectionKind, SectionProminence } from "./sectionKinds";
import type { GroupArrangement, VisualNode, VisualPlan, VisualTemplate } from "./types";

/** A section's arrangement when it is the content of a single-template unit: the closest match to that template's own layout. */
const ARRANGEMENT_FOR_TEMPLATE: Record<VisualTemplate, GroupArrangement> = {
  flow: "chain",
  problem_cause_solution: "grid",
  concept_map: "radial",
  timeline: "chain",
  decision_tree: "tree",
  architecture: "tree",
  comparison: "compare",
  action_plan: "grid",
  sectioned: "grid",
  causal_map: "tree", // same layered, relationship-driven family as architecture
};

export function arrangementFor(template: VisualTemplate): GroupArrangement {
  return ARRANGEMENT_FOR_TEMPLATE[template];
}

/** Id of the title object rendered for a group (a plan-local key; never a node id, since those can't contain "::"). */
export const groupTitleKey = (groupId: string) => `${groupId}::title`;

/** Id of the backdrop drawn behind one sub-topic of a section (a heading and what follows it), `index`th in its order. */
export const clusterKey = (groupId: string, index: number) => `${groupId}::cluster${index}`;

/** The backdrop keys a layout may hold (`clusterKey`). */
export const isClusterKey = (key: string) => /::cluster\d+$/.test(key);

/** Id of the takeaway line rendered under a group's title (content fidelity Wave B), when the group has one. */
export const groupTakeawayKey = (groupId: string) => `${groupId}::takeaway`;

/**
 * Flattens a grouped plan: every group becomes a heading node (its title), and `parent` fields are dropped.
 * Links between whole sections are dropped too: they are arrows between frames, drawn once on the first run,
 * and never between the title objects reconciliation compares sections by.
 */
export function ungroup(plan: VisualPlan): VisualPlan {
  if (!plan.nodes.some((n) => n.type === "group" || n.parent !== undefined)) return plan;
  const groups = new Set(plan.nodes.flatMap((n) => (n.type === "group" ? [n.id] : [])));
  const nodes = plan.nodes.map((n): VisualNode => {
    const { parent: _parent, ...rest } = n;
    if (rest.type !== "group") return rest as VisualNode;
    const { content, ...common } = rest;
    return { ...common, type: "heading", role: "section", content: { text: content.label } };
  });
  return { ...plan, nodes, relationships: plan.relationships.filter((r) => !groups.has(r.from) && !groups.has(r.to)) };
}

/** The key suffix of a section `groupByUnit` made for an AI analysis unit (`<unit> § group#0`). */
export const UNIT_SECTION_SUFFIX = `${UNIT_SEPARATOR}group#0`;

/**
 * A plan without the section titles `groupByUnit` added for AI units — for showing a model a section's current
 * representation (F38b): the title comes from the section's heading, never from the model, and would otherwise
 * shift the ids the model's "unchanged" replies refer to.
 */
export function withoutUnitSections(plan: VisualPlan): VisualPlan {
  const titles = new Set(plan.nodes.flatMap((n) => (n.stableKey?.endsWith(UNIT_SECTION_SUFFIX) ? [n.id] : [])));
  if (!titles.size) return plan;
  return {
    ...plan,
    nodes: plan.nodes.filter((n) => !titles.has(n.id)),
    relationships: plan.relationships.filter((r) => !titles.has(r.from) && !titles.has(r.to)),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A section heading from a unit key: its last heading, without an ordinal (" #2") or part (" ·1") suffix. */
export function labelOfUnit(unitKey: string): string {
  const last = unitKey.split(" › ").at(-1) ?? unitKey;
  return last.replace(/ ·\d+$/, "").replace(/ #\d+$/, "").trim();
}

const norm = (s: string) => s.replace(/^#+\s*/, "").trim().toLowerCase();

/** The namespace of plan-level nodes an outline adds (the subtitle), for `unitOfKey`. */
export const OUTLINE_UNIT = "(outline)";

export interface UnitInfo {
  key: string;
  /** True for a unit with nothing but heading lines (a document title), answered locally — never a section of its own. */
  headingOnly: boolean;
}

/** One section to frame: the namespace of its nodes' `stableKey`s, its title, and how it lays out. */
export interface SectionSpec {
  key: string;
  label: string;
  arrangement: GroupArrangement;
  /** What the section is (Phase 2's outline); stored as the group's `role`. */
  kind?: SectionKind;
  /** Stored as the group's `importance`: primary → "high", supporting → "low" (layout puts primary sections first). */
  prominence?: SectionProminence;
  /** The section's main point in one line (Wave B), shown under its title. */
  takeaway?: string;
}

export interface SectionLink {
  /** Section keys. */
  from: string;
  to: string;
  type: RelationType;
  label?: string;
}

export interface WrapOptions {
  /** Keeps group ids distinct from nodes reused from an earlier version (as `mergeUnitPlans`' own prefix does). */
  idPrefix?: string;
  /** Emit each section as the heading node `ungroup` would turn it into (for reconciliation), keeping the template. */
  flat?: boolean;
  /** The unit whose heading nodes are the document's title (role "title"). */
  titleKey?: string | null;
  /** A one-line summary shown under the title (role "subtitle"). */
  subtitle?: string;
  /** Links between whole sections (their frames). */
  links?: readonly SectionLink[];
}

const SUBTITLE_MAX = 300;

/** Details of one node merged into one card only while they stay under this (the dense-text limit). */
export const MERGED_DETAIL_MAX = 1_200;

/**
 * One detail card per node (content fidelity Wave D): a node's short text details — "text" nodes it links to with
 * `explained_by`, of the same origin — become one card, each detail under its own bold title, in their order. With
 * several cards stacked under a node, every link after the first had to skip the ones above it and tangled with the
 * links between nodes (the live hand-off "Decision" section: 8 crossings). Nothing is dropped: every word stays, and
 * links that pointed to a merged card point to the one it joined. Details of details, tables, code and pages, and
 * details past `MERGED_DETAIL_MAX` together, stay as they are. On raw (untrusted) nodes, before validation.
 */
export function mergeDetailCards(nodes: readonly unknown[], relationships: readonly unknown[]): { nodes: unknown[]; relationships: unknown[] } {
  const byId = new Map<string, Record<string, unknown>>();
  for (const n of nodes) if (isObject(n) && typeof n.id === "string") byId.set(n.id, n);
  const explains = relationships.filter((r): r is Record<string, unknown> & { from: string; to: string } => isObject(r) && r.type === "explained_by" && typeof r.from === "string" && typeof r.to === "string");
  const parentsOf = new Map<string, Set<string>>();
  for (const r of explains) parentsOf.set(r.to, new Set([...(parentsOf.get(r.to) ?? []), r.from]));
  const explainsOthers = new Set(explains.map((r) => r.from));
  const markdownOf = (n: Record<string, unknown>) => (isObject(n.content) && typeof n.content.markdown === "string" ? n.content.markdown : null);
  const mergeable = (id: string) => {
    const n = byId.get(id);
    return !!n && n.type === "text" && markdownOf(n) !== null && !explainsOthers.has(id) && parentsOf.get(id)!.size === 1;
  };
  const into = new Map<string, string>();
  const merged = new Map<string, Record<string, unknown>>();
  const seenParents = new Set<string>();
  for (const r of explains) {
    if (seenParents.has(r.from)) continue;
    seenParents.add(r.from);
    const targets = [...new Set(explains.filter((e) => e.from === r.from).map((e) => e.to))].filter(mergeable);
    // Same origin only: the model's analysis keeps its own card (and its tag).
    const groups = new Map<string, string[]>();
    for (const id of targets) {
      const origin = String(byId.get(id)!.origin ?? "");
      groups.set(origin, [...(groups.get(origin) ?? []), id]);
    }
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      const parts = ids.map((id) => byId.get(id)!);
      const titled = parts.some((p) => typeof p.title === "string" && p.title.trim());
      const markdown = parts.map((p) => (titled && typeof p.title === "string" && p.title.trim() ? `**${p.title.trim()}**\n\n${markdownOf(p)}` : markdownOf(p)!)).join("\n\n");
      if (markdown.length > MERGED_DETAIL_MAX) continue;
      const [keep, ...rest] = ids;
      const { title: _title, ...first } = byId.get(keep!)!;
      merged.set(keep!, { ...(titled ? first : byId.get(keep!)!), content: { ...(first.content as Record<string, unknown>), markdown } });
      for (const id of rest) into.set(id, keep!);
    }
  }
  if (!into.size) return { nodes: [...nodes], relationships: [...relationships] };
  const outNodes = nodes.flatMap((n) => {
    if (!isObject(n) || typeof n.id !== "string") return [n];
    if (into.has(n.id)) return [];
    return [merged.get(n.id) ?? n];
  });
  const seen = new Set<string>();
  const outRels = relationships.flatMap((r) => {
    if (!isObject(r)) return [r];
    const from = typeof r.from === "string" ? (into.get(r.from) ?? r.from) : r.from;
    const to = typeof r.to === "string" ? (into.get(r.to) ?? r.to) : r.to;
    if (from === to) return [];
    const key = `${String(from)}\u0000${String(to)}\u0000${String(r.type)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...r, from, to }];
  });
  return { nodes: outNodes, relationships: outRels };
}

/** A step label without a number an earlier run (or the model, shown it) put in front: "2 · Retry" → "Retry". */
export const unnumbered = (label: string) => label.replace(/^\s*\d{1,3}\s*[·.)]\s+/, "");

/**
 * The step number of every step of a flow section (Wave C: numbered steps): its shapes — not the explanations
 * hung from them — in the order their `flows_to` links give (plan order breaks ties and orders unlinked steps).
 * Part of the plan itself, so the canvas and the stored plan agree and an update compares like with like.
 */
function flowSteps(
  nodes: readonly unknown[],
  relationships: readonly unknown[],
  inFlow: (node: Record<string, unknown>) => boolean,
  sectionOf: (node: Record<string, unknown>) => string | null,
): Map<string, number> {
  const explanations = new Set(relationships.flatMap((r) => (isObject(r) && r.type === "explained_by" && typeof r.to === "string" ? [r.to] : [])));
  const bySection = new Map<string, string[]>();
  for (const n of nodes) {
    if (!isObject(n) || n.type !== "shape" || typeof n.id !== "string" || explanations.has(n.id) || !inFlow(n)) continue;
    const key = sectionOf(n)!;
    bySection.set(key, [...(bySection.get(key) ?? []), n.id]);
  }
  const out = new Map<string, number>();
  for (const ids of bySection.values()) {
    const members = new Set(ids);
    const next = new Map<string, string[]>(ids.map((id) => [id, []]));
    const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
    for (const r of relationships) {
      if (!isObject(r) || r.type !== "flows_to" || typeof r.from !== "string" || typeof r.to !== "string") continue;
      if (!members.has(r.from) || !members.has(r.to) || r.from === r.to) continue;
      next.get(r.from)!.push(r.to);
      incoming.set(r.to, incoming.get(r.to)! + 1);
    }
    // Kahn's order, always taking the earliest ready step in plan order; a cycle's rest follows in plan order.
    const order: string[] = [];
    const ready = ids.filter((id) => incoming.get(id) === 0);
    while (ready.length) {
      ready.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
      const id = ready.shift()!;
      order.push(id);
      for (const to of next.get(id)!) {
        incoming.set(to, incoming.get(to)! - 1);
        if (incoming.get(to) === 0) ready.push(to);
      }
    }
    for (const id of ids) if (!order.includes(id)) order.push(id);
    // A single shape is not a sequence.
    if (order.length >= 2) order.forEach((id, i) => out.set(id, i + 1));
  }
  return out;
}

/**
 * Wraps each section's nodes (a merged, still-untrusted raw plan whose `stableKey`s are namespaced by section —
 * `mergeUnitPlans`) in one group, and makes the plan `sectioned`. A heading node that repeats its section's title
 * is dropped (the frame's title already shows it); nodes of no section stay top-level. Returns the raw plan
 * unchanged when there is no section, so short, heading-less content keeps its template's own layout.
 */
export function wrapSections(input: unknown, sections: readonly SectionSpec[], options: WrapOptions = {}): unknown {
  const { idPrefix = "", flat = false, titleKey = null, subtitle, links = [] } = options;
  if (!isObject(input) || !Array.isArray(input.nodes) || !sections.length) return input;
  // One detail card per node (Wave D), before anything is framed or numbered.
  const detail = mergeDetailCards(input.nodes, Array.isArray(input.relationships) ? input.relationships : []);
  const raw: Record<string, unknown> & { nodes: unknown[] } = { ...input, nodes: detail.nodes, relationships: detail.relationships };
  const unitOf = (node: Record<string, unknown>) => {
    const key = typeof node.stableKey === "string" ? node.stableKey : "";
    const i = key.indexOf(UNIT_SEPARATOR);
    return i < 0 ? null : key.slice(0, i);
  };
  const specs = new Map(sections.map((s, i) => [s.key, { ...s, id: `${idPrefix}g${i}` }] as const));
  const nodes: unknown[] = [];
  const emitted = new Set<string>();
  const subtitleNode = subtitle?.trim()
    ? { id: `${idPrefix}subtitle`, type: "heading", role: "subtitle", stableKey: `${OUTLINE_UNIT}${UNIT_SEPARATOR}subtitle#0`, content: { text: subtitle.trim().slice(0, SUBTITLE_MAX) } }
    : null;
  let subtitlePlaced = !subtitleNode;
  const steps = flowSteps(raw.nodes, Array.isArray(raw.relationships) ? raw.relationships : [], (n) => specs.get(unitOf(n) ?? "")?.kind === "flow", unitOf);
  for (const node of raw.nodes) {
    if (!isObject(node)) {
      nodes.push(node);
      continue;
    }
    const unit = unitOf(node);
    const spec = unit ? specs.get(unit) : undefined;
    if (!spec) {
      const isTitle = !!unit && unit === titleKey && node.type === "heading";
      nodes.push(isTitle ? { ...node, role: "title" } : node);
      if (isTitle && !subtitlePlaced) {
        nodes.push(subtitleNode);
        subtitlePlaced = true;
      }
      continue;
    }
    if (!subtitlePlaced) {
      nodes.push(subtitleNode);
      subtitlePlaced = true;
    }
    if (!emitted.has(spec.key)) {
      emitted.add(spec.key);
      const stableKey = `${spec.key}${UNIT_SECTION_SUFFIX}`;
      const importance = spec.prominence === "primary" ? "high" : spec.prominence === "supporting" ? "low" : undefined;
      nodes.push(
        flat
          ? { id: spec.id, type: "heading", role: "section", stableKey, content: { text: spec.label } }
          : {
              id: spec.id,
              type: "group",
              stableKey,
              ...(spec.kind ? { role: spec.kind } : {}),
              ...(importance ? { importance } : {}),
              content: { label: spec.label, arrangement: spec.arrangement, ...(spec.takeaway ? { takeaway: spec.takeaway } : {}) },
            },
      );
    }
    const content = isObject(node.content) ? node.content : {};
    if (node.type === "heading" && typeof content.text === "string" && norm(content.text) === norm(spec.label)) continue;
    const step = typeof node.id === "string" ? steps.get(node.id) : undefined;
    const numbered = step !== undefined && typeof content.label === "string" ? { ...node, content: { ...content, label: `${step} · ${unnumbered(content.label)}` } } : node;
    nodes.push(flat ? numbered : { ...numbered, parent: spec.id });
  }
  if (!subtitlePlaced) nodes.unshift(subtitleNode);
  const relationships = [
    ...(Array.isArray(raw.relationships) ? raw.relationships : []),
    ...links.flatMap((l) => {
      const from = specs.get(l.from);
      const to = specs.get(l.to);
      if (!from || !to || from === to || !emitted.has(from.key) || !emitted.has(to.key)) return [];
      return [{ from: from.id, to: to.id, type: l.type, ...(l.label ? { label: l.label } : {}) }];
    }),
  ];
  return { ...raw, ...(flat ? {} : { template: "sectioned" }), nodes, relationships };
}

/**
 * `wrapSections` for per-unit generation: every unit with a heading and a body is a section, titled with its
 * heading and laid out with the template's arrangement; content before the first heading stays top-level, and a
 * leading heading-only unit is the document's title.
 */
export function groupByUnit(raw: unknown, template: VisualTemplate, units: readonly UnitInfo[], options: { idPrefix?: string; flat?: boolean } = {}): unknown {
  const sections = units.filter((u) => !u.headingOnly && u.key !== "(lead)").map((u) => ({ key: u.key, label: labelOfUnit(u.key), arrangement: arrangementFor(template) }));
  return wrapSections(raw, sections, { ...options, titleKey: units[0]?.headingOnly ? units[0].key : null });
}
