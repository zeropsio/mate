/**
 * The kill switch: shipped as `/sw.js` instead of `sw.ts` when the build says
 * `VITE_APP_SHELL_WORKER=retire`. Every browser that runs the app-shell worker fetches `/sw.js` on
 * its next load (`no-cache`, `updateViaCache: "none"`), finds this, takes over at once, clears the
 * worker's caches and unregisters. It has no fetch handler: from the moment it activates, every
 * request goes to the network as if no worker had ever been installed. The page of a retiring
 * build unregisters too (`appShellClient.ts`), for browsers that never fetch this.
 */

import { APP_SHELL_CACHE_PREFIX, outcomeOf } from "./appShell.logic";

interface ExtendableEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}

interface WorkerScope {
  readonly registration: ServiceWorkerRegistration;
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
}

const worker = globalThis as unknown as WorkerScope;

worker.addEventListener("install", (event) => {
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener("activate", (event) => {
  const cleared = caches
    .keys()
    .then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith(APP_SHELL_CACHE_PREFIX))
          .map((name) => caches.delete(name)),
      ),
    );
  event.waitUntil(outcomeOf(cleared).then(() => worker.registration.unregister()));
});
