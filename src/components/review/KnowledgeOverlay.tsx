"use client";

/**
 * Knowledge Notes on the canvas (knowledge-notes-plan §4.2, §5.1; WP2.2, WP2.4): each distil card's source chip ("3
 * sources", amber while it needs review, grey when its source isn't on this device) on its bottom-right corner, and the
 * outline of the cards citing the passage selected in the Source tab (two-way highlighting).
 *
 * The indicator budget (one marker per object): a card with a dense or stale marker shows that marker, not its chip;
 * a card with a chip shows no "added" dot (`AIChangeMarkers` reads `knowledgeUI.chips`). Only distil objects get a chip,
 * so a preserve canvas looks exactly as before. Follows pan/zoom like the other markers (one transform per change event,
 * positions recomputed at most once per frame); chips keep their on-screen size.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DocumentHome } from "@/domain/types";
import type { TransactionHistory } from "@/ai/changes/accept";
import { getPersistence } from "@/persistence";
import { loadLatest } from "@/ai/content/sources";
import { useDenseBlocks } from "@/components/ai/denseBlocksStore";
import { useStaleMarkers } from "@/components/ai/staleMarkersStore";
import { useKnowledgeObjects } from "./useKnowledgeObjects";
import { knowledgeUI, useKnowledgeUI } from "./knowledgeStore";
import { openSourceOn } from "./knowledgeActions";
import { SourceChip } from "./SourceChip";
import "./review.css";

export function KnowledgeOverlay({ api, home, history }: { api: ExcalidrawImperativeAPI; home: DocumentHome; history: TransactionHistory }) {
  const canvasId = home.canvasId;
  const ui = useKnowledgeUI(canvasId);
  const dense = useDenseBlocks(canvasId).entries;
  const stale = useStaleMarkers(canvasId);
  const layerRef = useRef<HTMLDivElement>(null);
  const { objects, sceneVersion } = useKnowledgeObjects(api, ui.revision);

  // Whether each source is stored on this device (an import without sources: chips stay, in grey).
  const [available, setAvailable] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const sourceIds = useMemo(() => [...new Set(objects.map((o) => o.sourceId))].sort().join(","), [objects]);
  useEffect(() => {
    if (!sourceIds) return;
    let live = true;
    const repo = getPersistence().contentSources;
    // `loadLatest` waits for a version still being recorded (an Accept a moment ago), so a new source isn't read as missing.
    void Promise.all(sourceIds.split(",").map(async (id) => [id, !!(await loadLatest(repo, id).catch(() => null))] as const)).then((pairs) => live && setAvailable(new Map(pairs)));
    return () => {
      live = false;
    };
  }, [sourceIds, ui.revision]);

  const quieter = useMemo(() => new Set([...dense.map((e) => e.id), ...stale]), [dense, stale]);
  // A card citing nothing gets a chip only while it needs review ("No source", amber; `sourceChipView`).
  const chips = useMemo(() => objects.filter((o) => (o.cites.length || (o.review?.reasons.length && !o.review.resolved)) && !quieter.has(o.objectId)), [objects, quieter]);
  useEffect(() => knowledgeUI.setChips(canvasId, chips.map((c) => c.objectId)), [canvasId, chips]);
  const outlined = useMemo(() => {
    void sceneVersion;
    const ids = new Set(ui.outlined);
    return ids.size ? api.getSceneElements().flatMap((el) => (ids.has(el.id) ? [{ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height }] : [])) : [];
  }, [api, ui.outlined, sceneVersion]);
  const active = chips.length > 0 || outlined.length > 0;

  useLayoutEffect(() => {
    if (!active) return;
    const place = (s: ReturnType<ExcalidrawImperativeAPI["getAppState"]>) => {
      const layer = layerRef.current;
      if (!layer) return;
      layer.style.transform = `scale(${s.zoom.value}) translate(${s.scrollX}px, ${s.scrollY}px)`;
      layer.style.setProperty("--acute-marker-zoom", String(s.zoom.value));
    };
    place(api.getAppState());
    return api.onChange((_elements, appState) => place(appState));
  }, [api, active]);

  if (!active) return null;
  const env = { api, home, history };
  return (
    <div className="acute-ai-markers acute-kn-overlay">
      <div ref={layerRef} className="acute-ai-markers__layer">
        {outlined.map((b) => (
          <div key={`o:${b.id}`} className="acute-kn-outline" data-element-id={b.id} style={{ left: b.x, top: b.y, width: b.width, height: b.height }} aria-hidden="true" />
        ))}
        {chips.map((o) => (
          <div key={o.objectId} className="acute-kn-chip-slot" data-element-id={o.objectId} style={{ left: o.box.x + o.box.width, top: o.box.y + o.box.height }}>
            <SourceChip cites={o.cites} {...(o.review ? { review: o.review } : {})} available={available.get(o.sourceId) ?? true} onOpen={(units) => openSourceOn(env, o.objectId, units, { scroll: false })} />
          </div>
        ))}
      </div>
    </div>
  );
}
