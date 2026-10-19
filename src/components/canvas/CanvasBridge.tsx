"use client";

import { createContext, useContext } from "react";
import type { ImportedHtml } from "@/domain/canvas/webEmbed";

/**
 * Narrow capabilities that hosted canvas content (rich blocks, page previews)
 * may use, without depending on the Excalidraw API directly.
 */
export interface CanvasBridge {
  deactivate(elementId: string): void;
  /** Auto-size: new size in scene px; `width: null` keeps the current width. */
  resize(elementId: string, width: number | null, height: number): void;
  /** Page previews: switch between the compact card and the content preview. */
  togglePagePreview(elementId: string): void;
  /** Web embeds: show imported HTML instead of the URL (`null` goes back to the URL). */
  setImportedHtml(elementId: string, imported: ImportedHtml | null): void;
}

const noop: CanvasBridge = {
  deactivate: () => {},
  resize: () => {},
  togglePagePreview: () => {},
  setImportedHtml: () => {},
};

export const CanvasBridgeContext = createContext<CanvasBridge>(noop);

export function useCanvasBridge(): CanvasBridge {
  return useContext(CanvasBridgeContext);
}
