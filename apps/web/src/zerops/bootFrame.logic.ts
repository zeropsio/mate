/**
 * The first frame, decided before it is painted (index.html's second inline script runs the same
 * rules; `bootFrame.test.ts` holds the two together). A browser whose last session was signed in
 * — or one coming back from the Zerops sign-in — is painted the app's own frame: the menu column
 * with its mark where the menu draws it, and a quiet page. Any other is painted the sign-in's
 * centred mark. Pure.
 */
import { ZEROPS_HANDOVER_CALLBACK_PATH } from "@t3tools/client-runtime/zerops/handover";

import type { ZeropsSessionStatus } from "./ZeropsSessionProvider";

/** What the session last said, for the next load's first frame. */
export const BOOT_FRAME_STORAGE_KEY = "mate:boot-frame";
export const BOOT_FRAME_SIGNED_IN = "app";

export type BootFrameMode = "app" | "mark";

const RETURNING = new RegExp(`${ZEROPS_HANDOVER_CALLBACK_PATH}/?$`, "iu");

export function bootFrameMode(input: {
  /** `localStorage[BOOT_FRAME_STORAGE_KEY]`. */
  readonly remembered: string | null;
  readonly pathname: string;
}): BootFrameMode {
  return input.remembered === BOOT_FRAME_SIGNED_IN || RETURNING.test(input.pathname)
    ? "app"
    : "mark";
}

/**
 * What the session writes for the next load: signed in remembers the app's frame, signed out
 * forgets it, and a status still on its way changes nothing.
 */
export function bootFrameMemory(status: ZeropsSessionStatus): "remember" | "forget" | "keep" {
  switch (status) {
    case "signed-in":
      return "remember";
    case "signed-out":
      return "forget";
    default:
      return "keep";
  }
}
