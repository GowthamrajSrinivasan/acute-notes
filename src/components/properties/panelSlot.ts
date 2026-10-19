"use client";

/**
 * A DOM slot inside Excalidraw's properties panel for an Acute section, kept
 * attached as Excalidraw re-creates the panel on selection changes. Sections
 * portal into it so they read as native panel sections.
 */
import { useEffect, useState } from "react";

export const PANEL_SELECTOR = ".App-menu__left .panelColumn";

/** Calls `onOpen` each time Excalidraw's properties panel opens (it is only in the DOM while a selection or drawing tool shows it). */
export function useOnPropertiesPanelOpen(onOpen: () => void): void {
  useEffect(() => {
    let open = false;
    const sync = () => {
      const now = !!document.querySelector(PANEL_SELECTOR);
      if (now && !open) onOpen();
      open = now;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [onOpen]);
}

export function usePanelSlot(className: string, onSync?: (panel: Element) => void): HTMLDivElement {
  const [slot] = useState(() => {
    const el = document.createElement("div");
    el.className = className;
    el.dataset.acuteSlot = "";
    return el;
  });

  useEffect(() => {
    const root = document.querySelector(".excalidraw") ?? document.body;
    const sync = () => {
      const panel = document.querySelector(PANEL_SELECTOR);
      if (!panel) return;
      if (slot.parentElement !== panel) panel.prepend(slot);
      onSync?.(panel);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      slot.remove();
    };
  }, [slot, onSync]);

  return slot;
}
