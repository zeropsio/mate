import { useEffect, useState } from "react";

import { isMacPlatform } from "../lib/utils";
import { Overlay } from "./ui/overlay";

// Matches the hold duration in apps/desktop/src/window/QuitHold.ts: the hint
// from a quick tap lingers for as long as a full hold would have taken.
const HIDE_AFTER_RELEASE_MS = 1200;

/**
 * Chrome-style "Hold ⌘Q to Quit" hint. The desktop main process intercepts
 * the quit accelerator and pushes press/release states; a quick tap shows
 * this pill while a full hold quits the app.
 */
export function QuitHoldOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const subscribe = window.desktopBridge?.onQuitShortcut;
    if (!subscribe) return;
    let hideTimer: number | undefined;
    const unsubscribe = subscribe((state) => {
      window.clearTimeout(hideTimer);
      if (state === "down") {
        setVisible(true);
        return;
      }
      hideTimer = window.setTimeout(() => setVisible(false), HIDE_AFTER_RELEASE_MS);
    });
    return () => {
      window.clearTimeout(hideTimer);
      unsubscribe();
    };
  }, []);

  // Only the desktop app holds the quit key; elsewhere there is nothing to say.
  if (!window.desktopBridge?.onQuitShortcut) return null;
  const shortcut = isMacPlatform(navigator.platform) ? "⌘Q" : "Ctrl+Q";
  return (
    <Overlay kind="hint" shown={visible}>
      Hold {shortcut} to quit
    </Overlay>
  );
}
