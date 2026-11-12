import { freshHqSocketName } from "@t3tools/client-runtime/zerops/hq";

/**
 * The name of this tab's HQ stream socket, which HQ ties a held press to. It belongs to the tab: a
 * reload of the tab keeps it, so a press held before the reload stays held; any other load (a new
 * tab, a duplicated tab, which copies `sessionStorage`, a fresh navigation) names a new socket.
 * Storage that is missing or throws gives a fresh name, which a reload then does not keep.
 */
const STORAGE_KEY = "mate:hq-socket-name";

/** This page load's name: the navigation type and the stored name are read once per load. */
let thisLoad: string | null = null;

export function tabHqSocketName(): string {
  thisLoad ??= readTabHqSocketName();
  return thisLoad;
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
