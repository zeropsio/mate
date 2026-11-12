// The generator alone, never the HQ client beside it: the page's boot entry bundles this module.
import { freshHqSocketName } from "@t3tools/client-runtime/zerops/hq/socketName";

/**
 * The name of this tab's HQ stream socket, which HQ ties a held press to. It belongs to the tab: a
 * reload of the tab keeps it, so a press held before the reload stays held; any other load (a new
 * tab, a duplicated tab, which copies `sessionStorage`, a fresh navigation) names a new socket.
 * Storage that is missing or throws gives a fresh name, which a reload then does not keep.
 */
const STORAGE_KEY = "mate:hq-socket-name";

/**
 * This page load's name: the navigation type and the stored name are read once per load, by
 * whoever asks first, and kept on the page. The boot entry (`boot.ts`), which opens HQ's stream
 * under this name before the app exists, is a script of its own with its own copy of this module:
 * the two share the page, not a module, and the app must read the name the boot entry decided,
 * never name the socket again. A context with no window keeps it on its global object.
 */
export function tabHqSocketName(): string {
  const page = (typeof window === "undefined" ? globalThis : window) as {
    __mateHqSocketName?: unknown;
  };
  // Only a name this module put there: anything else under that key on the page is not one.
  const held = page.__mateHqSocketName;
  if (typeof held === "string") return held;
  const name = readTabHqSocketName();
  page.__mateHqSocketName = name;
  return name;
}

function readTabHqSocketName(): string {
  try {
    const storage = window.sessionStorage;
    const navigation = performance.getEntriesByType("navigation")[0];
    const kept =
      navigation instanceof PerformanceNavigationTiming && navigation.type === "reload"
        ? storage.getItem(STORAGE_KEY)
        : null;
    if (kept !== null && kept !== "") return kept;
    const fresh = freshHqSocketName();
    storage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return freshHqSocketName();
  }
}
