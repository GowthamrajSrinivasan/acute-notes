/**
 * Conceptual updates on the AI tier (F38b, PRD §13.15.19a). A changed section
 * is re-analysed *with its current representation*, so the model reports what
 * changed in meaning instead of regenerating the section:
 *
 * - `representationOf` gives the model the section's previous nodes under
 *   short plan-local ids ("p1", …) and their unit-local keys (the part after
 *   `<unit> § `), so a node the model keeps gets back exactly its old key.
 * - `expandUnchanged` turns each `{"id":"p2","unchanged":true}` in the reply
 *   back into the previous node, verbatim. Preservation is therefore done by
 *   code, not by trusting the model to copy a node character for character —
 *   a reworded sentence whose concept didn't change yields a byte-identical
 *   node, which the classifier then reports as `unchanged`.
 *
 * The model still only *proposes*; everything goes through reconciliation and
 * F19 review, and user-edited objects stay conflicts (never overwritten).
 */
import type { CurrentRepresentation } from "@/ai/visualize/tasks";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { UNIT_SEPARATOR, unitOfKey } from "./keys";

export interface UnitRepresentation {
  current: CurrentRepresentation;
  /** Previous node by its plan-local id ("p1", …), with its unit-local key. */
  byLocalId: ReadonlyMap<string, VisualNode>;
}

const localKey = (unitKey: string, stableKey: string) => stableKey.slice(unitKey.length + UNIT_SEPARATOR.length);

/** A section's previous nodes and relationships as the model sees them; null when the section is new. */
export function representationOf(previous: VisualPlan, unitKey: string): UnitRepresentation | null {
  const nodes = previous.nodes.filter((n) => n.stableKey && unitOfKey(n.stableKey) === unitKey);
  if (!nodes.length) return null;
  const idOf = new Map(nodes.map((n, i) => [n.id, `p${i + 1}`] as const));
  const byLocalId = new Map<string, VisualNode>();
  const shown = nodes.map((n) => {
    const { sourceSpan: _span, id, stableKey, ...rest } = n;
    const node = { ...rest, id: idOf.get(id)!, stableKey: localKey(unitKey, stableKey!) } as VisualNode;
    byLocalId.set(node.id, node);
    return node as unknown as Record<string, unknown>;
  });
  const relationships = previous.relationships
    .filter((r) => idOf.has(r.from) && idOf.has(r.to))
    .map((r) => ({ from: idOf.get(r.from)!, to: idOf.get(r.to)!, type: r.type, ...(r.label ? { label: r.label } : {}) }));
  return { current: { nodes: shown, relationships }, byLocalId };
}

/** Only the words and numbers of a node's content (or title), for "is this re-sent node really the same?". */
function wording(v: unknown): string {
  return (JSON.stringify(v ?? "") ?? "")
    .toLowerCase()
    .replace(/\\[nrt]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const sameWording = (a: unknown, b: unknown) => wording(a) === wording(b);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * The reply with every `unchanged` node replaced by the previous node it names
 * (by id, else by stableKey), and a changed node that kept a previous id given
 * that node's key back. An `unchanged` marker naming nothing is dropped.
 */
export function expandUnchanged(raw: unknown, rep: UnitRepresentation | null): unknown {
  if (!rep || !isObject(raw) || !Array.isArray(raw.nodes)) return raw;
  const byKey = new Map([...rep.byLocalId.values()].map((n) => [n.stableKey!, n] as const));
  const nodes = raw.nodes.flatMap((node): unknown[] => {
    if (!isObject(node)) return [node];
    const byId = typeof node.id === "string" ? rep.byLocalId.get(node.id) : undefined;
    const previous = byId ?? (typeof node.stableKey === "string" ? byKey.get(node.stableKey) : undefined);
    if (node.unchanged === true) return previous ? [{ ...previous, id: typeof node.id === "string" ? node.id : previous.id }] : [];
    // Re-sent instead of marked unchanged, differing only in case, spacing, punctuation or code ticks: it IS the previous node.
    if (previous && node.type === previous.type && sameWording(node.content, previous.content) && sameWording(node.title, previous.title)) {
      return [{ ...previous, id: typeof node.id === "string" ? node.id : previous.id }];
    }
    // A "p…" id is the identity in this exchange: a changed node keeps that node's key whatever key the model wrote.
    if (byId && node.stableKey !== byId.stableKey) return [{ ...node, stableKey: byId.stableKey }];
    return [node];
  });
  return { ...raw, nodes };
}

/**
 * An `appended` reply (only what new paragraphs add) completed with the section as it is: every current node the reply
 * doesn't name is marked unchanged, and every current relationship is kept, so `expandUnchanged` gives back the whole section.
 */
export function withCurrentKept(raw: unknown, rep: UnitRepresentation): unknown {
  if (!isObject(raw)) return raw;
  // A current node re-sent under a new id (same type and wording) is that node, not a new one: dropped, its links moved to it.
  const resent = new Map<string, string>();
  const nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).filter((n) => {
    if (!isObject(n) || typeof n.id !== "string" || rep.byLocalId.has(n.id)) return true;
    const same = [...rep.byLocalId].find(([, p]) => p.type === n.type && sameWording(p.content, n.content) && sameWording((p as { title?: unknown }).title, n.title));
    if (same) resent.set(n.id, same[0]);
    return !same;
  });
  const named = new Set(nodes.flatMap((n) => (isObject(n) && typeof n.id === "string" ? [n.id] : [])));
  const kept = [...rep.byLocalId.keys()].filter((id) => !named.has(id)).map((id) => ({ id, unchanged: true }));
  const moved = (id: unknown) => (typeof id === "string" ? (resent.get(id) ?? id) : id);
  const relationships = (Array.isArray(raw.relationships) ? raw.relationships : []).map((r) => (isObject(r) ? { ...r, from: moved(r.from), to: moved(r.to) } : r));
  const has = new Set(relationships.flatMap((r) => (isObject(r) ? [`${r.from}>${r.to}>${r.type}`] : [])));
  const current = rep.current.relationships.filter((r) => !has.has(`${r.from}>${r.to}>${r.type}`));
  return { ...raw, nodes: [...kept, ...nodes], relationships: [...current, ...relationships] };
}

/**
 * New detail attached to an existing concept is an explanation of it (F38b),
 * whatever generic link the model drew. On an update, a *new* `text` or `page`
 * node whose only link is a `relates_to` with one node that was already on the
 * canvas becomes that node's `explained_by` child (concept → explanation), so
 * it is placed below its concept and typed as the rule says. A specific link
 * (`depends_on`, `blocks`, …), a new flow step (a shape) or a node linked to
 * several others is left exactly as the model gave it.
 */
export function typeExplanations(plan: VisualPlan, existingKeys: ReadonlySet<string>): VisualPlan {
  const byId = new Map(plan.nodes.map((n) => [n.id, n] as const));
  const isExisting = (id: string) => existingKeys.has(byId.get(id)?.stableKey ?? "");
  const relationships = plan.relationships.map((r) => {
    if (r.type !== "relates_to") return r;
    const [fresh, concept] = isExisting(r.to) && !isExisting(r.from) ? [r.from, r.to] : isExisting(r.from) && !isExisting(r.to) ? [r.to, r.from] : [null, null];
    if (!fresh || !concept) return r;
    const node = byId.get(fresh);
    if (!node || (node.type !== "text" && node.type !== "page")) return r;
    if (plan.relationships.filter((o) => o.from === fresh || o.to === fresh).length !== 1) return r;
    return { from: concept, to: fresh, type: "explained_by" as const, ...(r.label ? { label: r.label } : {}) };
  });
  return { ...plan, relationships };
}
