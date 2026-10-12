/**
 * A list of public routes as a menu lists them: one entry per route, the service as the developer
 * names it, its port only where it tells two apart. Pure: the routes menu, a place's addresses
 * and a project's addresses all list them this way.
 */
import type { ZeropsPublicRoute } from "@t3tools/client-runtime/zerops";

export interface ZeropsRouteMenuEntry {
  readonly key: string;
  readonly service: string;
  /** Written only where one service answers on several ports; one port needs no number. */
  readonly port: number | undefined;
  readonly host: string;
  readonly url: string;
}

/**
 * The menu's items, in the order `derivePublicRoutes` sorted the routes.
 *
 * A port is written only where it tells the two apart — where one service
 * answers on more than one of them. A service reached at four domains on the
 * same port is the ordinary shape of a production, and `app:80` written four
 * times over says nothing while looking like it does.
 */
export function routeMenuEntries(
  routes: ReadonlyArray<ZeropsPublicRoute>,
): ReadonlyArray<ZeropsRouteMenuEntry> {
  const ports = new Map<string, Set<number>>();
  for (const route of routes) {
    const seen = ports.get(route.service) ?? new Set<number>();
    seen.add(route.port);
    ports.set(route.service, seen);
  }
  return routes.map((route) => ({
    key: route.url,
    service: route.service,
    port: (ports.get(route.service)?.size ?? 0) > 1 ? route.port : undefined,
    host: route.host,
    url: route.url,
  }));
}
