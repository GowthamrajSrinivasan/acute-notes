"use client";

/**
 * The `✨ Ask AI` entry point (F18, PRD §6.4): one button in the properties
 * panel, which Excalidraw shows only while something is selected — so it
 * adds no persistent toolbar clutter and never appears on each block. Shown
 * only for selections with content an AI action can use, and never while
 * AI mode is Off.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import { hasUsefulSelection } from "@/ai/context/selectionContext";
import { usePanelSlot } from "@/components/properties/panelSlot";
import { useSelection } from "@/components/properties/selectedBlockStore";
import type { SceneElement } from "@/domain/canvas/adapter";
import { getDocumentStore } from "@/state/documents";
import { HistoryIcon } from "@/components/common/icons";
import { aiPanel, useAIMode, useAIPanel } from "./askAI";

export function AskAISection({ api }: { api: ExcalidrawImperativeAPI }) {
  const mode = useAIMode();
  const selection = useSelection();
  const slot = usePanelSlot("acute-ai-slot");
  const panel = useAIPanel();
  const useful = useMemo(
    () =>
      mode === "on" &&
      hasUsefulSelection(api.getSceneElements() as unknown as readonly SceneElement[], selection, (id) => getDocumentStore().get(id)),
    [api, mode, selection],
  );
  if (!useful) return null;

  return createPortal(
    <fieldset className="acute-text-section">
      <legend>AI</legend>
      <div className="acute-ask-ai__entry-row">
        <button
          type="button"
          className="acute-ask-ai__entry"
          aria-pressed={panel.open && panel.tab === "chat"}
          onClick={() => aiPanel.openChat()}
        >
          <span aria-hidden="true">✨</span> Ask AI
        </button>
        <button
          type="button"
          className="acute-ai-history-toggle"
          aria-label="AI conversation history"
          title="AI conversation history"
          aria-pressed={panel.open && panel.tab === "history"}
          onClick={() => (panel.open && panel.tab === "history" ? aiPanel.close() : aiPanel.openHistory())}
        >
          <HistoryIcon size={16} />
        </button>
      </div>
    </fieldset>,
    slot,
  );
}
