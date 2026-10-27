/**
 * An environment's public face: every URL the platform serves for it.
 *
 * Derived from a project and its services; the routings of its own domains join
 * them in the data layer's `publicAccess` projection.
 * `servicePortOrigin` (api.ts) stays the single place the subdomain rule lives.
 *
 * Two kinds of service are left out on purpose. The zcp container's port is
 * the Mate's own door (and code-server's), not the application's, and the Mate
 * already has its own card; the platform's system service is not the user's.
 *
 * @module publicRoutes
 */

import { servicePortOrigin, type ZeropsProject, type ZeropsService } from "./api.ts";
import { isZcpService } from "./candidates.ts";

export interface ZeropsPublicRoute {
  /** The service the route reaches, by hostname — what a person calls it. */
  readonly service: string;
  /** The routing location's service identity, when resolved by the data layer. */
  readonly serviceId?: string;
  readonly port: number;
  readonly url: string;
  /** The URL without its scheme: what a row shows and what a person copies. */
  readonly host: string;
}

function byServiceThenPort(left: ZeropsPublicRoute, right: ZeropsPublicRoute): number {
  return left.service.localeCompare(right.service, "en") || left.port - right.port;
}

/**
 * A service that would answer publicly if somebody said so: it serves HTTP and
 * its subdomain is off.
 *
 * Enabling one is a first-class act, not a recovery step. A production
 * environment cloned from dev comes up with its subdomain **not** taken —
 * `enableSubdomainAccess` does not apply to a service imported without code
 * (`verified.md`) — so the first deploy lands and the page answers 502 with
 * nothing anywhere saying why. The routes menu already tells a person where an
 * environment is reachable; this is what it needs to also tell them where it
 * could be.
 */
export interface ZeropsRouteOffer {
  readonly service: string;
  readonly serviceId: string;
  /** The lowest HTTP port it serves — the one enabling would publish. */
  readonly port: number;
}

export function derivePublicRouteOffers(
  services: ReadonlyArray<ZeropsService>,
): ReadonlyArray<ZeropsRouteOffer> {
  const offers: Array<ZeropsRouteOffer> = [];
  for (const service of services) {
    if (service.isSystem === true || isZcpService(service)) continue;
    if (service.subdomainAccess === true) continue;
    const http = (service.ports ?? [])
      .filter((port) => port.scheme === "http" || port.scheme === "https")
      .map((port) => port.port)
      .sort((left, right) => left - right);
    const port = http[0];
    if (port === undefined) continue;
    offers.push({ service: service.name, serviceId: service.id, port });
  }
  return offers.sort((left, right) => left.service.localeCompare(right.service, "en"));
}

export function derivePublicRoutes(
  project: ZeropsProject,
  services: ReadonlyArray<ZeropsService>,
): ReadonlyArray<ZeropsPublicRoute> {
  const routes: Array<ZeropsPublicRoute> = [];
  for (const service of services) {
    if (service.isSystem === true || isZcpService(service)) continue;
    for (const port of service.ports ?? []) {
      const url = servicePortOrigin(project, service, port);
      if (url === undefined) continue;
      routes.push({
        service: service.name,
        port: port.port,
        url,
        host: url.replace(/^https?:\/\//u, ""),
      });
    }
  }
  return routes.sort(byServiceThenPort);
}
