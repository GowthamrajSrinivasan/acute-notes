/**
 * `convertMermaid` (F33): Mermaid source → a validated `VisualPlan`, ready
 * for F30's `renderVisualPlan`. Deterministic and local — no model call and
 * no Mermaid library. Never throws: every failure is a typed
 * `MermaidConversionError`.
 *
 *   detect (header) → parse (flowchart | state | class | er | sequence | pie | gantt) →
 *   graphToPlan / buildSequencePlan / buildPiePlan / buildGanttPlan → validateVisualPlan (F29)
 */
import { InvalidVisualPlanError, validateVisualPlan } from "@/ai/visual-plan/validate";
import { detectMermaid, isMermaidLanguage } from "./detect";
import { buildArchitecturePlan, parseArchitecture } from "./architecture";
import { parseClass } from "./classDiagram";
import { parseEr } from "./er";
import { parseFlowchart } from "./flowchart";
import { parseGantt } from "./gantt";
import { buildGanttPlan } from "./ganttToPlan";
import { parsePie } from "./pie";
import { buildPiePlan } from "./pieToPlan";
import { parseSequence } from "./sequence";
import { buildSequencePlan } from "./sequenceToPlan";
import { readFrontmatter, splitStatements } from "./source";
import { parseState } from "./state";
import { graphToPlan } from "./toVisualPlan";
import type { ConvertibleKind, ConvertMermaidOptions, MermaidConversionResult, ParseResult } from "./types";

/** Longest source accepted (F29's code-block limit); a diagram near it would be far over the node limit anyway. */
export const MAX_MERMAID_SOURCE = 20_000;

const SUPPORTED = "flowcharts, state, class, entity-relationship, sequence, pie, gantt and architecture diagrams";

const PARSERS: Record<ConvertibleKind, (source: string) => ParseResult> = { flowchart: parseFlowchart, state: parseState, class: parseClass, er: parseEr };

export function convertMermaid(source: string, options: ConvertMermaidOptions = {}): MermaidConversionResult {
  try {
    if (typeof source !== "string" || !splitStatements(source, readFrontmatter(source).bodyStart).length) {
      return { ok: false, error: { code: "empty", message: "there is no Mermaid diagram to convert" } };
    }
    if (source.length > MAX_MERMAID_SOURCE) {
      return { ok: false, error: { code: "too_large", message: `the diagram is ${source.length} characters; at most ${MAX_MERMAID_SOURCE} can be converted` } };
    }
    const detected = detectMermaid(source);
    if (!detected) {
      return isMermaidLanguage(options.language)
        ? { ok: false, error: { code: "unsupported_diagram", message: `this Mermaid diagram type isn't recognised; only ${SUPPORTED} can be converted` } }
        : { ok: false, error: { code: "not_mermaid", message: "this isn't a Mermaid diagram (no `flowchart`, `graph` or other diagram header)" } };
    }
    if (detected.kind === "sequence") {
      const parsedSequence = parseSequence(source);
      if (!parsedSequence.ok) return parsedSequence;
      const builtSequence = buildSequencePlan(parsedSequence.graph, { sourceOffset: options.sourceOffset ?? 0 });
      if (!builtSequence.ok) return builtSequence;
      const validatedSequence = validateVisualPlan(builtSequence.plan);
      return {
        ok: true,
        kind: "sequence",
        plan: validatedSequence.plan,
        warnings: [...builtSequence.warnings, ...validatedSequence.warnings],
        graph: parsedSequence.graph,
      };
    }
    if (detected.kind === "pie") {
      const parsedPie = parsePie(source);
      if (!parsedPie.ok) return parsedPie;
      const builtPie = buildPiePlan(parsedPie.graph);
      if (!builtPie.ok) return builtPie;
      const validatedPie = validateVisualPlan(builtPie.plan);
      return { ok: true, kind: "pie", plan: validatedPie.plan, warnings: [...builtPie.warnings, ...validatedPie.warnings], graph: parsedPie.graph };
    }
    if (detected.kind === "gantt") {
      const parsedGantt = parseGantt(source);
      if (!parsedGantt.ok) return parsedGantt;
      const builtGantt = buildGanttPlan(parsedGantt.graph, { sourceOffset: options.sourceOffset ?? 0 });
      if (!builtGantt.ok) return builtGantt;
      const validatedGantt = validateVisualPlan(builtGantt.plan);
      return { ok: true, kind: "gantt", plan: validatedGantt.plan, warnings: [...builtGantt.warnings, ...validatedGantt.warnings], graph: parsedGantt.graph };
    }
    if (detected.kind === "architecture") {
      const parsedArchitecture = parseArchitecture(source);
      if (!parsedArchitecture.ok) return parsedArchitecture;
      const builtArchitecture = buildArchitecturePlan(parsedArchitecture.graph, { sourceOffset: options.sourceOffset ?? 0 });
      if (!builtArchitecture.ok) return builtArchitecture;
      const validatedArchitecture = validateVisualPlan(builtArchitecture.plan);
      return {
        ok: true,
        kind: "architecture",
        plan: validatedArchitecture.plan,
        warnings: [...parsedArchitecture.graph.notes, ...builtArchitecture.warnings, ...validatedArchitecture.warnings],
        graph: parsedArchitecture.graph,
      };
    }
    if (!detected.supported) {
      const what = `"${detected.keyword}" diagrams`;
      return {
        ok: false,
        error: { code: "unsupported_diagram", kind: detected.kind, message: `${what} can't be converted to canvas shapes yet; only ${SUPPORTED} can` },
      };
    }
    const parsed = PARSERS[detected.kind as ConvertibleKind](source);
    if (!parsed.ok) return parsed;
    const built = graphToPlan(parsed.graph, { sourceOffset: options.sourceOffset ?? 0 });
    if (!built.ok) return built;
    const validated = validateVisualPlan(built.plan);
    return {
      ok: true,
      kind: parsed.graph.kind,
      plan: validated.plan,
      warnings: [...parsed.graph.notes, ...built.warnings, ...validated.warnings],
      graph: parsed.graph,
    };
  } catch (e) {
    if (e instanceof InvalidVisualPlanError) {
      return { ok: false, error: { code: "invalid_plan", message: `the converted diagram isn't a valid visual plan: ${e.problems.join("; ")}` } };
    }
    return { ok: false, error: { code: "invalid_plan", message: `conversion failed unexpectedly: ${e instanceof Error ? e.message : String(e)}` } };
  }
}
