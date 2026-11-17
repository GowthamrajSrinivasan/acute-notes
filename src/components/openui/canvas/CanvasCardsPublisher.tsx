"use client";

/**
 * Feeds the canvas's "Cards" view (`canvasCardsStore.ts`): while the header's View is "Cards", the canvas's source-citing
 * AI cards (distil cards from Visualize and pinned notes, `knowledgeObjectsOf`) with their citations, open review and cited
 * passages. Renders nothing. Mounted only when `isOpenUiCanvasEnabled()`; reads the canvas and the stored source versions,
 * writes nothing.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useState } from "react";
import type { TransactionHistory } from "@/ai/changes/accept";
import { openSourceOn } from "@/components/review/knowledgeActions";
import { useKnowledgeUI } from "@/components/review/knowledgeStore";
import { useKnowledgeObjects } from "@/components/review/useKnowledgeObjects";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentHome } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";
import { useUiPref } from "@/state/uiPrefs";
import { buildNotes } from "../notes/notesModel";
import { canvasCards, type CanvasCardInfo, type CanvasCardsHost } from "./canvasCardsStore";

interface Env {
  api: ExcalidrawImperativeAPI;
  home: DocumentHome;
  history: TransactionHistory;
}

export function CanvasCardsPublisher(env: Env) {
  const display = useUiPref("blockDisplay");
  return display === "cards" ? <Publisher {...env} /> : null;
}

const sourceKey = (s: { sourceId: string; version: number }) => `${s.sourceId}@${s.version}`;
const getDocument = (id: string) => getDocumentStore().get(id);

function Publisher({ api, home, history }: Env) {
  const ui = useKnowledgeUI(home.canvasId);
  const { objects, sceneVersion } = useKnowledgeObjects(api, ui.revision);
  // The same notes the Notes view reads (`buildNotes`: citations, open review, source version as plain data), kept to
  // the cards that cite a source. A section title, a manual card or a shape keeps its usual look.
  const cited = useMemo(() => {
    void sceneVersion;
    return buildNotes(api.getSceneElements() as unknown as readonly SceneElement[], getDocument, objects).flatMap((s) =>
      s.notes.flatMap((n) => (n.source && n.cites.length ? [{ objectId: n.id, cites: n.cites, needsReview: n.needsReview, ...n.source }] : [])),
    );
  }, [api, objects, sceneVersion]);

  // Each cited source version's unit texts, for the chips' expandable passages.
  const wanted = useMemo(() => [...new Set(cited.map(sourceKey))].sort().join(","), [cited]);
  const [units, setUnits] = useState<Map<string, Map<string, string>>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const keys = wanted ? wanted.split(",") : [];
    void Promise.all(
      keys.map(async (k) => {
        const at = k.lastIndexOf("@");
        const version = await getPersistence().contentSources.getVersion(k.slice(0, at), Number(k.slice(at + 1)));
        return [k, new Map((version?.units?.units ?? []).map((u) => [u.id, u.text] as const))] as const;
      }),
    )
      .then((entries) => !cancelled && setUnits(new Map(entries)))
      .catch((err: unknown) => console.error("[acute-notes] Couldn't load the cited passages", err));
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  const host = useMemo<CanvasCardsHost>(
    () => ({
      // The chip's card is in view (it was just clicked): select it without moving the camera.
      openSource: (objectId, us) => openSourceOn({ api, home, history }, objectId, us, { scroll: false }),
    }),
    [api, home, history],
  );

  useEffect(() => {
    const next = new Map<string, CanvasCardInfo>();
    for (const o of cited) {
      const texts = units.get(sourceKey(o));
      const passages = new Map(o.cites.flatMap((u) => (texts?.has(u) ? [[u, texts.get(u)!] as const] : [])));
      next.set(o.objectId, { cites: o.cites, ...(o.needsReview ? { needsReview: o.needsReview } : {}), passages });
    }
    canvasCards.publish(next, host);
  }, [cited, units, host]);

  useEffect(() => () => canvasCards.clear(), []);
  return null;
}
