/**
 * A stop's public face — the addresses its services answer at, and the services it could open —
 * joined from its project's row (its subdomain host and zone), its services' rows (which answer on
 * a subdomain, on which ports), both observed live, and its routing (the domains bound to it),
 * sampled while the stop is drawn (`families/publicRouting.ts`).
 *
 * @module data/projections/publicAccess
 */
import { routingScope } from "../families/publicRouting.ts";
import type { Projection } from "../store.ts";
import { derivePublicAccess, type ZeropsPublicAccess } from "../../zerops/publicRoutes.ts";
import { sameValue } from "./equal.ts";
import type { ProjectKey } from "./processes.ts";
import { sampledRead } from "./sampled.ts";
import { projectServices } from "./services.ts";

export interface PublicAccessView extends ZeropsPublicAccess {
  /**
   * `ready` once every part is read; `failed` while its routing's read fails or is refused — the
   * addresses read before stay, beside the failure; `reading` until then.
   */
  readonly state: "ready" | "reading" | "failed";
  /** The owner refused the viewer the routing: the person's again asks for access anew. */
  readonly denied: boolean;
}

const NONE: ZeropsPublicAccess = { routes: [], offers: [] };

export const publicAccess: Projection<ProjectKey, PublicAccessView> = {
  name: "publicAccess",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    const scope = routingScope(orgId, projectId);
    const routing = sampledRead(read, "publicRouting", scope, projectId);
    const project = read.fact("project", projectId);
    const { services } = projectServices.derive(read, { orgId, projectId });
    const { phase, fault } = read.stream(scope);
    const failing = phase === "recovering" || phase === "refused";
    const access =
      routing.value !== undefined && project.kind === "known" && services !== undefined
        ? derivePublicAccess(project.value, services, routing.value)
        : undefined;
    return {
      ...(access ?? NONE),
      state: failing ? "failed" : access !== undefined ? "ready" : "reading",
      denied: phase === "refused" && fault?.outcome === "authoritative-denial",
    };
  },
  equals: sameValue,
};
