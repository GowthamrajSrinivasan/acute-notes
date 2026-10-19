/**
 * Archify import (interactive architecture frames, Phase 3): an Archify architecture document — the JSON the Archify
 * skill authors (`diagram_type: "architecture"`, MIT, github.com/tt-a1i/archify) — becomes a `VisualPlan` whose
 * frames are interactive diagrams: each component a shape with its kind, sublabel and tag; each boundary a section;
 * each connection a relationship with its label; the document's cards the frame's info cards.
 *
 * Archify is an input representation only, like Mermaid (F33): Acute lays the diagram out itself, so authored
 * positions, sizes and routing hints are not used. Pure; the result goes through F29's `validateVisualPlan`.
 */
import { NODE_KINDS, type ArchitectureKind, type DiagramCard, type NodeKind } from "@/domain/canvas/diagram";
import type { RelationType } from "@/domain/types";
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import { validateVisualPlan } from "@/ai/visual-plan/validate";

export type ArchifyResult = { ok: true; plan: VisualPlan; warnings: string[] } | { ok: false; reason: string };

/** Archify card dot colours → the kind whose accent they match. */
const DOT_KIND: Record<string, NodeKind> = {
  cyan: "frontend",
  emerald: "backend",
  violet: "database",
  amber: "cloud",
  rose: "security",
  orange: "messagebus",
  slate: "external",
};

/** Larger than any real diagram; a document over it is someone else's JSON. */
export const MAX_ARCHIFY_SOURCE = 512 * 1024;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const truncate = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
/** A plan-local id: `::` is reserved for group titles, and ids are bounded (as Mermaid's `planIdOf`). */
const planId = (raw: string) => truncate(raw.replaceAll("::", "_"), 200);

/** The Archify document `text` holds — the whole text, or one ```json fence — or null when it isn't one. */
export function detectArchify(text: string): Obj | null {
  if (text.length > MAX_ARCHIFY_SOURCE) return null;
  const trimmed = text.trim();
  const fenced = /^(`{3,}|~{3,})[ \t]*(json)?[ \t]*\n([\s\S]*?)\n\1[ \t]*$/i.exec(trimmed);
  const body = fenced ? fenced[3]! : trimmed;
  if (!body.startsWith("{")) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return null;
  }
  return isObj(doc) && typeof doc.diagram_type === "string" && (Array.isArray(doc.components) || doc.diagram_type !== "architecture") ? doc : null;
}

function relationOf(variant: unknown): RelationType {
  // Archify's variants are visual; "dashed" draws an asynchronous or optional dependency.
  return variant === "dashed" ? "depends_on" : "flows_to";
}

/** An Archify document → a validated plan, or why it can't be imported. */
export function convertArchify(doc: Obj): ArchifyResult {
  if (doc.diagram_type !== "architecture") {
    return { ok: false, reason: `Archify ${String(doc.diagram_type)} diagrams can't be imported yet: only architecture diagrams.` };
  }
  const meta = isObj(doc.meta) ? doc.meta : {};
  const title = str(meta.title);
  const warnings: string[] = [];
  const seen = new Set<string>();

  const components = (Array.isArray(doc.components) ? doc.components : []).filter(isObj);
  const nodes: VisualNode[] = [];
  let positioned = false;
  let sourced = 0;
  for (const c of components) {
    const id = str(c.id);
    const label = str(c.label);
    if (!id || !label || seen.has(planId(id))) continue;
    seen.add(planId(id));
    const kind = NODE_KINDS.includes(c.type as ArchitectureKind) ? (c.type as ArchitectureKind) : undefined;
    if (c.pos !== undefined || c.size !== undefined || c.row !== undefined || c.col !== undefined) positioned = true;
    if (Array.isArray(c.sources) && c.sources.length) sourced += 1;
    nodes.push({
      id: planId(id),
      // Re-importing an edited document updates the same objects (F37–F39): the key is the Archify id, never its wording.
      stableKey: `archify:${truncate(id, 280)}`,
      type: "shape",
      content: {
        // A database reads as one on the canvas too.
        shape: kind === "database" ? "cylinder" : "rectangle",
        label: truncate(label, TEXT_LIMITS.shapeLabel),
        ...(kind ? { kind } : {}),
        ...(str(c.sublabel) ? { sublabel: str(c.sublabel)! } : {}),
        ...(str(c.tag) ? { tag: str(c.tag)! } : {}),
      },
    } as VisualNode);
  }
  if (!nodes.length) return { ok: false, reason: "The Archify document has no components to draw." };

  const relationships: VisualRelationship[] = [];
  let dangling = 0;
  for (const c of (Array.isArray(doc.connections) ? doc.connections : []).filter(isObj)) {
    const from = str(c.from);
    const to = str(c.to);
    if (!from || !to || !seen.has(planId(from)) || !seen.has(planId(to))) {
      dangling += 1;
      continue;
    }
    const label = str(c.label);
    relationships.push({ from: planId(from), to: planId(to), type: relationOf(c.variant), ...(label ? { label: truncate(label, TEXT_LIMITS.relationshipLabel) } : {}) });
  }

  const cards: DiagramCard[] = (Array.isArray(doc.cards) ? doc.cards : []).filter(isObj).flatMap((c) => {
    const cardTitle = str(c.title);
    const items = (Array.isArray(c.items) ? c.items : []).map(str).filter((i): i is string => !!i);
    if (!cardTitle) return [];
    const kind = typeof c.dot === "string" ? DOT_KIND[c.dot] : undefined;
    return [{ ...(kind ? { kind } : {}), title: cardTitle, items }];
  });

  // Boundaries become sections: one level (frames can't nest), each component in the first boundary that wraps it.
  const boundaries = (Array.isArray(doc.boundaries) ? doc.boundaries : []).filter(isObj);
  const sectionOf = new Map<string, string>();
  const groups: VisualNode[] = [];
  let shared = 0;
  boundaries.forEach((b, i) => {
    const label = str(b.label);
    const members = (Array.isArray(b.wraps) ? b.wraps : []).map((w) => (typeof w === "string" ? planId(w) : "")).filter((w) => seen.has(w));
    if (!label || !members.length) return;
    const gid = `boundary${i}`;
    let own = 0;
    for (const m of members) {
      if (sectionOf.has(m)) shared += 1;
      else {
        sectionOf.set(m, gid);
        own += 1;
      }
    }
    if (own) groups.push({ id: gid, type: "group", content: { label: truncate(label, TEXT_LIMITS.groupLabel), arrangement: "tree", diagram: "architecture" } } as VisualNode);
  });

  if (positioned) warnings.push("Archify positions and sizes aren't used: Acute lays the diagram out itself");
  if (shared) warnings.push(`${shared} component${shared === 1 ? " is" : "s are"} in more than one boundary: each is drawn in the first (frames don't nest)`);
  if (dangling) warnings.push(`${dangling} connection${dangling === 1 ? "" : "s"} to an unknown component left out`);
  if (sourced) warnings.push(`source references on ${sourced} component${sourced === 1 ? "" : "s"} aren't imported yet`);
  if (Array.isArray(meta.views) && meta.views.length) warnings.push("guided views aren't imported yet");

  const summary = str(meta.subtitle);
  let plan: unknown;
  if (!groups.length) {
    // No boundaries: one architecture plan, which the renderer frames as one interactive diagram titled after it.
    plan = {
      version: 1,
      template: "architecture",
      nodes,
      relationships,
      metadata: { ...(title ? { title } : {}), ...(summary ? { summary } : {}), ...(cards.length ? { cards } : {}) },
    };
  } else {
    // Components outside every boundary share one more section, named after the diagram.
    const loose = nodes.filter((n) => !sectionOf.has(n.id));
    if (loose.length) {
      groups.push({ id: "boundary_rest", type: "group", content: { label: title ?? "Architecture", arrangement: "tree", diagram: "architecture" } } as VisualNode);
      for (const n of loose) sectionOf.set(n.id, "boundary_rest");
    }
    // The cards describe the whole diagram: under the first section's frame.
    if (cards.length) {
      const first = groups[0] as Extract<VisualNode, { type: "group" }>;
      first.content = { ...first.content, cards };
    }
    plan = {
      version: 1,
      template: "sectioned",
      nodes: [
        ...(title ? [{ id: "title", type: "heading", role: "title", content: { text: truncate(title, TEXT_LIMITS.planTitle) } }] : []),
        ...groups,
        ...nodes.map((n) => ({ ...n, parent: sectionOf.get(n.id) })),
      ],
      relationships,
      metadata: { ...(title ? { title } : {}), ...(summary ? { summary } : {}) },
    };
  }
  try {
    const validated = validateVisualPlan(plan);
    return { ok: true, plan: validated.plan, warnings: [...warnings, ...validated.warnings] };
  } catch (error) {
    return { ok: false, reason: `The Archify document couldn't be turned into a diagram: ${error instanceof Error ? error.message : String(error)}` };
  }
}
