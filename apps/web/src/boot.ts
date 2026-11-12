/**
 * The page's boot entry: a few lines the page runs ahead of the app's bundle (`index.html`), while
 * that bundle still downloads and compiles. A signed-in reload has the data layer's HQ adapter
 * begin its opening from here — a ticket and the socket (`data/adapters/hqStreamAhead.ts`), with
 * the sign-in this browser keeps; the app's HQ client takes the socket over when it starts. Where
 * there is nothing to open — no sign-in kept, a desktop window, storage refused — it does nothing,
 * and the app opens its own stream as it always did.
 *
 * The socket is opened under the tab's name for this load (`tabHqSocketName`), which HQ ties a
 * held press to: this entry decides it when it opens a stream, and the app then reads that
 * decision off the page.
 *
 * It imports nothing but those two modules, which import next to nothing themselves: whatever it
 * imported would have to load before it could run.
 */
import { openHqStreamAhead } from "@t3tools/client-runtime/data/hqStreamAhead";

import { tabHqSocketName } from "./zerops/tabHqSocketName";

try {
  // A desktop window's sign-in is not this origin's storage.
  if (window.desktopBridge === undefined)
    openHqStreamAhead(import.meta.env.VITE_HQ_ORIGIN ?? "", window.localStorage, tabHqSocketName);
} catch {
  // Storage the browser refuses to hand out: the app opens its own stream.
}
