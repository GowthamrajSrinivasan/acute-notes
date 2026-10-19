/**
 * A validated section (F43) → a `sectioned` VisualPlan: the section is one
 * `group` (one frame, F42) keyed with the section's key, each node a member
 * keyed with its own (`stableKey`), and links between members as the plan's
 * relationships. Links with an end outside the section are cross links —
 * the map's bookkeeping draws them when both ends exist.
 *
 * Plan-node ids are the map's short ids for keys (`RepoMapRecord.ids`), so a
 * key is the same plan node — and the same change key in the pending set —
 * every time it is sent.
 */
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { formatRepoRef } from "@/domain/sourceRef";
import type { SourceRef } from "@/domain/types";
import type { MapNodeInput, MapRelationshipInput, SectionInput } from "./schema";

/** The key of a section's summary card (a node of its own, so an edit to it is reconciled like any card). */
export const summaryKey = (sectionKey: string) => `${sectionKey}#summary`;

export interface ConvertedSection {
  /** Grouped: the section's group first, then its members. */
  plan: VisualPlan;
  /** Links with an end outside this section. */
  cross: MapRelationshipInput[];
  /** Repo references by key, for provenance. */
  refs: Map<string, SourceRef[]>;
  /** The section as canonical JSON (the content version's text), with and without the commit. */
  text: string;
  body: string;
}

function member(n: MapNodeInput, id: string, parent: string): VisualNode {
  // A card's kind (Lens Phase 2): on a shape it's its semantics; on any other card, the node's own `kind`.
  const kind = n.kind && n.type !== "shape" ? { kind: n.kind } : {};
  const base = { id, parent, stableKey: n.key, ...(n.title ? { title: n.title } : {}), ...kind };
  switch (n.type) {
    case "text":
      return { ...base, type: "text", content: { markdown: n.markdown } };
    case "heading":
      return { id, parent, stableKey: n.key, ...kind, type: "heading", content: { text: n.text } };
    case "table":
      return { ...base, type: "table", content: { columns: n.columns, rows: n.rows.map((r) => n.columns.map((_, i) => r[i] ?? "")) } };
    case "todo":
      return { ...base, type: "todo", content: { items: n.items } };
    case "shape":
      return { id, parent, stableKey: n.key, type: "shape", content: { shape: n.shape, label: n.label, ...(n.kind ? { kind: n.kind } : {}) } };
    case "code":
      return { ...base, type: "code", content: { source: n.code, ...(n.language ? { language: n.language } : {}) } };
  }
}

/** `path#L<a>-<b>@<commit>` (or `path@<commit>`), the repo reference stored in provenance (`domain/sourceRef.ts`). */
export const repoRef = formatRepoRef;

/** Canonical JSON: fixed field order, nothing but what was validated. */
function canonical(input: SectionInput, withCommit: boolean): string {
  const node = (n: MapNodeInput) => {
    const { key, type, title, source, kind, ...content } = n;
    return { key, type, ...(title ? { title } : {}), ...(kind ? { kind } : {}), ...sorted(content), ...(source ? { source } : {}) };
  };
  return JSON.stringify({
    ...(withCommit ? { commit: input.commit } : {}),
    section: {
      key: input.section.key,
      label: input.section.label,
      arrangement: input.section.arrangement,
      ...(input.section.summary ? { summary: input.section.summary } : {}),
      ...(input.section.level !== undefined ? { level: input.section.level } : {}),
    },
    nodes: input.nodes.map(node),
    relationships: input.relationships.map((r) => ({ from: r.from, to: r.to, type: r.type, ...(r.label ? { label: r.label } : {}) })),
  });
}

function sorted(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
}

/** `idOf` gives the map's short id for a key (assigned by the caller). */
export function convertSection(input: SectionInput, idOf: (key: string) => string): ConvertedSection {
  const gid = idOf(input.section.key);
  // Every map section is a Lens level (Phase 2): an interactive frame, with its level when the agent gave one.
  const nodes: VisualNode[] = [
    {
      id: gid,
      type: "group",
      stableKey: input.section.key,
      content: { label: input.section.label, arrangement: input.section.arrangement, diagram: "architecture", ...(input.section.level !== undefined ? { level: input.section.level } : {}) },
    },
  ];
  if (input.section.summary) {
    nodes.push({ id: idOf(summaryKey(input.section.key)), parent: gid, stableKey: summaryKey(input.section.key), type: "text", content: { markdown: input.section.summary } });
  }
  const refs = new Map<string, SourceRef[]>();
  for (const n of input.nodes) {
    nodes.push(member(n, idOf(n.key), gid));
    if (n.source) refs.set(n.key, [repoRef(n.source.path, n.source.lines, input.commit)]);
  }
  const own = new Set(input.nodes.map((n) => n.key));
  const relationships = input.relationships.filter((r) => own.has(r.from) && own.has(r.to)).map((r) => ({ from: idOf(r.from), to: idOf(r.to), type: r.type, ...(r.label ? { label: r.label } : {}) }));
  // A member linked to its own section is already in its frame: nothing to draw.
  const cross = input.relationships.filter((r) => !(own.has(r.from) && own.has(r.to)) && r.from !== input.section.key && r.to !== input.section.key);
  return {
    plan: { version: 1, template: "sectioned", nodes, relationships, metadata: { title: input.section.label } },
    cross,
    refs,
    text: canonical(input, true),
    body: canonical(input, false),
  };
}

/** A section back from its content version's text (for re-staging it on a link or a removal). */
export function sectionFromText(text: string): SectionInput | null {
  try {
    const raw = JSON.parse(text) as SectionInput;
    if (!raw || typeof raw.commit !== "string" || !raw.section || !Array.isArray(raw.nodes) || !Array.isArray(raw.relationships)) return null;
    return raw;
  } catch {
    return null;
  }
}
