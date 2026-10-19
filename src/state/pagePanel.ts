"use client";

/**
 * Which page is open in the side panel. A tiny external store so the canvas
 * (opening a page preview), the page sidebar and the panel itself can share
 * it without lifting state through the shell.
 */
import { useSyncExternalStore } from "react";
import { claimSlot, registerSlotCloser, releaseSlot } from "./sidePanelSlot";

export interface PagePanelState {
  pageId: string | null;
  /** Full width over the canvas (the canvas stays mounted underneath). */
  expanded: boolean;
  /** Canvas element the page was opened from, if any. */
  elementId: string | null;
}

let state: PagePanelState = { pageId: null, expanded: false, elementId: null };
/** One-shot request: the page whose title takes focus when its panel mounts (new pages). */
let focusTitleFor: string | null = null;
const listeners = new Set<() => void>();

function set(next: PagePanelState) {
  state = next;
  for (const l of listeners) l();
}

export const pagePanel = {
  get: (): PagePanelState => state,
  open(pageId: string, options: { elementId?: string | null; focusTitle?: boolean } = {}): void {
    claimSlot("page");
    focusTitleFor = options.focusTitle ? pageId : null;
    set({ ...state, pageId, elementId: options.elementId ?? null });
  },
  /** True once after `open(pageId, { focusTitle: true })`. */
  takeFocusTitle(pageId: string): boolean {
    if (focusTitleFor !== pageId) return false;
    focusTitleFor = null;
    return true;
  },
  close(): void {
    releaseSlot("page");
    if (state.pageId) set({ ...state, pageId: null, elementId: null });
  },
  setExpanded(expanded: boolean): void {
    if (state.expanded !== expanded) set({ ...state, expanded });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

registerSlotCloser("page", pagePanel.close);

const SERVER_STATE: PagePanelState = { pageId: null, expanded: false, elementId: null };

export function usePagePanel(): PagePanelState {
  return useSyncExternalStore(pagePanel.subscribe, pagePanel.get, () => SERVER_STATE);
}
