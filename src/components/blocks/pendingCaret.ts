/**
 * Where the user clicked to start editing a block, so the editor (which mounts
 * lazily a moment later and lays text out differently from the preview) can
 * put the caret on the same character instead of at the end.
 *
 * The click is resolved against the *preview* DOM while it is still on screen:
 * block id + character offset within that block. Both preview renderers tag
 * blocks with their BlockNote id (`data-block-id` for the compact preview,
 * `data-id` in BlockNote's own HTML).
 */
export type CaretTarget = { blockId: string; offset: number } | { x: number; y: number };

interface Pending {
  target: CaretTarget;
  at: number;
}

const MAX_AGE_MS = 3000;
const BLOCK_SELECTOR = "[data-block-id], [data-id]";
const pending = new Map<string, Pending>();

function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (pos) return { node: pos.offsetNode, offset: pos.offset };
  const range = doc.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

function blockIdOf(el: Element): string | null {
  return (el as HTMLElement).dataset.blockId ?? (el as HTMLElement).dataset.id ?? null;
}

/** Resolves a viewport point inside a block's preview to block id + text offset. */
export function resolveCaretInPreview(root: HTMLElement, x: number, y: number): CaretTarget {
  // Inactive previews ignore pointer events; allow hit-testing just for this read.
  const prev = root.style.pointerEvents;
  root.style.pointerEvents = "auto";
  let hit: { node: Node; offset: number } | null = null;
  try {
    hit = caretAtPoint(x, y);
  } finally {
    root.style.pointerEvents = prev;
  }
  if (!hit || !root.contains(hit.node)) return { x, y };

  const start = hit.node.nodeType === Node.TEXT_NODE ? hit.node.parentElement : (hit.node as Element);
  const blockEl = start?.closest(BLOCK_SELECTOR);
  const blockId = blockEl && root.contains(blockEl) ? blockIdOf(blockEl) : null;
  if (!blockEl || !blockId) return { x, y };
  // Tables, code blocks etc.: text offsets don't map 1:1; use coordinates.
  if (blockEl.querySelector("table, pre")) return { x, y };

  // Count characters of this block's own text (not nested child blocks) before the caret.
  let offset = 0;
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest(BLOCK_SELECTOR) !== blockEl) continue;
    // Decorative text (list markers, labels) is not document content.
    if (n.parentElement?.closest('[aria-hidden="true"]')) continue;
    if (n === hit.node) {
      offset += hit.offset;
      return { blockId, offset };
    }
    offset += n.textContent?.length ?? 0;
  }
  return { blockId, offset: 0 };
}

export function setPendingCaret(documentId: string, target: CaretTarget): void {
  pending.set(documentId, { target, at: Date.now() });
}

/** Returns and clears the pending caret target, ignoring stale entries. */
export function takePendingCaret(documentId: string): CaretTarget | null {
  const p = pending.get(documentId);
  pending.delete(documentId);
  return p && Date.now() - p.at < MAX_AGE_MS ? p.target : null;
}
