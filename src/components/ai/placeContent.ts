"use client";

/**
 * The app side of "Where should this go?" (intelligent-update-engine-plan Stage 2d): the router's state per workspace,
 * kept between uses so the vector tier and descriptors stay incremental, the routing signals saved in the local meta
 * store, and the dialog's open/close store.
 *
 * The router needs no AI. It routes over the live workspace index when AI mode keeps one current (`liveIndex.ts`),
 * else over an index of its own, synced from the canvas on each use (only changed objects are indexed again).
 */
import { useSyncExternalStore } from "react";
import { DescriptorCache } from "@/ai/router/descriptors";
import { VectorTier } from "@/ai/router/embedding";
import { RoutingSignals } from "@/ai/router/signals";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { freshIndex } from "@/search/liveIndex";
import { WorkspaceIndex } from "@/search/workspaceIndex";

interface RouterState {
  own: WorkspaceIndex;
  tiers: WeakMap<WorkspaceIndex, VectorTier>;
  descriptors: DescriptorCache;
  signals: RoutingSignals;
  loaded: Promise<void>;
}

const states = new Map<string, RouterState>();
const signalsKey = (workspaceId: string) => `router.signals.${workspaceId}`;

function stateFor(workspaceId: string): RouterState {
  let s = states.get(workspaceId);
  if (!s) {
    const created: RouterState = { own: new WorkspaceIndex(workspaceId), tiers: new WeakMap(), descriptors: new DescriptorCache(), signals: new RoutingSignals(), loaded: Promise.resolve() };
    created.loaded = getPersistence()
      .meta.get<unknown>(signalsKey(workspaceId))
      .then((raw) => {
        if (raw) created.signals = RoutingSignals.fromJSON(raw);
      })
      .catch(() => undefined);
    states.set(workspaceId, (s = created));
  }
  return s;
}

/** The vector tier to route a canvas with (see module doc), its descriptor cache and routing signals. */
export async function routerFor(
  workspaceId: string,
  canvasId: string,
  scene: readonly SceneElement[],
  getDocument: (id: string) => DocumentRecord | null | undefined,
): Promise<{ tier: VectorTier; descriptors: DescriptorCache; signals: RoutingSignals }> {
  const s = stateFor(workspaceId);
  await s.loaded;
  let index = freshIndex(workspaceId);
  if (!index) {
    index = s.own;
    index.syncScene(canvasId, scene, getDocument);
  }
  let tier = s.tiers.get(index);
  if (!tier) s.tiers.set(index, (tier = new VectorTier(index)));
  return { tier, descriptors: s.descriptors, signals: s.signals };
}

/** Records the user's choice as a routing signal, and saves the signals. */
export function recordPlacement(workspaceId: string, text: string, targets: readonly string[]): void {
  const s = stateFor(workspaceId);
  s.signals.record(text, targets);
  void getPersistence()
    .meta.set(signalsKey(workspaceId), s.signals.toJSON())
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// The dialog's store (like `visualizeStore`'s).

interface PlaceDialogState {
  open: boolean;
  text: string;
  seq: number;
}

let dialog: PlaceDialogState = { open: false, text: "", seq: 0 };
const listeners = new Set<() => void>();
const emit = (next: PlaceDialogState) => {
  dialog = next;
  for (const l of listeners) l();
};

export const placeDialog = {
  /** Opens "Where should this go?", pre-filled with `text` (an Ask AI answer, a selection) or empty. */
  open(text = "") {
    emit({ open: true, text, seq: dialog.seq + 1 });
  },
  close() {
    emit({ ...dialog, open: false });
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => dialog,
};

export function usePlaceDialog(): PlaceDialogState {
  return useSyncExternalStore(placeDialog.subscribe, placeDialog.get, placeDialog.get);
}
