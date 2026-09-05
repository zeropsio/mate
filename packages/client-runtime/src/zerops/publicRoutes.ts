/**
 * An environment's public face: every URL the platform serves for it.
 *
 * Read off the same service list the picker already fetches
 * (`candidateLoading.ts`), so a production environment with no Mate — the one
 * whose routes matter most — has them without a container to ask. A route is
 * one subdomain-enabled HTTP(S) port of one service, and `servicePortOrigin`
 * (api.ts) stays the single place the platform's hostname rule lives.
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
  readonly port: number;
  readonly url: string;
  /** The URL without its scheme: what a row shows and what a person copies. */
  readonly host: string;
}

function byServiceThenPort(left: ZeropsPublicRoute, right: ZeropsPublicRoute): number {
  return left.service.localeCompare(right.service, "en") || left.port - right.port;
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
