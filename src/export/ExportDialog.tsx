"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { exportImage, type ExportFormat } from "./exportImage";

interface ExportDialogProps {
  api: ExcalidrawImperativeAPI;
  onClose: () => void;
}

/** Image export (PNG / SVG / clipboard) that includes Acute text and blocks. */
export function ExportDialog({ api, onClose }: ExportDialogProps) {
  const appState = api.getAppState();
  const hasSelection = Object.keys(appState.selectedElementIds).length > 0;
  const [scale, setScale] = useState(2);
  const [background, setBackground] = useState(true);
  const [dark, setDark] = useState(appState.theme === "dark");
  const [onlySelected, setOnlySelected] = useState(hasSelection);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button[data-primary]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const run = async (format: ExportFormat) => {
    setBusy(format);
    setError(null);
    try {
      await exportImage(api, { format, scale, background, dark, onlySelected });
      if (format === "clipboard") api.setToast({ message: "Copied PNG to clipboard", duration: 2000 });
      onClose();
    } catch (err) {
      console.error("[acute-notes] Export failed", err);
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div className="acute-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="acute-dialog" role="dialog" aria-modal="true" aria-labelledby="acute-export-title">
        <h2 id="acute-export-title">Export image</h2>
        <div className="acute-dialog__row">
          <span>Scale</span>
          <div className="acute-dialog__seg" role="radiogroup" aria-label="Scale">
            {[1, 2, 3].map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scale === s} onClick={() => setScale(s)}>
                {s}×
              </button>
            ))}
          </div>
        </div>
        <label className="acute-dialog__row">
          <span>Background</span>
          <input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} />
        </label>
        <label className="acute-dialog__row">
          <span>Dark mode</span>
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
        </label>
        {hasSelection && (
          <label className="acute-dialog__row">
            <span>Only selected</span>
            <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
          </label>
        )}
        {error && (
          <p role="alert" className="acute-dialog__error">
            {error}
          </p>
        )}
        <div className="acute-dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!!busy} onClick={() => void run("clipboard")}>
            {busy === "clipboard" ? "Copying…" : "Copy PNG"}
          </button>
          <button type="button" disabled={!!busy} onClick={() => void run("svg")}>
            {busy === "svg" ? "Exporting…" : "SVG"}
          </button>
          <button type="button" data-primary disabled={!!busy} onClick={() => void run("png")}>
            {busy === "png" ? "Exporting…" : "PNG"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
