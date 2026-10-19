/**
 * `AsciiTree` → plan nodes (F42 Phase 3): every node a rectangle `shape`, every parent → child link a
 * `relates_to` relationship. `treePlanParts` gives the pieces to splice into a larger plan (a document section
 * whose group uses the `tree` arrangement); `treeToPlan` wraps them in a plan of their own:
 *
 * - one tree (plus, at most, a few loose labels) → `decision_tree`, rooted at it (layered top down);
 * - several trees → `sectioned`, one `tree`-arranged group holding them all.
 *
 * Keys come from the label path (`ascii:tree:ACUTE › PAID › PRO`), so a regenerated drawing with the same
 * labels keeps its nodes; a repeated path gets `#2`, `#3`…
 */
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import { MAX_PLAN_NODES } from "@/ai/visual-plan/validate";
import { flat } from "./label";
import type { AsciiTree, AsciiTreeError } from "./types";

export const TREE_KEY_PREFIX = "ascii:tree:";
const PATH_SEPARATOR = " › ";
const KEY_MAX = 300;
/** Per label in a key, so a deep path of long labels still fits. */
const KEY_LABEL_MAX = 60;

export interface TreePlanPartsOptions {
  /** Prefixed to every node id (default "t", giving "t1", "t2"…); ids must be unique in the plan they join. */
  idPrefix?: string;
  /** Prefixed to every `stableKey`, e.g. the section's own key (default none: keys are `ascii:tree:<path>`). */
  keyPrefix?: string;
  /** A `group` node's id to set as every node's `parent`. */
  parent?: string;
  /** Added to every `sourceSpan`. */
  sourceOffset?: number;
}

export interface TreePlanParts {
  /** Shape nodes in pre-order (each parent before its children). */
  nodes: Extract<VisualNode, { type: "shape" }>[];
  relationships: VisualRelationship[];
  /** Ids of the roots that have children (0 when the tree is only loose labels). */
  trees: string[];
  /** Labels shortened to fit. */
  shortened: number;
}

const truncate = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

export function treePlanParts(tree: AsciiTree, options: TreePlanPartsOptions = {}): TreePlanParts {
  const { idPrefix = "t", keyPrefix = "", parent, sourceOffset = 0 } = options;
  const ids = tree.nodes.map((_, i) => `${idPrefix}${i + 1}`);
  const paths: string[] = [];
  const used = new Set<string>();
  let shortened = 0;
  const nodes = tree.nodes.map((n, i): Extract<VisualNode, { type: "shape" }> => {
    const own = truncate(flat(n.label), KEY_LABEL_MAX);
    const path = n.parent === null ? own : `${paths[n.parent]}${PATH_SEPARATOR}${own}`;
    paths.push(path);
    const base = truncate(`${keyPrefix}${TREE_KEY_PREFIX}${path}`, KEY_MAX - 5);
    let key = base;
    for (let k = 2; used.has(key); k++) key = `${base}#${k}`;
    used.add(key);
    if (n.label.length > TEXT_LIMITS.shapeLabel) shortened++;
    const role = n.parent === null ? (n.children.length ? "decision" : "note") : n.children.length ? "step" : "outcome";
    return {
      id: ids[i]!,
      type: "shape",
      role,
      content: { shape: "rectangle", label: truncate(n.label, TEXT_LIMITS.shapeLabel) },
      sourceSpan: { start: n.span.start + sourceOffset, end: n.span.end + sourceOffset },
      stableKey: key,
      ...(parent ? { parent } : {}),
    };
  });
  const relationships = tree.nodes.flatMap((n, i): VisualRelationship[] => (n.parent === null ? [] : [{ from: ids[n.parent]!, to: ids[i]!, type: "relates_to" }]));
  const trees = tree.roots.filter((r) => tree.nodes[r]!.children.length).map((r) => ids[r]!);
  return { nodes, relationships, trees, shortened };
}

export type BuildResult = { ok: true; plan: VisualPlan; warnings: string[] } | { ok: false; error: AsciiTreeError };

export function treeToPlan(tree: AsciiTree, options: { sourceOffset?: number; title?: string } = {}): BuildResult {
  if (!tree.nodes.length) return { ok: false, error: { code: "not_a_tree", message: "the drawing has no labels" } };
  if (tree.nodes.length > MAX_PLAN_NODES) {
    return { ok: false, error: { code: "too_large", message: `the tree has ${tree.nodes.length} nodes; at most ${MAX_PLAN_NODES} can be converted at once` } };
  }
  const title = options.title?.trim() ? options.title.trim() : undefined;
  const multi = tree.roots.filter((r) => tree.nodes[r]!.children.length).length > 1;
  const groupId = "tree";
  const parts = treePlanParts(tree, { sourceOffset: options.sourceOffset ?? 0, ...(multi ? { parent: groupId } : {}) });
  const warnings: string[] = [];
  if (parts.shortened) warnings.push(`${parts.shortened} label${parts.shortened === 1 ? "" : "s"} over ${TEXT_LIMITS.shapeLabel} characters shortened`);
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const nodes: VisualNode[] = multi
    ? [
        {
          id: groupId,
          type: "group",
          role: "hierarchy",
          stableKey: `${TREE_KEY_PREFIX}(group)`,
          content: { label: truncate(title ?? "Tree", TEXT_LIMITS.groupLabel), arrangement: "tree" },
        },
        ...parts.nodes,
      ]
    : parts.nodes;
  const plan: VisualPlan = {
    version: 1,
    template: multi ? "sectioned" : "decision_tree",
    nodes,
    relationships: parts.relationships,
    metadata: {
      ...(title ? { title: truncate(title, TEXT_LIMITS.planTitle) } : {}),
      summary: `Converted from an ASCII tree: ${count(parts.nodes.length, "node")}, ${count(parts.relationships.length, "link")}${multi ? `, ${parts.trees.length} trees` : ""}.`,
    },
  };
  return { ok: true, plan, warnings };
}
