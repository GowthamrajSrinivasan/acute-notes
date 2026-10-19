/**
 * Image export that includes Acute text items and blocks (plan B#9).
 *
 * Excalidraw's own export paints embeddables as grey placeholders. Here the
 * scene is exported with Acute items replaced by invisible placeholders (so
 * the bounds are unchanged), and each item is rendered off-screen with the
 * same `RichBlockHost` the canvas uses, rasterised with `html-to-image`, and
 * drawn at its position.
 *
 * Fonts: an SVG image can't use the page's fonts, and Excalidraw's fonts are
 * JS-registered, unicode-range-subsetted FontFaces. We let Excalidraw generate
 * the `@font-face` CSS it embeds in its own SVG export (subsetted to exactly
 * the characters used) and pass that to html-to-image — offline and exact.
 */
import { exportToCanvas, exportToSvg, getCommonBounds, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getFontEmbedCSS, toCanvas } from "html-to-image";
import { createRoot } from "react-dom/client";
import { BLOCK_FONTS } from "@/components/blocks/blockFonts";
import { hostPropsFor } from "@/components/blocks/hostProps";
import { RichBlockHost } from "@/components/blocks/RichBlockHost";
import { PagePreviewHost } from "@/components/pages/PagePreviewHost";
import { getEmbedRef, type AcuteEmbedRef } from "@/domain/canvas/adapter";
import { toPlainText } from "@/domain/content/richContent";
import { randomId } from "@/domain/ids";
import type { RichContent } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";
import { getUiPref } from "@/state/uiPrefs";

export type ExportFormat = "png" | "svg" | "clipboard" | "clipboard-svg";

export interface ExportOptions {
  format: ExportFormat;
  scale: number;
  background: boolean;
  dark: boolean;
  onlySelected: boolean;
  fileName?: string;
}

const PADDING = 10;
const THEME_FILTER = "invert(93%) hue-rotate(180deg)";

interface Item {
  el: NonDeletedExcalidrawElement;
  /** A rich block or a page preview. */
  ref: AcuteEmbedRef;
}

const documentIdOf = (ref: AcuteEmbedRef) => (ref.kind === "rich-block" ? ref.documentId : ref.pageId);
const isFrameless = (ref: AcuteEmbedRef) => ref.kind === "rich-block" && ref.style.frame === "none";

/**
 * Content box of an item inside its element, matching the canvas: cards inset
 * their content by the stroke width and clip to the rounded corners.
 */
function contentBox(item: Item): { inset: number; width: number; height: number; radius: number } {
  const { el, ref } = item;
  if (isFrameless(ref)) return { inset: 0, width: el.width, height: el.height, radius: 0 };
  const inset = el.strokeWidth;
  const width = Math.max(1, el.width - inset * 2);
  const height = Math.max(1, el.height - inset * 2);
  // Excalidraw's adaptive radius (32px, capped at 25% of the shorter side).
  const radius = el.roundness ? Math.min(32, Math.min(el.width, el.height) * 0.25) : 0;
  return { inset, width, height, radius };
}

function sceneFor(api: ExcalidrawImperativeAPI, onlySelected: boolean): NonDeletedExcalidrawElement[] {
  const all = api.getSceneElements();
  const selected = api.getAppState().selectedElementIds;
  if (!onlySelected || !Object.keys(selected).length) return [...all];
  // A selected frame exports with the elements inside it, as in Excalidraw.
  return all.filter(
    (el) =>
      selected[el.id] ||
      ("containerId" in el && el.containerId && selected[el.containerId]) ||
      (el.frameId && selected[el.frameId]),
  );
}

function splitItems(elements: readonly NonDeletedExcalidrawElement[]) {
  const items: Item[] = [];
  const others: ExcalidrawElement[] = [];
  for (const el of elements) {
    const ref = el.type === "embeddable" ? getEmbedRef(el) : null;
    if (ref) {
      items.push({ el, ref });
      // Stand-in rectangle keeps the export bounds identical. Cards keep their
      // frame (stroke, fill, roundness), exactly as Excalidraw draws it on the
      // canvas; frameless text is invisible.
      const frameless = isFrameless(ref);
      others.push({
        ...el,
        type: "rectangle",
        link: null,
        ...(frameless ? { strokeColor: "transparent", backgroundColor: "transparent" } : {}),
      } as ExcalidrawElement);
    } else {
      others.push(el);
    }
  }
  return { items, others };
}

/** Excalidraw font family numbers used by the items (item style + inline fonts). */
function fontsUsed(items: Item[]): Set<number> {
  const ids = new Set<string>();
  const visit = (blocks: RichContent) => {
    for (const b of blocks) {
      if (Array.isArray(b.content)) {
        for (const n of b.content) {
          const runs = n.type === "link" ? n.content : [n];
          for (const r of runs) if (r.styles?.fontFamily) ids.add(r.styles.fontFamily);
        }
      }
      if (b.children) visit(b.children);
    }
  };
  for (const { ref } of items) {
    if (ref.kind === "rich-block") ids.add(ref.style.fontFamily);
    const snap = getDocumentStore().get(documentIdOf(ref))?.snapshot;
    if (snap) visit(snap);
  }
  const out = new Set<number>();
  for (const id of ids) {
    const n = BLOCK_FONTS.find((f) => f.id === id)?.excalidraw;
    if (n) out.add(n);
  }
  return out;
}

/** `@font-face` CSS (data URLs, subsetted) generated by Excalidraw's own SVG export. */
async function excalidrawFontCss(items: Item[]): Promise<string> {
  const fonts = fontsUsed(items);
  if (!fonts.size) return "";
  const chars = new Set<string>(["a"]);
  for (const { ref } of items) {
    const rec = getDocumentStore().get(documentIdOf(ref));
    if (rec) for (const ch of rec.title + toPlainText(rec.snapshot)) if (ch.trim()) chars.add(ch);
  }
  const text = [...chars].join("");
  const samples = restoreElements(
    [...fonts].map(
      (fontFamily, i) =>
        ({
          type: "text",
          id: randomId(),
          x: 0,
          y: i * 40,
          text,
          originalText: text,
          fontSize: 20,
          fontFamily,
          // Explicit size: zero-size elements are skipped by the export.
          width: Math.max(20, text.length * 12),
          height: 26,
        }) as unknown as ExcalidrawElement,
    ),
    null,
    { refreshDimensions: true },
  );
  const svg: SVGSVGElement = await exportToSvg({ elements: samples, appState: { exportBackground: false }, files: null });
  return Array.from(svg.querySelectorAll("style"))
    .map((s: Element) => s.textContent ?? "")
    .filter((css) => css.includes("@font-face"))
    .join("\n");
}

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const start = performance.now();
  while (!check() && performance.now() - start < timeoutMs) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

/** Renders one item off-screen exactly as the canvas does and rasterises it. */
async function rasterise(item: Item, pixelRatio: number, fontCss: () => Promise<string>): Promise<HTMLCanvasElement> {
  const { el, ref } = item;
  const box = contentBox(item);
  await getDocumentStore().load(documentIdOf(ref));
  const host = document.createElement("div");
  Object.assign(host.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${box.width}px`,
    height: `${box.height}px`,
    pointerEvents: "none",
  });
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    // Light theme: dark exports apply the canvas filter to the whole image.
    const editorView = getUiPref("blockDisplay") === "editor";
    const contentReady = editorView ? ".acute-editor-view, .acute-preview__placeholder" : ".acute-preview";
    if (ref.kind === "rich-block") {
      root.render(<RichBlockHost {...hostPropsFor(el, ref, "light", false)} />);
      await waitFor(() => !!host.querySelector(contentReady), 3000);
    } else {
      root.render(
        <PagePreviewHost
          elementId={el.id}
          pageId={ref.pageId}
          preview={ref.preview}
          theme="light"
          background={el.fillStyle === "solid" ? el.backgroundColor : "transparent"}
          selected={false}
          exporting
        />,
      );
      const ready = ref.preview ? `.acute-page__doc :is(${contentReady})` : ".acute-page__card, .acute-page__missing";
      await waitFor(() => !!host.querySelector(ready), 3000);
    }
    await document.fonts.ready;
    const node = host.firstElementChild as HTMLElement;
    const css = (await fontCss()) + "\n" + (await getFontEmbedCSS(node).catch(() => ""));
    return await toCanvas(node, { pixelRatio, width: box.width, height: box.height, fontEmbedCSS: css, skipAutoScale: true });
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Rasterises an item and appends it to an exported SVG at its scene position. */
async function appendItemToSvg(
  svg: SVGSVGElement,
  item: Item,
  minX: number,
  minY: number,
  pixelRatio: number,
  fontCss: () => Promise<string>,
): Promise<void> {
  const img = await rasterise(item, pixelRatio, fontCss);
  const { el } = item;
  const box = contentBox(item);
  const ns = "http://www.w3.org/2000/svg";
  const x = el.x - minX + PADDING;
  const y = el.y - minY + PADDING;
  const group = document.createElementNS(ns, "g");
  if (el.angle) {
    const deg = (el.angle * 180) / Math.PI;
    group.setAttribute("transform", `rotate(${deg} ${x + el.width / 2} ${y + el.height / 2})`);
  }
  const image = document.createElementNS(ns, "image");
  image.setAttribute("x", String(x + box.inset));
  image.setAttribute("y", String(y + box.inset));
  image.setAttribute("width", String(box.width));
  image.setAttribute("height", String(box.height));
  image.setAttribute("href", img.toDataURL("image/png"));
  if (box.radius) {
    const clipId = `acute-clip-${el.id}`;
    const clip = document.createElementNS(ns, "clipPath");
    clip.setAttribute("id", clipId);
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", String(x + box.inset));
    rect.setAttribute("y", String(y + box.inset));
    rect.setAttribute("width", String(box.width));
    rect.setAttribute("height", String(box.height));
    rect.setAttribute("rx", String(Math.max(0, box.radius - box.inset)));
    clip.appendChild(rect);
    group.appendChild(clip);
    image.setAttribute("clip-path", `url(#${clipId})`);
  }
  group.appendChild(image);
  svg.appendChild(group);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportImage(api: ExcalidrawImperativeAPI, options: ExportOptions): Promise<void> {
  const elements = sceneFor(api, options.onlySelected);
  if (!elements.length) throw new Error("Nothing to export");
  const { items, others } = splitItems(elements);
  const [minX, minY] = getCommonBounds(others);
  const appState = {
    ...api.getAppState(),
    exportBackground: options.background,
    exportWithDarkMode: options.dark,
    exportScale: options.scale,
  };
  const files = api.getFiles();
  let fontCssPromise: Promise<string> | null = null;
  const fontCss = () => (fontCssPromise ??= excalidrawFontCss(items));
  const name = options.fileName ?? "acute-notes";

  if (options.format === "svg") {
    const svg: SVGSVGElement = await exportToSvg({ elements: others, appState, files, exportPadding: PADDING });
    for (const item of items) await appendItemToSvg(svg, item, minX, minY, Math.max(2, options.scale), fontCss);
    const markup = new XMLSerializer().serializeToString(svg);
    download(new Blob([markup], { type: "image/svg+xml" }), `${name}.svg`);
    return;
  }

  if (options.format === "clipboard-svg") {
    const svg: SVGSVGElement = await exportToSvg({ elements: others, appState, files, exportPadding: PADDING });
    for (const item of items) await appendItemToSvg(svg, item, minX, minY, Math.max(2, options.scale), fontCss);
    // Same as Excalidraw's "Copy to clipboard as SVG": the markup as text.
    await navigator.clipboard.writeText(new XMLSerializer().serializeToString(svg));
    return;
  }

  const scale = options.scale;
  const canvas: HTMLCanvasElement = await exportToCanvas({
    elements: others,
    appState,
    files,
    exportPadding: PADDING,
    getDimensions: (width: number, height: number) => ({ width: width * scale, height: height * scale, scale }),
  });
  const ctx = canvas.getContext("2d")!;
  // Excalidraw's renderer may leave its scale transform / filter on the context;
  // our coordinates are already in output pixels.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = "none";
  for (const item of items) {
    const img = await rasterise(item, scale, fontCss);
    const { el } = item;
    const box = contentBox(item);
    const cx = (el.x - minX + PADDING + el.width / 2) * scale;
    const cy = (el.y - minY + PADDING + el.height / 2) * scale;
    const w = box.width * scale;
    const h = box.height * scale;
    ctx.save();
    if (options.dark) ctx.filter = THEME_FILTER;
    ctx.translate(cx, cy);
    ctx.rotate(el.angle);
    if (box.radius) {
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, Math.max(0, box.radius - box.inset) * scale);
      ctx.clip();
    }
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), "image/png"),
  );
  if (options.format === "clipboard") {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return;
  }
  download(blob, `${name}.png`);
}

/**
 * Excalidraw's context-menu / shortcut "Copy to clipboard as PNG/SVG", with the
 * same defaults (selection if any, else the canvas; the export settings in the
 * app state), but including Acute text and blocks.
 */
export async function copySceneToClipboard(api: ExcalidrawImperativeAPI, kind: "png" | "svg"): Promise<void> {
  const s = api.getAppState();
  const hasSelection = Object.keys(s.selectedElementIds).length > 0;
  await exportImage(api, {
    format: kind === "png" ? "clipboard" : "clipboard-svg",
    scale: s.exportScale || 1,
    background: s.exportBackground,
    dark: s.exportWithDarkMode,
    onlySelected: hasSelection,
  });
  api.setToast({
    message: `Copied ${hasSelection ? "selection" : "canvas"} to clipboard as ${kind.toUpperCase()}`,
    duration: 2500,
  });
}

/** Dev diagnostics: rasterise one Acute element and return a PNG data URL. */
export async function rasteriseElementForDebug(api: ExcalidrawImperativeAPI, elementId: string): Promise<string | null> {
  const { items } = splitItems(api.getSceneElements().filter((el) => el.id === elementId));
  const item = items[0];
  if (!item) return null;
  const canvas = await rasterise(item, 1, () => excalidrawFontCss(items));
  return canvas.toDataURL("image/png");
}

/** Dev diagnostics: the @font-face CSS generated for the scene's Acute items. */
export async function fontCssForDebug(api: ExcalidrawImperativeAPI): Promise<string> {
  const { items } = splitItems(api.getSceneElements());
  return excalidrawFontCss(items);
}
