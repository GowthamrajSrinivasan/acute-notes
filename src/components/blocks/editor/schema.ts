/**
 * The deliberately small BlockNote schema used by Acute-Notes (F05–F09).
 * Canvas blocks expose only the reference blocks (see `CANVAS_SLASH_KEYS`);
 * pages add a few Notion-style blocks (quote, toggle list, divider, image). One
 * schema keeps every snapshot renderable by every view.
 */
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  createHeadingBlockSpec,
  createStyleSpec,
  defaultBlockSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import type { BlockFontId } from "@/domain/content/blockStyle";
import { fontCss } from "../blockFonts";
import { BACKGROUND_PALETTE, isCustomColor, resolveColor, TEXT_PALETTE } from "../palette";
import { CODE_LANGUAGES, SUPPORTED_LANGUAGES } from "./codeLanguages";

export { CODE_LANGUAGES };

/**
 * Value styles render real CSS on their span in *every* output — the live
 * editor, BlockNote's static HTML (Editor-view display) and exports — so a
 * value looks identical everywhere. Palette names ("red") resolve to BlockNote's
 * palette; custom colours (Excalidraw hex swatches) are tagged so dark mode can
 * apply the canvas colour filter to them.
 */
function span(): { dom: HTMLSpanElement; contentDOM: HTMLSpanElement } {
  const el = document.createElement("span");
  return { dom: el, contentDOM: el };
}

function colorStyle(type: "textColor" | "backgroundColor", palette: Readonly<Record<string, string>>) {
  const cssProp = type === "textColor" ? "color" : "backgroundColor";
  const render = (value: string | undefined) => {
    const out = span();
    const css = resolveColor(value, palette);
    if (css) out.dom.style[cssProp] = css;
    if (type === "textColor" && isCustomColor(value)) out.dom.dataset.customColor = "true";
    return out;
  };
  return createStyleSpec(
    { type, propSchema: "string" },
    {
      render,
      toExternalHTML: render,
      parse: (el) => (el.tagName === "SPAN" && el.style[cssProp] ? el.style[cssProp] : undefined),
    },
  );
}

/** Inline font family (a `BlockFontId`), for part of the text. */
const fontFamilySpec = createStyleSpec(
  { type: "fontFamily", propSchema: "string" },
  {
    render: (value) => {
      const out = span();
      if (value) out.dom.style.fontFamily = fontCss(value as BlockFontId);
      return out;
    },
    toExternalHTML: (value) => {
      const out = span();
      if (value) out.dom.style.fontFamily = fontCss(value as BlockFontId);
      return out;
    },
  },
);

/** Inline font size in scene px (stored as a number string, e.g. "28"). */
const fontSizeSpec = createStyleSpec(
  { type: "fontSize", propSchema: "string" },
  {
    render: (value) => {
      const out = span();
      if (value) out.dom.style.fontSize = `${Number(value)}px`;
      return out;
    },
    toExternalHTML: (value) => {
      const out = span();
      if (value) out.dom.style.fontSize = `${Number(value)}px`;
      return out;
    },
  },
);

export const acuteSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    // Toggle headings (content fidelity Wave D, progressive disclosure): a heading whose detail folds away.
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: true }),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    table: defaultBlockSpecs.table,
    quote: defaultBlockSpecs.quote,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    divider: defaultBlockSpecs.divider,
    // Pages only (not in CANVAS_SLASH_KEYS); files live in the asset store, see imageUpload.ts.
    image: defaultBlockSpecs.image,
    codeBlock: createCodeBlockSpec({
      indentLineWithTab: true,
      defaultLanguage: "typescript",
      supportedLanguages: SUPPORTED_LANGUAGES,
    }),
  },
  styleSpecs: {
    bold: defaultStyleSpecs.bold,
    italic: defaultStyleSpecs.italic,
    underline: defaultStyleSpecs.underline,
    strike: defaultStyleSpecs.strike,
    code: defaultStyleSpecs.code,
    textColor: colorStyle("textColor", TEXT_PALETTE),
    backgroundColor: colorStyle("backgroundColor", BACKGROUND_PALETTE),
    fontFamily: fontFamilySpec,
    fontSize: fontSizeSpec,
  },
});

export type AcuteSchema = typeof acuteSchema;

/** Slash-menu items offered inside canvas blocks (pages offer every item). */
export const CANVAS_SLASH_KEYS: ReadonlySet<string> = new Set([
  "heading",
  "heading_2",
  "heading_3",
  "numbered_list",
  "bullet_list",
  "check_list",
  "paragraph",
  "code_block",
  "table",
  // Collapsible blocks on the canvas too (Wave D): detail that folds under a line, opened when wanted.
  "toggle_list",
  "toggle_heading",
  "toggle_heading_2",
  "toggle_heading_3",
]);
