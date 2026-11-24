"use client";

import { lazy, Suspense } from "react";
import type { CanvasCard } from "@/components/openui/canvas/canvasCardsStore";
import { isEmptyContent } from "@/domain/content/richContent";
import type { CardLayout, NoteMode, RichContent } from "@/domain/types";
import type { BlockDisplay } from "@/state/uiPrefs";
import { BlockPreview } from "./BlockPreview";

// Editor-identical static view; loaded only when that display mode is chosen.
const EditorViewPreview = lazy(() => import("./editor/EditorViewPreview"));
// OpenUI card ("Cards" view); loaded only when that display mode is chosen and a card qualifies.
const CanvasOpenUiCard = lazy(() => import("@/components/openui/canvas/CanvasOpenUiCard"));

/** A text block the Cards view may draw as an OpenUI card (`RichBlockHost` decides which qualify). */
export interface InactiveCard {
  elementId: string;
  /** The block's document, for "Remove layout" on a stale stored layout. */
  documentId?: string;
  title: string;
  data: CanvasCard;
  layout?: CardLayout;
  noteMode?: NoteMode;
}

/**
 * Read-only content of a block or page that is not being edited, in the chosen display mode. In "Cards", only a block
 * given a `card` is drawn as an OpenUI card (its stored layout or the card derived from its text, `cardRenderPlan`);
 * everything else, and any card with nothing to draw, is drawn as in Compact.
 */
export function InactiveView({
  content,
  placeholder,
  display,
  theme,
  card,
}: {
  content: RichContent | undefined;
  placeholder: string;
  display: BlockDisplay;
  theme: "light" | "dark";
  card?: InactiveCard | null;
}) {
  const compact = <BlockPreview content={content} placeholder={placeholder} />;
  if (display === "compact" || !content || isEmptyContent(content)) return compact;
  if (display === "cards") {
    if (!card) return compact;
    return (
      <Suspense fallback={compact}>
        <CanvasOpenUiCard
          elementId={card.elementId}
          documentId={card.documentId}
          title={card.title}
          content={content}
          card={card.data}
          layout={card.layout}
          noteMode={card.noteMode ?? "manual"}
          fallback={compact}
        />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={compact}>
      <EditorViewPreview content={content} theme={theme} />
    </Suspense>
  );
}
