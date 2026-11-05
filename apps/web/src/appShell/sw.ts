/**
 * The hosted client's app-shell worker, built to `/sw.js` by `vite.config.ts`
 * (`appShellWorkerPlugin`, `VITE_APP_SHELL_WORKER=app-shell`) as one classic script: no module
 * worker, no chunk shared with the page. What it answers is `appShellWorker.ts`.
 *
 * **Updates take over at once** (`skipWaiting` + `clients.claim`). The worker keeps no state of a
 * page: it answers a bundle file by its content-named URL from caches whose names never change, and
 * the page only for the next navigation. A tab running an older bundle loses nothing to a newer
 * worker, so waiting for every tab to close would only keep an all-day tab on the old worker and
 * its bugs (and from the retiring one). The worker never reloads a page itself.
 *
 * **Retiring it**: build with `VITE_APP_SHELL_WORKER=retire` (zerops.yml), which ships `retire.ts`
 * as `/sw.js` instead (`docs/operations/release-and-deploy.md`). Never delete `/sw.js` from the
 * origin: an update that finds no script keeps the installed worker.
 */

import { outcomeOf, staticRoutes } from "./appShell.logic";
import { makeAppShellWorker } from "./appShellWorker";

interface ExtendableEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}

/** The install event of browsers with the Static Routing API (Chrome 123+). */
interface RoutingInstallEvent extends ExtendableEvent {
  addRoutes?(rules: readonly unknown[]): Promise<void>;
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface WorkerScope {
  readonly registration: ServiceWorkerRegistration;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install", listener: (event: RoutingInstallEvent) => void): void;
  addEventListener(type: "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEvent) => void): void;
}

const worker = globalThis as unknown as WorkerScope;

const appShell = makeAppShellWorker({
  caches,
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  scope: worker.registration.scope,
});

/** The static routes as the browser takes them: each URL pattern built as a `URLPattern`. */
function browserRoutes(scope: string) {
  return staticRoutes(scope).map((route) =>
    "urlPattern" in route.condition
      ? { ...route, condition: { urlPattern: new URLPattern(route.condition.urlPattern) } }
      : route,
  );
}

worker.addEventListener("install", (event) => {
  // Feature-detected: elsewhere every request reaches the handler, which passes what it does not route.
  const routed =
    typeof event.addRoutes === "function" && typeof URLPattern === "function"
      ? outcomeOf(event.addRoutes(browserRoutes(worker.registration.scope)))
      : Promise.resolve("done" as const);
  event.waitUntil(Promise.all([routed, appShell.install()]).then(() => worker.skipWaiting()));
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(outcomeOf(appShell.activate()).then(() => worker.clients.claim()));
});

worker.addEventListener("fetch", (event) => {
  const answer = appShell.answer(event.request, (work) => event.waitUntil(work));
  if (answer !== undefined) event.respondWith(answer);
});
