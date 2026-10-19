"use client";

/**
 * The "structure only" row of the Visualize review (content fidelity plan, Revision 2, Wave A): says, for as long as
 * the proposal is open, when what's proposed is not AI analysis — the whole result (AI wasn't asked, wasn't
 * configured, or failed) or some of its sections (AI couldn't produce them, so they show their own structure) — and
 * why. It offers to run it again with AI ("Analyse with AI" / "Retry") and proposes the result in place.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useState } from "react";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import type { AnalysisReport } from "@/ai/fidelity/analysis";
import { canRegenerate, canRetryWithAI, regenerateSections, retryWithAI } from "@/ai/fidelity/regenerate";
import { AIRuntime } from "@/ai/runtime";
import type { VisualizeResult } from "@/ai/visualize/types";
import { gatherRenderContext } from "@/components/canvas/renderPlanContext";
import type { SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";

const sections = (n: number) => `${n} ${n === 1 ? "section" : "sections"}`;

/** The row's message for a whole structure-only result. */
function structureMessage(report: AnalysisReport): string {
  switch (report.reason) {
    case "local_only":
      return "Shown from the content's own structure, as chosen. AI didn't analyse it.";
    case "no_provider":
      return "No AI connection is set up, so this is only the content's own structure, not an AI analysis.";
    case "ai_failed":
      return "AI analysis failed, so this is only the content's own structure.";
    default:
      return "Shown from the content's own structure. AI wasn't asked to analyse it.";
  }
}

export function AnalysisRow({ api, canvasId, set }: { api: ExcalidrawImperativeAPI; canvasId: string; set: ChangeSet & { analysis: AnalysisReport } }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = set.analysis;
  const whole = report.mode === "structure";
  const fallbacks = report.fallbacks;
  const shallow = report.shallow ?? [];
  const canRetryWhole = whole && report.reason !== "no_provider" && canRetryWithAI(set.operationId);
  const canRetrySections = !whole && fallbacks.length > 0 && canRegenerate(set.operationId);

  const rerun = async (run: () => Promise<VisualizeResult>) => {
    setRunning(true);
    setError(null);
    try {
      const result = await run();
      // Proposed in place of this one (unless it was settled or replaced meanwhile).
      if (getPendingChanges().get(canvasId)?.operationId === set.operationId) {
        getPendingChanges().propose(canvasId, result.changeSet);
        if (result.notices.length) api.setToast({ message: result.notices.join(" "), closable: true, duration: 10000 });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI analysis failed again.");
    } finally {
      setRunning(false);
    }
  };
  const request = () => ({ operationId: newId("op"), context: gatherRenderContext(api), scene: api.getSceneElements() as unknown as readonly SceneElement[] });

  const causes = [...(report.cause ? [{ label: whole ? "AI" : "Outline", cause: report.cause }] : []), ...fallbacks];
  return (
    <div className="acute-coverage acute-analysis" aria-label="AI analysis">
      <span className="acute-analysis__message">
        <strong className="acute-analysis__badge">{whole ? "Structure only" : fallbacks.length || report.outlineFailed ? "Partly structure only" : "Not analysed"}</strong>{" "}
        {whole
          ? structureMessage(report)
          : fallbacks.length > 0
            ? `AI couldn't analyse ${fallbacks.length === 1 ? "the section" : sections(fallbacks.length) + ":"} ${fallbacks.map((f) => `"${f.label}"`).join(", ")}, so ${fallbacks.length === 1 ? "it shows its" : "they show their"} own structure.`
            : report.outlineFailed
              ? "AI couldn't outline the document, so each part was analysed on its own."
              : ""}
        {!whole && shallow.length > 0 && (
          <>
            {fallbacks.length || report.outlineFailed ? " " : ""}
            AI only restated {shallow.map((l) => `"${l}"`).join(", ")}: no takeaway or analysis of its own, even after a retry.
          </>
        )}
      </span>
      {canRetryWhole && (
        <button
          type="button"
          className="acute-ask-ai__secondary acute-coverage__regenerate"
          disabled={running}
          onClick={() => void rerun(() => retryWithAI(set.operationId, AIRuntime, request()))}
        >
          {running ? "Analysing…" : report.reason === "ai_failed" ? "Retry with AI" : "Analyse with AI"}
        </button>
      )}
      {canRetrySections && (
        <button
          type="button"
          className="acute-ask-ai__secondary acute-coverage__regenerate"
          disabled={running}
          onClick={() => void rerun(() => regenerateSections(set.operationId, fallbacks.map((f) => f.key), AIRuntime, request()))}
        >
          {running ? `Retrying ${sections(fallbacks.length)}…` : `Retry ${sections(fallbacks.length)}`}
        </button>
      )}
      {causes.length > 0 && (
        <details className="acute-analysis__causes">
          <summary className="acute-review__note">Why</summary>
          <ul>
            {causes.map((c, i) => (
              <li key={i}>
                <strong>{c.label}:</strong> <span className="acute-review__note">{c.cause}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <span className="acute-coverage__error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
