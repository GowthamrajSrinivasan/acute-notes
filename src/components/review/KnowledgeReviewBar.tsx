"use client";

/**
 * "Review N" (knowledge-notes-plan §5.3, WP2.6; U3, U8): the Needs review items of the canvas's distil cards — a card
 * whose stored review is open, or a passage no card carries that the run flagged — stepped through one by one with Lane
 * H's `ReviewQueue`. Built from what is stored (the cards' `AIMetadata.review`, the source version's passage flags and
 * resolutions, `ai/content/sourceReview.ts`), so an unresolved item stays after Accept and after a reload until the
 * user resolves it; the model check being off changes nothing here (OD5: a flagged card is never treated as verified).
 *
 * Each action is stored: Keep and Use source wording on the card (`resolved`), Edit when the user saves the card
 * (`edited`), Include and Dismiss per source version. Review never blocks anything: the bar shows only while no change
 * set is under review (that bar has the floor then) and only on canvases with distil cards.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { TransactionHistory } from "@/ai/changes/accept";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { loadSourceReview, type SourceReviewRecord } from "@/ai/content/sourceReview";
import type { SourceUnit } from "@/ai/fidelity/contracts";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentHome } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";
import { editCard, includePassage, keepCard, openSourceOn, pinPassage, recordPassage, resolveEdited, type KnowledgeEnv } from "./knowledgeActions";
import { cardTextOf, isEditedSinceAI, type KnowledgeObject } from "./knowledgeObjects";
import { knowledgeUI, useKnowledgeUI } from "./knowledgeStore";
import { buildReviewQueue, type ReviewDecision, type ReviewItem } from "./queue";
import { ReviewQueue } from "./ReviewQueue";
import { useKnowledgeObjects } from "./useKnowledgeObjects";
import "./review.css";

const getDocument = (id: string) => getDocumentStore().get(id);

/** Per source on the canvas: the units of the newest version its cards were made from, and that version's passage record. */
interface SourceInfo {
  sourceId: string;
  version: number;
  units: SourceUnit[];
  review: SourceReviewRecord | null;
}

/** The queue over every source on the canvas, each in document order, sources in the order their cards appear. */
export function canvasQueue(objects: readonly KnowledgeObject[], sources: readonly SourceInfo[], textOf: (id: string) => { title: string; body: string }): { items: ReviewItem[]; sourceOf: Map<string, SourceInfo> } {
  const items: ReviewItem[] = [];
  const sourceOf = new Map<string, SourceInfo>();
  for (const s of sources) {
    const mine = objects.filter((o) => o.sourceId === s.sourceId);
    const cited = new Set(mine.flatMap((o) => o.cites));
    // Passage flags only about passages no card cites now (an included passage has its card).
    const flags = (s.review?.flags ?? []).filter((f) => f.unit !== undefined && !cited.has(f.unit));
    const queue = buildReviewQueue({
      units: s.units,
      cards: mine.map((o) => ({ id: o.objectId, ...textOf(o.objectId), cites: o.cites, ...(o.review ? { review: o.review } : {}) })),
      flags,
      resolvedUnits: s.review?.resolutions ?? {},
    });
    for (const item of queue) {
      items.push(item);
      sourceOf.set(item.key, s);
    }
  }
  return { items, sourceOf };
}

export function KnowledgeReviewBar({ api, home, history }: { api: ExcalidrawImperativeAPI; home: DocumentHome; history: TransactionHistory }) {
  const ui = useKnowledgeUI(home.canvasId);
  const { objects } = useKnowledgeObjects(api, ui.revision);
  const pending = useSyncExternalStore(
    (l) => getPendingChanges().subscribe(l),
    () => getPendingChanges().get(home.canvasId)?.operationId ?? null,
    () => null,
  );

  // Each source's units and passage record, loaded when the set of sources (or a resolution) changes.
  const wanted = useMemo(() => {
    const newest = new Map<string, number>();
    for (const o of objects) newest.set(o.sourceId, Math.max(newest.get(o.sourceId) ?? 0, o.version));
    return [...newest].sort((a, b) => a[0].localeCompare(b[0]));
  }, [objects]);
  const wantedKey = `${wanted.map(([s, v]) => `${s}@${v}`).join(",")}#${ui.revision}`;
  const [sources, setSources] = useState<{ key: string; list: SourceInfo[] }>({ key: "", list: [] });
  useEffect(() => {
    if (!wanted.length) return;
    let live = true;
    const { contentSources, meta } = getPersistence();
    void Promise.all(
      wanted.map(async ([sourceId, version]): Promise<SourceInfo> => {
        const v = await contentSources.getVersion(sourceId, version).catch(() => null);
        const review = await loadSourceReview(meta, sourceId, version).catch(() => null);
        return { sourceId, version, units: v?.units?.units ?? [], review };
      }),
    ).then((list) => live && setSources({ key: wantedKey, list }));
    return () => {
      live = false;
    };
    // `wantedKey` stands for `wanted`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey]);

  // A card the user chose Edit on and has since saved with a change: resolved as "edited" (Edit has no resolution of its own).
  // Checked whenever the canvas changes while such a card is pending (leaving the editor is an app-state change).
  useEffect(() => {
    if (!ui.editing.length) return;
    const check = () => {
      const elements = api.getSceneElements() as unknown as readonly SceneElement[];
      const active = api.getAppState().activeEmbeddable?.element.id;
      for (const id of knowledgeUI.get(home.canvasId).editing) {
        const card = objects.find((o) => o.objectId === id);
        if (card && id !== active && isEditedSinceAI(elements, id, getDocument)) resolveEdited({ api, home, history }, card);
      }
    };
    check();
    return api.onChange(() => check());
  }, [api, home, history, objects, ui.editing]);

  const { items, sourceOf } = useMemo(() => {
    const elements = api.getSceneElements() as unknown as readonly SceneElement[];
    return canvasQueue(objects, sources.list, (id) => cardTextOf(elements, id, getDocument));
  }, [api, objects, sources]);

  // The count "Review N" shows, for the "Added …" notice to carry while it is up (one bottom bar at a time).
  const count = pending ? 0 : items.length;
  useEffect(() => knowledgeUI.setQueue(home.canvasId, count), [home.canvasId, count]);

  if (pending || !items.length || ui.notice) return null;
  const env: KnowledgeEnv = { api, home, history };

  const decide = (d: ReviewDecision) => {
    const s = sourceOf.get(d.key);
    const card = d.card ? objects.find((o) => o.objectId === d.card) : undefined;
    const unit = s?.units.find((u) => u.id === d.units[0]);
    if (d.action === "keep" && card) keepCard(env, card);
    else if (d.action === "edit" && card) editCard(env, card);
    else if (d.action === "use_source_wording" && card && unit) {
      if (!pinPassage(env, card, unit, true)) api.setToast({ message: "This card can't take a quote; use Edit instead.", duration: 4000 });
    } else if (d.action === "include" && s && unit) void includePassage(env, s, unit);
    else if (d.action === "dismiss" && s && unit) void recordPassage(env, s.sourceId, s.version, unit.id, "dismissed");
  };

  const show = (item: ReviewItem) => {
    const s = sourceOf.get(item.key);
    const units = item.units.map((u) => u.id);
    if (item.card) return openSourceOn(env, item.card.id, units);
    // A passage no card carries: the Source tab of the card citing the nearest passage, on this one.
    const order = new Map((s?.units ?? []).map((u, i) => [u.id, i] as const));
    const at = order.get(units[0] ?? "") ?? 0;
    const near = objects
      .filter((o) => o.sourceId === s?.sourceId && o.cites.length)
      .map((o) => ({ o, d: Math.min(...o.cites.map((c) => Math.abs((order.get(c) ?? Infinity) - at))) }))
      .sort((a, b) => a.d - b.d)[0]?.o;
    if (near) openSourceOn(env, near.objectId, units);
  };

  return (
    <div className="acute-kn-reviewbar" data-testid="acute-kn-reviewbar">
      <ReviewQueue key={ui.walk} items={items} onDecide={decide} onShow={show} defaultOpen={ui.walk > 0} />
    </div>
  );
}
