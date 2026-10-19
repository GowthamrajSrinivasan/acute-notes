"use client";

/**
 * Per-device UI preferences, persisted in the local `meta` store.
 * Read synchronously through `useUiPref`; changes re-render subscribers only.
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_RESPONSE_STYLE, setResponseStyleSource, type ResponseStyle } from "@/ai/changes/responseStyle";
import { DEFAULT_CLEANUP, type CleanupOptions } from "@/ai/content/cleanup";
import { getPersistence } from "@/persistence";

/**
 * How inactive rich blocks are displayed on the canvas:
 * - `compact`: lightweight Acute preview renderer (smallest DOM, fastest)
 * - `editor`: BlockNote's own static HTML + styles, identical to edit mode
 */
export type BlockDisplay = "compact" | "editor";

/**
 * How objects an accepted AI change adds are pointed out on the canvas (a
 * pulsing dot on each): for a few seconds, until the dot is clicked, or not at all.
 */
export type AIChangeMarkers = "timed" | "until_clicked" | "off";

/** What the toolbar's arrow tool draws: Excalidraw's arrow, or a right-angle "architecture" connector Acute routes. */
export type ArrowTool = "excalidraw" | "architecture";

export interface UiPrefs {
  blockDisplay: BlockDisplay;
  aiChangeMarkers: AIChangeMarkers;
  /** Width of the docked page side panel (px). */
  pagePanelWidth: number;
  /** Width of the docked Acute Lens panel (px). */
  lensPanelWidth: number;
  /** How AI-generated objects look (AI settings → Response styling). */
  aiStyle: ResponseStyle;
  /** What Visualize strips from pasted AI answers first (AI settings → Clean pasted answers). */
  aiCleanup: CleanupOptions;
  arrowTool: ArrowTool;
}

const KEY = "ui.prefs";
const DEFAULTS: UiPrefs = {
  blockDisplay: "compact",
  aiChangeMarkers: "timed",
  pagePanelWidth: 560,
  lensPanelWidth: 640,
  aiStyle: DEFAULT_RESPONSE_STYLE,
  aiCleanup: DEFAULT_CLEANUP,
  arrowTool: "excalidraw",
};

let prefs: UiPrefs = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  void getPersistence()
    .meta.get<Partial<UiPrefs>>(KEY)
    .then((stored) => {
      if (stored) {
        prefs = { ...DEFAULTS, ...stored, aiStyle: { ...DEFAULTS.aiStyle, ...stored.aiStyle }, aiCleanup: { ...DEFAULTS.aiCleanup, ...stored.aiCleanup } };
        emit();
      }
    });
}

/** Non-React read of a preference. */
export function getUiPref<K extends keyof UiPrefs>(key: K): UiPrefs[K] {
  return prefs[key];
}

export function setUiPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void {
  if (prefs[key] === value) return;
  prefs = { ...prefs, [key]: value };
  emit();
  void getPersistence().meta.set(KEY, prefs);
}

function subscribe(listener: () => void) {
  ensureLoaded();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiPref<K extends keyof UiPrefs>(key: K): UiPrefs[K] {
  return useSyncExternalStore(
    subscribe,
    () => prefs[key],
    () => DEFAULTS[key],
  );
}

// Every AI proposal is styled with the current preference.
setResponseStyleSource(() => {
  ensureLoaded();
  return prefs.aiStyle;
});
