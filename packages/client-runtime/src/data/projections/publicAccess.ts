/**
 * One project's public face: every address it answers at now, the ones put in place but not
 * serving yet, and the services that could be published. Joined from the organization's services
 * (each one's subdomain switch and ports), the project's subdomain host, and the organization's
 * routings — never a read of its own. A routing not synced yet is pending, never live.
 *
 * A viewer the organization's routing search refuses reads the project's own listing instead:
 * `readsProject` asks the surface showing it to demand that listing.
 *
 * @module data/projections/publicAccess
 */
import type { ZeropsProject } from "../../zerops/api.ts";
import { isZcpService } from "../../zerops/candidates.ts";
import {
  derivePublicRouteOffers,
  derivePublicRoutes,
  type ZeropsPublicRoute,
  type ZeropsRouteOffer,
} from "../../zerops/publicRoutes.ts";
import {
  projectRoutingsScope,
  routingsScope,
  type PublicRoutingValue,
} from "../families/publicRouting.ts";
import type { ServiceValue } from "../families/service.ts";
import { linkKeys } from "../model.ts";
import type { ProjectionReads, Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { scopeFreshness } from "./freshness.ts";
import type { ProjectKey } from "./processes.ts";
import { projectServices } from "./services.ts";

export interface PublicAccess {
  /** `reading` until services and routings are both read; `failed` where either is refused. */
  readonly state: "ready" | "reading" | "failed";
  /** The addresses that serve now, by service then port. */
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  /** The addresses put in place that do not serve yet. */
  readonly pending: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers: ReadonlyArray<ZeropsRouteOffer>;
  /** The organization's routings are refused to the viewer: demand the project's own listing. */
  readonly readsProject: boolean;
}

const byServiceThenPort = (left: ZeropsPublicRoute, right: ZeropsPublicRoute) =>
  left.service.localeCompare(right.service, "en") || left.port - right.port;

/** Where the project's routings stand: the ones read, or why there are none to show. */
type Routings =
  | { readonly kind: "read"; readonly values: ReadonlyArray<PublicRoutingValue> }
  | { readonly kind: "reading" | "failed" };

/**
 * Whether the organization's routing search was refused to the viewer alone, its link up: the
 * project's own listing is what the viewer may read. A refused link refuses every scope with it,
 * and asks for nothing per project.
 */
function refusedAlone(read: ProjectionReads, orgId: string): boolean {
  return (
    read.stream(routingsScope(orgId)).phase === "refused" &&
    read.stream(linkKeys.zerops(orgId)).phase !== "refused"
  );
}

function routingsOf(read: ProjectionReads, { orgId, projectId }: ProjectKey): Routings {
  const values = (ids: Iterable<string>) => {
    const found: PublicRoutingValue[] = [];
    for (const id of ids) {
      const fact = read.fact("publicRouting", id);
      if (fact.kind === "known") found.push(fact.value);
    }
    return found;
  };
  if (refusedAlone(read, orgId)) {
    const own = projectRoutingsScope(orgId, projectId);
    if (read.stream(own).phase === "refused") return { kind: "failed" };
    if (read.coverage(own) !== "complete") return { kind: "reading" };
    return { kind: "read", values: values(read.members(own).ids) };
  }
  const freshness = scopeFreshness(read, orgId, routingsScope(orgId));
  if (freshness.unavailableReason !== undefined) return { kind: "failed" };
  return freshness.complete
    ? { kind: "read", values: values(read.index("routingProject", projectId)) }
    : { kind: "reading" };
}

function addressesOf(
  project: ZeropsProject,
  services: ReadonlyArray<ServiceValue>,
  routings: ReadonlyArray<PublicRoutingValue>,
): Pick<PublicAccess, "routes" | "pending"> {
  const live = new Map<string, ZeropsPublicRoute>();
  const pending = new Map<string, ZeropsPublicRoute>();
  const byId = new Map(
    services
      .filter((service) => service.isSystem !== true && !isZcpService(service))
      .map((service) => [service.id, service]),
  );
  for (const routing of routings)
    for (const location of routing.locations) {
      const service = byId.get(location.serviceStackId);
      if (service === undefined) continue;
      for (const { domainName } of routing.domains) {
        const url = `${routing.sslEnabled ? "https" : "http"}://${domainName}${location.path === "/" ? "" : location.path}`;
        const route = {
          service: service.name,
          port: location.port,
          url,
          host: url.replace(/^https?:\/\//u, ""),
        };
        // An address its routing has not put in place serves nothing yet, whatever else says so.
        if (routing.isSynced) {
          if (!pending.has(url)) live.set(url, route);
        } else {
          live.delete(url);
          pending.set(url, route);
        }
      }
    }
  // A service switch only corroborates publication. Without its routing, the expected address
  // is still pending (including the gap between a routing delete and the service's off push).
  for (const route of derivePublicRoutes(project, services))
    if (!live.has(route.url) && !pending.has(route.url)) pending.set(route.url, route);
  return {
    routes: [...live.values()].sort(byServiceThenPort),
    pending: [...pending.values()].sort(byServiceThenPort),
  };
}

const NOTHING: Pick<PublicAccess, "routes" | "pending" | "offers"> = {
  routes: [],
  pending: [],
  offers: [],
};

export const publicAccess: Projection<ProjectKey, PublicAccess> = {
  name: "publicAccess",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, key) => {
    const readsProject = refusedAlone(read, key.orgId);
    const services = projectServices.derive(read, key);
    const routings = routingsOf(read, key);
    if (services.unavailableReason !== undefined || routings.kind === "failed")
      return { state: "failed", ...NOTHING, readsProject };
    const project = read.fact("project", key.projectId);
    if (services.services === undefined || routings.kind !== "read" || project.kind !== "known")
      return { state: "reading", ...NOTHING, readsProject };
    return {
      state: "ready",
      ...addressesOf(project.value as ZeropsProject, services.services, routings.values),
      offers: derivePublicRouteOffers(services.services),
      readsProject,
    };
  },
  equals: sameValue,
};
