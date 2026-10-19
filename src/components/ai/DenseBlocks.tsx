"use client";

/**
 * Dense blocks (F42 "dense content", Phase 1; see `denseBlocksStore`): a small
 * dot on the bottom-left corner of each block an accepted change set added with
 * too much content to read well, one "N dense blocks · Review · Dismiss all"
 * chip for all of them (content fidelity Wave D: one summary, not a pill per
 * block; violet is "dense" only — amber is "stale"), and — once the user asks
 * to review them (the chip, the "Added …" notice's "Review ›", or a dot) — a
 * bar that walks through them one by one: each is selected and zoomed to, with
 * why it is dense. Dismissing one removes its dot; "Dismiss all" removes all. With AI on, "Visualize
 * better" (Phase 4.2) sends only that block to the model and proposes it
 * split into a frame of pieces, for review; for a table or checklist, "Split
 * locally" (Phase 4.4) does it with no model call. Follows pan/zoom like
 * `AIChangeMarkers` (one transform per change event, positions recomputed at
 * most once per frame, only while any badge is shown).
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AIError } from "@/ai/errors";
import { SparkleIcon } from "@/components/common/icons";
import { openAISettings, useAIMode } from "./askAI";
import { denseBlocks, useDenseBlocks } from "./denseBlocksStore";
import { NothingToSplitError } from "@/ai/density/visualizeBetter";
import { BlockUnavailableError, proposeSplitLocally, proposeVisualizeBetter } from "./visualizeBetterAction";
import { errorInfo, type ErrorInfo } from "./VisualizeDialog";
import { prefersReducedMotion } from "@/components/canvas/motion";

/** "Visualize better" for one block: running (cancellable), or failed with what to tell the user. */
type Better = { id: string; running: AbortController } | { id: string; error: ErrorInfo };

/** Its own failures say what happened; an AI failure is told as Visualize tells it. */
function failure(err: unknown): ErrorInfo {
  if (err instanceof NothingToSplitError || err instanceof BlockUnavailableError) return { message: err.message, offerLocal: false, offerSettings: false };
  return errorInfo(err);
}

const isCancel = (err: unknown) => (err instanceof DOMException && err.name === "AbortError") || (err instanceof AIError && err.kind === "cancelled");

export function DenseBlocks({ api, canvasId }: { api: ExcalidrawImperativeAPI; canvasId: string }) {
  const { entries, current } = useDenseBlocks(canvasId);
  const aiOn = useAIMode() === "on";
  const [better, setBetter] = useState<Better | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const active = entries.length > 0;

  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    let lastElements: readonly unknown[] | null = null;
    const place = (s: ReturnType<ExcalidrawImperativeAPI["getAppState"]>) => {
      const layer = layerRef.current;
      if (!layer) return;
      layer.style.transform = `scale(${s.zoom.value}) translate(${s.scrollX}px, ${s.scrollY}px)`;
      layer.style.setProperty("--acute-marker-zoom", String(s.zoom.value));
    };
    place(api.getAppState());
    const off = api.onChange((elements, appState) => {
      place(appState);
      if (elements === lastElements) return;
      lastElements = elements;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          setSceneVersion((v) => v + 1);
        });
    });
    return () => {
      off();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [api, active]);

  // The flagged blocks still on the canvas (an undone one has no badge, and is skipped by the walk-through).
  const shown = useMemo(() => {
    void sceneVersion; // recomputed when the scene changes
    if (!active) return [];
    const byId = new Map(api.getSceneElements().map((el) => [el.id, el] as const));
    return entries.flatMap((e) => {
      const el = byId.get(e.id);
      return el ? [{ ...e, el }] : [];
    });
  }, [api, entries, active, sceneVersion]);

  const index = current === null ? -1 : shown.findIndex((s) => s.id === current);
  const walking = index >= 0 ? shown[index]! : null;

  // Each block the walk-through arrives at is selected and zoomed to, so it can be read (a canvas of sections is
  // usually zoomed far out after Accept).
  const walkingId = walking?.id ?? null;
  useEffect(() => {
    if (!walkingId) return;
    const el = api.getSceneElements().find((e) => e.id === walkingId);
    if (!el) return;
    api.updateScene({ appState: { selectedElementIds: { [el.id]: true }, selectedGroupIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
    api.scrollToContent(el, { fitToViewport: true, viewportZoomFactor: 0.8, animate: !prefersReducedMotion(), duration: 300 });
  }, [api, walkingId]);

  if (!active) return null;
  const go = (i: number) => denseBlocks.show(canvasId, shown[(i + shown.length) % shown.length]!.id);
  // Only the block being shown has a split state; moving on leaves an earlier one's behind.
  const mine = better && walking && better.id === walking.id ? better : null;
  const split = (id: string, run: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    setBetter({ id, running: controller });
    run(controller.signal).then(
      // The proposal is under review now: the review bar takes the walk-through's place (`ChangeSetReview`).
      () => setBetter((b) => (b && "running" in b && b.running === controller ? null : b)),
      (err: unknown) => setBetter((b) => (b && "running" in b && b.running === controller ? (isCancel(err) ? null : { id, error: failure(err) }) : b)),
    );
  };
  return (
    <>
      <div className="acute-ai-markers acute-dense-markers">
        <div ref={layerRef} className="acute-ai-markers__layer">
          {shown.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`acute-dense-marker${s.id === walkingId ? " acute-dense-marker--current" : ""}`}
              style={{ left: s.el.x, top: s.el.y + s.el.height }}
              data-element-id={s.id}
              aria-label={`Dense: ${s.reason} — review`}
              title={`Dense: ${s.reason}. Click to review.`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => denseBlocks.show(canvasId, s.id)}
            />
          ))}
        </div>
      </div>
      {!walking && shown.length > 0 && (
        <div className="acute-dense-summary" role="status" aria-label="Dense blocks summary">
          <span className="acute-dense-summary__dot" aria-hidden="true" />
          <span>
            {shown.length} dense {shown.length === 1 ? "block" : "blocks"}
          </span>
          <button type="button" className="acute-ask-ai__secondary" onClick={() => denseBlocks.show(canvasId, shown[0]!.id)}>
            Review
          </button>
          <button type="button" className="acute-ask-ai__secondary" title="Stop pointing out these blocks" onClick={() => denseBlocks.dismissAll(canvasId)}>
            Dismiss all
          </button>
        </div>
      )}
      {walking && (
        <div className="acute-review" role="status" aria-label="Dense blocks">
          <SparkleIcon />
          <span className="acute-review__summary">
            {mine && "running" in mine ? (
              "Splitting this block…"
            ) : mine && "error" in mine ? (
              mine.error.message
            ) : (
              <>
                Dense block {index + 1} of {shown.length}
                <span className="acute-review__note"> · {walking.reason}.</span>
              </>
            )}
          </span>
          {mine && "running" in mine ? (
            <span className="acute-review__actions">
              <button type="button" className="acute-ask-ai__secondary" onClick={() => mine.running.abort()}>
                Cancel
              </button>
            </span>
          ) : (
            <span className="acute-review__actions">
              {mine && "error" in mine && mine.error.offerSettings && (
                <button type="button" className="acute-ask-ai__secondary" onClick={openAISettings}>
                  AI Settings
                </button>
              )}
              {walking.cause !== "long_text" && (
                <button
                  type="button"
                  className="acute-ask-ai__secondary"
                  title="Splits this block's rows (or long items) into cards, with no AI, and proposes it for you to review"
                  onClick={() => split(walking.id, () => proposeSplitLocally(api, canvasId, walking.id))}
                >
                  Split locally
                </button>
              )}
              {aiOn && (
                <button
                  type="button"
                  className="acute-ask-ai__secondary"
                  title="Sends only this block's content to your AI connection, and proposes it split into smaller pieces for you to review"
                  onClick={() => split(walking.id, (signal) => proposeVisualizeBetter(api, canvasId, walking.id, walking.reason, signal))}
                >
                  Visualize better
                </button>
              )}
              {shown.length > 1 && (
                <>
                  <button type="button" className="acute-ask-ai__secondary" aria-label="Previous dense block" onClick={() => go(index - 1)}>
                    ‹
                  </button>
                  <button type="button" className="acute-ask-ai__secondary" onClick={() => go(index + 1)}>
                    Next ›
                  </button>
                </>
              )}
              <button type="button" className="acute-ask-ai__secondary" title="Remove this block's dot" onClick={() => denseBlocks.dismiss(canvasId, walking.id)}>
                Dismiss
              </button>
              {shown.length > 1 && (
                <button type="button" className="acute-ask-ai__secondary" title="Stop pointing out all of them" onClick={() => denseBlocks.dismissAll(canvasId)}>
                  Dismiss all
                </button>
              )}
              <button type="button" className="acute-ask-ai__primary" onClick={() => denseBlocks.show(canvasId, null)}>
                Done
              </button>
            </span>
          )}
        </div>
      )}
    </>
  );
}
