/** Whether the person asked the system for less motion: then nothing eases, glides or scrolls smoothly. */
export function prefersReducedMotion(): boolean {
  // Drawn outside a page (a test's renderer) nothing moves.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
