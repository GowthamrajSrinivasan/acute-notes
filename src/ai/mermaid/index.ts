/**
 * F33 — Mermaid import and convert-to-native. Public surface:
 *
 * - `detectMermaid(code)` / `isMermaidLanguage(lang)` — is this Mermaid, and which kind
 * - `convertMermaid(source, options)` — Mermaid → validated `VisualPlan` (or a typed error)
 * - `parseFlowchart` / `parseState` / `parseClass` / `parseEr` / `graphToPlan` — the steps, for callers that need the parsed graph
 * - `parseSequence` / `buildSequencePlan`, `parsePie` / `buildPiePlan`, `parseGantt` / `buildGanttPlan` — the same,
 *   for sequence/pie/gantt diagrams (each its own parser/builder, not the generic `MermaidGraph` path)
 *
 * Mermaid is an input representation only; the plan (then canvas objects) is canonical.
 */
export { detectMermaid, isMermaidLanguage } from "./detect";
export { convertMermaid, MAX_MERMAID_SOURCE } from "./convert";
export { parseFlowchart } from "./flowchart";
export { parseState } from "./state";
export { parseClass } from "./classDiagram";
export { parseEr } from "./er";
export { parseGantt } from "./gantt";
export { buildGanttPlan } from "./ganttToPlan";
export { parsePie } from "./pie";
export { buildPiePlan } from "./pieToPlan";
export { parseSequence } from "./sequence";
export { buildSequencePlan } from "./sequenceToPlan";
export { graphToPlan, chooseTemplate } from "./toVisualPlan";
export * from "./types";
