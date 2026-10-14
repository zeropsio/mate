import { createRouter, type AnyRoute, RouterHistory } from "@tanstack/react-router";

import { appBasePathHref } from "./basePath.ts";
import { SurfaceLoading } from "./components/SurfaceLoading";
import { routeTree } from "./routeTree.gen";

export function getRouter(history: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    // The bundle may be hosted under a path prefix; without it every route
    // under <prefix>/ misses and the app renders its not-found page.
    basepath: appBasePathHref(),
    context: {},
    defaultPendingComponent: SurfaceLoading,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

/** How long after boot every page's code is fetched: past the boot's own reads and sockets. */
export const ROUTE_WARMUP_AFTER_MS = 4_000;

/**
 * Every page's lazy code, fetched once the boot has settled and the browser is idle: a later move
 * to a page not seen yet draws it at once, never the pending view a chunk on its way would put
 * between the two (a project's page stood blank 0.4 s on mate.zerops.io). A chunk that fails is
 * fetched again by the navigation that needs it.
 */
export function warmRouteChunks(
  router: Pick<AppRouter, "loadRouteChunk" | "routesById">,
  schedule: (run: () => void) => void = (run) =>
    setTimeout(() => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2_000 });
      else run();
    }, ROUTE_WARMUP_AFTER_MS),
): void {
  schedule(() => {
    for (const route of Object.values(router.routesById) as ReadonlyArray<AnyRoute>) {
      void router.loadRouteChunk(route)?.catch(() => undefined);
    }
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
