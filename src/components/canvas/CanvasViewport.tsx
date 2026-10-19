"use client";

import dynamic from "next/dynamic";
import type { CanvasDocument } from "@/domain/types";

/**
 * Excalidraw touches `window` at import time, so the canvas is client-only.
 * The placeholder matches the canvas background to avoid a layout/flash shift.
 */
const ExcalidrawCanvas = dynamic(() => import("./ExcalidrawCanvas").then((m) => m.ExcalidrawCanvas), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[var(--acute-bg)]" aria-busy="true" />,
});

export function CanvasViewport({ canvas }: { canvas: CanvasDocument | null }) {
  return (
    <div className="absolute inset-0">
      {canvas ? (
        // Keyed: a different canvas gets a fresh editor, never one render with the previous canvas's session.
        <ExcalidrawCanvas key={canvas.id} canvas={canvas} />
      ) : (
        <div className="absolute inset-0 bg-[var(--acute-bg)]" aria-busy="true" />
      )}
    </div>
  );
}
