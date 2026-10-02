/**
 * The first frame, decided before it is painted (index.html's second inline script runs the same
 * rules; `bootFrame.test.ts` holds the two together). A browser whose last session was signed in
 * and still holds it — or one coming back from the Zerops sign-in — is painted the app's own
 * frame: the menu column with its mark where the menu draws it, and a quiet page. Any other, and
 * any desktop window (its menu's mark stands beside the window's own buttons, in its title bar),
 * is painted the sign-in's centred mark. Pure.
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
  /** `localStorage[ZEROPS_SESSION_STORAGE_KEY]`: a memory left over without a session is a sign-in. */
  readonly session: string | null;
  readonly pathname: string;
  /** A desktop window (`window.desktopBridge`). */
  readonly desktop: boolean;
}): BootFrameMode {
  if (input.desktop) return "mark";
  const signedIn = input.remembered === BOOT_FRAME_SIGNED_IN && input.session !== null;
  return signedIn || RETURNING.test(input.pathname) ? "app" : "mark";
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
