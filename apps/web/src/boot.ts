/**
 * The page's boot entry: a few lines the page runs ahead of the app's bundle (`index.html`), while
 * that bundle still downloads and compiles. A signed-in reload has the data layer's HQ adapter
 * begin its opening from here — a ticket and the socket (`data/adapters/hqStreamAhead.ts`), with
 * the sign-in this browser keeps; the app's HQ client takes the socket over when it starts. Where
 * there is nothing to open — no sign-in kept, a desktop window, storage refused — it does nothing,
 * and the app opens its own stream as it always did.
 *
 * It imports nothing but that module, which imports nothing itself: whatever it imported would have
 * to load before it could run.
 */
import { openHqStreamAhead } from "@t3tools/client-runtime/data/hqStreamAhead";

try {
  // A desktop window's sign-in is not this origin's storage.
  if (window.desktopBridge === undefined)
    openHqStreamAhead(import.meta.env.VITE_HQ_ORIGIN ?? "", window.localStorage);
} catch {
  // Storage the browser refuses to hand out: the app opens its own stream.
}
