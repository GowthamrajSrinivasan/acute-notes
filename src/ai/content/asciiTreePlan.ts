/**
 * The local tier's ASCII-tree path (F42 Phase 3): content that is one tree
 * drawing — a code block (optionally under a heading that titles it) that
 * `detectAsciiTree` reads — is converted deterministically into shapes and
 * parent → child links, with no model call. A tree inside a larger document
 * is drawn in its section by the document planner instead (`localPlanner.ts`).
 */
import { convertAsciiTree, detectAsciiTree } from "./asciiTree";
import type { LocalPlanResult } from "./localPlanner";
import { codeBodyStart } from "./mermaidPlan";
import type { ParsedBlock, ParsedContent } from "./types";

/** At most this many of the converter's notes are listed as reasons. */
const MAX_NOTES = 3;

/** A local plan for content that is a single readable ASCII tree, else null. */
export function planAsciiTree(parsed: ParsedContent, input: string): LocalPlanResult | null {
  const blocks = parsed.blocks.filter((b) => b.type !== "divider");
  const heading = blocks[0]?.type === "heading" ? blocks[0] : null;
  const code = blocks.find((b): b is Extract<ParsedBlock, { type: "code" }> => b.type === "code");
  if (!code || blocks.length !== (heading ? 2 : 1) || !detectAsciiTree(code.source)) return null;
  const converted = convertAsciiTree(code.source, { sourceOffset: codeBodyStart(input, code), ...(heading ? { title: heading.text } : {}) });
  if (!converted.ok) return null;
  return { sufficient: true, confidence: 1, reasons: ["an ASCII tree: converted to shapes and links", ...converted.warnings.slice(0, MAX_NOTES)], plan: converted.plan };
}
