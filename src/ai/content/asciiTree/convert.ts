/**
 * `convertAsciiTree` (F42 Phase 3): an ASCII/box-drawing tree → a validated `VisualPlan`, ready for F30's
 * `renderVisualPlan`. Deterministic and local — no model call. Never throws: every failure is a typed
 * `AsciiTreeError`.
 *
 *   parse (indented, else box) → treeToPlan → validateVisualPlan (F29)
 *
 * `detectAsciiTree` answers "is this code block a tree the converter reads?" so a planner can decide between
 * native shapes, a code block, or AI; anything else — tables, arrow flows, charts, general ASCII art — is null.
 */
import { InvalidVisualPlanError, MAX_PLAN_NODES, validateVisualPlan } from "@/ai/visual-plan/validate";
import { parseBoxTree } from "./box";
import { parseIndentedTree } from "./indented";
import { treeToPlan } from "./toVisualPlan";
import type { AsciiTreeConversionResult, AsciiTreeDetection, AsciiTreeParseResult, ConvertAsciiTreeOptions } from "./types";

/** Longest source accepted (F29's code-block limit). */
export const MAX_ASCII_TREE_SOURCE = 20_000;

/** Characters every readable tree has at least one of: a branch marker or a connector. */
const TREE_HINT = /[|+`\\]|[─━═│┃║├└┌┐┬┴┼┣┗╠╚]/;

/** A line that starts like an indented branch with a label: its failure explains more than the box parser's. */
const INDENTED_BRANCH = /^[ 	│┃║|]*(?:[├└┣┗][─━═-]*|\|--|`-+|\+-+)[ ]*[\p{L}\p{N}]/mu;

/** Parses `source` as an indented tree, else as a top-down box tree; the more specific failure wins. */
export function parseAsciiTree(source: string): AsciiTreeParseResult {
  try {
    if (typeof source !== "string" || !source.trim()) return { ok: false, error: { code: "empty", message: "there is no drawing to convert" } };
    if (source.length > MAX_ASCII_TREE_SOURCE) {
      return { ok: false, error: { code: "too_large", message: `the drawing is ${source.length} characters; at most ${MAX_ASCII_TREE_SOURCE} can be converted` } };
    }
    if (!TREE_HINT.test(source)) return { ok: false, error: { code: "not_a_tree", message: "no tree branches or connector lines" } };
    const indented = parseIndentedTree(source);
    if (indented.ok) return indented;
    // An indented tree that is merely odd (not junk) is the better answer than a box parse of the same text.
    if (indented.error.code === "unsupported" || indented.error.code === "too_large") return indented;
    const box = parseBoxTree(source);
    if (box.ok) return box;
    return box.error.code === "not_a_tree" && INDENTED_BRANCH.test(source) ? indented : box;
  } catch (e) {
    return { ok: false, error: { code: "unsupported", message: `the drawing couldn't be read: ${e instanceof Error ? e.message : String(e)}` } };
  }
}

export function convertAsciiTree(source: string, options: ConvertAsciiTreeOptions = {}): AsciiTreeConversionResult {
  try {
    const parsed = parseAsciiTree(source);
    if (!parsed.ok) return parsed;
    const built = treeToPlan(parsed.tree, { sourceOffset: options.sourceOffset ?? 0, ...(options.title ? { title: options.title } : {}) });
    if (!built.ok) return built;
    const validated = validateVisualPlan(built.plan);
    return { ok: true, style: parsed.tree.style, plan: validated.plan, warnings: [...parsed.tree.notes, ...built.warnings, ...validated.warnings], tree: parsed.tree };
  } catch (e) {
    if (e instanceof InvalidVisualPlanError) {
      return { ok: false, error: { code: "invalid_plan", message: `the converted tree isn't a valid visual plan: ${e.problems.join("; ")}` } };
    }
    return { ok: false, error: { code: "invalid_plan", message: `conversion failed unexpectedly: ${e instanceof Error ? e.message : String(e)}` } };
  }
}

/** The tree `convertAsciiTree` would read in `code` (a code block's body), or null for anything else. */
export function detectAsciiTree(code: string): AsciiTreeDetection | null {
  const parsed = parseAsciiTree(code);
  if (!parsed.ok) return null;
  const { tree } = parsed;
  // Over F29's node limit it can't be converted, so it isn't a tree this parser handles.
  if (tree.nodes.length > MAX_PLAN_NODES) return null;
  return { style: tree.style, nodes: tree.nodes.length, trees: tree.roots.filter((r) => tree.nodes[r]!.children.length).length };
}
