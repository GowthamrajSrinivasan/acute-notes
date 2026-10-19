"use client";

/**
 * Points out what an accepted AI change set added (see `aiMarkersStore`): a
 * pulsing green dot on the top-right corner of each added object — blocks,
 * shapes, pages and section frames; connectors are left out. Clicking a dot
 * dismisses it; the `aiChangeMarkers` preference decides whether dots clear
 * on their own after a few seconds, stay until clicked, or never appear.
 *
 * Like the review ghosts, the overlay follows pan/zoom by updating one
 * transform from the renderer's change event (no React render per frame);
 * dot positions are recomputed at most once per frame, only while any dot is
 * shown. Dots keep their on-screen size at every zoom.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { aiMarkers, useAIMarkers } from "./aiMarkersStore";
import { useDenseBlocks } from "./denseBlocksStore";
import { useStaleMarkers } from "./staleMarkersStore";

export function AIChangeMarkers({ api, canvasId }: { api: ExcalidrawImperativeAPI; canvasId: string }) {
  const ids = useAIMarkers(canvasId);
  // One AI marker per object (content fidelity Wave D): an object that is dense or stale shows that marker, which
  // asks something of the user; its "added" dot, only news, gives way.
  const dense = useDenseBlocks(canvasId).entries;
  const stale = useStaleMarkers(canvasId);
  const quieter = useMemo(() => new Set([...dense.map((e) => e.id), ...stale]), [dense, stale]);
  const layerRef = useRef<HTMLDivElement>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const active = ids.size > 0;

  // A layout effect: the layer is transformed before the dots are first painted.
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
    // Deleted (e.g. undone) objects show no dot; a redo brings theirs back while it lasts.
    return api.getSceneElements().flatMap((el) => (ids.has(el.id) && el.type !== "arrow" && !quieter.has(el.id) ? [{ id: el.id, x: el.x + el.width, y: el.y }] : []));
  }, [api, ids, active, sceneVersion, quieter]);

  if (!active) return null;
  return (
    <div className="acute-ai-markers">
      <div ref={layerRef} className="acute-ai-markers__layer">
        {dots.map((d) => (
          <button
            key={d.id}
            type="button"
            className="acute-ai-marker"
            style={{ left: d.x, top: d.y }}
            data-element-id={d.id}
            aria-label="Added by AI — dismiss this marker"
            title="Added by AI · click to dismiss"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => aiMarkers.dismiss(canvasId, [d.id])}
          />
        ))}
      </div>
    </div>
  );
}
