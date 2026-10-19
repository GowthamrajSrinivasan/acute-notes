"use client";

/**
 * The content coverage row of the Visualize review (content fidelity plan): one line under the review summary —
 * how much of the source the AI placed itself (the honest number: the safety net always brings what's on the canvas
 * to 100%), whether anything is missing from the canvas, and the key terms (numbers, paths, identifiers) — that
 * opens, in place, to each section's details: the points the safety net added from the source because the AI left
 * them out, and the key terms it missed. "Regenerate" redoes only the sections that fell short
 * (`FIDELITY_CONFIG.regenerate` decides whether and when it is offered), each at most once, and proposes the result
 * in place; it never makes a section worse (Wave A2, `regenerateSections`).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useState } from "react";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { canRegenerate, regeneratedSections, regenerateSections } from "@/ai/fidelity/regenerate";
import { percent, sectionsToRegenerate, type FidelityReport } from "@/ai/fidelity/report";
import { AIRuntime } from "@/ai/runtime";
import { gatherRenderContext } from "@/components/canvas/renderPlanContext";
import { ChevronDownIcon } from "@/components/common/icons";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import type { SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";

const sections = (n: number) => `${n} ${n === 1 ? "section" : "sections"}`;

/**
 * `perSectionOnCanvas`: each section's coverage is shown at the section itself (`SectionChips`, Wave C), so the row
 * keeps only the totals — no per-section list to look back and forth to.
 */
export function CoverageRow({
  api,
  canvasId,
  set,
  perSectionOnCanvas = false,
}: {
  api: ExcalidrawImperativeAPI;
  canvasId: string;
  set: ChangeSet & { fidelity: FidelityReport };
  perSectionOnCanvas?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = set.fidelity;
  const notOnCanvas = Math.max(0, report.units - report.placedByAI - report.addedFromSource);
  const byAI = percent(report.placedByAI, report.units);
  const missingTerms = report.keyTerms.missing.length;
  const done = regeneratedSections(set.operationId);
  const retry = canRegenerate(set.operationId) ? sectionsToRegenerate(report).filter((s) => !done.has(s.key)) : [];
  const { enabled: modelGuidanceEnabled, litePattern, message: modelGuidanceMessage } = FIDELITY_CONFIG.modelGuidance;
  const isLiteModel = modelGuidanceEnabled && !!set.metadata.model && litePattern.test(set.metadata.model);

  const regenerate = async () => {
    setRunning(true);
    setError(null);
    try {
      const scene = api.getSceneElements() as unknown as readonly SceneElement[];
      const result = await regenerateSections(set.operationId, retry.map((s) => s.key), AIRuntime, { operationId: newId("op"), context: gatherRenderContext(api), scene });
      // Proposed in place of this one (unless it was settled or replaced meanwhile).
      if (getPendingChanges().get(canvasId)?.operationId === set.operationId) {
        getPendingChanges().propose(canvasId, result.changeSet);
        // A section kept as it was ("the regenerated one placed less…") is said, never silent.
        if (result.notices.length) api.setToast({ message: result.notices.join(" "), closable: true, duration: 10000 });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Regeneration failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="acute-coverage" aria-label="Content coverage">
      <button
        type="button"
        className="acute-coverage__summary"
        {...(perSectionOnCanvas ? { title: "Each section's details are on its frame" } : { "aria-expanded": open, onClick: () => setOpen((o) => !o) })}
      >
        <span className="acute-coverage__metric" title="Source points (sentences, list items, table rows) the AI placed itself; the rest were added from the source">
          AI placed <strong>{byAI}%</strong>
          {report.addedFromSource > 0 && <span className="acute-review__note"> · +{report.addedFromSource} from source</span>}
        </span>
        <span className="acute-coverage__metric" title="Whether every source point is somewhere on the canvas">
          {notOnCanvas === 0 ? (
            <>Nothing lost ✓</>
          ) : (
            <span className="acute-coverage__missing">
              {notOnCanvas} {notOnCanvas === 1 ? "point" : "points"} not on the canvas
            </span>
          )}
        </span>
        <span className="acute-coverage__metric" title="Numbers, paths and identifiers in the source, and how many the AI kept">
          Key terms <strong>{report.keyTerms.placedByAI}</strong>/{report.keyTerms.total}
          {missingTerms > 0 && <span className="acute-coverage__missing"> · {missingTerms} missed by AI</span>}
        </span>
        {!perSectionOnCanvas && <ChevronDownIcon />}
      </button>
      {retry.length > 0 && (
        <button type="button" className="acute-ask-ai__secondary acute-coverage__regenerate" disabled={running} onClick={() => void regenerate()}>
          {running ? `Regenerating ${sections(retry.length)}…` : `Regenerate ${sections(retry.length)}`}
        </button>
      )}
      {error && <span className="acute-coverage__error" role="alert">{error}</span>}
      {isLiteModel && <span className="acute-review__note acute-coverage__model-note">{modelGuidanceMessage}</span>}
      {open && !perSectionOnCanvas && (
        <ul className="acute-coverage__details" aria-label="Coverage by section">
          {report.sections.map((s) => {
            const listed = s.added.slice(0, FIDELITY_CONFIG.maxListedPerSection);
            return (
              <li key={s.key} className="acute-coverage__section">
                <div className="acute-coverage__section-head">
                  <strong>{s.label}</strong>
                  <span className="acute-review__note">
                    AI placed {s.placedByAI}/{s.units} · key terms {s.keyTerms.placedByAI}/{s.keyTerms.total}
                  </span>
                </div>
                {s.added.length > 0 && (
                  <div>
                    <span className="acute-review__note">Added from the source ({s.added.length}):</span>
                    <ul className="acute-coverage__added">
                      {listed.map((text, i) => (
                        <li key={i}>{text.length > 180 ? `${text.slice(0, 179)}…` : text}</li>
                      ))}
                      {s.added.length > listed.length && <li className="acute-review__note">+{s.added.length - listed.length} more</li>}
                    </ul>
                  </div>
                )}
                {s.keyTerms.missing.length > 0 && (
                  <div className="acute-coverage__terms" aria-label={`Key terms the AI missed in ${s.label}`}>
                    {s.keyTerms.missing.map((t) => (
                      <code key={t}>{t}</code>
                    ))}
                  </div>
                )}
                {s.added.length === 0 && s.keyTerms.missing.length === 0 && <span className="acute-review__note">Everything placed by the AI.</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
