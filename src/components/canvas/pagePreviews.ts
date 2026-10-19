/**
 * Canvas operations for page previews (F09): an Excalidraw embeddable that
 * references a page by id. The page itself lives outside the canvas; the
 * element only carries presentation (position, size, preview mode).
 */
import { CaptureUpdateAction, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getEmbedRef, pageLink, type AcuteEmbedRef } from "@/domain/canvas/adapter";
import { PAGE_PREVIEW_SIZE } from "@/domain/content/richContent";
import { randomId } from "@/domain/ids";
import { BLOCK_STYLE, replaceElement } from "./richBlocks";
import { prefersReducedMotion } from "./motion";

type PageRef = Extract<AcuteEmbedRef, { kind: "page-preview" }>;

function viewportCenter(api: ExcalidrawImperativeAPI): { x: number; y: number } {
  const s = api.getAppState();
  return { x: s.width / 2 / s.zoom.value - s.scrollX, y: s.height / 2 / s.zoom.value - s.scrollY };
}

/**
 * A page-preview embeddable element for `pageId`, not yet in the scene.
 * Callers add the element with their own scene update (F19/F30 batch many at
 * once; `insertPagePreview` below adds just this one).
 */
export function createPagePreviewElement(pageId: string, box: { x: number; y: number; width: number; height: number }, preview = false): ExcalidrawElement {
  const ref: PageRef = { kind: "page-preview", pageId, preview };
  const [element] = restoreElements(
    [
      {
        ...BLOCK_STYLE,
        type: "embeddable",
        id: randomId(),
        ...box,
        link: pageLink(pageId),
        customData: { acute: ref },
      } as unknown as ExcalidrawElement,
    ],
    null,
  );
  if (!element) throw new Error("Failed to create page preview");
  return element;
}

/** Places a preview of `pageId` (centred on `at`, default the viewport centre) and selects it. */
export function insertPagePreview(
  api: ExcalidrawImperativeAPI,
  pageId: string,
  options: { at?: { x: number; y: number }; preview?: boolean } = {},
): string {
  const preview = options.preview ?? false;
  const size = preview ? PAGE_PREVIEW_SIZE.content : PAGE_PREVIEW_SIZE.card;
  const center = options.at ?? viewportCenter(api);
  const element = createPagePreviewElement(pageId, { x: center.x - size.width / 2, y: center.y - size.height / 2, ...size }, preview);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), element],
    appState: { selectedElementIds: { [element.id]: true }, selectedGroupIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return element.id;
}

/**
 * Switches a preview between the compact card and the content preview (one
 * undo step). Each mode keeps its own size: the other mode's size is restored.
 */
export function togglePagePreview(api: ExcalidrawImperativeAPI, elementId: string): void {
  replaceElement(
    api,
    elementId,
    (el) => {
      const ref = getEmbedRef(el);
      if (ref?.kind !== "page-preview") return el;
      const preview = !ref.preview;
      const size = ref.otherSize ?? (preview ? PAGE_PREVIEW_SIZE.content : PAGE_PREVIEW_SIZE.card);
      const next: PageRef = { ...ref, preview, otherSize: { width: el.width, height: el.height } };
      return newElementWith(el, {
        width: size.width,
        height: size.height,
        customData: { ...el.customData, acute: next },
      });
    },
    CaptureUpdateAction.IMMEDIATELY,
  );
}

/** Previews of `pageId` on this canvas, topmost first. */
export function findPagePreviews(api: ExcalidrawImperativeAPI, pageId: string): NonDeletedExcalidrawElement[] {
  return api
    .getSceneElements()
    .filter((el) => {
      if (el.type !== "embeddable") return false;
      const ref = getEmbedRef(el);
      return ref?.kind === "page-preview" && ref.pageId === pageId;
    })
    .reverse();
}

/** Selects an element and scrolls it into view. */
export function revealElement(api: ExcalidrawImperativeAPI, element: NonDeletedExcalidrawElement): void {
  api.updateScene({
    appState: { selectedElementIds: { [element.id]: true }, selectedGroupIds: {} },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  api.scrollToContent(element, { animate: !prefersReducedMotion(), duration: 250 });
}
