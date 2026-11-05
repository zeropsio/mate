/**
 * The page's side of the app-shell worker (`sw.ts`): whether this load registers it, and the
 * stale-chunk reload's way to a fresh page.
 *
 * **Only the hosted build at an origin root.** The build says so (`VITE_APP_SHELL_WORKER`, set by
 * zerops.yml's `prod` and `staging` only), and the page checks what it runs as: a production
 * bundle (never Vite's dev server), the hosted-static app (`isHostedStaticApp`), served at `/` (a
 * Mate's container serves the same source under `/mate/`, built without the variable), outside
 * Electron (the desktop shell loads the hosted origin but owns its own cache), in a secure context
 * where `navigator.serviceWorker` exists.
 */

import {
  outcomeOf,
  readStoredAt,
  SHELL_CACHE,
  SHELL_CACHE_KEY_PATH,
  stampResponse,
} from "./appShell.logic";

export type AppShellWorkerMode = "app-shell" | "retire" | "none";

export interface AppShellWorkerSite {
  /** `VITE_APP_SHELL_WORKER` as built. */
  readonly mode: string | undefined;
  readonly production: boolean;
  readonly hosted: boolean;
  /** `appBasePath()`: `""` at an origin root. */
  readonly basePath: string;
  readonly electron: boolean;
  readonly serviceWorkers: boolean;
}

/**
 * `app-shell` registers the worker, `retire` unregisters whatever this origin registered (the kill
 * switch, wherever it runs), `none` leaves the browser's workers alone.
 */
export function appShellWorkerMode(site: AppShellWorkerSite): AppShellWorkerMode {
  if (!site.serviceWorkers) return "none";
  const mode = site.mode?.trim().toLowerCase();
  if (mode === "retire") return "retire";
  if (mode !== "app-shell") return "none";
  if (!site.production || !site.hosted || site.basePath !== "" || site.electron) return "none";
  return "app-shell";
}

/** How long the stale-chunk reload waits for the page to be forgotten before reloading anyway. */
export const FORGET_SHELL_TIMEOUT_MS = 800;

/**
 * Makes the next navigation ask the origin for the page first, keeping the kept one only as the
 * offline answer (stored at 0: `planShell` says `network`). The stale-chunk reload calls this
 * first: the kept page is the one whose chunk a deploy removed. Resolves within `timeoutMs`
 * whatever the Cache API does; a reload that still meets the old page fails the chunk again within
 * `STALE_CHUNK_RELOAD_GUARD_MS` and shows the error screen, never a loop.
 */
export type ForgetOutcome = "forgotten" | "nothing-kept" | "failed" | "timed-out";

export async function forgetCachedShell(
  storage: Pick<CacheStorage, "open" | "has"> | undefined,
  origin: string,
  timeoutMs: number = FORGET_SHELL_TIMEOUT_MS,
): Promise<ForgetOutcome> {
  if (storage === undefined) return "nothing-kept";
  const forget = async (): Promise<ForgetOutcome> => {
    // `has` first: opening a cache creates it, and a browser without the worker gets none.
    if (!(await storage.has(SHELL_CACHE))) return "nothing-kept";
    const cache = await storage.open(SHELL_CACHE);
    const key = new URL(SHELL_CACHE_KEY_PATH, origin).href;
    const kept = await cache.match(key);
    if (kept === undefined) return "nothing-kept";
    if (readStoredAt(kept.headers) !== 0) await cache.put(key, stampResponse(kept, 0));
    return "forgotten";
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const outcome = await Promise.race([
    forget().catch((): ForgetOutcome => "failed"),
    new Promise<ForgetOutcome>((resolve) => {
      timer = setTimeout(() => resolve("timed-out"), timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  return outcome;
}

/** The page's caches, where the Cache API exists (secure contexts only). */
function pageCaches(): CacheStorage | undefined {
  return typeof caches === "undefined" ? undefined : caches;
}

/** The stale-chunk reload: forget the kept page, then reload into what the origin serves now. */
export function reloadIntoFreshShell(): void {
  void forgetCachedShell(pageCaches(), window.location.origin).then(() => window.location.reload());
}

/**
 * Registers (or retires) the worker once the page has loaded, so it never competes with the boot.
 * Registering the same script again changes nothing; the browser itself checks `/sw.js` for a
 * newer worker on navigations, and `updateViaCache: "none"` keeps that check out of the HTTP
 * cache on top of the script's `no-cache` header.
 */
export function startAppShellWorker(mode: AppShellWorkerMode): void {
  if (mode === "none") return;
  const run = () => {
    const container = navigator.serviceWorker;
    if (mode === "retire") {
      void outcomeOf(
        container
          .getRegistrations()
          .then((registrations) => Promise.all(registrations.map((entry) => entry.unregister()))),
      );
      return;
    }
    // A refused registration leaves the page as it is without the worker; the next load asks again.
    void outcomeOf(container.register("/sw.js", { scope: "/", updateViaCache: "none" }));
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
}
