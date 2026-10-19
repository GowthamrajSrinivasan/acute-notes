/**
 * F42 Phase 3 — ASCII-tree conversion. Public surface:
 *
 * - `detectAsciiTree(code)` — is this code block a tree the converter reads (and which style)
 * - `convertAsciiTree(source, options)` — tree → validated `VisualPlan` (or a typed error)
 * - `parseAsciiTree` / `treePlanParts` / `treeToPlan` — the steps, for callers splicing a tree into a larger plan
 *
 * The drawing is an input representation only; the plan (then canvas shapes) is canonical.
 */
export { convertAsciiTree, detectAsciiTree, parseAsciiTree, MAX_ASCII_TREE_SOURCE } from "./convert";
export { treePlanParts, treeToPlan, TREE_KEY_PREFIX, type TreePlanParts, type TreePlanPartsOptions } from "./toVisualPlan";
export * from "./types";
