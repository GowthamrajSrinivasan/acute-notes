"use client";

/**
 * The floating "✨ Visualize this?" hint (F31), beside the block it's about.
 * Unlike F19's ghosts (canvas content, so they scale with zoom), this is a UI
 * control: it tracks the block's position in screen coordinates but keeps its
 * own size at every zoom level. Position updates are written straight to the
 * element's style from the renderer's change event — no React render per
 * frame. Dismisses itself if the block it's about is deleted.
 */
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef } from "react";
import { useAIMode } from "./askAI";
import { visualizeDialog } from "./visualizeStore";
import { useVisualizeHint, visualizeHint } from "./visualizeHintStore";

const GAP = 10;

export function VisualizeHint({ api }: { api: ExcalidrawImperativeAPI }) {
  const hint = useVisualizeHint();
  const mode = useAIMode();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hint || mode !== "on") return;
    const place = (s: AppState) => {
      const el = api.getSceneElements().find((e) => e.id === hint.elementId);
      const node = ref.current;
      if (!el) {
        visualizeHint.dismiss();
        return;
      }
      if (!node) return;
      const zoom = s.zoom.value;
      const x = (el.x + el.width + s.scrollX) * zoom + GAP;
      const y = (el.y + s.scrollY) * zoom;
      node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    };
    place(api.getAppState());
    return api.onChange((_elements, appState) => place(appState));
  }, [api, hint, mode]);

  // Like every other ✨ entry point, never shown while AI mode is Off (PRD F18).
  if (!hint || mode !== "on") return null;

  const open = () => {
    visualizeDialog.open({ text: hint.text, label: "Pasted text" });
    visualizeHint.dismiss();
  };

  return (
    <div ref={ref} className="acute-visualize-hint" role="status">
      <button type="button" className="acute-visualize-hint__ask" onClick={open}>
        <span aria-hidden="true">✨</span> Visualize this?
      </button>
      <button type="button" className="acute-visualize-hint__dismiss" aria-label="Dismiss" onClick={() => visualizeHint.dismiss()}>
        ×
      </button>
    </div>
  );
}
