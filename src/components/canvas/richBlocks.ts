/**
 * Canvas operations for Acute text items and rich blocks hosted as Excalidraw
 * embeddables. Mutations go through `updateScene` with explicit history
 * capture so each user-level action is one undo step.
 */
import { CaptureUpdateAction, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getActiveEditor } from "@/components/blocks/activeEditors";
import { DEFAULT_BLOCK_STROKE } from "@/components/blocks/blockColor";
import { blockLink, getArrowRelation, getEmbedRef, keepsRelationOnCopy, pageLink, withRelation, type AcuteEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { lensCopyData } from "@/domain/lens/identity";
import { CARD_STYLE, TEXT_ITEM_STYLE, type BlockStyle } from "@/domain/content/blockStyle";
import { BLOCK_SIZE, isEmptyContent, templateFor } from "@/domain/content/richContent";
import { newId, randomId } from "@/domain/ids";
import { roomForGrownFrame } from "@/ai/changes/frameRoom";
import type { Box } from "@/ai/changes/changeSet";
import type { DocumentHome, ObjectMetadata, RichBlockType, RichContent } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { cloneDocument } from "@/state/documentClone";
import { getDocumentStore } from "@/state/documents";

type CaptureUpdate = (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction];

/** Card blocks: subtle bordered surface. */
export const BLOCK_STYLE = {
  strokeColor: DEFAULT_BLOCK_STROKE,
  backgroundColor: "#ffffff",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  roundness: { type: 3 },
} as const;

/** Frameless text: transparent stroke + background → Excalidraw draws no frame. */
const TEXT_ITEM_ELEMENT = {
  strokeColor: "transparent",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 1,
  strokeStyle: "solid",
  roughness: 0,
  roundness: null,
} as const;

const TEXT_ITEM_TEMPLATE: RichContent = [{ type: "paragraph", content: "" }];
/** Initial width of a new text item before auto-width measures its content. */
const TEXT_ITEM_MIN_WIDTH = 24;

export const lineHeightOf = (fontSize: number) => Math.round(fontSize * 1.5);

/** Scene coordinates of the current viewport centre. */
function viewportCenter(api: ExcalidrawImperativeAPI): { x: number; y: number } {
  const s = api.getAppState();
  return { x: s.width / 2 / s.zoom.value - s.scrollX, y: s.height / 2 / s.zoom.value - s.scrollY };
}

function findElement(api: ExcalidrawImperativeAPI, id: string): NonDeletedExcalidrawElement | undefined {
  return api.getSceneElements().find((el) => el.id === id);
}

/**
 * Replaces one element. Excalidraw tracks the active embeddable by object
 * identity, so the active reference is refreshed too — otherwise updating the
 * block being edited would silently disable its pointer events.
 */
export function replaceElement(
  api: ExcalidrawImperativeAPI,
  id: string,
  update: (el: ExcalidrawElement) => ExcalidrawElement,
  captureUpdate: CaptureUpdate,
): ExcalidrawElement | null {
  const current = api.getSceneElementsIncludingDeleted();
  const index = current.findIndex((el) => el.id === id);
  if (index < 0) return null;
  const replaced = update(current[index]!);
  const elements: ExcalidrawElement[] = current.slice();
  elements[index] = replaced;
  const active = api.getAppState().activeEmbeddable;
  const appState: Partial<AppState> | undefined =
    active?.element.id === id && !replaced.isDeleted
      ? { activeEmbeddable: { element: replaced as NonDeletedExcalidrawElement, state: active.state } }
      : undefined;
  api.updateScene({ elements, ...(appState ? { appState: appState as never } : {}), captureUpdate });
  return replaced;
}

export interface InsertOptions {
  /** Scene point: top-left for text items, centre for cards. Defaults to the viewport centre. */
  at?: { x: number; y: number };
  style?: BlockStyle;
  /** Pre-filled content (defaults to the block type's template). */
  content?: RichContent;
  /** Start editing right away (default true). Pasted text is inserted selected, not editing. */
  activate?: boolean;
  /** Replace (delete) this element in the same history step, e.g. converting native text. */
  replaceElementId?: string;
  /** Explicit size (defaults to the block type's size / auto-size for text). */
  size?: { width: number; height: number };
  angle?: number;
  /** Document metadata (defaults to user provenance); AI-created blocks pass their `metadata.ai`. */
  metadata?: ObjectMetadata;
}

/**
 * A new block document (record cached at once, written in the background),
 * not yet shown by any element. Also used to give an existing block new
 * content undoably (F39): the element is re-pointed at a fresh document.
 */
export function createBlockDocument(home: DocumentHome, content: RichContent, metadata?: ObjectMetadata): string {
  const documentId = newId("doc");
  const now = Date.now();
  // Cache is updated synchronously; the IndexedDB write is not awaited.
  void getDocumentStore().put({
    id: documentId,
    ...home,
    kind: "block",
    title: "Untitled",
    snapshot: content,
    createdAt: now,
    updatedAt: now,
    metadata: metadata ?? { ai: { createdBy: "user" } },
  });
  return documentId;
}

/**
 * A new block: its document record (cached at once, written in the
 * background) and its embeddable element, not yet in the scene. Callers add
 * the element with their own scene update, so many blocks can be added in one.
 */
export function createBlockElement(
  home: DocumentHome,
  blockType: RichBlockType,
  options: {
    box: { x: number; y: number; width: number; height: number };
    style?: BlockStyle;
    content?: RichContent;
    angle?: number;
    metadata?: ObjectMetadata;
    /** Cards only: fill colour (default white). */
    backgroundColor?: string;
  },
): ExcalidrawElement {
  const style = options.style ?? CARD_STYLE;
  const frameless = style.frame === "none";
  const documentId = createBlockDocument(home, options.content ?? (frameless && blockType === "text" ? TEXT_ITEM_TEMPLATE : templateFor(blockType)), options.metadata);

  const ref: AcuteEmbedRef = { kind: "rich-block", blockType, documentId, style };
  const { box } = options;
  const [element] = restoreElements(
    [
      {
        ...(frameless ? TEXT_ITEM_ELEMENT : { ...BLOCK_STYLE, ...(options.backgroundColor ? { backgroundColor: options.backgroundColor } : {}) }),
        type: "embeddable",
        id: randomId(),
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        angle: options.angle ?? 0,
        link: blockLink(documentId),
        customData: { acute: ref },
      } as unknown as ExcalidrawElement,
    ],
    null,
  );
  if (!element) throw new Error("Failed to create block element");
  return element;
}

/**
 * Creates a document + embeddable and starts editing it.
 * - Text items (`style.frame === "none"`) look like plain canvas text and are
 *   captured in history only once they have content (see `finishTextItem`).
 * - Cards are bordered blocks, captured immediately.
 */
export function insertRichBlock(
  api: ExcalidrawImperativeAPI,
  home: DocumentHome,
  blockType: RichBlockType,
  options: InsertOptions = {},
): string {
  const style = options.style ?? CARD_STYLE;
  const frameless = style.frame === "none";
  const point = options.at ?? viewportCenter(api);
  const size =
    options.size ??
    (frameless
      ? { width: style.autoWidth ? TEXT_ITEM_MIN_WIDTH : BLOCK_SIZE.text.width, height: lineHeightOf(style.fontSize) }
      : BLOCK_SIZE[blockType]);
  const origin = frameless ? point : { x: point.x - size.width / 2, y: point.y - size.height / 2 };
  const element = createBlockElement(home, blockType, {
    box: { ...origin, ...size },
    style,
    ...(options.content ? { content: options.content } : {}),
    ...(options.angle !== undefined ? { angle: options.angle } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  });

  const existing = api
    .getSceneElementsIncludingDeleted()
    .map((el) => (el.id === options.replaceElementId ? newElementWith(el, { isDeleted: true }) : el));
  api.updateScene({
    elements: [...existing, element],
    appState: { selectedElementIds: { [element.id]: true }, selectedGroupIds: {} },
    // Empty text items that are abandoned must not leave an undo step; items
    // that are not opened for editing (e.g. pasted) are committed at once.
    captureUpdate:
      frameless && options.activate !== false ? CaptureUpdateAction.EVENTUALLY : CaptureUpdateAction.IMMEDIATELY,
  });
  if (options.activate !== false) activateEmbeddable(api, element.id);
  return element.id;
}

/** Inserts a frameless text item at a scene point (T tool / double-click). */
export function insertTextItem(
  api: ExcalidrawImperativeAPI,
  home: DocumentHome,
  at: { x: number; y: number },
  style: BlockStyle = TEXT_ITEM_STYLE,
): string {
  // `at` is where the caret goes: centre the first line on it vertically.
  return insertRichBlock(api, home, "text", {
    style,
    at: { x: at.x, y: at.y - lineHeightOf(style.fontSize) / 2 },
  });
}

/**
 * Called when a text item stops being edited: an empty one is removed without
 * trace (like Excalidraw text); otherwise its creation and size changes are
 * committed as one undo step.
 */
export function finishTextItem(api: ExcalidrawImperativeAPI, elementId: string): void {
  const el = findElement(api, elementId);
  const ref = el && getEmbedRef(el);
  if (!el || ref?.kind !== "rich-block" || ref.style.frame !== "none") return;
  const snapshot = getDocumentStore().get(ref.documentId)?.snapshot;
  if (snapshot && isEmptyContent(snapshot)) {
    replaceElement(api, elementId, (e) => newElementWith(e, { isDeleted: true }), CaptureUpdateAction.NEVER);
    return;
  }
  api.updateScene({ elements: api.getSceneElementsIncludingDeleted(), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
}

/** Updates an element's Acute style (one undo step by default). */
export function updateBlockStyle(
  api: ExcalidrawImperativeAPI,
  elementId: string,
  patch: Partial<BlockStyle>,
  captureUpdate: CaptureUpdate = CaptureUpdateAction.IMMEDIATELY,
): void {
  replaceElement(
    api,
    elementId,
    (el) => {
      const ref = getEmbedRef(el);
      if (ref?.kind !== "rich-block") return el;
      const style: BlockStyle = { ...ref.style, ...patch };
      if (patch.textColor === undefined && "textColor" in patch) delete style.textColor;
      const framePatch =
        patch.frame && patch.frame !== ref.style.frame
          ? patch.frame === "none"
            ? { ...TEXT_ITEM_ELEMENT, roundness: null }
            : { ...BLOCK_STYLE }
          : {};
      return newElementWith(el, {
        ...framePatch,
        customData: { ...el.customData, acute: { ...ref, style } },
      } as never);
    },
    captureUpdate,
  );
}

/** Sets or clears an item's element-level hyperlink (one undo step). */
export function setBlockHref(api: ExcalidrawImperativeAPI, elementId: string, href: string | null): void {
  replaceElement(
    api,
    elementId,
    (el) => {
      const ref = getEmbedRef(el);
      if (ref?.kind !== "rich-block") return el;
      const next = { ...ref };
      if (href) next.href = href;
      else delete next.href;
      return newElementWith(el, { customData: { ...el.customData, acute: next } });
    },
    CaptureUpdateAction.IMMEDIATELY,
  );
}

/**
 * Auto-size commit (merged into the surrounding history step). No-op when the
 * size is unchanged or while the user is resizing the element by hand.
 */
export function resizeElement(
  api: ExcalidrawImperativeAPI,
  elementId: string,
  width: number | null,
  height: number,
): void {
  const el = findElement(api, elementId);
  if (!el || api.getAppState().resizingElement?.id === elementId) return;
  const w = Math.max(8, width ?? el.width);
  const h = Math.max(8, height);
  if (Math.abs(w - el.width) < 1 && Math.abs(h - el.height) < 1) return;
  replaceElement(api, elementId, (e) => newElementWith(e, { width: w, height: h }), CaptureUpdateAction.EVENTUALLY);
}

/** Room kept between a frame's members and its edges when it grows (the renderer's section padding). */
const FRAME_FIT_PAD = 40;

/**
 * Grows the frame `elementId` belongs to so the element stays inside it:
 * Excalidraw clips a frame's members to its bounds, so a block that grows to
 * fit its content (auto-height) would otherwise be cut off at the frame's
 * edge. Only ever grows. Returns the frame's id and its version before, or
 * null when nothing changed.
 */
export function growFrameToFit(api: ExcalidrawImperativeAPI, elementId: string): { id: string; version: number; before: Box } | null {
  const el = findElement(api, elementId);
  const frame = el?.frameId ? findElement(api, el.frameId) : undefined;
  if (!el || !frame || frame.isDeleted) return null;
  const width = Math.max(frame.width, el.x + el.width + FRAME_FIT_PAD - frame.x);
  const height = Math.max(frame.height, el.y + el.height + FRAME_FIT_PAD - frame.y);
  // Only when a member overflows (or nearly): a frame the user sized with room to spare is left alone.
  const overflows = el.x + el.width > frame.x + frame.width - 1 || el.y + el.height > frame.y + frame.height - 1;
  if (!overflows || (width - frame.width < 1 && height - frame.height < 1)) return null;
  const { version } = frame;
  const before = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  replaceElement(api, frame.id, (e) => newElementWith(e, { width, height }), CaptureUpdateAction.EVENTUALLY);
  return { id: frame.id, version, before };
}

/**
 * After the frame `frameId` grew from `before`: the section frames it now reaches move out of its way, each with
 * everything inside it, keeping the gaps they had (`roomForGrownFrame`). Returns what moved (id and version before)
 * and the ids of the frames that moved, for re-routing the links between them.
 */
export function makeRoomForFrame(api: ExcalidrawImperativeAPI, frameId: string, before: Box): { changed: { id: string; version: number }[]; frames: string[] } {
  const scene = api.getSceneElementsIncludingDeleted();
  const frames = scene.filter((el) => el.type === "frame" && !el.isDeleted).map((el) => ({ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height }));
  const moves = roomForGrownFrame(frames, frameId, before);
  if (!moves.size) return { changed: [], frames: [] };
  const changed: { id: string; version: number }[] = [];
  const elements = scene.map((el) => {
    const m = moves.get(el.id) ?? (el.frameId ? moves.get(el.frameId) : undefined);
    if (!m || el.isDeleted) return el;
    changed.push({ id: el.id, version: el.version });
    return newElementWith(el, { x: el.x + m.dx, y: el.y + m.dy });
  });
  api.updateScene({ elements, captureUpdate: CaptureUpdateAction.EVENTUALLY });
  return { changed, frames: [...moves.keys()] };
}

/** Switches an Acute embeddable into editing mode. */
export function activateEmbeddable(api: ExcalidrawImperativeAPI, elementId: string): void {
  const element = findElement(api, elementId);
  if (!element || element.type !== "embeddable" || element.locked) return;
  api.updateScene({
    appState: {
      activeEmbeddable: { element, state: "active" },
      selectedElementIds: { [elementId]: true },
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

/** Leaves editing mode, keeps the block selected and returns focus to the canvas. */
export function deactivateEmbeddable(api: ExcalidrawImperativeAPI, elementId: string): void {
  api.updateScene({
    appState: { activeEmbeddable: null, selectedElementIds: { [elementId]: true } },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  document.querySelector<HTMLElement>(".excalidraw")?.focus();
}

/** The single selected Acute embeddable, if any. */
export function getSelectedAcuteEmbeddable(api: ExcalidrawImperativeAPI): NonDeletedExcalidrawElement | null {
  const ids = Object.keys(api.getAppState().selectedElementIds);
  if (ids.length !== 1) return null;
  const el = api.getSceneElements().find((e) => e.id === ids[0]);
  return el && el.type === "embeddable" && getEmbedRef(el) ? el : null;
}


/**
 * `onDuplicate` handler: duplicated/pasted rich blocks get their own copy of
 * the document so editing the copy never changes the original, and a duplicated
 * arrow keeps its semantic relation (F23) only when both its ends were copied
 * with it (`keepsRelationOnCopy`). A copied Lens node or frame drops its key
 * and a copied map object stops carrying its map identity into Lens
 * (`lensCopyData`). Duplicated page previews
 * likewise get their own copy of the page. Copies belong to `home` — the
 * workspace and canvas they land in, which differ from the source's when
 * pasting across canvases.
 */
export function handleDuplicate(
  nextElements: readonly ExcalidrawElement[],
  prevElements: readonly ExcalidrawElement[],
  home?: DocumentHome,
): ExcalidrawElement[] | void {
  const existing = new Set(prevElements.map((e) => e.id));
  const copied = new Set(nextElements.flatMap((e) => (existing.has(e.id) ? [] : [e.id])));
  let changed = false;
  const result = nextElements.map((el) => {
    if (existing.has(el.id)) return el;
    if (el.type === "arrow" && getArrowRelation(el) && !keepsRelationOnCopy(el as unknown as SceneElement, copied)) {
      changed = true;
      return newElementWith(el, { customData: withRelation(el.customData, undefined) });
    }
    // A copy never takes the original's Lens identity: its key, or the map identity it carries (D21, D59).
    const lensCopy = lensCopyData(el as unknown as SceneElement, (id) => getDocumentStore().get(id));
    if (lensCopy) {
      changed = true;
      el = newElementWith(el, { customData: lensCopy });
    }
    if (el.type !== "embeddable") return el;
    const ref = getEmbedRef(el);
    if (ref?.kind === "page-preview") {
      const pageId = cloneDocument(ref.pageId, getDocumentStore(), getPersistence(), "page", home ?? {});
      changed = true;
      return newElementWith(el, {
        link: pageLink(pageId),
        customData: { ...el.customData, acute: { ...ref, pageId } },
      });
    }
    if (ref?.kind !== "rich-block") return el;
    const documentId = cloneDocument(ref.documentId, getDocumentStore(), getPersistence(), "doc", home ?? {});
    changed = true;
    return newElementWith(el, {
      link: blockLink(documentId),
      customData: { ...el.customData, acute: { ...ref, documentId } },
    });
  });
  return changed ? result : undefined;
}

/**
 * While a card block is being edited, a Stroke colour change applies to the
 * text selection only (when part of the text is selected); the block's own
 * stroke is restored. With no selection, or everything selected, the change
 * applies to the whole block as usual. (Frameless text has no Stroke control;
 * its colour is set from the Text panel section.)
 */
export class StrokeToSelection {
  private tracked: { id: string; stroke: string } | null = null;

  /** Call from Excalidraw `onChange`. Cheap unless a block is being edited. */
  handleChange(api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[], activeId: string | null): void {
    if (!activeId) {
      this.tracked = null;
      return;
    }
    const el = elements.find((e) => e.id === activeId);
    if (!el) return;
    const prev = this.tracked;
    if (!prev || prev.id !== el.id) {
      this.tracked = { id: el.id, stroke: el.strokeColor };
      return;
    }
    if (el.strokeColor === prev.stroke) return;

    const ref = getEmbedRef(el);
    const editor = ref?.kind === "rich-block" ? getActiveEditor(ref.documentId) : undefined;
    const color = el.strokeColor;
    const scope = editor && color !== "transparent" ? editor.selectionScope() : "none";
    if (scope !== "partial" || !editor) {
      this.tracked = { id: el.id, stroke: color };
      // Whole text selected: the block colour applies everywhere, so drop
      // per-text colours that would otherwise override it.
      if (scope === "all") queueMicrotask(() => editor?.clearTextColor());
      return;
    }
    const original = prev.stroke;
    // Defer: updateScene must not run inside Excalidraw's onChange.
    queueMicrotask(() => {
      editor.applyTextColor(color);
      replaceElement(api, el.id, (e) => newElementWith(e, { strokeColor: original }), CaptureUpdateAction.NEVER);
    });
  }
}
