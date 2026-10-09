/**
 * A page loaded before a deploy still asks for the old build's lazy chunks, which the new build
 * removed: the static host answers a missing asset with the app's page (HTML), so the import
 * fails. Each deploy replaces the whole bundle (the hosted client's static service, a Mate's
 * /mate/), so an old chunk cannot be kept; the app reloads once to the new build instead. A tab
 * that reloaded for this a moment ago and fails again shows the error screen: never a loop.
 */

/** A second stale chunk within this long of the last reload is a real failure, not a deploy. */
export const STALE_CHUNK_RELOAD_GUARD_MS = 60_000;

const RELOADED_AT_KEY = "mate:stale-chunk-reloaded-at";

/** How each browser (and Vite's preload) says a module or stylesheet of the build is missing. */
const STALE_CHUNK_MESSAGES = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /is not a valid javascript mime type/i,
  /expected a javascript(?:-or-wasm)? module script/i,
  /unable to preload css/i,
];

export function isStaleChunkError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  return message !== undefined && STALE_CHUNK_MESSAGES.some((pattern) => pattern.test(message));
}

export interface StaleChunkHost {
  readonly storage: () => Pick<Storage, "getItem" | "setItem">;
  readonly now: () => number;
  readonly reload: () => void;
}

export function makeStaleChunkRecovery(host: StaleChunkHost) {
  let reloading = false;
  /** Whether the error is a stale chunk the app reloads for (it then shows nothing of it). */
  const recover = (error: unknown): boolean => {
    if (!isStaleChunkError(error)) return false;
    if (reloading) return true;
    const now = host.now();
    try {
      const storage = host.storage();
      const last = Number(storage.getItem(RELOADED_AT_KEY));
      if (Number.isFinite(last) && last > 0 && now - last < STALE_CHUNK_RELOAD_GUARD_MS) {
        return false;
      }
      storage.setItem(RELOADED_AT_KEY, String(now));
    } catch {
      // A tab that cannot remember the reload could loop: it shows the error instead.
      return false;
    }
    reloading = true;
    host.reload();
    return true;
  };
  return { recover };
}

/** The page's own recovery: its session storage, its clock, its reload. */
export const staleChunkRecovery = makeStaleChunkRecovery({
  storage: () => window.sessionStorage,
  now: () => Date.now(),
  reload: () => window.location.reload(),
});
