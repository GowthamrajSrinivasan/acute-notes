"use client";

import { useEffect } from "react";

/**
 * Stops the browser's own pinch-zoom anywhere on the page. Excalidraw turns a
 * pinch into canvas zoom only inside its container, so a pinch that starts on
 * the header, navigator or page panel magnified the whole page instead — the
 * raster canvas went blurry and the app chrome slid out of view.
 *
 * - Trackpad pinch and Ctrl/⌘+wheel arrive as a wheel event with ctrlKey;
 *   Excalidraw still zooms the canvas (it handles the event before it bubbles
 *   to window), only the browser default is cancelled.
 * - Safari trackpad pinch arrives as non-standard gesture events.
 * - Touchscreen pinch is disabled in CSS (`touch-action` on html).
 * Keyboard zoom (Ctrl/⌘ +/−/0) stays available for accessibility.
 */
export function PinchZoomGuard() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();
    const opts = { passive: false } as const;
    window.addEventListener("wheel", onWheel, opts);
    for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, onGesture, opts);
    return () => {
      window.removeEventListener("wheel", onWheel);
      for (const type of ["gesturestart", "gesturechange"]) document.removeEventListener(type, onGesture);
    };
  }, []);
  return null;
}
