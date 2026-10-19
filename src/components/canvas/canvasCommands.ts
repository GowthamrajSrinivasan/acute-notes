import type { DocumentHome } from "@/domain/types";

export type CanvasTheme = "light" | "dark";

/** Excalidraw's canvas background presets (DEFAULT_CANVAS_BACKGROUND_PICKS). */
export const CANVAS_BACKGROUNDS = ["#ffffff", "#f8f9fa", "#f5faff", "#fffce8", "#fdf8f6"] as const;

/**
 * Commands the open canvas offers to UI outside it (navigator, page panel,
 * header menu), so that UI never needs the Excalidraw API. Registered by the
 * canvas while it is mounted.
 */
export interface CanvasCommands {
  /** The open canvas (and its workspace). */
  home(): DocumentHome;
  /** Adds a preview of the page at the viewport centre. */
  insertPagePreview(pageId: string): void;
  /** Selects and scrolls to the page's preview; false when it is not on the canvas. */
  revealPage(pageId: string): boolean;
  /** Selects, scrolls to and flashes an element once (Acute Lens's "Back to canvas"); false when it's gone. */
  revealNode(elementId: string): boolean;
  /** Writes pending canvas changes now (before export). */
  flush(): Promise<void>;
  /** Opens the export-image dialog. */
  openExportImage(): void;
  /** Removes every element from the canvas (one undoable step). Callers confirm first. */
  resetCanvas(): void;
  /** Turns every free-standing native text into rich text (one undoable step); returns how many. */
  convertAllNativeText(): number;
  /** Shows a short message to the user (e.g. why an image could not be added to a page). */
  notify(message: string): void;
  getTheme(): CanvasTheme;
  setTheme(theme: CanvasTheme): void;
  getBackground(): string;
  setBackground(color: string): void;
}

let current: CanvasCommands | null = null;
const listeners = new Set<() => void>();

function set(next: CanvasCommands | null): void {
  current = next;
  for (const l of listeners) l();
}

export function registerCanvasCommands(commands: CanvasCommands): () => void {
  set(commands);
  return () => {
    if (current === commands) set(null);
  };
}

/** Notified when a canvas registers or unregisters its commands (e.g. toolbar enablement). */
export function subscribeCanvasCommands(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCanvasCommands(): CanvasCommands | null {
  return current;
}
