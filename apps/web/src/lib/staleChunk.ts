/**
 * A page loaded before a deploy still asks for the old build's lazy chunks, which the new build
 * removed: the static host answers a missing asset with the app's page (HTML), so the import
 * fails. Each deploy replaces the whole bundle (the hosted client's static service, a Mate's
 * /mate/), so an old chunk cannot be kept; the app reloads once to the new build instead. A tab
 * that reloaded for this a moment ago and fails again shows the error screen: never a loop.
 *
 * A Mate's setup runs in the tab that pressed it and stops with the page: the reload waits for
 * it to end.
 */

import { pressesInFlight } from "../zerops/matePress";

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
  /** Whether a Mate's setup runs in this tab (`pressesInFlight`), and when that changes. */
  readonly busy: {
    readonly read: () => boolean;
    readonly subscribe: (listener: () => void) => () => void;
  };
}

export function makeStaleChunkRecovery(host: StaleChunkHost) {
  let reloading = false;
  let waiting = false;
  /** Reloads now, or once the setup this tab runs ends. */
  const reloadWhenIdle = () => {
    if (!host.busy.read()) {
      host.reload();
      return;
    }
    waiting = true;
    const stop = host.busy.subscribe(() => {
      if (host.busy.read()) return;
      stop();
      waiting = false;
      host.reload();
    });
  };
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
    reloadWhenIdle();
    return true;
  };
  /** Whether the reload `recover` asked for waits on a setup this tab runs. */
  return { recover, waiting: () => waiting };
}

/** The page's own recovery: its session storage, its clock, its reload. */
export const staleChunkRecovery = makeStaleChunkRecovery({
  storage: () => window.sessionStorage,
  now: () => Date.now(),
  reload: () => window.location.reload(),
  busy: pressesInFlight,
});
