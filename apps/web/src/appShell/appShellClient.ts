/**
 * The page's side of the app-shell worker (`sw.ts`): whether this load registers it.
 *
 * **Only the hosted build at an origin root.** The build says so (`VITE_APP_SHELL_WORKER`, set by
 * zerops.yml's `prod` and `staging` only), and the page checks what it runs as: a production
 * bundle (never Vite's dev server), the hosted-static app (`isHostedStaticApp`), served at `/` (a
 * Mate's container serves the same source under `/mate/`, built without the variable), outside
 * Electron (the desktop shell loads the hosted origin but owns its own cache), in a secure context
 * where `navigator.serviceWorker` exists.
 */

import { outcomeOf } from "./appShell.logic";

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

/**
 * Registers (or retires) the worker once the page has loaded, so it never competes with the boot.
 * Registering the same script again changes nothing; the browser itself checks `/sw.js` for a
 * newer worker on navigations, and `updateViaCache: "none"` keeps that check out of the HTTP
 * cache. That flag carries it: mate.zerops.io's Cloudflare hands browsers root `.js` and `.svg`
 * files with `max-age=14400` whatever nginx's `no-cache` says, while its edge still revalidates
 * them with the origin (`curl -sI https://mate.zerops.io/sw.js`, 2026-11-06).
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
