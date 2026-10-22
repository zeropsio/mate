import {
  createRouter,
  defaultParseSearch,
  RouterHistory,
  stringifySearchWith,
} from "@tanstack/react-router";

import { appBasePathHref } from "./basePath.ts";
import { RoutePending } from "./components/RoutePending";
import { routeTree } from "./routeTree.gen";

/**
 * TanStack's search, except that a value a URL cannot hold as text (a Git path naming bytes that
 * are not UTF-8, `PathText`) is written as JSON, whose escapes the default parser reads back.
 */
export const stringifySearch = stringifySearchWith(JSON.stringify, (value: string) =>
  value.isWellFormed() ? JSON.parse(value) : value,
);
export const parseSearch = defaultParseSearch;

export function getRouter(history: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    // The bundle may be hosted under a path prefix; without it every route
    // under <prefix>/ misses and the app renders its not-found page.
    basepath: appBasePathHref(),
    context: {},
    stringifySearch,
    parseSearch,
    defaultPendingComponent: RoutePending,
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
