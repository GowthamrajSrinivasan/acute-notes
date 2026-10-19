"use client";

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BlockPreview } from "@/components/blocks/BlockPreview";
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CollapseIcon,
  CopyIcon,
  ExpandIcon,
  LocateIcon,
  PageIcon,
} from "@/components/common/icons";
import { RowMenu, type OpenMenu } from "@/components/common/RowMenu";
import { useActionRunner } from "@/components/shell/useActionRunner";
import { useDocumentTheme } from "@/components/common/useDocumentTheme";
import { UNTITLED_PAGE } from "@/domain/content/richContent";
import { formatEdited } from "@/domain/pages/formatEdited";
import { renamePage } from "@/domain/pages/pageCommands";
import { documentMarkdown, downloadMarkdown } from "@/portability/markdownExport";
import { useDocumentRecord } from "@/state/documents";
import { pagePanel, usePagePanel } from "@/state/pagePanel";
import { setUiPref, useUiPref } from "@/state/uiPrefs";
import type { PageEditorHandle } from "./editor/PageEditor";

// BlockNote (+ Mantine) loads with the first opened page.
const PageEditor = lazy(() => import("./editor/PageEditor"));

const MIN_WIDTH = 380;
/** Canvas width always left visible next to the docked panel. */
const MIN_CANVAS_WIDTH = 240;

const iconButton =
  "inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent " +
  "text-[var(--acute-text-muted)] hover:bg-[var(--acute-surface-muted)] hover:text-[var(--acute-text)]";

/**
 * Side panel ("side peek") with the open page as a full document (F09/F16).
 * Docked to the right of the canvas, resizable, or expanded over the canvas;
 * the canvas stays mounted either way, so viewport and selection survive.
 */
export function PagePanel() {
  const { pageId, expanded } = usePagePanel();
  if (!pageId) return null;
  return <OpenPagePanel key={pageId} pageId={pageId} expanded={expanded} />;
}

function OpenPagePanel({ pageId, expanded }: { pageId: string; expanded: boolean }) {
  const record = useDocumentRecord(pageId);
  const theme = useDocumentTheme();
  const storedWidth = useUiPref("pagePanelWidth");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<PageEditorHandle | null>(null);
  const handleEditorReady = useCallback((handle: PageEditorHandle | null) => {
    editorRef.current = handle;
  }, []);

  // A deleted page closes its panel.
  useEffect(() => {
    if (record === null) pagePanel.close();
  }, [record]);

  // New pages start in the title.
  useEffect(() => {
    if (pagePanel.takeFocusTitle(pageId)) titleRef.current?.focus();
  }, [pageId]);

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const right = parent.getBoundingClientRect().right;
    const max = Math.max(MIN_WIDTH, parent.clientWidth - MIN_CANVAS_WIDTH);
    let width = panel.offsetWidth;
    const onMove = (ev: PointerEvent) => {
      width = Math.round(Math.min(max, Math.max(MIN_WIDTH, right - ev.clientX)));
      setDragWidth(width);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      setUiPref("pagePanelWidth", width);
      setDragWidth(null);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  // Escape: first leaves the text (unless a BlockNote menu is open), then closes the panel.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const target = e.target as HTMLElement;
    // An open menu closes itself on Escape; keep the panel open.
    if (target.closest('[role="menu"]')) return;
    if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      if (document.querySelector(".bn-suggestion-menu, .bn-grid-suggestion-menu")) return;
      e.preventDefault();
      panelRef.current?.focus();
      return;
    }
    e.preventDefault();
    pagePanel.close();
  };

  const locate = () => {
    const canvas = getCanvasCommands();
    if (!canvas) return;
    if (!canvas.revealPage(pageId)) canvas.insertPagePreview(pageId);
  };

  const title = record?.title ?? "";
  const width = dragWidth ?? storedWidth;

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      data-acute-page-panel=""
      data-expanded={expanded || undefined}
      data-theme={theme}
      aria-label={`Page: ${title.trim() || UNTITLED_PAGE}`}
      className="acute-page-panel acute-side-panel"
      style={expanded ? undefined : { width }}
      onKeyDown={onKeyDown}
    >
      {!expanded && (
        <div
          className="acute-page-panel__resize acute-side-panel__resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize page panel"
          onPointerDown={onResizeStart}
          onDoubleClick={() => setUiPref("pagePanelWidth", 560)}
        />
      )}
      <header className="acute-page-panel__bar acute-side-panel__bar">
        <button type="button" className={iconButton} title="Close — Esc" aria-label="Close page" onClick={pagePanel.close}>
          <CloseIcon size={16} />
        </button>
        <button
          type="button"
          className={iconButton}
          title={expanded ? "Dock to the side" : "Expand to full width"}
          aria-label={expanded ? "Dock page panel" : "Expand page panel"}
          aria-pressed={expanded}
          onClick={() => pagePanel.setExpanded(!expanded)}
        >
          {expanded ? <CollapseIcon size={15} /> : <ExpandIcon size={15} />}
        </button>
        <div className="acute-page-panel__crumb acute-side-panel__crumb">
          <PageIcon size={14} />
          <span className="truncate">{title.trim() || UNTITLED_PAGE}</span>
        </div>
        <CopyPageButton pageId={pageId} />
        <button type="button" className={iconButton} title="Show on canvas" aria-label="Show on canvas" onClick={locate}>
          <LocateIcon size={16} />
        </button>
      </header>
      <div
        className="acute-page-panel__scroll"
        // Clicking the empty space below the content continues writing at the end (like Notion).
        onMouseDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("acute-page-panel__doc")) {
            e.preventDefault();
            editorRef.current?.focus("end");
          }
        }}
      >
        <div className="acute-page-panel__doc">
          <PageTitle
            ref={titleRef}
            value={title}
            disabled={!record}
            onChange={(value) => renamePage(pageId, value)}
            onEnter={() => editorRef.current?.focus("start")}
          />
          <div className="acute-page-panel__meta">{record ? formatEdited(record.updatedAt) : " "}</div>
          <div className="acute-page-panel__content">
            <Suspense
              fallback={
                <div className="acute-block" data-theme={theme}>
                  <BlockPreview content={record?.snapshot} placeholder="" />
                </div>
              }
            >
              <PageEditor pageId={pageId} theme={theme} onReady={handleEditorReady} />
            </Suspense>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Copies the page as Markdown; the chevron opens "Export as Markdown" (a `.md` download). */
function CopyPageButton({ pageId }: { pageId: string }) {
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const { run, errorDialog } = useActionRunner();

  const copy = () =>
    run(async () => {
      const { markdown } = await documentMarkdown(pageId, true);
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }, "Couldn't copy the page");

  return (
    <div className="acute-split-button">
      <button
        type="button"
        className={iconButton}
        title={copied ? "Copied" : "Copy page as Markdown"}
        aria-label="Copy page as Markdown"
        onClick={copy}
      >
        {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
      </button>
      <button
        type="button"
        className={`${iconButton} acute-split-button__chevron`}
        title="More copy options"
        aria-label="More copy options"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        data-acute-menu-anchor=""
        onClick={(e) => {
          const anchor = e.currentTarget.getBoundingClientRect();
          setMenu((m) =>
            m
              ? null
              : {
                  id: "page-copy",
                  label: "Copy options",
                  anchor,
                  items: [
                    {
                      label: "Export as Markdown",
                      onSelect: () => run(() => downloadMarkdown(pageId, true), "Couldn't export Markdown"),
                    },
                  ],
                },
          );
        }}
      >
        <ChevronDownIcon size={12} />
      </button>
      {menu && <RowMenu menu={menu} onClose={() => setMenu(null)} />}
      {errorDialog}
    </div>
  );
}

interface PageTitleProps {
  ref: React.Ref<HTMLTextAreaElement>;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onEnter: () => void;
}

/** Large, auto-growing page title (wraps like a heading; Enter moves into the content). */
function PageTitle({ ref, value, disabled, onChange, onEnter }: PageTitleProps) {
  const local = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = useCallback(
    (el: HTMLTextAreaElement | null) => {
      local.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.RefObject<HTMLTextAreaElement | null>).current = el;
    },
    [ref],
  );

  useLayoutEffect(() => {
    const el = local.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={setRefs}
      className="acute-page-panel__title"
      rows={1}
      value={value}
      placeholder={UNTITLED_PAGE}
      aria-label="Page title"
      disabled={disabled}
      spellCheck
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter();
        } else if (e.key === "ArrowDown" && e.currentTarget.selectionStart === e.currentTarget.value.length) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}
