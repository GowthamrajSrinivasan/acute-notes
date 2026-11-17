"use client";

import { lazy, Suspense } from "react";
import type { CanvasCard } from "@/components/openui/canvas/canvasCardsStore";
import { isEmptyContent } from "@/domain/content/richContent";
import type { RichContent } from "@/domain/types";
import type { BlockDisplay } from "@/state/uiPrefs";
import { BlockPreview } from "./BlockPreview";

// Editor-identical static view; loaded only when that display mode is chosen.
const EditorViewPreview = lazy(() => import("./editor/EditorViewPreview"));
// OpenUI card ("Cards" view); loaded only when that display mode is chosen and a card qualifies.
const CanvasOpenUiCard = lazy(() => import("@/components/openui/canvas/CanvasOpenUiCard"));

/**
 * Read-only content of a block or page that is not being edited, in the chosen display mode. In "Cards", only a block
 * given a `card` (a source-citing AI text card, `canvasCardsStore.ts`) is drawn as an OpenUI card; everything else is
 * drawn as in Compact.
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
  card?: { elementId: string; title: string; data: CanvasCard } | null;
}) {
  const compact = <BlockPreview content={content} placeholder={placeholder} />;
  if (display === "compact" || !content || isEmptyContent(content)) return compact;
  if (display === "cards") {
    if (!card) return compact;
    return (
      <Suspense fallback={compact}>
        <CanvasOpenUiCard elementId={card.elementId} title={card.title} content={content} card={card.data} fallback={compact} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={compact}>
      <EditorViewPreview content={content} theme={theme} />
    </Suspense>
  );
}
