/**
 * Flow sections as one card (note-taking-modes plan Step 6, D4): on an AI-managed canvas, a `flow` section's step shapes
 * and the text explaining each step become ONE text node — the steps as a numbered list, each with its explanation —
 * whose card draws as an OpenUI `FlowDiagram` (`ai/openui/flowLayout.ts`). Pure plan → plan: no model call, no layout.
 *
 * Only a plain linear sequence is collapsed, so nothing the native shapes would show is lost: 2–12 step shapes, each
 * linked to the next in one chain (or not linked at all: plan order), no label on any link touching a step, and no
 * architecture semantics on a shape. A step's own explanations (plain text linked from that step only) go into the card
 * under it. Any other unlabelled link between a step and another node (the model's analysis relating to a step, a link
 * from elsewhere) is kept and ends at the card. A branch, a cycle or a labelled link leaves the section native. Other
 * members (analysis, notes, pages) stay as they are. (Live run 2026-11-24: the model linked its analysis notes to the
 * first step with "relates_to"; refusing those left a plain flow native.)
 *
 * The card's stable key is derived from its section's, so a later update of the same section finds the same card
 * (`collapseFlowsLike`, used by the update engine only for sections that were already a flow card).
 */
import { UNIT_SEPARATOR, unitOfKey } from "@/ai/reconcile/keys";
import { FLOW_STEPS_MAX, FLOW_STEPS_MIN, flowMarkdown } from "@/ai/openui/flowLayout";
import { unnumbered } from "./groups";
import type { VisualNode, VisualPlan, VisualRelationship } from "./types";

/** The role of a flow card's text node: the renderer gives such a node a `FlowDiagram` layout. */
export const FLOW_CARD_ROLE = "flow-card";

/** A flow section's card key: the section's unit, then the card's own structural key. */
export function flowCardKey(groupKey: string): string {
  return `${unitOfKey(groupKey) ?? groupKey}${UNIT_SEPARATOR}${FLOW_CARD_ROLE}#0`;
}

export interface FlowCollapse {
  plan: VisualPlan;
  /** Each collapsed node's id → its card's node id (for moving citations and reviews onto the card). */
  rename: ReadonlyMap<string, string>;
  /** The cards made, by node id. */
  cards: readonly VisualNode[];
}

type Collapsible = { group: VisualNode; card: VisualNode; removed: Set<string> };

/** The section as one card, or null when it is not a plain linear flow. */
function collapsible(plan: VisualPlan, group: VisualNode): Collapsible | null {
  if (group.type !== "group" || group.role !== "flow" || !group.stableKey) return null;
  const members = plan.nodes.filter((n) => n.parent === group.id);
  const steps = members.filter((n) => n.type === "shape");
  if (steps.length < FLOW_STEPS_MIN || steps.length > FLOW_STEPS_MAX) return null;
  if (steps.some((s) => s.type !== "shape" || !s.content.label.trim() || s.content.kind || s.content.sublabel || s.content.tag || s.content.details)) return null;
  const stepIds = new Set(steps.map((s) => s.id));
  const byId = new Map(members.map((n) => [n.id, n] as const));
  const touching = (id: string) => plan.relationships.filter((r) => r.from === id || r.to === id);

  // Each step's explanations: text nodes of the section linked from it only, by "explained_by".
  const explanations = new Map<string, VisualNode[]>();
  const order: VisualRelationship[] = [];
  for (const r of plan.relationships) {
    const fromStep = stepIds.has(r.from);
    const toStep = stepIds.has(r.to);
    if (!fromStep && !toStep) continue;
    if (r.label) return null;
    if (fromStep && toStep) {
      if (r.type === "explained_by") return null;
      order.push(r);
      continue;
    }
    // A step's own explanation (a plain text node linked from it only) goes into the card under that step.
    const text = fromStep && r.type === "explained_by" ? byId.get(r.to) : undefined;
    if (text && text.type === "text" && text.origin !== "analysis" && touching(text.id).length === 1) {
      explanations.set(r.from, [...(explanations.get(r.from) ?? []), text]);
      continue;
    }
    // Any other unlabelled link between a step and something else (the model's analysis relating to the first step, a
    // section linking in) is kept, pointing at the card: the card stands for every step. A labelled one names a step,
    // which a card can't show, so it was refused above.
  }

  // One chain through every step, or no links at all (the plan's order).
  let ordered: VisualNode[] = steps;
  if (order.length) {
    const next = new Map<string, string>();
    const hasIn = new Set<string>();
    for (const r of order) {
      if (next.has(r.from) || hasIn.has(r.to)) return null;
      next.set(r.from, r.to);
      hasIn.add(r.to);
    }
    const start = steps.filter((s) => !hasIn.has(s.id));
    if (start.length !== 1) return null;
    ordered = [];
    for (let id: string | undefined = start[0]!.id; id; id = next.get(id)) ordered.push(byId.get(id)!);
    if (ordered.length !== steps.length) return null;
  }

  const markdown = flowMarkdown(
    ordered.map((s) => ({
      // A flow's steps arrive numbered ("2 · QA sign-off", `groups.ts`); the card numbers its own.
      label: s.type === "shape" ? unnumbered(s.content.label).trim() : "",
      markdown: (explanations.get(s.id) ?? []).map((t) => (t.type === "text" ? [t.title ? `**${t.title}**` : "", t.content.markdown.trim()].filter(Boolean).join("\n\n") : "")).join("\n\n"),
    })),
  );
  const card: VisualNode = {
    id: `${group.id}::flow`,
    type: "text",
    role: FLOW_CARD_ROLE,
    title: group.content.label,
    parent: group.id,
    stableKey: flowCardKey(group.stableKey),
    content: { markdown },
  };
  const removed = new Set([...stepIds, ...[...explanations.values()].flat().map((t) => t.id)]);
  return { group, card, removed };
}

function apply(plan: VisualPlan, found: readonly Collapsible[], keepParent: boolean): FlowCollapse {
  const rename = new Map<string, string>();
  for (const f of found) for (const id of f.removed) rename.set(id, f.card.id);
  const cardAt = new Map<string, VisualNode>();
  for (const f of found) {
    const first = plan.nodes.find((n) => f.removed.has(n.id))!;
    const { parent: _parent, ...unparented } = f.card;
    cardAt.set(first.id, keepParent ? f.card : (unparented as VisualNode));
  }
  const nodes = plan.nodes.flatMap((n) => (cardAt.has(n.id) ? [cardAt.get(n.id)!] : rename.has(n.id) ? [] : [n]));
  // Links inside a collapsed flow go (the card shows its order and explanations); a link between a step and anything
  // else now ends at the card, once.
  const seen = new Set<string>();
  const relationships = plan.relationships.flatMap((r) => {
    const from = rename.get(r.from) ?? r.from;
    const to = rename.get(r.to) ?? r.to;
    if (from === to) return [];
    if (from === r.from && to === r.to) return [r];
    const key = `${from}|${to}|${r.type}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ ...r, from, to }];
  });
  return { plan: { ...plan, nodes, relationships }, rename, cards: [...cardAt.values()] };
}

/** Every plain linear flow section of a grouped plan as one card (`only` narrows which sections). */
export function collapseFlowSections(plan: VisualPlan, only?: (group: VisualNode) => boolean): FlowCollapse {
  const found = plan.nodes.flatMap((g) => {
    if (g.type !== "group" || (only && !only(g))) return [];
    const c = collapsible(plan, g);
    return c ? [c] : [];
  });
  if (!found.length) return { plan, rename: new Map(), cards: [] };
  return apply(plan, found, true);
}

/** Whether a stored plan has any flow card (the update engine's cue to keep flow sections as cards). */
export function hasFlowCards(plan: VisualPlan): boolean {
  return plan.nodes.some((n) => n.role === FLOW_CARD_ROLE);
}

/**
 * An update's plans with each section that was a flow card before collapsed again, so the update changes that card in
 * place rather than replacing it with native shapes: `grouped` is the update's plan regrouped into sections, `flat` the
 * same nodes ungrouped (the update compares flat plans). A section that is no longer a plain flow stays native (the
 * review then shows the card's removal and the shapes' addition, as for any change of representation).
 */
export function collapseFlowsLike(flat: VisualPlan, grouped: VisualPlan, previous: VisualPlan): { flat: VisualPlan; grouped: VisualPlan; rename: ReadonlyMap<string, string> } {
  const before = new Set(previous.nodes.flatMap((n) => (n.role === FLOW_CARD_ROLE && n.stableKey ? [n.stableKey] : [])));
  if (!before.size) return { flat, grouped, rename: new Map() };
  const found = grouped.nodes.flatMap((g) => {
    if (g.type !== "group" || !g.stableKey || !before.has(flowCardKey(g.stableKey))) return [];
    const c = collapsible(grouped, g);
    return c ? [c] : [];
  });
  if (!found.length) return { flat, grouped, rename: new Map() };
  const g = apply(grouped, found, true);
  const f = apply(flat, found, false);
  return { flat: f.plan, grouped: g.plan, rename: g.rename };
}
