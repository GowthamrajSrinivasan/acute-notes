"use client";

/**
 * "Back to canvas" from a Lens level on another canvas (plan AC9): Lens can't reveal an element on a canvas that
 * isn't mounted, so it leaves the request here, navigates, and the next canvas to mount (`LensPanelHost`) carries
 * it out once its scene has loaded. A request for a different canvas than the one that mounts is dropped.
 */

let pending: { canvasId: string; elementId: string } | null = null;

export function requestReveal(canvasId: string, elementId: string): void {
  pending = { canvasId, elementId };
}

/**
 * The element waiting to be revealed on `canvasId`, without taking it: the caller clears it once done, so a
 * mount that's torn down before the scene loads (React strict mode's double effects) leaves it for the next one.
 */
export function pendingReveal(canvasId: string): string | null {
  if (pending && pending.canvasId !== canvasId) pending = null;
  return pending?.elementId ?? null;
}

export function clearReveal(): void {
  pending = null;
}
