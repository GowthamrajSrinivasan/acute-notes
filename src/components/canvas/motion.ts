/**
 * Whether the user asked for reduced motion (the OS / browser setting): camera moves then jump instead of gliding
 * (content fidelity Wave D). Read at the moment of each move, so a changed setting applies at once.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
