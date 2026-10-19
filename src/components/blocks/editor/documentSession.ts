"use client";

/**
 * Shared lifecycle for BlockNote editors bound to a rich document (canvas
 * blocks and pages): open the document's Y.Doc through the ref-counted
 * registry, seed it from the stored snapshot on first edit, and mirror the
 * content back into the preview snapshot.
 */
import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import { useEffect, useRef, useState } from "react";
import { deriveTitle } from "@/domain/content/richContent";
import type { RichContent } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { awaitPendingClone, richDocKey } from "@/state/documentClone";
import { getDocumentStore } from "@/state/documents";
import { replaceDefaultBlockId, RICH_FRAGMENT } from "@/sync/blockIds";
import { DocumentProvider, LOCAL_ORIGIN } from "@/sync/DocumentProvider";
import { documentRegistry } from "@/sync/documentRegistry";
import { trackDocumentUndo } from "./docUndo";
import { acuteSchema } from "./schema";

export const FRAGMENT = RICH_FRAGMENT;
const SNAPSHOT_DELAY_MS = 250;

/** Loads the document's Y.Doc, seeding it from the stored snapshot on first edit. */
async function openDocument(documentId: string): Promise<DocumentProvider> {
  // A just-duplicated block must not seed before its copied history lands.
  await awaitPendingClone(documentId);
  const provider = new DocumentProvider(richDocKey(documentId), getPersistence().yupdates);
  await provider.load();
  const fragment = provider.doc.getXmlFragment(FRAGMENT);
  if (fragment.length === 0) {
    const store = getDocumentStore();
    await store.load(documentId);
    const seed = store.get(documentId)?.snapshot;
    if (seed?.length) {
      // Headless conversion: the snapshot (template / AI / import content)
      // becomes the collaborative document before any editor binds to it.
      const headless = BlockNoteEditor.create({ schema: acuteSchema });
      provider.applyLocalChange(() => {
        blocksToYXmlFragment(headless, seed as never, fragment);
      }, LOCAL_ORIGIN);
      headless._tiptapEditor.destroy();
    }
  } else {
    // Keep block ids unique across documents (see `replaceDefaultBlockId`).
    const store = getDocumentStore();
    await store.load(documentId);
    let snapshot: RichContent | null = null;
    provider.applyLocalChange(() => {
      snapshot = replaceDefaultBlockId(fragment, store.get(documentId)?.snapshot ?? []);
    }, LOCAL_ORIGIN);
    if (snapshot) store.update(documentId, { snapshot });
  }
  return provider;
}

/**
 * The document's shared provider while mounted (null until loaded), with
 * undo tracking. `canvasUndo`: its changes also become canvas history steps
 * (canvas blocks; pages keep their undo inside the page editor).
 */
export function useDocumentProvider(documentId: string, options: { canvasUndo?: boolean } = {}): DocumentProvider | null {
  const canvasUndo = options.canvasUndo ?? false;
  const [provider, setProvider] = useState<DocumentProvider | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Shared, ref-counted provider: seeding runs once per document.
    const lease = documentRegistry.acquire(richDocKey(documentId), () => openDocument(documentId));
    lease.provider.then(
      (p) => {
        // After seeding, so loading a block's template is never an undo step.
        trackDocumentUndo(documentId, p, canvasUndo);
        if (!cancelled) setProvider(p);
      },
      (err: unknown) => console.error("[acute-notes] Failed to open document", err),
    );
    return () => {
      cancelled = true;
      lease.release();
      setProvider(null);
    };
  }, [documentId, canvasUndo]);
  return provider;
}

interface SnapshotSource {
  readonly document: unknown;
  onChange(callback: () => void): (() => void) | void;
}

/**
 * Mirrors the editor content into the document's preview snapshot (debounced,
 * never awaited). Blocks derive their title from the content; pages keep
 * their own, explicitly edited title.
 */
export function useSnapshotMirror(editor: SnapshotSource, documentId: string, title: "derive" | "keep"): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const store = getDocumentStore();
    const writeSnapshot = () => {
      timer.current = null;
      const snapshot = editor.document as RichContent;
      store.updateSnapshot(documentId, snapshot, title === "derive" ? deriveTitle(snapshot, "Untitled") : undefined);
    };
    const unsubscribe = editor.onChange(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(writeSnapshot, SNAPSHOT_DELAY_MS);
    });
    return () => {
      unsubscribe?.();
      if (timer.current) {
        clearTimeout(timer.current);
        writeSnapshot();
      }
    };
  }, [editor, documentId, title]);
}
