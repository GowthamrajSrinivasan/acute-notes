"use client";

/**
 * Stroke and Background for a selected composite shape (a cylinder). Its host is drawn transparent, so Excalidraw's
 * own colour pickers would show "transparent" and colour an invisible rectangle; while one is selected they are
 * hidden (`data-acute-composite-selected`) and these set the colours its outline is drawn in. Excalidraw's other
 * controls (stroke width and style, sloppiness, fill style, opacity) work as they are: the outline mirrors the host.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { compositeStyleOf, selectedShape, setCompositeStyle } from "@/components/canvas/compositeShapes";
import { usePanelSlot } from "./panelSlot";

/** Excalidraw's quick picks (`DEFAULT_ELEMENT_STROKE_PICKS` / `DEFAULT_ELEMENT_BACKGROUND_PICKS`). */
const STROKE_PICKS = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"] as const;
const BACKGROUND_PICKS = ["transparent", "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99"] as const;

/** The selected composite host and its colours, as a stable snapshot (`hostId|stroke|background`), or "". */
function useSelectedComposite(api: ExcalidrawImperativeAPI) {
  const subscribe = useCallback((notify: () => void) => api.onChange(notify), [api]);
  const snapshot = useCallback(() => {
    const shape = selectedShape(api, api.getAppState());
    if (!shape || shape.wholeGroup) return "";
    const style = compositeStyleOf(shape.host);
    return `${shape.host.id}|${style.strokeColor}|${style.backgroundColor}`;
  }, [api]);
  const key = useSyncExternalStore(subscribe, snapshot, () => "");
  if (!key) return null;
  const [hostId, strokeColor, backgroundColor] = key.split("|") as [string, string, string];
  return { hostId, strokeColor, backgroundColor };
}

function Swatches({ label, picks, value, onPick }: { label: string; picks: readonly string[]; value: string; onPick: (color: string) => void }) {
  return (
    <>
      <legend>{label}</legend>
      <div className="color-picker__top-picks acute-text-section__colors">
        {picks.map((c) => (
          <button
            key={c}
            type="button"
            className={`color-picker__button${c === "transparent" ? " is-transparent" : ""}${value.toLowerCase() === c ? " active" : ""}`}
            title={c}
            aria-label={`${label} ${c}`}
            aria-pressed={value.toLowerCase() === c}
            style={{ "--swatch-color": c } as React.CSSProperties}
            onClick={() => onPick(c)}
          >
            <div className="color-picker__button-outline" />
          </button>
        ))}
      </div>
    </>
  );
}

export function ShapeSection({ api }: { api: ExcalidrawImperativeAPI }) {
  const selected = useSelectedComposite(api);
  const slot = usePanelSlot("acute-shape-slot");
  const shown = !!selected;
  useEffect(() => {
    document.documentElement.toggleAttribute("data-acute-composite-selected", shown);
    return () => document.documentElement.removeAttribute("data-acute-composite-selected");
  }, [shown]);

  if (!selected) return null;
  return createPortal(
    <fieldset className="acute-text-section" data-testid="acute-shape-section">
      <Swatches label="Stroke" picks={STROKE_PICKS} value={selected.strokeColor} onPick={(strokeColor) => setCompositeStyle(api, selected.hostId, { strokeColor })} />
      <Swatches
        label="Background"
        picks={BACKGROUND_PICKS}
        value={selected.backgroundColor}
        onPick={(backgroundColor) => setCompositeStyle(api, selected.hostId, { backgroundColor })}
      />
    </fieldset>,
    slot,
  );
}
