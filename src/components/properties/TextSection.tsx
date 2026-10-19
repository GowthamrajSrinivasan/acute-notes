"use client";

/**
 * The single formatting surface for Acute text items and blocks (the editor's
 * floating toolbars are disabled), rendered inside Excalidraw's properties
 * panel with its own markup/classes so it reads as a native section.
 *
 * Scope rule, identical for every control (plan A1):
 * - editing with part of the text selected → only the selection
 * - editing with everything / nothing selected, or item selected → whole item
 *   (item setting + that property's inline overrides cleared)
 *
 * It also tags Excalidraw's native sections (`data-acute-section`) so frameless
 * text can hide the ones that don't apply (stroke, fill, sloppiness, edges).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { DocumentHome } from "@/domain/types";
import { useEffect, useReducer, useState } from "react";
import { createPortal } from "react-dom";
import {
  getActiveEditor,
  subscribeActiveEditors,
  type ActiveEditorHandle,
  type LineType,
  type MarkKey,
  type SelectionFormat,
} from "@/components/blocks/activeEditors";
import { BLOCK_FONTS } from "@/components/blocks/blockFonts";
import { updateBlockStyle } from "@/components/canvas/richBlocks";
import { FONT_SIZES, type BlockFontId, type BlockStyle, type BlockTextAlign } from "@/domain/content/blockStyle";
import { convertNativeText } from "@/components/canvas/convertNativeText";
import { setBlockHref } from "@/components/canvas/richBlocks";
import { EDIT_LINK_EVENT, useSelectedBlock, useSelectedNativeText, type SelectedBlock } from "./selectedBlockStore";
import { usePanelSlot } from "./panelSlot";
import { createTextFormatter } from "./textFormatting";

/** Excalidraw's quick-pick stroke colours; the first is the theme-default ink. */
const TEXT_COLORS = ["#1e1e1e", "#e03131", "#2f9e44", "#1971c2", "#f08c00"] as const;
const ALIGNS: { value: BlockTextAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];
const MARK_BUTTONS: { key: MarkKey; label: string; title: string; style?: React.CSSProperties }[] = [
  { key: "bold", label: "B", title: "Bold (Ctrl+B)", style: { fontWeight: 800 } },
  { key: "italic", label: "I", title: "Italic (Ctrl+I)", style: { fontStyle: "italic", fontFamily: "serif" } },
  { key: "underline", label: "U", title: "Underline (Ctrl+U)", style: { textDecoration: "underline" } },
  { key: "strike", label: "S", title: "Strikethrough", style: { textDecoration: "line-through" } },
  { key: "code", label: "</>", title: "Inline code (Ctrl+E)", style: { fontFamily: "monospace", fontSize: "0.7rem" } },
];
const LINE_TYPES: { value: LineType; label: string }[] = [
  { value: "paragraph", label: "Text" },
  { value: "heading1", label: "Heading 1" },
  { value: "heading2", label: "Heading 2" },
  { value: "heading3", label: "Heading 3" },
  { value: "bulletListItem", label: "Bulleted list" },
  { value: "numberedListItem", label: "Numbered list" },
  { value: "checkListItem", label: "To-do list" },
];

function slug(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Marks native panel sections by their heading so CSS can target them. */
function tagNativeSections(panel: Element) {
  for (const child of Array.from(panel.children)) {
    if ((child as HTMLElement).dataset.acuteSlot !== undefined) continue;
    const heading = child.querySelector(":scope > h3, :scope > legend");
    const name = heading?.textContent ? slug(heading.textContent) : null;
    if (name && (child as HTMLElement).dataset.acuteSection !== name) (child as HTMLElement).dataset.acuteSection = name;
  }
}

/** The live editor's formatting at the selection (re-renders on selection/content change). */
function useEditorFormat(documentId: string, active: boolean): { editor?: ActiveEditorHandle; format?: SelectionFormat } {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!active) return;
    let unsubscribe = () => {};
    const attach = () => {
      unsubscribe();
      const editor = getActiveEditor(documentId);
      unsubscribe = editor ? editor.subscribe(rerender) : () => {};
      rerender();
    };
    attach();
    const offRegistry = subscribeActiveEditors(attach);
    return () => {
      unsubscribe();
      offRegistry();
    };
  }, [documentId, active]);
  const editor = active ? getActiveEditor(documentId) : undefined;
  return { editor, format: editor?.getFormat() };
}

export function TextSection({ api, home }: { api: ExcalidrawImperativeAPI; home: DocumentHome }) {
  const selected = useSelectedBlock();
  const nativeText = useSelectedNativeText();
  // Top of the panel; also tags native sections so CSS can hide inapplicable ones.
  const slot = usePanelSlot("acute-text-slot", tagNativeSections);

  if (selected) return createPortal(<TextControls api={api} selected={selected} />, slot);
  if (nativeText) {
    return createPortal(
      <fieldset className="acute-text-section">
        <legend>Text</legend>
        <button
          type="button"
          className="acute-text-section__convert"
          title="Turn this text into rich text (lists, todos, fonts, inline styles)"
          onClick={() => convertNativeText(api, home, nativeText)}
        >
          Convert to rich text
        </button>
      </fieldset>,
      slot,
    );
  }
  return null;
}

function TextControls({ api, selected }: { api: ExcalidrawImperativeAPI; selected: SelectedBlock }) {
  const { style, elementId, documentId } = selected;
  const { format } = useEditorFormat(documentId, selected.active);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  // Same scope rule as keyboard shortcuts (see textFormatting.ts).
  const fmt = createTextFormatter(api, selected);
  const { applyValue, withText } = fmt;
  const setItem = (patch: Partial<BlockStyle>) => updateBlockStyle(api, elementId, patch);
  // Not editing, the Link control edits the element's own link (like native elements).
  const elementLink = !selected.active;
  useEffect(() => {
    const open = () => setLinkDraft(selected.href ?? "https://");
    window.addEventListener(EDIT_LINK_EVENT, open);
    return () => window.removeEventListener(EDIT_LINK_EVENT, open);
  }, [selected.href]);

  const fontValue = (format?.fontFamily as BlockFontId | undefined) ?? style.fontFamily;
  const sizeValue = format?.fontSize ? Number(format.fontSize) : style.fontSize;
  const alignValue = format?.alignment ?? style.textAlign;
  const colorValue = format?.textColor ?? style.textColor;

  return (
    <fieldset
      className="acute-text-section"
      // Keep the editor's text selection while clicking these controls.
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (!(target instanceof HTMLSelectElement) && !(target instanceof HTMLInputElement && target.type === "url")) {
          e.preventDefault();
        }
      }}
    >
      <legend>Text</legend>
      <select
        className="acute-text-section__font"
        aria-label="Font"
        value={fontValue}
        onChange={(e) => {
          const id = e.target.value as BlockFontId;
          applyValue("fontFamily", id, { fontFamily: id });
        }}
        style={{ fontFamily: BLOCK_FONTS.find((f) => f.id === fontValue)?.css }}
      >
        {BLOCK_FONTS.map((f) => (
          <option key={f.id} value={f.id} style={{ fontFamily: f.css }}>
            {f.label}
          </option>
        ))}
      </select>

      <legend>Font size</legend>
      <div className="buttonList">
        {Object.entries(FONT_SIZES).map(([label, size]) => (
          <label key={label} className={sizeValue === size ? "active" : ""} title={`${label} (${size}px)`}>
            <input
              type="radio"
              name="acute-font-size"
              checked={sizeValue === size}
              onChange={() => applyValue("fontSize", String(size), { fontSize: size })}
            />
            <span className="acute-text-section__glyph">{label}</span>
          </label>
        ))}
      </div>

      <legend>Style</legend>
      <div className="buttonList acute-text-section__marks">
        {MARK_BUTTONS.map((m) => (
          <button
            key={m.key}
            type="button"
            className={format?.marks[m.key] ? "active" : ""}
            title={m.title}
            aria-pressed={!!format?.marks[m.key]}
            onClick={() => withText((e) => e.toggleMark(m.key))}
          >
            <span style={m.style}>{m.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={(elementLink ? selected.href : format?.link) ? "active" : ""}
          title={elementLink ? "Element link (Ctrl+K)" : "Link selected text (Ctrl+K)"}
          onClick={() => setLinkDraft((elementLink ? selected.href : format?.link) ?? "https://")}
        >
          <LinkIcon />
        </button>
        <button type="button" title="Clear formatting" onClick={() => withText((e) => e.clearFormatting())}>
          <span style={{ fontSize: "0.75rem" }}>T̸</span>
        </button>
      </div>
      {linkDraft !== null && (
        <form
          className="acute-text-section__link"
          onSubmit={(e) => {
            e.preventDefault();
            const raw = linkDraft.trim();
            const url = raw && raw !== "https://" ? raw : null;
            if (elementLink) setBlockHref(api, elementId, url);
            else withText((ed) => ed.setLink(url));
            setLinkDraft(null);
          }}
        >
          <input
            type="url"
            autoFocus
            aria-label="Link URL"
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLinkDraft(null)}
          />
          <button type="submit">{linkDraft.trim() ? "Apply" : "Remove"}</button>
        </form>
      )}

      <legend>Turn into</legend>
      <select
        className="acute-text-section__font"
        aria-label="Turn into"
        value={format?.lineType ?? "paragraph"}
        onChange={(e) => withText((ed) => ed.setLineType(e.target.value as LineType), true)}
      >
        {LINE_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <legend>Text align</legend>
      <div className="buttonList">
        {ALIGNS.map((a) => (
          <label key={a.value} className={alignValue === a.value ? "active" : ""} title={a.label}>
            <input
              type="radio"
              name="acute-text-align"
              checked={alignValue === a.value}
              onChange={() => fmt.align(a.value)}
            />
            <AlignIcon align={a.value} />
          </label>
        ))}
      </div>

      <legend>Text color</legend>
      <div className="color-picker__top-picks acute-text-section__colors">
        {TEXT_COLORS.map((c, i) => {
          const isDefault = i === 0;
          const active = isDefault ? !colorValue : colorValue?.toLowerCase() === c;
          return (
            <button
              key={c}
              type="button"
              className={`color-picker__button${active ? " active" : ""}`}
              title={isDefault ? "Default" : c}
              style={{ "--swatch-color": c } as React.CSSProperties}
              onClick={() => applyValue("textColor", isDefault ? null : c, { textColor: isDefault ? undefined : c })}
            >
              <div className="color-picker__button-outline" />
            </button>
          );
        })}
      </div>

      <legend>Frame</legend>
      <div className="buttonList">
        {(["none", "card"] as const).map((f) => (
          <label key={f} className={style.frame === f ? "active" : ""} title={f === "none" ? "Plain text" : "Card"}>
            <input type="radio" name="acute-frame" checked={style.frame === f} onChange={() => setItem({ frame: f, autoWidth: f === "none" })} />
            <span className="acute-text-section__glyph">{f === "none" ? "Aa" : "▢"}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const ALIGN_PATHS: Record<BlockTextAlign, string> = {
  left: "M3 4h12M3 9h8M3 14h11",
  center: "M3 4h12M5 9h8M4 14h10",
  right: "M3 4h12M7 9h8M4 14h11",
};

function AlignIcon({ align }: { align: BlockTextAlign }) {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path d={ALIGN_PATHS[align]} />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  );
}
