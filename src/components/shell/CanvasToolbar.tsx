"use client";

import { useEffect, useId, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { aiPanel, useAIMode, useAIPanel } from "@/components/ai/askAI";
import {
  CANVAS_BACKGROUNDS,
  getCanvasCommands,
  subscribeCanvasCommands,
  type CanvasCommands,
} from "@/components/canvas/canvasCommands";
import { ChevronDownIcon, MoonIcon, SunIcon } from "@/components/common/icons";
import type { MenuItem } from "@/components/common/RowMenu";
import { useDocumentTheme } from "@/components/common/useDocumentTheme";
import { useSelectedBlock } from "@/components/properties/selectedBlockStore";
import { downloadMarkdown } from "@/portability/markdownExport";
import { usePagePanel } from "@/state/pagePanel";
import { setUiPref, useUiPref } from "@/state/uiPrefs";
import { SaveIndicator } from "./SaveIndicator";
import { useActionRunner } from "./useActionRunner";

/** The open canvas's commands; re-renders when a canvas mounts or unmounts. */
function useCanvasCommands(): CanvasCommands | null {
  return useSyncExternalStore(subscribeCanvasCommands, getCanvasCommands, () => null);
}

function ToolButton({
  label,
  shortcut,
  disabledReason,
  pressed,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  /** Set when the button is disabled; shown in the tooltip. */
  disabledReason?: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const tooltip = [label, shortcut && `(${shortcut})`, disabledReason && `— ${disabledReason}`].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className="acute-toolbar__button"
      aria-label={label}
      aria-pressed={pressed}
      title={tooltip}
      disabled={!!disabledReason}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const Sep = () => <span className="acute-toolbar__sep" aria-hidden="true" />;

/**
 * Canvas-level actions (export image, reset, canvas/Markdown export) as items for
 * the header's `⋮` menu. Build the items when the menu opens so their
 * enabled state reflects the current canvas, page and selection; render
 * `errorDialog` alongside the menu. "Export canvas…" calls `onExportCanvas`
 * (the header owns that dialog).
 */
export function useCanvasMenuItems({ onExportCanvas }: { onExportCanvas: () => void }): { items: MenuItem[]; errorDialog: ReactNode } {
  const canvas = useCanvasCommands();
  const { pageId } = usePagePanel();
  const selectedBlock = useSelectedBlock();
  const { run, errorDialog } = useActionRunner();

  const exportMarkdown = (documentId: string, asPage: boolean) =>
    run(() => downloadMarkdown(documentId, asPage), "Couldn't export Markdown");

  const items: MenuItem[] = [
    {
      label: "Export image",
      hint: "Ctrl+Shift+E",
      separatorBefore: true,
      disabled: !canvas,
      onSelect: () => canvas?.openExportImage(),
    },
    {
      label: "Convert all text to rich text",
      disabled: !canvas,
      onSelect: () => canvas?.convertAllNativeText(),
    },
    {
      label: "Reset the canvas",
      disabled: !canvas,
      onSelect: () => {
        const message =
          "Reset the canvas? Every drawing, block and page preview on it is removed (Ctrl+Z undoes this). " +
          "Its pages stay in the navigator.";
        if (window.confirm(message)) canvas?.resetCanvas();
      },
    },
    {
      label: "Export canvas…",
      separatorBefore: true,
      disabled: !canvas,
      onSelect: onExportCanvas,
    },
    {
      label: "Export page as Markdown",
      disabled: !pageId,
      onSelect: () => pageId && exportMarkdown(pageId, true),
    },
    {
      label: "Export block as Markdown",
      disabled: !selectedBlock,
      onSelect: () => selectedBlock && exportMarkdown(selectedBlock.documentId, false),
    },
  ];

  return { items, errorDialog };
}

/**
 * Header toolbar (right side): appearance (block View toggle, theme, canvas
 * background) and the save status. Canvas-level actions live in the `⋮`
 * menu (`useCanvasMenuItems`). Help is Excalidraw's own button (bottom right).
 */
export function CanvasToolbar() {
  const canvas = useCanvasCommands();
  const theme = useDocumentTheme();
  const blockDisplay = useUiPref("blockDisplay");
  const noCanvas = canvas ? undefined : "open a canvas first";

  const editorView = blockDisplay === "editor";

  return (
    <div className="acute-toolbar" role="toolbar" aria-label="Canvas tools">
      <ViewToggle editorView={editorView} />
      <ToolButton
        label={theme === "dark" ? "Light mode" : "Dark mode"}
        shortcut="Shift+Alt+D"
        disabledReason={noCanvas}
        onClick={() => canvas?.setTheme(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? <SunIcon size={17} /> : <MoonIcon size={17} />}
      </ToolButton>
      <BackgroundPicker canvas={canvas} />
      <SaveIndicator before={<Sep />} className="acute-toolbar__status" />
    </div>
  );
}

/**
 * `✨ Ask AI` (same button as the properties panel's). Opens a new chat about
 * the selection when there is one, else about the whole canvas; hidden while
 * AI mode is Off.
 */
export function AskAIButton() {
  const canvasOpen = useCanvasCommands() !== null;
  const mode = useAIMode();
  const panel = useAIPanel();
  if (mode !== "on") return null;
  return (
    <button
      type="button"
      className="acute-ask-ai__entry acute-ask-ai__entry--header"
      title={canvasOpen ? "Ask AI about the selection, or the whole canvas" : "Ask AI — open a canvas first"}
      disabled={!canvasOpen}
      aria-pressed={panel.open && panel.tab === "chat"}
      onClick={() => aiPanel.openChat({ context: "auto" })}
    >
      <span aria-hidden="true">✨</span> Ask AI
    </button>
  );
}

/** Canvas background: a swatch of the current colour; the palette opens on click. */
function BackgroundPicker({ canvas }: { canvas: CanvasCommands | null }) {
  const [open, setOpen] = useState(false);
  // The colour lives in the canvas; re-render after changing it here.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = canvas?.getBackground() ?? "#ffffff";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const pick = (color: string) => {
    canvas?.setBackground(color);
    refresh();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="acute-toolbar__button acute-toolbar__button--swatch"
        aria-label="Canvas background"
        aria-haspopup="true"
        aria-expanded={open}
        title={canvas ? `Canvas background (${current})` : "Canvas background — open a canvas first"}
        disabled={!canvas}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="acute-toolbar__swatch" style={{ background: current }} />
        <ChevronDownIcon size={12} />
      </button>
      {open && canvas && (
        <div className="acute-popover" role="dialog" aria-label="Canvas background">
          <div className="acute-popover__title">Canvas background</div>
          <div className="acute-popover__swatches" role="radiogroup" aria-label="Background colours">
            {CANVAS_BACKGROUNDS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={current.toLowerCase() === color}
                aria-label={color}
                title={color}
                className="acute-popover__swatch"
                style={{ background: color }}
                onClick={() => pick(color)}
              />
            ))}
            <span className="acute-popover__sep" aria-hidden="true" />
            <label className="acute-popover__swatch acute-popover__swatch--custom" title="Custom colour">
              <input
                type="color"
                aria-label="Custom canvas background"
                value={/^#[0-9a-f]{6}$/i.test(current) ? current : "#ffffff"}
                onChange={(e) => pick(e.target.value)}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

const VIEW_OPTIONS = [
  { value: "compact", label: "Compact", tooltip: "Compact — blocks show lightweight previews (faster)" },
  { value: "editor", label: "Editor", tooltip: "Editor — blocks look exactly as while editing" },
] as const;

/** How inactive blocks are drawn on the canvas: a "View" segmented toggle (Compact | Editor). */
function ViewToggle({ editorView }: { editorView: boolean }) {
  const labelId = useId();
  const value = editorView ? "editor" : "compact";
  return (
    <div className="acute-view-toggle" title="How blocks look on the canvas when you are not editing them">
      <span id={labelId} className="acute-view-toggle__label">
        View
      </span>
      <div className="acute-segmented" role="radiogroup" aria-labelledby={labelId} data-value={value}>
        {VIEW_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            title={o.tooltip}
            onClick={() => setUiPref("blockDisplay", o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
