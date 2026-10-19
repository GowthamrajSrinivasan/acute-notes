"use client";

/**
 * Review reasons on the canvas (content fidelity plan, Wave C): while a Visualize proposal is under review, each
 * section frame carries a chip at its top edge — whether AI analysed it, how much of its source the AI placed, what
 * was added from the source — with the one action that fits (Retry a section that fell back, Regenerate one that
 * fell short). The reason sits next to what it is about; the review bar keeps the totals and Accept / Reject.
 * (`sectionReviews` decides what each chip says.)
 *
 * Follows pan/zoom like the AI markers (one transform per change event); chips keep their on-screen size.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { canRegenerate, regeneratedSections, regenerateSections } from "@/ai/fidelity/regenerate";
import { sectionReviews } from "@/ai/fidelity/sectionReview";
import { AIRuntime } from "@/ai/runtime";
import { gatherRenderContext } from "@/components/canvas/renderPlanContext";
import type { SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";

export function SectionChips({ api, canvasId, set }: { api: ExcalidrawImperativeAPI; canvasId: string; set: ChangeSet }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const reviews = useMemo(
    () => sectionReviews(set, { canRegenerate: canRegenerate(set.operationId), regenerated: regeneratedSections(set.operationId) }),
    [set],
  );

  useLayoutEffect(() => {
    if (!reviews.length) return;
    const place = (s: ReturnType<ExcalidrawImperativeAPI["getAppState"]>) => {
      const layer = layerRef.current;
      if (!layer) return;
      layer.style.transform = `scale(${s.zoom.value}) translate(${s.scrollX}px, ${s.scrollY}px)`;
      layer.style.setProperty("--acute-marker-zoom", String(s.zoom.value));
    };
    place(api.getAppState());
    return api.onChange((_elements, appState) => place(appState));
  }, [api, reviews.length]);

  if (!reviews.length) return null;

  const act = async (key: string) => {
    setRunning(key);
    setError(null);
    try {
      const scene = api.getSceneElements() as unknown as readonly SceneElement[];
      const result = await regenerateSections(set.operationId, [key], AIRuntime, { operationId: newId("op"), context: gatherRenderContext(api), scene });
      // Proposed in place of this one (unless it was settled or replaced meanwhile); a kept section is said.
      if (getPendingChanges().get(canvasId)?.operationId === set.operationId) {
        getPendingChanges().propose(canvasId, result.changeSet);
        if (result.notices.length) api.setToast({ message: result.notices.join(" "), closable: true, duration: 10000 });
      }
    } catch (err) {
      setError({ key, message: err instanceof Error ? err.message : "It failed again." });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="acute-ai-markers acute-section-chips">
      <div ref={layerRef} className="acute-ai-markers__layer">
        {reviews.map((r) => (
          <div
            key={r.frameKey}
            className={`acute-section-chip acute-section-chip--${r.tone}`}
            style={{ left: r.box.x + r.box.width, top: r.box.y, ["--acute-frame-w" as string]: `${r.box.width}px` }}
            role="note"
            aria-label={`Section ${r.label}: ${r.text}`}
            title={[r.text, ...r.detail].join("\n")}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="acute-section-chip__text">{r.text}</span>
            {r.action && (
              <button type="button" className="acute-section-chip__action" disabled={running !== null} onClick={() => void act(r.action!.key)}>
                {running === r.action.key ? (r.action.label === "Retry" ? "Retrying…" : "Regenerating…") : r.action.label}
              </button>
            )}
            {error?.key === r.action?.key && error && (
              <span className="acute-section-chip__error" role="alert">
                {error.message}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
