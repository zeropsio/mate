/**
 * The PlatformSignals port over a browser tab (DESIGN §6.4): the document's visibility, the
 * window's focus, a return from the back-forward cache or a freeze, the network, and a tick for
 * sleep detection. The account's data provider makes one per account epoch, and every consumer of
 * the account hears the tab through it.
 */
import {
  makePlatformSignals,
  SIGNALS_TICK_MS,
  type PageEvent,
  type PlatformSignals,
} from "@t3tools/client-runtime/zerops/knowledge";

/** The tab `document` and `window` belong to, bound to them whichever tab later holds the globals. */
export function browserPlatformSignals(document: Document, window: Window): PlatformSignals {
  const hidden = () => document.visibilityState === "hidden";
  return makePlatformSignals({
    hidden,
    online: () => typeof navigator === "undefined" || navigator.onLine !== false,
    now: () => ({ wall: Date.now(), mono: performance.now() }),
    listen: (hear) => {
      const on = (event: PageEvent) => () => hear(event);
      const onVisibility = () => hear({ type: "visibility", hidden: hidden() });
      const onPageShow = (event: Event) =>
        hear({ type: "pageshow", persisted: (event as PageTransitionEvent).persisted === true });
      const windowEvents = [
        ["focus", on({ type: "focus" })],
        ["blur", on({ type: "blur" })],
        ["online", on({ type: "online" })],
        ["offline", on({ type: "offline" })],
        ["pageshow", onPageShow],
      ] as const;
      const onResume = on({ type: "resume" });
      document.addEventListener("visibilitychange", onVisibility);
      document.addEventListener("resume", onResume);
      for (const [type, listener] of windowEvents) window.addEventListener(type, listener);
      // One timer at a time, so a throttled or frozen tab's ticks stay what they are: a gap.
      let timer: ReturnType<typeof setTimeout>;
      const tick = () => {
        hear({ type: "tick" });
        timer = setTimeout(tick, SIGNALS_TICK_MS);
      };
      tick();
      return () => {
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibility);
        document.removeEventListener("resume", onResume);
        for (const [type, listener] of windowEvents) window.removeEventListener(type, listener);
      };
    },
  });
}
