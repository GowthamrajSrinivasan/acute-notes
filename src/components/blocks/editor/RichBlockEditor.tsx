"use client";

/**
 * Full BlockNote editor for one rich document. Lazy-loaded (see
 * `RichBlockHost`) and mounted only for the block being edited.
 *
 * Content is a `Y.XmlFragment` in the document's own Y.Doc, persisted through
 * `DocumentProvider`. A renderer-independent snapshot is mirrored into the
 * document store (debounced) for previews, search and export.
 */
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { BlockNoteEditor, filterSuggestionItems } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from "@blocknote/react";
import { useEffect } from "react";
import { isEmptyContent } from "@/domain/content/richContent";
import type { RichContent } from "@/domain/types";
import type { DocumentProvider } from "@/sync/DocumentProvider";
import { registerActiveEditor } from "../activeEditors";
import { takePendingCaret, type CaretTarget } from "../pendingCaret";
import { handleEditorUndoKey, resetEditorUndo } from "./docUndo";
import { FRAGMENT, useDocumentProvider, useSnapshotMirror } from "./documentSession";
import { createEditorHandle } from "./editorHandle";
import { resolveFileUrl } from "./imageUpload";
import { pasteHandler } from "./paste";
import { acuteSchema, CANVAS_SLASH_KEYS, type AcuteSchema } from "./schema";

const LOCAL_USER = { name: "You", color: "#6965db" };
const PORTALS = { default: "body" } as const;

type Editor = BlockNoteEditor<AcuteSchema["blockSchema"], AcuteSchema["inlineContentSchema"], AcuteSchema["styleSchema"]>;

/** Puts the caret on the character the user clicked in the preview. */
function placeCaret(editor: Editor, target: CaretTarget): boolean {
  const tiptap = editor._tiptapEditor;
  try {
    if ("blockId" in target) {
      if (!editor.getBlock(target.blockId)) return false;
      editor.setTextCursorPosition(target.blockId, "start");
      const { $from, from } = tiptap.state.selection;
      const pos = from + Math.min(target.offset, $from.parent.content.size);
      tiptap.commands.focus();
      tiptap.commands.setTextSelection(pos);
      return true;
    }
    const hit = tiptap.view.posAtCoords({ left: target.x, top: target.y });
    if (!hit) return false;
    tiptap.commands.focus();
    tiptap.commands.setTextSelection(hit.pos);
    return true;
  } catch {
    return false;
  }
}

interface RichBlockEditorProps {
  documentId: string;
  theme: "light" | "dark";
  /** Frameless text: no side-menu gutter, text starts exactly at the item's edge. */
  frameless?: boolean;
}

export default function RichBlockEditor({ documentId, theme, frameless = false }: RichBlockEditorProps) {
  const provider = useDocumentProvider(documentId, { canvasUndo: true });
  if (!provider) return null;
  return <LoadedEditor key={provider.docId} provider={provider} documentId={documentId} theme={theme} frameless={frameless} />;
}

function LoadedEditor({
  provider,
  documentId,
  theme,
  frameless,
}: {
  provider: DocumentProvider;
  documentId: string;
  theme: "light" | "dark";
  frameless: boolean;
}) {
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: acuteSchema,
      pasteHandler,
      // Shows images that arrive in content (e.g. Markdown); canvas blocks take no uploads (images go on the canvas).
      resolveFileUrl,
      // No awareness provider: remote cursors are irrelevant until collaboration
      // exists, and it keeps the cursor plugin out of the editor lifecycle.
      collaboration: { fragment: provider.doc.getXmlFragment(FRAGMENT), user: LOCAL_USER },
    }),
    [provider],
  ) as unknown as Editor;

  // Mirror the document into the preview snapshot (debounced, never awaited).
  useSnapshotMirror(editor, documentId, "derive");

  // Each editing session has its own in-editor undo history.
  useEffect(() => resetEditorUndo(documentId), [documentId]);

  // The side panel formats this document through this handle (toolbars are off).
  useEffect(() => registerActiveEditor(documentId, createEditorHandle(editor as never)), [editor, documentId]);

  // Focus when editing starts: at the clicked point if editing began with a
  // click, else the first block of an empty document, else the end.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const caret = takePendingCaret(documentId);
      if (caret && placeCaret(editor, caret)) return;
      const blocks = editor.document;
      const empty = isEmptyContent(blocks as unknown as RichContent);
      const target = empty ? blocks[0] : blocks.at(-1);
      if (target) {
        try {
          editor.setTextCursorPosition(target, empty ? "start" : "end");
        } catch {
          // Some blocks (e.g. tables) have no text cursor position.
        }
      }
      editor.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [editor, documentId]);

  return (
    <div
      // Ahead of ProseMirror: in-editor undo/redo (see docUndo.ts).
      onKeyDownCapture={(e) => {
        if (handleEditorUndoKey(e.nativeEvent, documentId)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <BlockNoteView
      editor={editor}
      theme={theme}
      slashMenu={false}
      // Formatting lives in the side panel only (one formatting surface, like native text).
      formattingToolbar={false}
      linkToolbar={false}
      sideMenu={!frameless}
      portalElements={PORTALS}
    >
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(
            getDefaultReactSlashMenuItems(editor as never).filter(
              (item) => "key" in item && CANVAS_SLASH_KEYS.has(item.key as string),
            ),
            query,
          )
        }
      />
      </BlockNoteView>
    </div>
  );
}

