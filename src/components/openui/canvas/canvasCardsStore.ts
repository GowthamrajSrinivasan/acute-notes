"use client";

/**
 * What the canvas's "Cards" view knows about each source-citing AI card (`.ai/docs/openui/openui-canvas-rendering-plan-2026-11-16.md`
 * step 4), as plain data keyed by element id: its citations, an open review's reason and the cited passages' text.
 *
 * Filled by `CanvasCardsPublisher` (which reads the distil link through `useKnowledgeObjects`, an allowed reader), read by
 * `RichBlockHost` through `useCanvasCard`. `components/blocks/**` therefore never reads object metadata or a
 * reconciliation field: it gets this data, or nothing (a manual card, or the Cards view off).
 *
 * One canvas is open at a time, so the store is module state; the publisher empties it when it unmounts.
 */
import { useSyncExternalStore } from "react";
import type { NoteMode } from "@/domain/types";

export interface CanvasCardInfo {
  cites: readonly string[];
  /** The first reason of an open review. */
  needsReview?: string;
  /** The cited units' passages, once loaded (expandable citation chips). */
  passages: ReadonlyMap<string, string>;
}

/** What a card's buttons can ask of the canvas. */
export interface CanvasCardsHost {
  /** Selects the card and opens the Source tab on these units (`openSourceOn`). */
  openSource(objectId: string, units: readonly string[]): void;
}

export interface CanvasCard {
  info: CanvasCardInfo;
  host: CanvasCardsHost;
}

let cards = new Map<string, CanvasCard>();
let host: CanvasCardsHost | null = null;
/** The open canvas's note-taking mode (note-taking-modes plan): on an AI-managed canvas every text block is a card. */
let noteMode: NoteMode = "manual";
/** The open canvas (where a card's "Ask AI" proposal goes for review); null while no canvas publishes. */
let canvasId: string | null = null;
const listeners = new Set<() => void>();

/** For a card with no published data (no citations): its chips have nothing to open. */
export const NO_CARDS_HOST: CanvasCardsHost = { openSource: () => undefined };
export const NO_CARD_INFO: CanvasCardInfo = { cites: [], passages: new Map() };

const signature = (i: CanvasCardInfo) => JSON.stringify([i.cites, i.needsReview ?? null, [...i.passages]]);

export const canvasCards = {
  /** Replaces what is known. A card whose data didn't change keeps its object, so its host doesn't re-render. */
  publish(next: ReadonlyMap<string, CanvasCardInfo>, nextHost: CanvasCardsHost): void {
    const hostChanged = nextHost !== host;
    host = nextHost;
    let changed = hostChanged || next.size !== cards.size;
    const out = new Map<string, CanvasCard>();
    for (const [id, info] of next) {
      const prev = cards.get(id);
      if (prev && !hostChanged && signature(prev.info) === signature(info)) out.set(id, prev);
      else {
        out.set(id, { info, host: nextHost });
        changed = true;
      }
    }
    cards = out;
    if (changed) for (const l of listeners) l();
  },
  setNoteMode(next: NoteMode): void {
    if (next === noteMode) return;
    noteMode = next;
    for (const l of listeners) l();
  },
  noteMode(): NoteMode {
    return noteMode;
  },
  setCanvasId(next: string | null): void {
    canvasId = next;
  },
  canvasId(): string | null {
    return canvasId;
  },
  /** Drops the published citation data (the Cards view was left); keeps the canvas's mode. */
  clearCards(): void {
    if (!cards.size && !host) return;
    cards = new Map();
    host = null;
    for (const l of listeners) l();
  },
  /** Drops everything (the canvas closed). */
  clear(): void {
    if (!cards.size && !host && noteMode === "manual" && canvasId === null) return;
    cards = new Map();
    host = null;
    noteMode = "manual";
    canvasId = null;
    for (const l of listeners) l();
  },
  get(elementId: string): CanvasCard | null {
    return cards.get(elementId) ?? null;
  },
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The open canvas's note-taking mode as the Cards view uses it (`manual` while the view is off). */
export function useCanvasNoteMode(): NoteMode {
  return useSyncExternalStore(subscribe, () => noteMode, () => "manual");
}

/** The Cards view's data for one canvas element; null when it isn't a source-citing AI card or the view is off. */
export function useCanvasCard(elementId: string): CanvasCard | null {
  return useSyncExternalStore(
    subscribe,
    () => canvasCards.get(elementId),
    () => null,
  );
}
