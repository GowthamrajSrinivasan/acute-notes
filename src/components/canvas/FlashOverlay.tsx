"use client";

/**
 * A pulsing ring around an element just flashed (`flashStore`), e.g. Acute Lens's "Back to canvas". Follows
 * pan/zoom with one transform from the renderer's change event, like `AIChangeMarkers` and `DiagramOverlay`.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFlashed } from "./flashStore";

export function FlashOverlay({ api }: { api: ExcalidrawImperativeAPI }) {
  const flashed = useFlashed();
  const layerRef = useRef<HTMLDivElement>(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const active = flashed.length > 0;

  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    let lastElements: readonly unknown[] | null = null;
    const place = (s: ReturnType<ExcalidrawImperativeAPI["getAppState"]>) => {
      const layer = layerRef.current;
      if (!layer) return;
      layer.style.transform = `scale(${s.zoom.value}) translate(${s.scrollX}px, ${s.scrollY}px)`;
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

  const rings = useMemo(() => {
    void sceneVersion; // recomputed when the scene changes
    if (!active) return [];
    const byId = new Map(api.getSceneElements().map((el) => [el.id, el]));
    return flashed.flatMap(({ id, token }) => {
      const el = byId.get(id);
      return el ? [{ token, x: el.x, y: el.y, width: el.width, height: el.height }] : [];
    });
  }, [api, flashed, active, sceneVersion]);

  if (!active) return null;
  return (
    <div className="acute-flash">
      <div ref={layerRef} className="acute-flash__layer">
        {rings.map((r) => (
          <div key={r.token} className="acute-flash__ring" style={{ left: r.x - 6, top: r.y - 6, width: r.width + 12, height: r.height + 12 }} />
        ))}
      </div>
    </div>
  );
}
