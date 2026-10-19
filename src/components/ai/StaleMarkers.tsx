"use client";

/**
 * The quiet "stale" marker (F43): a small amber dot on the top-left corner of
 * each repo-map card that cites a path the IDE agent reported as changed
 * (see `staleMarkersStore`). Clicking it dismisses it; re-sending the section
 * clears it. Follows pan/zoom like `AIChangeMarkers` (one transform per
 * change event, positions recomputed at most once per frame, only while any
 * marker is shown).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { staleMarkers, useStaleMarkers } from "./staleMarkersStore";

export function StaleMarkers({ api, canvasId }: { api: ExcalidrawImperativeAPI; canvasId: string }) {
  const ids = useStaleMarkers(canvasId);
  const layerRef = useRef<HTMLDivElement>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const active = ids.size > 0;

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

  const dots = useMemo(() => {
    void sceneVersion; // recomputed when the scene changes
    if (!active) return [];
    return api.getSceneElements().flatMap((el) => (ids.has(el.id) ? [{ id: el.id, x: el.x, y: el.y }] : []));
  }, [api, ids, active, sceneVersion]);

  if (!active) return null;
  return (
    <div className="acute-ai-markers acute-stale-markers">
      <div ref={layerRef} className="acute-ai-markers__layer">
        {dots.map((d) => (
          <button
            key={d.id}
            type="button"
            className="acute-stale-marker"
            style={{ left: d.x, top: d.y }}
            data-element-id={d.id}
            aria-label="Stale: the code this card describes changed — dismiss"
            title="Stale · the code this card describes changed since it was mapped · click to dismiss"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => staleMarkers.clear(canvasId, [d.id])}
          />
        ))}
      </div>
    </div>
  );
}
