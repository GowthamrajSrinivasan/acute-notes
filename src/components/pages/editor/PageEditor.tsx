"use client";

/**
 * Full-featured page editor (Notion-style) shown in the page side panel.
 * Lazy-loaded; one instance at a time.
 *
 * Unlike canvas blocks, which format through the canvas properties panel, a
 * page uses BlockNote's own UI: `/` slash menu, floating formatting and link
 * toolbars, drag handles with block menus, and table handles. Content lives in
 * the page's Y.Doc; the preview snapshot is mirrored for canvas previews,
 * search and export. The title is edited separately (it is not content).
 */
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import type { BlockNoteEditor } from "@blocknote/core";
import { withCollaboration } from "@blocknote/core/yjs";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect } from "react";
import { handleEditorUndoKey, resetEditorUndo } from "@/components/blocks/editor/docUndo";
import { FRAGMENT, useDocumentProvider, useSnapshotMirror } from "@/components/blocks/editor/documentSession";
import { resolveFileUrl, uploadImage } from "@/components/blocks/editor/imageUpload";
import { pasteHandler } from "@/components/blocks/editor/paste";
import { acuteSchema, type AcuteSchema } from "@/components/blocks/editor/schema";
import type { DocumentProvider } from "@/sync/DocumentProvider";

const LOCAL_USER = { name: "You", color: "#6965db" };

type Editor = BlockNoteEditor<AcuteSchema["blockSchema"], AcuteSchema["inlineContentSchema"], AcuteSchema["styleSchema"]>;

/** What the panel may do with the editor (e.g. Enter in the title moves into the content). */
export interface PageEditorHandle {
  focus(at: "start" | "end"): void;
}

interface PageEditorProps {
  pageId: string;
  theme: "light" | "dark";
  onReady?: (handle: PageEditorHandle | null) => void;
}

export default function PageEditor({ pageId, theme, onReady }: PageEditorProps) {
  const provider = useDocumentProvider(pageId);
  if (!provider) return null;
  return <LoadedPageEditor key={provider.docId} provider={provider} pageId={pageId} theme={theme} onReady={onReady} />;
}

function LoadedPageEditor({
  provider,
  pageId,
  theme,
  onReady,
}: {
  provider: DocumentProvider;
  pageId: string;
  theme: "light" | "dark";
  onReady?: (handle: PageEditorHandle | null) => void;
}) {
  const editor = useCreateBlockNote(
    withCollaboration({
      schema: acuteSchema,
      pasteHandler,
      uploadFile: uploadImage,
      resolveFileUrl,
      collaboration: { fragment: provider.doc.getXmlFragment(FRAGMENT), user: LOCAL_USER },
    }),
    [provider],
  ) as unknown as Editor;

  useSnapshotMirror(editor, pageId, "keep");
  useEffect(() => resetEditorUndo(pageId), [pageId]);

  useEffect(() => {
    if (!onReady) return;
    onReady({
      focus(at) {
        const blocks = editor.document;
        const target = at === "start" ? blocks[0] : blocks.at(-1);
        if (target) {
          try {
            editor.setTextCursorPosition(target, at);
          } catch {
            // Some blocks (e.g. tables, dividers) have no text cursor position.
          }
        }
        editor.focus();
      },
    });
    return () => onReady(null);
  }, [editor, onReady]);

  return (
    <div
      // Ahead of ProseMirror: undo/redo within the page (see docUndo.ts).
      onKeyDownCapture={(e) => {
        if (handleEditorUndoKey(e.nativeEvent, pageId)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <BlockNoteView editor={editor} theme={theme} className="acute-page-editor" />
    </div>
  );
}
