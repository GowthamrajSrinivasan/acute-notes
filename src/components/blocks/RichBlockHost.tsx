"use client";

import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { layoutStateOf } from "@/ai/openui/cardLayout";
import { isFlowLang } from "@/ai/openui/flowLayout";
import { useAIMode } from "@/components/ai/askAI";
import { useCanvasBridge } from "@/components/canvas/CanvasBridge";
import { NO_CARD_INFO, NO_CARDS_HOST, useCanvasCard, useCanvasNoteMode } from "@/components/openui/canvas/canvasCardsStore";
import { toPlainText } from "@/domain/content/richContent";
import type { BlockFontId, BlockFrame, BlockTextAlign } from "@/domain/content/blockStyle";
import type { RichBlockType } from "@/domain/types";
import { useDocumentRecord } from "@/state/documents";
import { useUiPref } from "@/state/uiPrefs";
import { fontCss } from "./blockFonts";
import { BlockPreview } from "./BlockPreview";
import { InactiveView } from "./InactiveView";

// BlockNote (+ Mantine) is loaded only when a block is first edited.
const RichBlockEditor = lazy(() => import("./editor/RichBlockEditor"));
// Opening a layout card asks first (note-taking-modes Step 7); loaded only when one is opened.
const LayoutCardGuard = lazy(() => import("@/components/openui/canvas/LayoutCardGuard"));

const PLACEHOLDER: Record<RichBlockType, string> = {
  text: "Empty text block — double-click to write",
  todo: "Empty checklist — double-click to add tasks",
  table: "Empty table",
  code: "Empty code block",
};

/** Native events that must not reach Excalidraw's document-level handlers. */
const ISOLATED_EVENTS = ["copy", "cut", "paste", "keyup"] as const;

interface RichBlockHostProps {
  elementId: string;
  documentId: string;
  blockType: RichBlockType;
  active: boolean;
  theme: "light" | "dark";
  /** The element's background colour (the DOM layer covers the canvas-drawn fill). */
  background: string;
  /** Resolved content colour for the current theme (undefined = theme default). */
  textColor: string | undefined;
  frame: BlockFrame;
  fontFamily: BlockFontId;
  fontSize: number;
  textAlign: BlockTextAlign;
  /** Frameless text only: width follows the longest line. */
  autoWidth: boolean;
  /** Cards only: height follows the content until the user resizes the block. */
  autoHeight: boolean;
  /** Element-level hyperlink (like a native element link). */
  href?: string;
}

/**
 * Canvas host for one rich block. Memoised on primitive props, so Excalidraw
 * re-rendering its embeddable layer (e.g. while dragging) does not re-render
 * block content. Inactive → static preview; active → one BlockNote editor.
 */
export const RichBlockHost = memo(function RichBlockHost({
  elementId,
  documentId,
  blockType,
  active,
  theme,
  background,
  textColor,
  frame,
  fontFamily,
  fontSize,
  textAlign,
  autoWidth,
  autoHeight,
  href,
}: RichBlockHostProps) {
  const record = useDocumentRecord(documentId);
  const display = useUiPref("blockDisplay");
  // "Cards" view: a source-citing AI text card's citations and review, as plain data (null for any other block).
  const canvasCard = useCanvasCard(elementId);
  // …and the canvas's mode: on an AI-managed canvas every text block is a card (note-taking-modes plan §4.2).
  const noteMode = useCanvasNoteMode();
  const bridge = useCanvasBridge();
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const frameless = frame === "none";

  // "Cards" view: this block is drawn as an OpenUI card. It keeps the box it has: a view must not move or resize anything
  // (sizes are stored in the scene, and a taller card would overlap its neighbours), so the card fits itself to the box.
  // Which blocks qualify: a source-citing card, any card with a stored layout, and every framed text block on an
  // AI-managed canvas — frameless text is writing on the whiteboard, not a card, and keeps its look (squeezed into its
  // one-line box a card would be clipped). What it draws (stored layout, derived card, or Compact) is `cardRenderPlan`'s.
  const openUiCard =
    !active && display === "cards" && blockType === "text" && !!record && (!!canvasCard || !!record.layout || (noteMode === "ai" && !frameless));

  // Opening a card the Cards view draws from its stored layout (note-taking-modes Step 7): editing its text would leave the
  // layout out of date and lose the drawing, so it asks first. On an AI-managed canvas: "Ask AI to change…" or "Switch to
  // editable"; on a Manual one the editor opens with a warning. A flow card is exempt: it is redrawn from its text.
  const aiMode = useAIMode();
  const layoutAtRisk =
    active && display === "cards" && blockType === "text" && !!record?.layout && layoutStateOf(record) === "current" && !isFlowLang(record.layout.lang);
  const [layoutChoice, setLayoutChoice] = useState<"choose" | "ask" | "edit" | null>(null);
  // Each opening asks again: the choice is forgotten when the block is left (adjusted while rendering, not in an effect).
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setLayoutChoice(null);
  }
  const layoutView = layoutAtRisk ? (layoutChoice ?? (noteMode === "ai" ? "choose" : "edit")) : null;
  const guarded = layoutView === "choose" || layoutView === "ask";

  // Frameless text sizes itself to its content (height always, width while autoWidth); so does an auto-height card's height.
  // A card with a stored layout keeps the box it was given in every view: fitted to its text in Compact, its layout would
  // be clipped in Cards (which never resizes). The editor still grows it while editing (`active`); the layout chooser
  // fills the box as it is (it scrolls), never resizing the card.
  const fitsContent = (frameless || autoHeight) && !openUiCard && !guarded && (active || !record?.layout);
  useEffect(() => {
    const el = contentRef.current;
    if (!fitsContent || !el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      // offsetWidth/Height are layout sizes, unaffected by the canvas zoom transform.
      bridge.resize(elementId, frameless && autoWidth ? Math.ceil(el.offsetWidth) : null, Math.ceil(el.offsetHeight));
    };
    const observer = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(measure);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [fitsContent, frameless, autoWidth, elementId, bridge]);

  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const stop = (e: Event) => e.stopPropagation();
    // Scroll the block content instead of the canvas; Ctrl/⌘+wheel still zooms.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
    };
    for (const type of ISOLATED_EVENTS) el.addEventListener(type, stop);
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      for (const type of ISOLATED_EVENTS) el.removeEventListener(type, stop);
      el.removeEventListener("wheel", onWheel);
    };
  }, [active]);

  return (
    <div
      ref={ref}
      className="acute-block"
      data-element-id={elementId}
      data-block-type={blockType}
      data-active={active || undefined}
      data-theme={theme}
      data-frame={frame}
      data-autowidth={(frameless && autoWidth) || undefined}
      data-autoheight={(!frameless && autoHeight && !openUiCard) || undefined}
      data-openui={openUiCard || undefined}
      style={
        {
          "--acute-block-bg": background,
          "--acute-block-fg": textColor,
          "--acute-block-font": fontCss(fontFamily),
          "--acute-block-size": `${fontSize}px`,
          "--acute-block-align": textAlign,
        } as React.CSSProperties
      }
      // Keys typed in the editor (and its portalled menus) must not trigger
      // canvas shortcuts: Excalidraw does not treat contenteditable as writable.
      onKeyDown={(e) => {
        e.stopPropagation();
        // BlockNote marks Escape as handled even when nothing is open, so only
        // defer to it while its slash menu is showing.
        if (e.key === "Escape" && active && !document.querySelector(".bn-suggestion-menu")) {
          e.preventDefault();
          bridge.deactivate(elementId);
        }
      }}
    >
      <div className="acute-block__bg" aria-hidden="true" />
      {href && !active && (
        <a className="acute-block__href" href={href} target="_blank" rel="noopener noreferrer" title={href}>
          ↗
        </a>
      )}
      {active && blockType === "code" && <CopyCodeButton text={record ? toPlainText(record.snapshot) : ""} />}
      <div className="acute-block__content" ref={contentRef}>
        {active && guarded ? (
          <Suspense fallback={<BlockPreview content={record?.snapshot} placeholder={PLACEHOLDER[blockType]} />}>
            <LayoutCardGuard
              elementId={elementId}
              card={{ snapshot: record!.snapshot, ...(record!.layout ? { layout: record!.layout } : {}) }}
              passages={canvasCard?.info.passages ?? NO_CARD_INFO.passages}
              view={layoutView}
              aiOn={aiMode === "on"}
              onView={setLayoutChoice}
              onClose={() => bridge.deactivate(elementId)}
            />
          </Suspense>
        ) : active ? (
          <>
            {layoutView === "edit" && (
              <div className="acute-layout-warning" role="note" data-testid="acute-layout-warning">
                Editing the text leaves this card&apos;s layout out of date (it is then drawn from its text).
                {aiMode === "on" && (
                  <button type="button" onClick={() => setLayoutChoice("ask")}>
                    Ask AI to change instead
                  </button>
                )}
              </div>
            )}
            <Suspense fallback={<BlockPreview content={record?.snapshot} placeholder={PLACEHOLDER[blockType]} />}>
              <RichBlockEditor documentId={documentId} theme={theme} frameless={frameless} />
            </Suspense>
          </>
        ) : (
          <InactiveView
            content={record?.snapshot}
            placeholder={record === null ? "Content unavailable" : frameless ? "" : PLACEHOLDER[blockType]}
            display={display}
            theme={theme}
            card={
              openUiCard
                ? { elementId, documentId, title: record!.title, data: canvasCard ?? { info: NO_CARD_INFO, host: NO_CARDS_HOST }, layout: record!.layout, noteMode }
                : null
            }
          />
        )}
      </div>
    </div>
  );
});

function CopyCodeButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="acute-block__copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
