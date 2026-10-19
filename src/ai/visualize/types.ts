import type { ChangeSet } from "@/ai/changes/changeSet";
import type { ProviderRole } from "@/ai/runtime";
import type { RenderContext } from "@/ai/renderer/render";
import type { ParseMarkdown } from "@/ai/renderer/mapNode";
import type { ContentFormat } from "@/ai/content/types";
import type { VisualTemplate } from "@/ai/visual-plan/types";
import type { AnalysisReport } from "@/ai/fidelity/analysis";
import type { FidelityReport } from "@/ai/fidelity/report";
import type { OutlinedReuse } from "./outlined";

/** PRD §6.7's own three labels — the only stages the UI ever shows. */
export type VisualizeStage = "parsing" | "analyzing" | "planning_layout";

export interface VisualizeProgress {
  stage: VisualizeStage;
  label: string;
}

export interface VisualizeInput {
  text: string;
  format?: ContentFormat;
  /** A user-forced template; omitted lets the local tier or the outline choose. */
  template?: VisualTemplate;
  /** Skip AI entirely and use the local tier's plan even when it isn't `sufficient` — the "offer local-only" recourse from a `NoProviderConfiguredError`. */
  forceLocalOnly?: boolean;
  /** Ask AI even when the local tier judged the content fully explicit ("Analyse with AI" in the review). */
  forceAI?: boolean;
  operationId: string;
  title: string;
  context: RenderContext;
}

export interface VisualizeOptions {
  signal?: AbortSignal;
  onProgress?: (progress: VisualizeProgress) => void;
  /** Passed through to `renderVisualPlan` (F30); overrides its default real, lazy-loaded parser. Tests inject a stub to stay pure and DOM-free. */
  parseMarkdown?: ParseMarkdown;
  /** "Regenerate" (`regenerateSections`): reuse an earlier outlined run, generating only its `retry` sections again. */
  reuse?: OutlinedReuse;
}

export interface VisualizeResult {
  changeSet: ChangeSet;
  usedLocalTier: boolean;
  /** From `validateVisualPlan` — surfaced so the review can note anything dropped or trimmed. */
  warnings: string[];
  /** Where AI fell short and what is shown instead, in words the review shows the user as is (empty when AI did it all). */
  notices: string[];
  /** What AI analysed: all of it, some sections (the rest shown from their own structure), or nothing (also on the change set). */
  analysis: AnalysisReport;
  /** Only when AI actually ran. */
  provenance?: { providerId: string; role: ProviderRole; model: string };
  /** AI runs: how much of the source the AI's plans placed, and what the content safety net added (also on the change set). */
  fidelity?: FidelityReport;
}

/** No provider is configured at all (no primary, no fallback) — recoverable via "Use local structure instead" or AI Settings. */
export class NoProviderConfiguredError extends Error {
  override name = "NoProviderConfiguredError";
  constructor(readonly canUseLocalTier: boolean) {
    super("No AI connection is configured.");
  }
}

/**
 * "Keep as text" (content fidelity D-R2.3): AI's plan of the content is fewer than 3 text cards with no
 * relationship — a diagram would add little. Carries the proposal, so "Visualize anyway" needs no new AI call.
 */
export class ReadsFineAsTextError extends Error {
  override name = "ReadsFineAsTextError";
  constructor(readonly changeSet: ChangeSet) {
    super("This reads fine as text: a diagram of it would add little. Keep it as text, or visualize it anyway.");
  }
}

/** `forceLocalOnly` with nothing the local tier could build a plan from at all (e.g. empty input). */
export class NothingToVisualizeLocallyError extends Error {
  override name = "NothingToVisualizeLocallyError";
  constructor() {
    super("This content has no structure clear enough to visualize without AI.");
  }
}
