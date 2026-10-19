/**
 * A partial patch of an existing node's descriptive and project-knowledge halves (plan D43's `update_node`).
 * A provided field replaces that field, `null` clears it, an omitted field is untouched. The Lens half
 * (`key`, `expandsTo`, `sources`) is not patchable: AI/MCP input can't set it (Phase 0.1), so it survives untouched.
 *
 * Pure: written against the `customData` bag, validated per field with the same normalizers as every other writer.
 */
import { getNodeSemantics, withNodeProject, withNodeSemantics, type NodeKind, type NodeSemantics } from "./diagram";
import { getNodeProject, type NodeProject } from "./nodeProject";
import { NODE_KIND_STYLES, PLAIN_NODE_STYLE, hasKindStyle } from "./nodeKindStyle";

type Patchable<T> = { [K in keyof T]?: T[K] | null };

export type NodePatch = Patchable<NodeSemantics> & Patchable<NodeProject>;

export const SEMANTICS_PATCH_KEYS = ["kind", "sublabel", "tag", "details"] as const satisfies readonly (keyof NodeSemantics)[];
export const PROJECT_PATCH_KEYS = [
  "project", "refs", "style", "focus", "status", "reason", "options", "chosen", "enforce", "supersedes", "deviatesFrom", "stage", "note", "answer", "severity", "order", "next", "intent",
] as const satisfies readonly (keyof NodeProject)[];

/** `base` with each patched key replaced (or removed for `null`); keys outside `keys` are never read from the patch. */
function merged<T extends object>(base: T | undefined, patch: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const k of keys) {
    if (patch[k] === null) delete out[k];
    else if (patch[k] !== undefined) out[k] = patch[k];
  }
  return out;
}

/** `customData` with the patch applied: semantics first (so the kind is set), then project fields normalized against the resulting kind. */
export function applyNodePatch(customData: Record<string, unknown> | undefined, patch: NodePatch): Record<string, unknown> {
  const p = patch as Record<string, unknown>;
  const withSemantics = withNodeSemantics(customData, merged(getNodeSemantics({ customData }), p, SEMANTICS_PATCH_KEYS) as NodeSemantics);
  return withNodeProject(withSemantics, merged(getNodeProject({ customData }), p, PROJECT_PATCH_KEYS) as NodeProject);
}

/** The node's kind in `customData`, if any. */
export const nodeKindIn = (customData: Record<string, unknown> | undefined): NodeKind | undefined => getNodeSemantics({ customData })?.kind;

/**
 * The colours a kind change should write, as `setNodeKind` does: a new kind sets its style; a cleared kind restores
 * the plain look only if the shape still wears the old kind's colours. Undefined when nothing should change.
 */
export function kindChangeStyle(
  colours: { strokeColor?: string; backgroundColor?: string },
  before: NodeKind | undefined,
  after: NodeKind | undefined,
): { strokeColor: string; backgroundColor: string } | undefined {
  if (before === after) return undefined;
  if (after) {
    const { strokeColor, backgroundColor } = NODE_KIND_STYLES[after];
    return { strokeColor, backgroundColor };
  }
  return hasKindStyle(colours, before) ? { ...PLAIN_NODE_STYLE } : undefined;
}

/** "status → done, reason cleared" — what a patch changes, for the review row. */
export function describeNodePatch(patch: NodePatch): string {
  const p = patch as Record<string, unknown>;
  const parts = [...SEMANTICS_PATCH_KEYS, ...PROJECT_PATCH_KEYS].flatMap((k) => {
    const v = p[k];
    if (v === undefined) return [];
    if (v === null) return [`${k} cleared`];
    if (Array.isArray(v)) return [`${k} → ${v.length}`];
    return [`${k} → ${String(v).replace(/_/g, " ")}`];
  });
  return parts.join(", ") || "no change";
}
