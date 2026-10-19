"use client";

import { lazy, Suspense } from "react";
import { isEmptyContent } from "@/domain/content/richContent";
import type { RichContent } from "@/domain/types";
import type { BlockDisplay } from "@/state/uiPrefs";
import { BlockPreview } from "./BlockPreview";

// Editor-identical static view; loaded only when that display mode is chosen.
const EditorViewPreview = lazy(() => import("./editor/EditorViewPreview"));

/** Read-only content of a block or page that is not being edited, in the chosen display mode. */
export function InactiveView({
  content,
  placeholder,
  display,
  theme,
}: {
  content: RichContent | undefined;
  placeholder: string;
  display: BlockDisplay;
  theme: "light" | "dark";
}) {
  const compact = <BlockPreview content={content} placeholder={placeholder} />;
  if (display === "compact" || !content || isEmptyContent(content)) return compact;
  return (
    <Suspense fallback={compact}>
      <EditorViewPreview content={content} theme={theme} />
    </Suspense>
  );
}
