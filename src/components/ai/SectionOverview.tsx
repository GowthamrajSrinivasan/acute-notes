"use client";

/**
 * The overview level of a Visualize result (content fidelity plan, Wave D; semantic zoom): below `OVERVIEW_ZOOM`,
 * each section frame Visualize made shows a card over it — the section's title and one-line takeaway, at a size
 * readable on screen whatever the zoom — so a large result reads as its sections at a glance, and the detail comes
 * back as you zoom in. Nothing on the canvas changes: the cards are an overlay, and let every click through.
 *
 * A card is centred on its frame and at least `--acute-overview-min` wide on screen, overhanging a frame that is
 * narrower than that, so its text never breaks inside a word; long text is cut to a few lines. While cards show,
 * the AI markers (added dots, "Dense" pills, stale dots) are hidden: they would sit on top of the overview.
 *
 * Like the AI markers, the overlay follows pan/zoom with one transform from the renderer's change event (no React
 * render per frame); cards are recomputed at most once per frame, only when the scene changes or the zoom crosses
 * the threshold.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

/** Below this zoom a section's detail is too small to read, so its overview card shows. */
export const OVERVIEW_ZOOM = 0.35;

interface OverviewCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  takeaway?: string;
  /**
   * The widest the card may get, in scene px: its frame plus the free space on its nearer side, twice (the card is
   * centred), up to the next frame beside it — so an overhanging card never covers its neighbour's.
   */
  room: number;
}

type SceneEl = { id: string; type: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; customData?: { acuteOverview?: { title?: unknown; takeaway?: unknown } } };

/** No limit from neighbours: a card alone in its row may grow this wide beside its frame (scene px, each side). */
const OPEN_ROOM = 100_000;
/** Kept clear between an overhanging card and the next frame (scene px). */
const ROOM_MARGIN = 16;

/** The overview cards of the scene's Visualize section frames (frames written with `acuteOverview`). */
export function overviewCards(elements: readonly SceneEl[]): OverviewCard[] {
  const frames = elements.filter((el) => !el.isDeleted && el.type === "frame");
  return frames.flatMap((el) => {
    const o = el.customData?.acuteOverview;
    if (!o || typeof o.title !== "string") return [];
    // Frames beside this one (overlapping it vertically): the nearest on each side bounds how far the card spreads.
    const beside = frames.filter((f) => f.id !== el.id && f.y < el.y + el.height && f.y + f.height > el.y);
    const left = Math.min(OPEN_ROOM, ...beside.filter((f) => f.x + f.width <= el.x).map((f) => el.x - (f.x + f.width)));
    const right = Math.min(OPEN_ROOM, ...beside.filter((f) => f.x >= el.x + el.width).map((f) => f.x - (el.x + el.width)));
    const room = el.width + 2 * Math.max(0, Math.min(left, right) - ROOM_MARGIN);
    return [{ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height, title: o.title, ...(typeof o.takeaway === "string" ? { takeaway: o.takeaway } : {}), room }];
  });
}

export function SectionOverview({ api }: { api: ExcalidrawImperativeAPI }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [zoomedOut, setZoomedOut] = useState(() => api.getAppState().zoom.value < OVERVIEW_ZOOM);
  const [sceneVersion, setSceneVersion] = useState(0);

  useLayoutEffect(() => {
    let frame = 0;
    let lastElements: readonly unknown[] | null = null;
    const place = (s: ReturnType<ExcalidrawImperativeAPI["getAppState"]>) => {
      const layer = layerRef.current;
      if (layer) {
        layer.style.transform = `scale(${s.zoom.value}) translate(${s.scrollX}px, ${s.scrollY}px)`;
        layer.style.setProperty("--acute-overview-zoom", String(s.zoom.value));
      }
      setZoomedOut(s.zoom.value < OVERVIEW_ZOOM);
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

  const cards = useMemo(() => {
    void sceneVersion; // recomputed when the scene changes
    return zoomedOut ? overviewCards(api.getSceneElements() as unknown as readonly SceneEl[]) : [];
  }, [api, zoomedOut, sceneVersion]);

  return (
    <div className="acute-overview" aria-hidden={!cards.length} data-active={cards.length ? "" : undefined}>
      <div ref={layerRef} className="acute-overview__layer">
        {cards.map((c) => (
          <div
            key={c.id}
            className="acute-overview__card"
            style={{
              left: c.x + c.width / 2,
              top: c.y,
              ["--acute-frame-w" as string]: `${c.width}px`,
              ["--acute-frame-h" as string]: `${c.height}px`,
              ["--acute-frame-room" as string]: `${c.room}px`,
            }}
            data-element-id={c.id}
          >
            <div className="acute-overview__text">
              <strong className="acute-overview__title">{c.title}</strong>
              {c.takeaway && <span className="acute-overview__takeaway">{c.takeaway}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
