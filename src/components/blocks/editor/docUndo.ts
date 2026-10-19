/**
 * Undo for rich documents, on Yjs `UndoManager`s bound to each open
 * document's Y.Doc (they outlive the editor, which is mounted only while
 * editing):
 *
 * - `editorUndo` — in-editor Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y while typing,
 *   grouped in ~0.5 s chunks, reset when an editing session starts. (BlockNote's
 *   own y-prosemirror undo is not used: it never captures edits here.)
 * - `canvasUndo` (canvas blocks only) — everything changed in the document
 *   between two canvas history commits as ONE item, handed to the canvas
 *   history as a content step, so an editing session undoes together from the
 *   canvas, like native text. Each step holds a registry lease, keeping the
 *   document (and its undo managers) loaded while the step is in the history.
 */
import { BlockNoteEditor } from "@blocknote/core";
import { yXmlFragmentToBlocks } from "@blocknote/core/yjs";
import * as Y from "yjs";
import { modKey } from "@/components/canvas/shortcuts";
import { deriveTitle } from "@/domain/content/richContent";
import type { RichContent } from "@/domain/types";
import type { DocStep } from "@/history/canvasHistory";
import { registerDocStepSource } from "@/history/docSteps";
import { richDocKey } from "@/state/documentClone";
import { getDocumentStore } from "@/state/documents";
import { PERSISTENCE_ORIGIN, REMOTE_ORIGIN, type DocumentProvider } from "@/sync/DocumentProvider";
import { documentRegistry } from "@/sync/documentRegistry";
import { getActiveEditor } from "../activeEditors";
import { acuteSchema } from "./schema";

const FRAGMENT = "blocknote";
/** Typing pauses longer than this start a new in-editor undo step. */
const EDITOR_CAPTURE_MS = 500;

interface Tracked {
  documentId: string;
  provider: DocumentProvider;
  editorUndo: Y.UndoManager;
  canvasUndo: Y.UndoManager | null;
  pending: boolean;
}

/**
 * Every transaction origin counts as a local change except loading from
 * storage, remote sync and the listed undo managers. (Matching the editor's
 * y-prosemirror origin by identity is fragile: bundlers can load two copies.)
 */
class LocalOrigins extends Set<unknown> {
  constructor(private readonly excluded: () => unknown[] = () => []) {
    super();
  }
  override has(origin: unknown): boolean {
    return origin !== PERSISTENCE_ORIGIN && origin !== REMOTE_ORIGIN && !this.excluded().includes(origin);
  }
}

const tracked = new Map<string, Tracked>();
const listeners = new Set<() => void>();
let converter: BlockNoteEditor | null = null;

/**
 * Starts undo tracking for an open document (idempotent per provider).
 * `canvasSteps`: its changes also become canvas history steps (canvas blocks).
 */
export function trackDocumentUndo(documentId: string, provider: DocumentProvider, canvasSteps: boolean): void {
  let entry = tracked.get(documentId);
  if (entry?.provider !== provider) {
    const fragment = provider.doc.getXmlFragment(FRAGMENT);
    const created: Tracked = {
      documentId,
      provider,
      // The canvas history's own undo/redo is not an in-editor step.
      editorUndo: new Y.UndoManager(fragment, {
        trackedOrigins: new LocalOrigins(() => [created.canvasUndo]),
        captureTimeout: EDITOR_CAPTURE_MS,
      }),
      canvasUndo: null,
      pending: false,
    };
    entry = created;
    tracked.set(documentId, created);
    provider.onDispose(() => {
      created.editorUndo.destroy();
      created.canvasUndo?.destroy();
      if (tracked.get(documentId) === created) tracked.delete(documentId);
    });
  }
  if (canvasSteps && !entry.canvasUndo) attachCanvasUndo(entry);
}

function attachCanvasUndo(entry: Tracked): void {
  const undoManager = new Y.UndoManager(entry.provider.doc.getXmlFragment(FRAGMENT), {
    // Editor edits, programmatic formatting and in-editor undo/redo.
    trackedOrigins: new LocalOrigins(),
    // One stack item per history step: capture until `take()` closes it.
    captureTimeout: Number.POSITIVE_INFINITY,
  });
  const onStack = (event: { type: "undo" | "redo"; origin: unknown }) => {
    // Our own undo/redo moving items between stacks is not a new change.
    if (event.type !== "undo" || event.origin === undoManager) return;
    if (!entry.pending) {
      entry.pending = true;
      for (const l of listeners) l();
    }
  };
  undoManager.on("stack-item-added", onStack);
  undoManager.on("stack-item-updated", onStack);
  entry.canvasUndo = undoManager;
}

/** A new editing session starts with an empty in-editor undo history. */
export function resetEditorUndo(documentId: string): void {
  tracked.get(documentId)?.editorUndo.clear();
}

/**
 * Keydown handler for an editor (capture phase, ahead of ProseMirror):
 * Mod+Z undo, Mod+Shift+Z / Mod+Y redo within the document. True if handled.
 */
export function handleEditorUndoKey(e: KeyboardEvent, documentId: string): boolean {
  if (!modKey(e) || e.altKey) return false;
  const undo = !e.shiftKey && e.code === "KeyZ";
  const redo = (e.shiftKey && e.code === "KeyZ") || (!e.shiftKey && e.code === "KeyY");
  if (!undo && !redo) return false;
  const entry = tracked.get(documentId);
  if (!entry) return false;
  if (undo) entry.editorUndo.undo();
  else entry.editorUndo.redo();
  return true;
}

/** Mirrors the document into its preview snapshot when no editor is showing it. */
function refreshSnapshot(entry: Tracked): void {
  if (getActiveEditor(entry.documentId)) return; // the mounted editor mirrors itself
  converter ??= BlockNoteEditor.create({ schema: acuteSchema }) as unknown as BlockNoteEditor;
  try {
    const blocks = yXmlFragmentToBlocks(converter as never, entry.provider.doc.getXmlFragment(FRAGMENT)) as unknown as RichContent;
    getDocumentStore().updateSnapshot(entry.documentId, blocks, deriveTitle(blocks, "Untitled"));
  } catch (err) {
    console.error("[acute-notes] Failed to refresh preview after undo", err);
  }
}

function stepFor(entry: Tracked): DocStep {
  // Keeps the document loaded (its undo managers live on its Y.Doc).
  const lease = documentRegistry.acquire(richDocKey(entry.documentId), () => Promise.resolve(entry.provider));
  return {
    undo: () => {
      entry.canvasUndo?.undo();
      refreshSnapshot(entry);
    },
    redo: () => {
      entry.canvasUndo?.redo();
      refreshSnapshot(entry);
    },
    dispose: () => lease.release(),
  };
}

registerDocStepSource({
  take() {
    const steps: DocStep[] = [];
    for (const entry of tracked.values()) {
      if (!entry.pending || !entry.canvasUndo) continue;
      entry.pending = false;
      entry.canvasUndo.stopCapturing();
      steps.push(stepFor(entry));
    }
    return steps;
  },
  hasPending: () => [...tracked.values()].some((e) => e.pending),
  onPending(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
});

// Diagnostics in development builds.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__acuteDocUndo = { tracked };
}
