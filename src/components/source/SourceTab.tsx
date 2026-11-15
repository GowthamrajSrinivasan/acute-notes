"use client";

/**
 * The "Source" tab beside Properties (knowledge-notes-plan §5.1, OD1; WP2.1–2.3, 2.7): for one selected distil card,
 * Lane D's `SourcePanel` fed from storage — the version the card was made from (`getVersion` by its
 * `contentSourceVersion`), "Source updated since this card" with View latest, "Source not on this device" when the
 * source isn't stored here — with the card's passages highlighted, and the passage actions: selecting a passage
 * outlines the cards citing it (the camera follows, a jump with reduced motion), Add to canvas / Pin quote / Include
 * through the local tier (no AI call).
 *
 * Shown only when the selection is one object made under the distil note model; a preserve canvas's panel is exactly
 * as before. While Source is active, the panel's own sections are hidden (`acute-kn-panel--source`).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { TransactionHistory } from "@/ai/changes/accept";
import type { SourcePanelState, UnitId } from "@/ai/fidelity/contracts";
import { usePanelSlot } from "@/components/properties/panelSlot";
import { useSelection } from "@/components/properties/selectedBlockStore";
import { prefersReducedMotion } from "@/components/canvas/motion";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentHome } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";
import { addPassageCard, includePassage, objectsNow, outlineCiting, pinPassage } from "@/components/review/knowledgeActions";
import { knowledgeObjectOf } from "@/components/review/knowledgeObjects";
import { knowledgeUI, useKnowledgeUI } from "@/components/review/knowledgeStore";
import { SourcePanel } from "./SourcePanel";
import { loadSourcePanel } from "./sourceData";

const getDocument = (id: string) => getDocumentStore().get(id);
const SOURCE_CLASS = "acute-kn-panel--source";

export function SourceTab({ api, home, history }: { api: ExcalidrawImperativeAPI; home: DocumentHome; history: TransactionHistory }) {
  const selection = useSelection();
  const ui = useKnowledgeUI(home.canvasId);
  const ids = Object.keys(selection);
  const single = ids.length === 1 ? ids[0]! : null;
  const object = useMemo(() => {
    void ui.revision;
    return single ? knowledgeObjectOf(api.getSceneElements() as unknown as readonly SceneElement[], single, getDocument) : null;
  }, [api, single, ui.revision]);
  if (!object) return null;
  return <SourceTabFor key={object.objectId} api={api} home={home} history={history} objectId={object.objectId} />;
}

function SourceTabFor({ api, home, history, objectId }: { api: ExcalidrawImperativeAPI; home: DocumentHome; history: TransactionHistory; objectId: string }) {
  const ui = useKnowledgeUI(home.canvasId);
  const showSource = ui.tab === "source";
  const onSync = useCallback((panel: Element) => panel.classList.toggle(SOURCE_CLASS, knowledgeUI.get(home.canvasId).tab === "source"), [home.canvasId]);
  const slot = usePanelSlot("acute-kn-source-slot", onSync);
  // The panel's own sections show again when the tab closes or this card is no longer selected.
  useEffect(() => {
    const panel = slot.parentElement;
    panel?.classList.toggle(SOURCE_CLASS, showSource);
    return () => panel?.classList.remove(SOURCE_CLASS);
  }, [slot, showSource]);

  const object = useMemo(() => {
    void ui.revision;
    return knowledgeObjectOf(api.getSceneElements() as unknown as readonly SceneElement[], objectId, getDocument);
  }, [api, objectId, ui.revision]);
  const [viewLatest, setViewLatest] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; state: SourcePanelState } | null>(null);
  const version = object ? (viewLatest ? null : object.version) : null;
  const key = object ? `${object.sourceId}@${version ?? "latest"}#${ui.revision}` : "";

  useEffect(() => {
    if (!showSource || !object) return;
    let live = true;
    const { contentSources, meta } = getPersistence();
    const onCanvas = objectsNow(api)
      .filter((o) => o.sourceId === object.sourceId)
      .flatMap((o) => o.cites);
    void (async () => {
      const v = version ?? (await contentSources.get(object.sourceId).catch(() => null))?.latestVersion ?? object.version;
      const result = await loadSourcePanel(contentSources, meta, object.sourceId, v, onCanvas);
      if (live) setLoaded({ key, state: result.state });
    })();
    return () => {
      live = false;
    };
  }, [api, key, showSource, object, version]);

  if (!object) return null;
  const state: SourcePanelState = loaded?.key === key ? loaded.state : { kind: "loading" };
  const focus = ui.focus?.objectId === object.objectId ? ui.focus.units : object.cites;
  const env = { api, home, history };
  const data = state.kind === "ready" ? state.data : null;
  const unitOf = (id: UnitId) => data?.units.find((u) => u.id === id);
  const sourceOf = () => (data ? { sourceId: data.sourceId, version: data.version, units: data.units } : null);

  return createPortal(
    <div className="acute-kn-source" data-testid="acute-source-tab">
      <div className="acute-kn-tabs" role="tablist" aria-label="Side panel">
        <button type="button" role="tab" aria-selected={!showSource} onClick={() => knowledgeUI.showProperties(home.canvasId)}>
          Properties
        </button>
        <button type="button" role="tab" aria-selected={showSource} onClick={() => knowledgeUI.openSource(home.canvasId, ui.focus)}>
          Source
        </button>
      </div>
      {showSource && (
        <SourcePanel
          state={state}
          selection={{ units: focus }}
          reducedMotion={prefersReducedMotion()}
          onSelectPassage={(units) => {
            if (data) outlineCiting(env, data.sourceId, units);
          }}
          onAddToCanvas={(unit) => {
            const s = sourceOf();
            const u = unitOf(unit);
            if (s && u) void addPassageCard(env, s, u);
          }}
          onPinQuote={
            object.shape === "block"
              ? (unit) => {
                  const u = unitOf(unit);
                  if (u && !pinPassage(env, object, u)) api.setToast({ message: "Couldn't pin the passage on this card.", duration: 3000 });
                }
              : undefined
          }
          onInclude={(unit) => {
            const s = sourceOf();
            const u = unitOf(unit);
            if (s && u) void includePassage(env, s, u);
          }}
          {...(data && data.latestVersion > data.version ? { onViewLatest: () => setViewLatest(true) } : {})}
        />
      )}
    </div>,
    slot,
  );
}
