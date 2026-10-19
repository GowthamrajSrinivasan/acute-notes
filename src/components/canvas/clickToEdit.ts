/**
 * Click-to-edit for Acute blocks.
 *
 * Inactive blocks do not receive pointer events (Excalidraw owns them so the
 * block can be selected, moved and resized). Excalidraw only starts editing an
 * embeddable on double-click or a click in its centre third, and editors then
 * place the caret at the end. This adds:
 *
 * - a plain click on an *already selected* block (anywhere but its edges)
 *   starts editing, and
 * - editing started by click or double-click places the caret where the
 *   user clicked.
 *
 * Drags are ignored (they move the block), as are clicks near the edges where
 * the resize handles are.
 */
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import type { NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { resolveCaretInPreview, setPendingCaret } from "@/components/blocks/pendingCaret";
import { getEmbedRef } from "@/domain/canvas/adapter";
import { activateEmbeddable } from "./richBlocks";

const CLICK_MAX_MOVE_PX = 4;
const CLICK_MAX_MS = 500;
/** Screen-pixel margin kept free for Excalidraw's resize handles. */
const EDGE_MARGIN_PX = 10;

function isCanvasTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLCanvasElement && target.classList.contains("interactive");
}

/** The Acute block under a viewport point (topmost first), with edge margin. */
function blockAt(api: ExcalidrawImperativeAPI, clientX: number, clientY: number): NonDeletedExcalidrawElement | null {
  const appState = api.getAppState();
  const { x, y } = viewportCoordsToSceneCoords({ clientX, clientY }, appState);
  const margin = EDGE_MARGIN_PX / appState.zoom.value;
  const elements = api.getSceneElements();
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i]!;
    if (el.type !== "embeddable" || el.locked || !getEmbedRef(el)) continue;
    if (x >= el.x + margin && x <= el.x + el.width - margin && y >= el.y + margin && y <= el.y + el.height - margin) {
      return el;
    }
  }
  return null;
}

function isActive(api: ExcalidrawImperativeAPI, elementId: string): boolean {
  const active = api.getAppState().activeEmbeddable;
  return active?.state === "active" && active.element.id === elementId;
}

function documentIdOf(el: NonDeletedExcalidrawElement): string | null {
  const ref = getEmbedRef(el);
  return ref?.kind === "rich-block" ? ref.documentId : null;
}

/** Records where editing should put the caret, resolved against the on-screen preview. */
function rememberCaret(block: NonDeletedExcalidrawElement, clientX: number, clientY: number): void {
  const documentId = documentIdOf(block);
  if (!documentId) return;
  const root = document.querySelector<HTMLElement>(
    `.acute-block[data-element-id="${CSS.escape(block.id)}"] .acute-block__content`,
  );
  setPendingCaret(documentId, root ? resolveCaretInPreview(root, clientX, clientY) : { x: clientX, y: clientY });
}

export function installClickToEdit(api: ExcalidrawImperativeAPI, container: HTMLElement): () => void {
  let down: { x: number; y: number; t: number; blockId: string; wasSelected: boolean } | null = null;

  const onPointerDown = (e: PointerEvent) => {
    down = null;
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !isCanvasTarget(e.target)) return;
    if (api.getAppState().activeTool.type !== "selection") return;
    const block = blockAt(api, e.clientX, e.clientY);
    if (!block || isActive(api, block.id)) return;
    const selected = api.getAppState().selectedElementIds;
    // Captured before Excalidraw handles the event: was it selected already?
    down = {
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      blockId: block.id,
      wasSelected: Object.keys(selected).length === 1 && !!selected[block.id],
    };
  };

  const onPointerUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    if (!d || !d.wasSelected) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (moved > CLICK_MAX_MOVE_PX || e.timeStamp - d.t > CLICK_MAX_MS) return;
    const block = blockAt(api, e.clientX, e.clientY);
    if (!block || block.id !== d.blockId || isActive(api, block.id)) return;
    rememberCaret(block, e.clientX, e.clientY);
    // Let Excalidraw finish its own pointer-up handling first.
    requestAnimationFrame(() => activateEmbeddable(api, block.id));
  };

  // Excalidraw activates on double-click itself; we only supply the caret point.
  const onDoubleClick = (e: MouseEvent) => {
    if (!isCanvasTarget(e.target)) return;
    const block = blockAt(api, e.clientX, e.clientY);
    if (block && !isActive(api, block.id)) rememberCaret(block, e.clientX, e.clientY);
  };

  container.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  container.addEventListener("dblclick", onDoubleClick, true);
  return () => {
    container.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    container.removeEventListener("dblclick", onDoubleClick, true);
  };
}
