"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CanvasHistory, HistoryElement } from "@/history/canvasHistory";
import { isMac } from "./shortcuts";

const NATIVE_UNDO = '[data-testid="button-undo"]';

const UndoGlyph = () => (
  <svg aria-hidden="true" focusable="false" role="img" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.5 10.833 4.167 7.5 7.5 4.167M4.167 7.5h9.166a3.333 3.333 0 0 1 0 6.667H12.5" strokeWidth="1.25" />
  </svg>
);
const RedoGlyph = () => (
  <svg aria-hidden="true" focusable="false" role="img" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.5 10.833 15.833 7.5 12.5 4.167M15.833 7.5H6.667a3.333 3.333 0 1 0 0 6.667H7.5" strokeWidth="1.25" />
  </svg>
);

/**
 * Undo/redo buttons wired to Acute's unified history, rendered in place of
 * Excalidraw's own (which are hidden by CSS) with the same markup, in both
 * the desktop footer and the compact toolbar.
 */
export function HistoryButtons({ history }: { history: CanvasHistory<HistoryElement> }) {
  const [slot] = useState(() => {
    const el = document.createElement("div");
    el.className = "acute-history-slot";
    return el;
  });
  const canUndo = useSyncExternalStore(history.subscribe.bind(history), () => history.canUndo, () => false);
  const canRedo = useSyncExternalStore(history.subscribe.bind(history), () => history.canRedo, () => false);

  // Excalidraw re-creates its footer/toolbar (layout, theme): keep the slot next to its undo button.
  useEffect(() => {
    const root = document.querySelector(".excalidraw") ?? document.body;
    const attach = () => {
      const native = document.querySelector(NATIVE_UNDO);
      const anchor = native?.closest(".undo-button-container") ?? native;
      if (anchor && slot.nextElementSibling !== anchor) anchor.before(slot);
    };
    attach();
    const observer = new MutationObserver(attach);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      slot.remove();
    };
  }, [slot]);

  const mod = isMac ? "⌘" : "Ctrl+";
  return createPortal(
    <>
      <div className="undo-button-container" data-acute="">
        <button
          type="button"
          className="ToolIcon_type_button ToolIcon_size_medium ToolIcon_type_button--show ToolIcon"
          data-testid="acute-undo"
          aria-label="Undo"
          title={`Undo — ${mod}Z`}
          disabled={!canUndo}
          onClick={() => history.undo()}
        >
          <div className="ToolIcon__icon" aria-hidden="true">
            <UndoGlyph />
          </div>
        </button>
      </div>
      <div className="redo-button-container" data-acute="">
        <button
          type="button"
          className="ToolIcon_type_button ToolIcon_size_medium ToolIcon_type_button--show ToolIcon"
          data-testid="acute-redo"
          aria-label="Redo"
          title={`Redo — ${mod}${isMac ? "⇧Z" : "Y"}`}
          disabled={!canRedo}
          onClick={() => history.redo()}
        >
          <div className="ToolIcon__icon" aria-hidden="true">
            <RedoGlyph />
          </div>
        </button>
      </div>
    </>,
    slot,
  );
}
