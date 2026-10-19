"use client";

import { useEffect, useState } from "react";

/**
 * A `display: contents` slot placed right after the element `anchorSelector`
 * matches in Excalidraw's main toolbar, for a tool of Acute's own to portal
 * into. Excalidraw may re-create the toolbar (theme/mobile/view mode), so a
 * cheap MutationObserver re-attaches the slot when it becomes disconnected.
 */
export function useToolbarSlot(anchorSelector: string): HTMLDivElement {
  const [slot] = useState(() => {
    const el = document.createElement("div");
    el.className = "acute-toolbar-slot";
    return el;
  });

  useEffect(() => {
    const root = document.querySelector(".excalidraw") ?? document.body;
    const attach = () => {
      if (slot.isConnected) return;
      document.querySelector(anchorSelector)?.after(slot);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      slot.remove();
    };
  }, [slot, anchorSelector]);

  return slot;
}
