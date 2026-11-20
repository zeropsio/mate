import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

function motionPreference() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  return window.matchMedia(query);
}

/** Whether the person asked the system for less motion: then nothing eases, glides or scrolls smoothly. */
export function prefersReducedMotion(): boolean {
  // Drawn outside a page (a test's renderer) nothing moves.
  return motionPreference()?.matches ?? true;
}

/** Listen for the person changing their motion preference, until the returned function is called. */
export function onReducedMotionChange(listener: () => void): () => void {
  const media = motionPreference();
  media?.addEventListener("change", listener);
  return () => media?.removeEventListener("change", listener);
}

/** Whether the person asked for less motion, kept current while the component is mounted. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(onReducedMotionChange, prefersReducedMotion, () => true);
}
