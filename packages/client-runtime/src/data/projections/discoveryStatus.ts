/** Complete source coverage earns a negative listing. Ending an attempt or patience does not. */
import { servicesScope } from "../families/service.ts";
import type { Projection } from "../store.ts";
import { organizationProjects } from "./projects.ts";
import { hqNavigation } from "./hqNavigation.ts";
import { mateLinks } from "./mateLinks.ts";
import { sameValue } from "./equal.ts";
export type DiscoveryStatus = "complete" | "incomplete" | "unavailable";
export const discoveryStatus: Projection<
  { readonly orgId: string; readonly hqAbsent: boolean },
  DiscoveryStatus
> = {
  name: "discoveryStatus",
  keyOf: (key) => JSON.stringify(key),
  equals: sameValue,
  derive: (read, { orgId, hqAbsent }) => {
    const projects = organizationProjects.derive(read, orgId);
    const services = servicesScope(orgId);
    const serviceMembers = read.members(services);
    const hq = hqNavigation.derive(read, orgId);
    if (
      projects.unavailableReason !== undefined ||
      read.stream(services).phase === "refused" ||
      (!hqAbsent && (hq.refusal !== null || hq.updateRequired))
    )
      return "unavailable";
    if (
      !projects.complete ||
      serviceMembers.coverage !== "complete" ||
      serviceMembers.unverified.length > 0 ||
      serviceMembers.ids.some((id) => read.fact("service", id).kind === "unknown") ||
      (!hqAbsent && (hq.read !== "read" || hq.structure === null))
    )
      return "incomplete";
    for (const target of mateLinks.derive(read, null).targets.values()) {
      if (target.orgId !== orgId || !target.environment.guards.want) continue;
      const credential = target.environment.credential;
      if (credential.kind === "held" && credential.installed) continue;
      if (
        credential.kind === "refused" ||
        credential.kind === "backoff" ||
        credential.kind === "retired"
      )
        return "unavailable";
      return "incomplete";
    }
    return "complete";
  },
};
