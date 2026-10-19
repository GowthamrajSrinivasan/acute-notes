/**
 * The local tier's Archify path (interactive architecture frames, Phase 3): content that is one Archify architecture
 * document — the JSON on its own, or in one ```json fence — becomes interactive diagram frames, with no model call
 * (like a Mermaid diagram, `mermaidPlan.ts`). Any other content, including an Archify document of another diagram
 * type, is left to the normal local plan.
 */
import { convertArchify, detectArchify } from "@/ai/archify/convert";
import type { LocalPlanResult } from "./localPlanner";

/** At most this many of the converter's notes are listed as reasons. */
const MAX_NOTES = 3;

/** A local plan for content that is a single Archify architecture document, else null. */
export function planArchify(input: string): LocalPlanResult | null {
  const doc = detectArchify(input);
  if (!doc || doc.diagram_type !== "architecture") return null;
  const converted = convertArchify(doc);
  if (!converted.ok) return null;
  return {
    sufficient: true,
    confidence: 1,
    reasons: ["an Archify architecture diagram: converted to an interactive diagram frame", ...converted.warnings.slice(0, MAX_NOTES)],
    plan: converted.plan,
  };
}
