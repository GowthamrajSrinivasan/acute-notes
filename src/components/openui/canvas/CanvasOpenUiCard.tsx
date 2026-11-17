"use client";

/**
 * One canvas card drawn as an OpenUI card (the "Cards" view, `.ai/docs/openui/openui-canvas-rendering-plan-2026-11-16.md`
 * step 5). Loaded only when that view is chosen, so OpenUI stays out of the main bundle otherwise.
 *
 * Read-only: the Lang is built from the card's stored content (`cardLangOf`), and double-click still opens BlockNote
 * exactly as before. The card's own body lets pointer events through to the canvas (select, drag, double-click to edit);
 * only its buttons (citation chips, "More", "Open in source") take clicks, and those never start a canvas drag.
 */
import type { OpenUIError } from "@openuidev/react-lang";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { cardLangOf } from "@/ai/openui/cardLang";
import { NotesHostProvider, type NotesHost } from "@/ai/openui/hostContext";
import { OpenUiCardRenderer } from "@/components/openui/OpenUiCardRenderer";
import type { RichContent } from "@/domain/types";
import type { CanvasCard } from "./canvasCardsStore";
import "../interactions.css";
import "../notes/notes.css";

export interface CanvasOpenUiCardProps {
  elementId: string;
  title: string;
  content: RichContent;
  card: CanvasCard;
  /** What is drawn instead when the card can't be (no text, or Lang that doesn't parse). */
  fallback: ReactNode;
}

export default function CanvasOpenUiCard({ elementId, title, content, card, fallback }: CanvasOpenUiCardProps) {
  const { info, host } = card;
  const lang = useMemo(() => cardLangOf({ title, snapshot: content }, info), [title, content, info]);
  const [failed, setFailed] = useState<string | null>(null);
  const onError = useCallback(
    (errors: OpenUIError[]) => {
      if (errors.length) setFailed(lang);
    },
    [lang],
  );
  const notesHost = useMemo<NotesHost>(
    () => ({
      noteId: elementId,
      unitText: (u: string) => info.passages.get(u),
      openSource: (us: readonly string[]) => host.openSource(elementId, us),
    }),
    [elementId, info, host],
  );
  // A failure is remembered for the Lang that failed only: an edit that fixes the content draws the card again.
  if (!lang || failed === lang) return <>{fallback}</>;
  return (
    <div className="acute-openui-card" data-testid="acute-openui-card" onPointerDown={(e) => e.stopPropagation()}>
      <NotesHostProvider value={notesHost}>
        <OpenUiCardRenderer response={lang} onError={onError} />
      </NotesHostProvider>
    </div>
  );
}
