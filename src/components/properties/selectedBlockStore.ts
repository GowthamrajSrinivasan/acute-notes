/**
 * The single selected Acute text item / block, published from the canvas
 * `onChange` so the Text panel section re-renders only when it changes.
 */
import { useSyncExternalStore } from "react";
import type { BlockStyle } from "@/domain/content/blockStyle";
import type { LensProfileId, NodeLens, NodeSemantics } from "@/domain/canvas/diagram";
import type { NodeProject } from "@/domain/canvas/nodeProject";
import type { RelationType } from "@/domain/types";

export interface SelectedBlock {
  elementId: string;
  documentId: string;
  style: BlockStyle;
  /** Being edited right now (selection-aware colour changes apply). */
  active: boolean;
  /** Element-level hyperlink. */
  href?: string;
}

let current: SelectedBlock | null = null;
const listeners = new Set<() => void>();

function same(a: SelectedBlock | null, b: SelectedBlock | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.elementId === b.elementId &&
    a.documentId === b.documentId &&
    a.active === b.active &&
    a.href === b.href &&
    JSON.stringify(a.style) === JSON.stringify(b.style)
  );
}

export const selectedBlockStore = {
  get: (): SelectedBlock | null => current,
  set(next: SelectedBlock | null) {
    if (same(current, next)) return;
    current = next;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** A single selected native (free) Excalidraw text element, offered for conversion. */
let nativeText: string | null = null;
const nativeListeners = new Set<() => void>();

export const selectedNativeTextStore = {
  get: (): string | null => nativeText,
  set(next: string | null) {
    if (next === nativeText) return;
    nativeText = next;
    for (const l of nativeListeners) l();
  },
  subscribe(listener: () => void): () => void {
    nativeListeners.add(listener);
    return () => nativeListeners.delete(listener);
  },
};

export function useSelectedNativeText(): string | null {
  return useSyncExternalStore(selectedNativeTextStore.subscribe, selectedNativeTextStore.get, () => null);
}

/** Ctrl+K on a selected (not edited) item asks the panel to edit its link. */
export const EDIT_LINK_EVENT = "acute:edit-link";

export function useSelectedBlock(): SelectedBlock | null {
  return useSyncExternalStore(selectedBlockStore.subscribe, selectedBlockStore.get, () => null);
}

/** Other single selections with an Acute panel section (relationship, page preview, diagram frame / node). */
export type SelectedObject =
  | {
      kind: "arrow";
      elementId: string;
      relation?: RelationType;
      connected: boolean;
      /** Set when the arrow connects nodes of an interactive diagram frame. */
      diagram?: { explanation?: string };
    }
  | { kind: "page"; elementId: string; pageId: string; preview: boolean }
  | { kind: "frame"; elementId: string; interactive: boolean; level?: number; profile?: LensProfileId }
  | { kind: "diagram-node"; elementId: string; frameId: string; semantics: NodeSemantics; lens: NodeLens; project?: NodeProject };

let selectedObject: SelectedObject | null = null;
const objectListeners = new Set<() => void>();

export const selectedObjectStore = {
  get: (): SelectedObject | null => selectedObject,
  set(next: SelectedObject | null) {
    if (JSON.stringify(next) === JSON.stringify(selectedObject)) return;
    selectedObject = next;
    for (const l of objectListeners) l();
  },
  subscribe(listener: () => void): () => void {
    objectListeners.add(listener);
    return () => objectListeners.delete(listener);
  },
};

export function useSelectedObject(): SelectedObject | null {
  return useSyncExternalStore(selectedObjectStore.subscribe, selectedObjectStore.get, () => null);
}

/**
 * The canvas selection as Excalidraw's `selectedElementIds` object, published
 * only when that object changes (O(1) in `onChange`). Consumers derive what
 * they need from it on change, e.g. whether `✨ Ask AI` applies.
 */
let selection: Readonly<Record<string, true>> = {};
const selectionListeners = new Set<() => void>();

export const selectionStore = {
  get: (): Readonly<Record<string, true>> => selection,
  set(next: Readonly<Record<string, true>>) {
    if (next === selection) return;
    selection = next;
    for (const l of selectionListeners) l();
  },
  subscribe(listener: () => void): () => void {
    selectionListeners.add(listener);
    return () => selectionListeners.delete(listener);
  },
};

export function useSelection(): Readonly<Record<string, true>> {
  return useSyncExternalStore(selectionStore.subscribe, selectionStore.get, () => EMPTY_SELECTION);
}

const EMPTY_SELECTION: Readonly<Record<string, true>> = {};
