/**
 * What a service runs, from its own row in the organization's services listing: its active
 * version, and that version's name. The API never returns a version's name; the row's own
 * variables do — `appVersionName` beside `appVersionId`, both SYSTEM variables on that row. They
 * name the build the service last started, so the name is the one it runs only
 * while `appVersionId` is its active version's id. One row is one observation: no variable is read
 * of its own, and none can trail the version the row names.
 *
 * @module data/projections/serviceRuns
 */
import { servicesScope, type ServiceValue } from "../families/service.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

/**
 * What a service runs: its active version's id and source (`NONE` on a runtime nothing was
 * ever deployed to), each `null` when it has no active version — the source also where its row
 * leaves it unstated — and that version's name, `null` where nothing names it.
 */
export interface ZeropsServiceDeployedVersion {
  readonly activeId: string | null;
  readonly source: string | null;
  readonly name: string | null;
}

/** `unread` until the listing and the row say; `absent` where the read listing holds no such service. */
export type ServiceRuns = ZeropsServiceDeployedVersion | "unread" | "absent";

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
};

const variable = (service: ServiceValue, key: string): string | null =>
  text(service.userData?.find((entry) => entry.key === key)?.content);

export function runsOf(service: ServiceValue): ServiceRuns {
  const version = service.activeAppVersion;
  if (version === undefined) return "unread";
  const activeId = text(version?.id);
  if (version === null || activeId === null) return { activeId: null, source: null, name: null };
  const name =
    text(version.name) ??
    (variable(service, "appVersionId") === activeId ? variable(service, "appVersionName") : null);
  return { activeId, source: text(version.source), name };
}

export const serviceRuns: Projection<
  { readonly orgId: string; readonly serviceId: string },
  ServiceRuns
> = {
  name: "serviceRuns",
  keyOf: ({ orgId, serviceId }) => `${orgId}/${serviceId}`,
  derive: (read, { orgId, serviceId }) => {
    const fact = read.fact("service", serviceId);
    // A service that left the listing is no longer one of its project's (`serviceProject`).
    if (fact.kind === "known" && read.index("serviceProject", fact.value.projectId).has(serviceId))
      return runsOf(fact.value);
    return read.coverage(servicesScope(orgId)) === "complete" ? "absent" : "unread";
  },
  equals: sameValue,
};
