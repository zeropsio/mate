/**
 * index.html's first frame (`#boot-shell`), kept: it stands while the app draws nothing into
 * #root, and goes in the frame the app first draws there. The waits before the app can draw — the
 * session check, the account's data, its inventory, the sign-in's return — draw nothing into
 * #root; their one line goes into the frame's page (`bootFrameSlot`). So the frame is mounted once,
 * by the HTML, and never replaced by a copy of itself (the owner, 2026-10-02: "full animated Mate
 * logo, then it turns into a little different smaller logo").
 */
import * as Schema from "effect/Schema";

import { getLocalStorageItem } from "~/hooks/useLocalStorage";
import {
  resolveInitialThreadSidebarWidth,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "~/components/threadSidebarWidth";
import type { ZeropsSessionStatus } from "./ZeropsSessionProvider";
import { BOOT_FRAME_SIGNED_IN, BOOT_FRAME_STORAGE_KEY, bootFrameMemory } from "./bootFrame.logic";

/** Shows the frame while #root is empty, from now on. Called once, before the app renders. */
export function keepBootFrame(root: HTMLElement): void {
  const shell = document.getElementById("boot-shell");
  if (shell === null) return;
  // A mutation's callback runs before the next paint: the frame goes in the frame the app draws.
  const sync = () => {
    shell.hidden = root.childElementCount > 0;
  };
  new MutationObserver(sync).observe(root, { childList: true });
  sync();
}

/** Where a wait's line stands in the frame's page; null where there is no frame (tests, SSR). */
export function bootFrameSlot(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.getElementById("boot-shell-page");
}

/**
 * The app's frame from now on: a wait that knows the person is signed in (the account's data, its
 * inventory, the sign-in's return) draws it even where the load painted the sign-in's mark.
 */
export function showAppFrame(): void {
  const root = document.documentElement;
  if (root.dataset.bootFrame === "app") return;
  let stored: number | null = null;
  try {
    stored = getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite);
  } catch {
    stored = null;
  }
  root.style.setProperty(
    "--boot-menu-width",
    `${resolveInitialThreadSidebarWidth(stored, window.innerWidth)}px`,
  );
  root.dataset.bootFrame = "app";
}

/** What the session says, kept for the next load's first frame. */
export function rememberBootFrame(status: ZeropsSessionStatus): void {
  const memory = bootFrameMemory(status);
  if (memory === "keep") return;
  try {
    if (memory === "remember")
      window.localStorage.setItem(BOOT_FRAME_STORAGE_KEY, BOOT_FRAME_SIGNED_IN);
    else window.localStorage.removeItem(BOOT_FRAME_STORAGE_KEY);
  } catch {
    // Storage refused: the next load paints the sign-in's mark, and the app takes over from it.
  }
}
