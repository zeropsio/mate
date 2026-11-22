/**
 * The first frame, decided before it is painted (index.html's second inline script runs the same
 * rules). A browser whose last session was signed in to Zerops HQ's is painted the app's own
 * frame: the menu column with its mark where the menu draws it, and a quiet page. Any other, and
 * any desktop window (its menu's mark stands beside the window's own buttons, in its title bar),
 * is painted the sign-in's centred mark. Pure.
 */
import type { ZeropsSessionStatus } from "./ZeropsSessionProvider";

/** What the session last said, for the next load's first frame. */
export const BOOT_FRAME_STORAGE_KEY = "mate:boot-frame";
/**
 * The last session was signed in to Zerops HQ's, which keeps nothing in this origin's storage: the
 * one memory that paints the app's frame.
 */
export const BOOT_FRAME_SHARED = "zerops-hq";

type BootFrameMode = "app" | "mark";

export function bootFrameMode(input: {
  /** `localStorage[BOOT_FRAME_STORAGE_KEY]`. */
  readonly remembered: string | null;
  /** A desktop window (`window.desktopBridge`). */
  readonly desktop: boolean;
}): BootFrameMode {
  if (input.desktop) return "mark";
  return input.remembered === BOOT_FRAME_SHARED ? "app" : "mark";
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

/**
 * The frame against what the app has drawn into #root: shown while it draws nothing; and where it
 * drew before (a wait later in the session — an account switched, a sign-in from the page), the
 * frame takes the app's colours and menu width as they are now, not the load's.
 */
export function bootFrameSync(input: { readonly rootChildren: number; readonly drawn: boolean }): {
  readonly shown: boolean;
  readonly repaint: boolean;
  readonly drawn: boolean;
} {
  const shown = input.rootChildren === 0;
  return { shown, repaint: shown && input.drawn, drawn: input.drawn || !shown };
}

const LIVE_ROLES = [
  ["--background", "--boot-background"],
  ["--foreground", "--boot-foreground"],
  ["--sidebar", "--boot-sidebar"],
] as const;

/** The frame's colours from the app's live roles; a role it cannot read keeps the load's. */
export function livePalette(read: (name: string) => string): Record<string, string> {
  const palette: Record<string, string> = {};
  for (const [live, boot] of LIVE_ROLES) {
    const value = read(live).trim();
    if (value !== "") palette[boot] = value;
  }
  return palette;
}
