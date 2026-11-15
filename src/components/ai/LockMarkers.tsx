"use client";

/**
 * A small lock on every locked card and section frame (intelligent-update-engine-plan Stage 1e), at its top-left
 * corner: what "Update from new content" leaves alone. Read from the elements themselves (`domain/canvas/lock.ts`), so
 * locking or unlocking shows at once. Like the AI change markers, the layer follows pan/zoom through one transform and
 * positions are recomputed at most once per frame; the icon keeps its on-screen size at every zoom.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { isLocked } from "@/domain/canvas/lock";

export function LockMarkers({ api }: { api: ExcalidrawImperativeAPI }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [sceneVersion, setSceneVersion] = useState(0);

  useLayoutEffect(() => {
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
  }, [api]);

  const locks = useMemo(() => {
    void sceneVersion; // recomputed when the scene changes
    return api.getSceneElements().flatMap((el) => (isLocked(el as never) ? [{ id: el.id, x: el.x, y: el.y, frame: el.type === "frame" }] : []));
  }, [api, sceneVersion]);

  return (
    <div className="acute-lock-markers" hidden={!locks.length}>
      <div ref={layerRef} className="acute-ai-markers__layer">
        {locks.map((l) => (
          <span
            key={l.id}
            className="acute-lock-marker"
            style={{ left: l.x, top: l.y }}
            data-element-id={l.id}
            role="img"
            aria-label={l.frame ? "Locked section: updates leave it alone" : "Locked: updates leave this card alone"}
            title={l.frame ? "Locked section · updates leave it alone" : "Locked · updates leave this card alone"}
          >
            🔒
          </span>
        ))}
      </div>
    </div>
  );
}
