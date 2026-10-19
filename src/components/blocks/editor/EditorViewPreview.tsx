"use client";

/**
 * "Editor view" display for inactive blocks: BlockNote's own static HTML
 * (`blocksToFullHTML`) rendered with BlockNote's stylesheet, so a block looks
 * exactly as it does while editing — without mounting an editor per block.
 *
 * One headless editor performs all conversions; results are cached per
 * snapshot object, so re-renders and unchanged blocks cost nothing.
 */
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { BlockNoteEditor } from "@blocknote/core";
import { darkDefaultTheme, lightDefaultTheme } from "@blocknote/mantine";
import { memo, useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { RichContent } from "@/domain/types";
import { resolveImageUrl } from "../imageAssets";
import { acuteSchema } from "./schema";

let converter: BlockNoteEditor | null = null;
const cache = new WeakMap<RichContent, string>();

function toFullHtml(content: RichContent): string {
  const hit = cache.get(content);
  if (hit !== undefined) return hit;
  converter ??= BlockNoteEditor.create({ schema: acuteSchema }) as unknown as BlockNoteEditor;
  let html: string;
  try {
    html = converter.blocksToFullHTML(content as never);
  } catch (err) {
    console.error("[acute-notes] Failed to render block HTML", err);
    html = "";
  }
  // Stored images: the browser can't load `acute-asset://`; the component fills in blob URLs.
  html = html.replace(/<img([^>]*?) src="(acute-asset:\/\/[^"]*)"/g, '<img$1 data-acute-src="$2"');
  cache.set(content, html);
  return html;
}

/**
 * BlockNote's named text and background colours resolve through
 * `--bn-colors-highlights-*` variables, which `BlockNoteView` sets on the live
 * editor only. Without them here a coloured block (an AI title's accent, a
 * side-menu colour) shows no colour. Only the highlights: the editor's own
 * background, text and font stay with `globals.css`.
 */
function highlightVars(theme: "light" | "dark"): CSSProperties {
  const highlights = (theme === "dark" ? darkDefaultTheme : lightDefaultTheme).colors.highlights;
  return Object.fromEntries(
    Object.entries(highlights).flatMap(([name, c]) => [
      [`--bn-colors-highlights-${name}-text`, c.text],
      [`--bn-colors-highlights-${name}-background`, c.background],
    ]),
  ) as CSSProperties;
}

const HIGHLIGHTS = { light: highlightVars("light"), dark: highlightVars("dark") };

interface EditorViewPreviewProps {
  content: RichContent;
  theme: "light" | "dark";
}

const EditorViewPreview = memo(function EditorViewPreview({ content, theme }: EditorViewPreviewProps) {
  const html = useMemo(() => toFullHtml(content), [content]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const img of ref.current?.querySelectorAll<HTMLImageElement>("img[data-acute-src]") ?? []) {
      void resolveImageUrl(img.dataset.acuteSrc!).then((src) => {
        if (src) img.src = src;
      });
    }
  }, [html]);
  return (
    <div
      className="bn-container bn-mantine acute-editor-view"
      data-color-scheme={theme}
      data-mantine-color-scheme={theme}
      style={HIGHLIGHTS[theme]}
      aria-readonly="true"
    >
      {/* Markup produced by BlockNote's serializer from our own document state.
          `ProseMirror` mirrors the live editor's class list: BlockNote's table
          CSS (default 120px column min-width) only matches `.ProseMirror td`. */}
      <div ref={ref} className="ProseMirror bn-editor bn-default-styles" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

export default EditorViewPreview;
