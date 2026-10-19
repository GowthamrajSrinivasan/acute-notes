/**
 * What AI actually analysed in a Visualize result (content fidelity plan, Revision 2, Wave A): whether the result is
 * AI analysis or only the content's own structure, why, and which sections fell back to their own structure. Carried
 * on the change set so the review says it for as long as the proposal is open — not only in a toast — and can offer
 * a retry. Nothing here changes what is generated.
 */
import { z } from "zod";
import { AIError } from "@/ai/errors";

/** Why a whole result is structure only. */
export const STRUCTURE_ONLY_REASONS = [
  /** The local tier judged the content fully explicit (checklists, code, a diagram), so AI wasn't asked. */
  "structured",
  /** The user chose "Use local structure". */
  "local_only",
  /** No AI connection is configured. */
  "no_provider",
  /** AI was asked and failed; the local plan is shown instead. */
  "ai_failed",
] as const;
export type StructureOnlyReason = (typeof STRUCTURE_ONLY_REASONS)[number];

/** A section AI couldn't analyse (after the runtime's repair retry), shown from its own structure. */
export interface SectionFallback {
  key: string;
  label: string;
  /** The failure, short: the AI error's kind and message. */
  cause: string;
}

export interface AnalysisReport {
  /** "ai": AI analysed the content (some sections may still have fallen back); "structure": AI analysed nothing. */
  mode: "ai" | "structure";
  /** Only for "structure". */
  reason?: StructureOnlyReason;
  /** The AI failure behind "ai_failed", or behind a failed outline. */
  cause?: string;
  /** The outline call failed, so each part was analysed as a section of its own. */
  outlineFailed?: true;
  fallbacks: SectionFallback[];
  /** Labels of sections AI only restated: no takeaway or no analysis of its own, even after a retry (Wave B). */
  shallow?: string[];
}

const cause = z.string().max(500);

export const analysisReportSchema = z.object({
  mode: z.enum(["ai", "structure"]),
  reason: z.enum(STRUCTURE_ONLY_REASONS).optional(),
  cause: cause.optional(),
  outlineFailed: z.literal(true).optional(),
  fallbacks: z.array(z.object({ key: z.string().min(1).max(2_000), label: z.string().max(300), cause })).max(200),
  shallow: z.array(z.string().max(300)).max(200).optional(),
});

const CAUSE_MAX = 200;

/** A failure as a short cause for the review and the log: `invalid_output: …` for an AI error, else its message. */
export function failureCause(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const text = err instanceof AIError ? `${err.kind}: ${message}` : message;
  return text.length > CAUSE_MAX ? `${text.slice(0, CAUSE_MAX - 1)}…` : text;
}

/** True when the review should say something: the result isn't (all) AI analysis. */
export function needsAnalysisNotice(report: AnalysisReport | undefined): report is AnalysisReport {
  return !!report && (report.mode === "structure" || report.fallbacks.length > 0 || !!report.outlineFailed || !!report.shallow?.length);
}
