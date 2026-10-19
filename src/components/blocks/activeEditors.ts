/**
 * Registry of mounted block editors, keyed by document id. Lets the side
 * panel and canvas code drive formatting in the editor being used without
 * importing BlockNote into the canvas bundle.
 */
import type { BlockTextAlign } from "@/domain/content/blockStyle";

export type SelectionScope = "none" | "partial" | "all";
/** Value styles that can apply to part of the text. */
export type ValueStyleKey = "fontFamily" | "fontSize" | "textColor";
export type MarkKey = "bold" | "italic" | "underline" | "strike" | "code";
export type LineType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem";

export interface SelectionFormat {
  marks: Record<MarkKey, boolean>;
  fontFamily?: string;
  fontSize?: string;
  textColor?: string;
  alignment?: BlockTextAlign;
  lineType?: LineType;
  link?: string;
}

export interface ActiveEditorHandle {
  /** How much of the document's text is selected. */
  selectionScope(): SelectionScope;
  /** The selected part as Markdown when only part of the document is selected (Visualize a sub-range, F31); otherwise null. */
  selectedMarkdown(): string | null;
  /** Formatting at the current selection (for the panel's active states). */
  getFormat(): SelectionFormat;
  /** Selection or content changed. */
  subscribe(listener: () => void): () => void;
  /** Sets (or removes, with null) a value style on the selection. */
  applyStyle(key: ValueStyleKey, value: string | null): void;
  /** Removes a value style / line alignment from the whole document. */
  clearStyleEverywhere(key: ValueStyleKey | "textAlignment"): void;
  toggleMark(key: MarkKey): void;
  /** Aligns the lines in the selection. */
  setAlignment(align: BlockTextAlign): void;
  /** Turns the lines in the selection into another block type. */
  setLineType(type: LineType): void;
  setLink(url: string | null): void;
  clearFormatting(): void;
  selectAll(): void;
  /** Colours the current selection and returns focus to the editor. */
  applyTextColor(color: string): void;
  /** Removes per-text colours from the current selection. */
  clearTextColor(): void;
}

const editors = new Map<string, ActiveEditorHandle>();
const waiting = new Map<string, ((editor: ActiveEditorHandle) => void)[]>();
const listeners = new Set<() => void>();

export function registerActiveEditor(documentId: string, handle: ActiveEditorHandle): () => void {
  editors.set(documentId, handle);
  for (const l of listeners) l();
  const queued = waiting.get(documentId);
  if (queued) {
    waiting.delete(documentId);
    for (const run of queued) run(handle);
  }
  return () => {
    if (editors.get(documentId) !== handle) return;
    editors.delete(documentId);
    for (const l of listeners) l();
  };
}

export function getActiveEditor(documentId: string): ActiveEditorHandle | undefined {
  return editors.get(documentId);
}

/** Runs `fn` with the document's editor now, or as soon as it mounts (≤3 s). */
export function runWithEditor(documentId: string, fn: (editor: ActiveEditorHandle) => void): void {
  const editor = editors.get(documentId);
  if (editor) {
    fn(editor);
    return;
  }
  const queue = waiting.get(documentId) ?? [];
  queue.push(fn);
  waiting.set(documentId, queue);
  setTimeout(() => {
    const q = waiting.get(documentId);
    if (!q) return;
    const i = q.indexOf(fn);
    if (i >= 0) q.splice(i, 1);
    if (!q.length) waiting.delete(documentId);
  }, 3000);
}

/** Editors mounted/unmounted. */
export function subscribeActiveEditors(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
