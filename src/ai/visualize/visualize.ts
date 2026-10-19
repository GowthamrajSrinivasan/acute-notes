/**
 * `visualizeContent` (F31): the whole Content-to-Canvas pipeline, composed
 * from F26–F30 as one async workflow with explicit stages and cancellation.
 *
 *   parse (F28) → local tier sufficient? ──yes──────────────────┐
 *        │        (only fully explicit content: see `aiRecommended`) │
 *        │ no (or a template was forced)                        │
 *        ▼                                                      │
 *   outline_document → generate_visual_plan per section          │
 *   (a forced template: generate_visual_plan per analysis unit)  │
 *        │                                                      │
 *        ▼                                                      │
 *   validate (F29) ◄──────────────────────────────────────────────┘
 *        │
 *        ▼
 *   render (F30) → a declarative F19 change set
 *
 * UI components only call this, show `onProgress`'s stage, and — on success
 * — hand the change set to F19's existing review; they never touch React,
 * Excalidraw, BlockNote or persistence state themselves from in here, and
 * neither does this module.
 */
import { analyzeContent } from "@/ai/content/analyze";
import { detectRevisions, withoutRevised, type Revision } from "@/ai/history/revisions";
import { withChoiceNodes } from "@/ai/history/choiceNodes";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { AIError } from "@/ai/errors";
import { AI_PROVIDER_DESCRIPTORS } from "@/ai/providers/registry";
import { renderVisualPlan } from "@/ai/renderer/render";
import { NO_PROVIDER_CONFIGURED_MESSAGE, type AIRuntime } from "@/ai/runtime";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { newContentSourceId } from "@/ai/content/sources";
import { failureCause, type AnalysisReport } from "@/ai/fidelity/analysis";
import { SHORT_SOURCE_CHARS } from "@/ai/fidelity/analysisCheck";
import { rememberInput, rememberRun } from "@/ai/fidelity/regenerate";
import { ensureStableKeys, mergeUnitPlans } from "@/ai/reconcile/keys";
import { groupByUnit } from "@/ai/visual-plan/groups";
import { stopwatch } from "./timing";
import { visualizeOutlined, type OutlinedResult } from "./outlined";
import { analysisUnits, headingOnlyReply } from "@/ai/reconcile/units";
// Loads the Visualize tasks for its side effect: the module registers them with the task registry.
import "./tasks";
import type { GenerateVisualPlanInput } from "./tasks";
import { NoProviderConfiguredError, NothingToVisualizeLocallyError, ReadsFineAsTextError, type VisualizeInput, type VisualizeOptions, type VisualizeResult } from "./types";
import type { VisualPlan } from "@/ai/visual-plan/types";

function abortError(): DOMException {
  return new DOMException("Visualize was cancelled.", "AbortError");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

export async function visualizeContent(input: VisualizeInput, runtime: AIRuntime, options: VisualizeOptions = {}): Promise<VisualizeResult> {
  const { signal, onProgress, parseMarkdown } = options;
  const report = (stage: VisualizeStageArg) => onProgress?.(stage);

  const watch = stopwatch();
  report({ stage: "parsing", label: "Parsing…" });
  const { parsed, local } = await analyzeContent(input.text, { format: input.format, signal });
  throwIfAborted(signal);
  watch.lap("parse");

  let rawPlan: unknown;
  let usedLocalTier: boolean;
  /** Where the text changes its mind (G3.3), found on the AI path. */
  let revisions: Revision[] = [];
  let provenance: VisualizeResult["provenance"];
  let aiTemplate: string | undefined;
  let fidelity: VisualizeResult["fidelity"];
  let outlinedRun: OutlinedResult | null = null;
  const notes: string[] = [];
  const notices: string[] = [];
  /** The local plan is a good enough answer when AI isn't available (a structured document AI would only improve). */
  const localFallback = !input.template && local.sufficient ? local.plan : null;
  // What AI analysed, for the review (Wave A: a result that is only the content's own structure always says so).
  let analysis: AnalysisReport = { mode: "ai", fallbacks: [] };

  if (input.forceLocalOnly) {
    if (!local.plan) throw new NothingToVisualizeLocallyError();
    rawPlan = local.plan;
    usedLocalTier = true;
    analysis = { mode: "structure", reason: "local_only", fallbacks: [] };
  } else if (localFallback && !local.aiRecommended && !input.forceAI) {
    rawPlan = localFallback;
    usedLocalTier = true;
    analysis = { mode: "structure", reason: "structured", fallbacks: [] };
  } else {
    usedLocalTier = false;
    let units = analysisUnits(parsed, input.text);
    // Where the text changes its mind (G3.3): the later statement wins. The earlier one is left out of what is analysed (and of the
    // safety net), and kept on its section's "Changed over time" page; the source keeps the user's text as pasted.
    revisions = await detectRevisions(runtime, units, signal);
    if (revisions.length) {
      const text = withoutRevised(input.text, revisions);
      const again = await analyzeContent(text, { format: input.format, signal });
      units = analysisUnits(again.parsed, text);
    }
    const analyzing = (label: string) => report({ stage: "analyzing", label });
    try {
      // No forced template: outline the whole document (even a single section, which the outline just classifies),
      // then generate each semantic section with its kind's rules (F42 Phase 2). A failed outline is handled inside:
      // each part becomes a section of its own, with every node type allowed.
      if (!input.template) {
        const outlined: OutlinedResult = await visualizeOutlined(units, runtime, { signal, onProgress: analyzing, ...(options.reuse ? { reuse: options.reuse } : {}) });
        outlinedRun = outlined;
        rawPlan = outlined.raw;
        aiTemplate = "sectioned";
        provenance = outlined.provenance;
        notes.push(...outlined.warnings);
        fidelity = outlined.fidelity;
        if (outlined.outlineFailed) notices.push("AI couldn't outline the whole document, so each of its sections was analysed on its own.");
        if (outlined.failed.length) notices.push(sectionsNotice(outlined.failed.map((f) => f.label)));
        if (outlined.keptEarlier.length) notices.push(keptEarlierNotice(outlined.keptEarlier));
        analysis = {
          mode: "ai",
          fallbacks: outlined.failed,
          ...(outlined.shallow.length ? { shallow: outlined.shallow } : {}),
          ...(outlined.outlineFailed ? { outlineFailed: true as const, ...(outlined.outlineCause ? { cause: outlined.outlineCause } : {}) } : {}),
        };
      } else {
        // A user-forced template: one call per analysis unit with that template's rules.
        const template = input.template;
        aiTemplate = template;
        // One call per analysis unit (F37), so a later update can re-analyse only the units that changed.
        // A heading-only unit (a title above the first subsection) is answered locally: a model asked about it invents content.
        const calls = units.filter((u) => !headingOnlyReply(u, template)).length;
        let done = 0;
        analyzing(calls > 1 ? `Analyzing ${calls} parts…` : "Analyzing…");
        const replies = await Promise.all(
          units.map(async (u) => {
            const local = headingOnlyReply(u, template);
            if (local) return null;
            const reply = await runtime.run<GenerateVisualPlanInput, unknown>("generate_visual_plan", { template, text: u.text }, { signal });
            if (calls > 1 && ++done < calls) analyzing(`Analyzing parts: ${done} of ${calls} done…`);
            return reply;
          }),
        );
        throwIfAborted(signal);
        const merged = mergeUnitPlans(template, replies.map((r, i) => ({ unitKey: units[i]!.key, raw: r ? r.data : headingOnlyReply(units[i]!, template) })));
        // Each section of the document becomes a frame of its own (F42), laid out with the template's arrangement.
        rawPlan = groupByUnit(merged, template, units.map((u, i) => ({ key: u.key, headingOnly: replies[i] === null })));
        const last = replies.filter((r) => r !== null).at(-1);
        if (last) provenance = { providerId: last.providerId, role: last.role, model: last.usage.model };
      }
    } catch (err) {
      ({ rawPlan, usedLocalTier } = recover(err, localFallback, !!local.plan, notes));
      if (usedLocalTier && !isNoProvider(err)) notices.push("AI analysis failed, so the document's own structure is shown.");
      analysis = isNoProvider(err)
        ? { mode: "structure", reason: "no_provider", fallbacks: [] }
        : { mode: "structure", reason: "ai_failed", cause: failureCause(err), fallbacks: [] };
      if (!isNoProvider(err)) console.warn(`[acute-notes] Visualize: AI analysis failed, the local plan is shown (${failureCause(err)})`);
    }
  }
  if (usedLocalTier) aiTemplate = undefined;
  watch.lap(usedLocalTier ? "local plan" : "analyze");

  report({ stage: "planning_layout", label: "Planning layout…" });
  const validated = validateVisualPlan(rawPlan);
  const keyed = ensureStableKeys(validated.plan);
  const plan = revisions.length ? withChoiceNodes(keyed, [], revisions) : keyed;
  const warnings = [...notes, ...validated.warnings];
  // Content the validator could not carry over is said, never only logged (content fidelity: every loss is visible).
  const lostNodes = validated.losses.filter((l) => /^node \d+: dropped/.test(l)).length;
  if (validated.losses.length) console.warn(`[acute-notes] Visualize: the plan lost ${validated.losses.length} item(s) in validation: ${validated.losses.join(" | ")}`);
  if (lostNodes) notices.push(`${lostNodes} ${lostNodes === 1 ? "part" : "parts"} of AI's plan couldn't be shown and ${lostNodes === 1 ? "was" : "were"} left out.`);
  throwIfAborted(signal);
  const metadata = provenanceMetadata(input.operationId, provenance);
  // Every run starts a content source (F37); it's recorded only if the result is accepted.
  const contentSource = {
    sourceId: newContentSourceId(),
    version: 1,
    origin: "paste" as const,
    tier: usedLocalTier ? ("local" as const) : ("ai" as const),
    template: aiTemplate ?? plan.template,
    text: input.text,
    plan,
    ...(revisions.length ? { revisions } : {}),
  };
  report({ stage: "planning_layout", label: "Drawing the canvas…" });
  const changeSet = await renderVisualPlan(plan, {
    operationId: input.operationId,
    title: input.title,
    metadata,
    context: input.context,
    contentSource,
    ...(parseMarkdown ? { parseMarkdown } : {}),
  });

  watch.lap("validate + render");
  console.info(`[acute-notes] Visualize timing (${usedLocalTier ? "local" : "ai"}): ${watch.summary()}`);
  const fidelityReport = fidelity && !usedLocalTier && fidelity.units > 0 ? fidelity : undefined;
  if (fidelityReport) changeSet.fidelity = fidelityReport;
  changeSet.analysis = analysis;
  // Kept so a structure-only result can be run again with AI ("Analyse with AI" / "Retry" in the review).
  if (analysis.mode === "structure") {
    const { operationId: _op, context: _ctx, ...rest } = input;
    rememberInput(changeSet.operationId, rest);
  }
  // Kept so "Regenerate" can redo only the sections that fell short (reusing the outline and the other sections).
  if (outlinedRun && !usedLocalTier) {
    const { operationId: _op, context: _ctx, ...rest } = input;
    // A regenerated section is offered once only (Wave A2): the sections regenerated so far carry over.
    const reuse = options.reuse;
    const regenerated = new Set([...(reuse?.regenerated ?? []), ...(reuse ? reuse.retry.keys() : [])]);
    rememberRun(changeSet.operationId, { input: rest, outline: outlinedRun.outline, replies: outlinedRun.replies, regenerated });
  }
  // "Keep as text" (D-R2.3): only for AI's own choice of representation (not a forced template, not a regeneration).
  if (!usedLocalTier && !input.template && !options.reuse && readsFineAsText(plan, input.text)) throw new ReadsFineAsTextError(changeSet);
  return { changeSet, usedLocalTier, warnings, notices, analysis, ...(provenance ? { provenance } : {}), ...(fidelityReport ? { fidelity: fidelityReport } : {}) };
}

/** "Keep as text" applies only to content of at most `SHORT_SOURCE_CHARS` and this many sentences. */
const SHORT_SENTENCES = 2;

/**
 * Content a diagram adds little to (D-R2.3): the source is short (a note of a sentence or two), and AI's plan of it
 * is fewer than 3 content nodes, all of them text (or pages), with no relationship between them. All of these: a
 * relationship-free comparison table or set of shapes still draws, and longer content the model merely wrote out
 * as text is asked for its structure instead (the analysis check), not declared simple.
 */
export function readsFineAsText(plan: VisualPlan, source: string): boolean {
  const text = source.trim();
  if (text.length > SHORT_SOURCE_CHARS || text.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length > SHORT_SENTENCES) return false;
  const groups = new Set(plan.nodes.flatMap((n) => (n.type === "group" ? [n.id] : [])));
  const content = plan.nodes.filter((n) => n.type !== "group" && n.type !== "heading");
  if (!content.length || content.length >= 3 || !content.every((n) => n.type === "text" || n.type === "page")) return false;
  return !plan.relationships.some((r) => !groups.has(r.from) && !groups.has(r.to));
}

/** The notice for regenerated sections whose earlier version was kept. */
export function keptEarlierNotice(labels: readonly string[]): string {
  const named = labels.map((l) => `"${l}"`).join(", ");
  return `Kept the earlier version of ${named}: the regenerated one placed less of the source.`;
}

/** The notice for sections the model couldn't produce. */
export function sectionsNotice(labels: readonly string[]): string {
  const named = labels.map((l) => `"${l}"`).join(", ");
  return labels.length === 1
    ? `AI couldn't analyse the section ${named}, so its own structure is shown.`
    : `AI couldn't analyse ${labels.length} sections (${named}), so their own structure is shown.`;
}

const isNoProvider = (err: unknown) => err instanceof AIError && err.kind === "model_unavailable" && err.message === NO_PROVIDER_CONFIGURED_MESSAGE;

/**
 * An AI failure: a structured document AI would only have improved falls back to its local plan (with a note),
 * as it did before AI was recommended for it; anything else fails as before.
 */
function recover(err: unknown, localFallback: unknown, hasLocalPlan: boolean, notes: string[]): { rawPlan: unknown; usedLocalTier: boolean } {
  const cancelled = (err instanceof DOMException && err.name === "AbortError") || (err instanceof AIError && err.kind === "cancelled");
  if (localFallback && !cancelled) {
    if (!isNoProvider(err)) notes.push(`AI analysis failed (${err instanceof Error ? err.message : String(err)}), so the document's own structure was used.`);
    return { rawPlan: localFallback, usedLocalTier: true };
  }
  // The one condition the AI branch can't recover from on its own: nothing is configured at all.
  if (isNoProvider(err)) throw new NoProviderConfiguredError(hasLocalPlan);
  throw err;
}

/** Provider/model/authType are only known once the AI call resolves (or never, for the local tier) — never the caller's job to guess upfront. */
export function provenanceMetadata(operationId: string, provenance: VisualizeResult["provenance"]): ChangeSet["metadata"] {
  const authType = provenance ? AI_PROVIDER_DESCRIPTORS.find((d) => d.id === provenance.providerId)?.accessType : undefined;
  return {
    createdBy: "ai",
    task: "generate_visual_plan",
    operationId,
    ...(provenance ? { provider: provenance.providerId, model: provenance.model } : {}),
    ...(authType ? { authType } : {}),
  };
}

type VisualizeStageArg = Parameters<NonNullable<VisualizeOptions["onProgress"]>>[0];
