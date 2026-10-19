/**
 * Mermaid detection (F33): is a code string a Mermaid diagram, and which
 * kind? Decided by the diagram's header keyword — the first statement after
 * any frontmatter and `%%` comments/directives — exactly as Mermaid's own
 * detectors do, so no Mermaid library is needed (or loaded) to answer it.
 */
import { readFrontmatter, splitStatements } from "./source";
import { CONVERTIBLE_KINDS, type MermaidDetection, type MermaidDiagramKind } from "./types";

/** Header keyword → kind. Longest keywords first where one is a prefix of another. */
const HEADERS: readonly (readonly [RegExp, MermaidDiagramKind])[] = [
  [/^(flowchart-elk|flowchart|graph)(?=$|\s)/, "flowchart"],
  [/^(stateDiagram-v2|stateDiagram)(?=$|\s)/, "state"],
  [/^(sequenceDiagram)(?=$|\s)/, "sequence"],
  [/^(classDiagram-v2|classDiagram)(?=$|\s)/, "class"],
  [/^(erDiagram)(?=$|\s)/, "er"],
  [/^(journey)(?=$|\s)/, "journey"],
  [/^(gantt)(?=$|\s)/, "gantt"],
  [/^(pie)(?=$|\s)/, "pie"],
  [/^(quadrantChart)(?=$|\s)/, "quadrant"],
  [/^(requirementDiagram)(?=$|\s)/, "requirement"],
  [/^(gitGraph)(?=$|\s|:)/, "gitgraph"],
  [/^(C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)(?=$|\s)/, "c4"],
  [/^(mindmap)(?=$|\s)/, "mindmap"],
  [/^(timeline)(?=$|\s)/, "timeline"],
  [/^(zenuml)(?=$|\s)/, "zenuml"],
  [/^(sankey-beta|sankey)(?=$|\s)/, "sankey"],
  [/^(xychart-beta|xychart)(?=$|\s)/, "xychart"],
  [/^(block-beta|block)(?=$|\s)/, "block"],
  [/^(packet-beta|packet)(?=$|\s)/, "packet"],
  [/^(kanban)(?=$|\s)/, "kanban"],
  [/^(architecture-beta|architecture)(?=$|\s)/, "architecture"],
  [/^(radar-beta|radar)(?=$|\s)/, "radar"],
  [/^(treemap-beta|treemap)(?=$|\s)/, "treemap"],
];

/** A code fence language that means Mermaid (```mermaid, ```mmd). */
export function isMermaidLanguage(language: string | undefined | null): boolean {
  return !!language && /^(mermaid|mmd)$/i.test(language.trim());
}

/** The diagram kind of `code`, or null when it doesn't start with a Mermaid diagram header. Never throws. */
export function detectMermaid(code: string): MermaidDetection | null {
  if (typeof code !== "string") return null;
  const first = splitStatements(code, readFrontmatter(code).bodyStart)[0];
  if (!first) return null;
  for (const [pattern, kind] of HEADERS) {
    const m = pattern.exec(first.text);
    if (!m) continue;
    const keyword = m[1]!;
    return {
      kind,
      // "sequence"/"pie"/"gantt"/"architecture" each convert via their own parser/builder (`sequence.ts`, `pie.ts`, `gantt.ts`, `architecture.ts`),
      // not the generic `MermaidGraph` path `CONVERTIBLE_KINDS` gates, so they're `supported` without being one.
      supported: kind === "sequence" || kind === "pie" || kind === "gantt" || kind === "architecture" || (CONVERTIBLE_KINDS as readonly string[]).includes(kind),
      keyword,
      headerSpan: { start: first.span.start, end: first.span.end },
    };
  }
  return null;
}
