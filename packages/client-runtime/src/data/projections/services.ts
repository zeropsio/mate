/**
 * One project's services as the organization's services listing holds them: not known until that
 * listing's first baseline, then every service the project has now, each as its newest row says
 * it. An outage keeps what was read and says it is catching up. A project its owner withholds from
 * the viewer shows none of its services: the services' own leaving comes only with their next
 * change. A project this organization does not list — another's, or one not listed yet — is not
 * known here.
 *
 * @module data/projections/services
 */
import { servicesScope, type ServiceValue } from "../families/service.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { scopeFreshness, type ScopeFreshness } from "./freshness.ts";
import type { ProjectKey } from "./processes.ts";

export interface ProjectServices extends Omit<ScopeFreshness, "complete"> {
  /** The project's services by name; `undefined` until the organization's listing is read. */
  readonly services: ReadonlyArray<ServiceValue> | undefined;
}

const byName = (left: ServiceValue, right: ServiceValue) =>
  left.name.localeCompare(right.name) || left.id.localeCompare(right.id);

export const projectServices: Projection<ProjectKey, ProjectServices> = {
  name: "projectServices",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    const { complete, ...freshness } = scopeFreshness(read, orgId, servicesScope(orgId));
    if (!complete) return { services: undefined, ...freshness };
    const project = read.fact("project", projectId);
    if (project.kind === "withheld" && project.reason === "denied")
      return { services: undefined, ...freshness, unavailableReason: "forbidden" };
    // Only a project this organization lists has its services here: another organization's, or
    // one not listed yet, is not known — never an empty list.
    if (project.kind !== "known" || project.value.clientId !== orgId)
      return { services: undefined, ...freshness };
    const services: ServiceValue[] = [];
    for (const id of read.index("serviceProject", projectId)) {
      const fact = read.fact("service", id);
      if (fact.kind === "known") services.push(fact.value);
    }
    return { services: services.sort(byName), ...freshness };
  },
  equals: sameValue,
};

/** Several projects' services at once: what a surface weighing a whole app's projects reads. */
export const projectsServices: Projection<
  { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
  Readonly<Record<string, ProjectServices>>
> = {
  name: "projectsServices",
  keyOf: ({ orgId, projectIds }) => `${orgId}/${projectIds.join(",")}`,
  derive: (read, { orgId, projectIds }) =>
    Object.fromEntries(
      projectIds.map((projectId) => [
        projectId,
        projectServices.derive(read, { orgId, projectId }),
      ]),
    ),
  equals: sameValue,
};
