/**
 * The analysis check's light retry: a section's plan that lacks only a takeaway or analysis (`missingAnalysis`) is
 * completed by a small call that returns just those parts (`generate_section_analysis`), merged into the plan the
 * section already has — instead of generating the whole plan again. Its details are never touched, and the merged
 * plan is checked like any other: it is kept only when it lacks less, otherwise the full regeneration runs as before.
 */
import { z } from "zod";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export const analysisPatchInput = z.object({
  label: z.string().min(1),
  kind: z.string().min(1),
  /** The section's own text. */
  text: z.string().min(1),
  /** What the plan lacks (from `missingAnalysis`). */
  missing: z.array(z.string().min(1).max(400)).min(1).max(10),
  /** The nodes the plan already has, for the analysis to link to. */
  nodes: z.array(z.object({ id: z.string(), type: z.string(), label: z.string() })),
  takeaway: z.string().optional(),
});
export type AnalysisPatchInput = z.infer<typeof analysisPatchInput>;

/** Just enough to know the reply is object-shaped; `applyAnalysisPatch` is lenient about the rest. */
export const analysisPatchEnvelope = z.looseObject({
  takeaway: z.string().optional(),
  nodes: z.array(z.unknown()).optional(),
  relationships: z.array(z.unknown()).optional(),
});

const MAX_LISTED_NODES = 80;

/** A node's short name for the prompt: its title, label, heading text, or the start of its text. */
function nodeLabel(n: Record<string, unknown>): string {
  const c = isObject(n.content) ? n.content : {};
  const pick = [n.title, c.label, c.text, c.title, c.markdown].find((v): v is string => typeof v === "string" && v.trim() !== "");
  const s = (pick ?? "").replace(/\s+/g, " ").trim();
  return s.length > 70 ? `${s.slice(0, 69)}…` : s;
}

/** The nodes of a raw reply as the patch prompt lists them. */
export function nodeSummaries(raw: unknown): AnalysisPatchInput["nodes"] {
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return [];
  return raw.nodes
    .flatMap((n) => (isObject(n) && typeof n.id === "string" && typeof n.type === "string" ? [{ id: n.id, type: n.type, label: nodeLabel(n) }] : []))
    .slice(0, MAX_LISTED_NODES);
}

/** Whether what's missing includes analysis nodes (not only a takeaway). */
export const needsAnalysisNodes = (missing: readonly string[]) => missing.some((m) => m === "its own analysis" || m.startsWith("an analysis line"));

/** What no small call can supply: drawn structure takes a full regeneration. */
export const needsFullRegeneration = (missing: readonly string[]) => missing.some((m) => m.startsWith("a visual structure"));

/**
 * `raw` with the patch merged in: the takeaway when the plan had none, and (when analysis nodes are missing) the
 * patch's text nodes, each marked as analysis with a fresh id, and the links among known ids. Null when `raw` isn't a plan.
 */
export function applyAnalysisPatch(raw: unknown, patch: unknown, missing: readonly string[]): unknown {
  if (!isObject(raw) || !Array.isArray(raw.nodes) || !isObject(patch)) return null;
  let metadata = isObject(raw.metadata) ? raw.metadata : undefined;
  if (typeof patch.takeaway === "string" && patch.takeaway.trim() && !(typeof metadata?.takeaway === "string" && metadata.takeaway.trim())) {
    metadata = { ...(metadata ?? {}), takeaway: patch.takeaway.trim() };
  }
  const nodes = [...raw.nodes];
  const relationships = Array.isArray(raw.relationships) ? [...raw.relationships] : [];
  if (needsAnalysisNodes(missing) && Array.isArray(patch.nodes)) {
    const taken = new Set(raw.nodes.flatMap((n) => (isObject(n) && typeof n.id === "string" ? [n.id] : [])));
    const renamed = new Map<string, string>();
    let next = 1;
    for (const n of patch.nodes) {
      // Only what the model marked as its analysis: a copy of the section's own content must not be added again.
      if (!isObject(n) || n.origin !== "analysis" || !isObject(n.content) || typeof n.content.markdown !== "string" || !n.content.markdown.trim()) continue;
      let id = `ax${next++}`;
      while (taken.has(id)) id = `ax${next++}`;
      taken.add(id);
      if (typeof n.id === "string") renamed.set(n.id, id);
      nodes.push({
        id,
        type: "text",
        origin: "analysis",
        ...(typeof n.title === "string" && n.title.trim() ? { title: n.title.trim() } : {}),
        ...(typeof n.role === "string" ? { role: n.role } : {}),
        content: { markdown: n.content.markdown },
      });
    }
    const known = new Set(raw.nodes.flatMap((n) => (isObject(n) && typeof n.id === "string" ? [n.id] : [])));
    const resolve = (id: unknown) => (typeof id === "string" ? (renamed.get(id) ?? (known.has(id) ? id : null)) : null);
    if (Array.isArray(patch.relationships)) {
      for (const r of patch.relationships) {
        if (!isObject(r) || typeof r.type !== "string") continue;
        const from = resolve(r.from);
        const to = resolve(r.to);
        if (from && to && from !== to) relationships.push({ ...r, from, to });
      }
    }
  }
  return { ...raw, nodes, relationships, ...(metadata ? { metadata } : {}) };
}
