"use client";

import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { useCanvasBridge } from "@/components/canvas/CanvasBridge";
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
  const bridge = useCanvasBridge();
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const frameless = frame === "none";

  // Frameless text sizes itself to its content (height always, width while autoWidth); so does an auto-height card's height.
  const fitsContent = frameless || autoHeight;
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
      data-autoheight={(!frameless && autoHeight) || undefined}
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
        {active ? (
          <Suspense fallback={<BlockPreview content={record?.snapshot} placeholder={PLACEHOLDER[blockType]} />}>
            <RichBlockEditor documentId={documentId} theme={theme} frameless={frameless} />
          </Suspense>
        ) : (
          <InactiveView
            content={record?.snapshot}
            placeholder={record === null ? "Content unavailable" : frameless ? "" : PLACEHOLDER[blockType]}
            display={display}
            theme={theme}
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
