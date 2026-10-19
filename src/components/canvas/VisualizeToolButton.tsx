"use client";

import { createPortal } from "react-dom";
import { useAIMode } from "@/components/ai/askAI";
import { useVisualizeDialog, visualizeDialog } from "@/components/ai/visualizeStore";
import { SparkleIcon } from "@/components/common/icons";
import { useToolbarSlot } from "./toolbarSlot";

/** The toolbar's last item: its "more tools" dropdown. */
const ANCHOR_SELECTOR = ".App-toolbar .App-toolbar__extra-tools-trigger";

/**
 * `✨ Visualize` at the end of Excalidraw's main toolbar: opens the Visualize
 * dialog (the same as `⋮` → "Visualize content…"), which turns content into
 * boxes, lines and sections. Styled as the header's pill toggle so it stands
 * apart from the drawing tools; hidden while AI mode is Off.
 */
export function VisualizeToolButton() {
  const slot = useToolbarSlot(ANCHOR_SELECTOR);
  const mode = useAIMode();
  const dialog = useVisualizeDialog();
  if (mode !== "on") return null;
  return createPortal(
    <>
      <div className="App-toolbar__divider" aria-hidden="true" />
      <div className="acute-visualize-tool">
        <button
          type="button"
          className="acute-visualize-tool__button"
          title="Visualize — turn notes or pasted text into boxes, lines and sections"
          aria-haspopup="dialog"
          aria-pressed={dialog.open}
          data-testid="toolbar-acute-visualize"
          onClick={() => visualizeDialog.open()}
        >
          <SparkleIcon size={14} />
          Visualize
        </button>
      </div>
    </>,
    slot,
  );
}
