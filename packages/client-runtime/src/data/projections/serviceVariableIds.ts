/**
 * A service's own variables by key — each row's id, never its value — so a write names the row it
 * replaces (`vault-write`'s `update`). The Mate's own container's are among them, which the vault
 * never lists (`vault.ts`). Null until the project's service variables are read; observed only
 * while a screen demands the project's `serviceVariable` detail.
 *
 * @module data/projections/serviceVariableIds
 */
import { serviceVariablesScope } from "../families/serviceVariables.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface ServiceVariableIdsKey {
  readonly orgId: string;
  readonly projectId: string;
  readonly serviceId: string;
}

export const serviceVariableIds: Projection<
  ServiceVariableIdsKey,
  Readonly<Record<string, string>> | null
> = {
  name: "serviceVariableIds",
  keyOf: ({ orgId, projectId, serviceId }) => `${orgId}/${projectId}/${serviceId}`,
  derive: (read, { orgId, projectId, serviceId }) => {
    const scope = serviceVariablesScope(orgId, projectId);
    if (read.coverage(scope) === "unknown") return null;
    const ids: Record<string, string> = {};
    for (const id of read.members(scope).ids) {
      const fact = read.fact("serviceVariable", id);
      if (fact.kind === "known" && fact.value.serviceId === serviceId) ids[fact.value.key] = id;
    }
    return ids;
  },
  equals: sameValue,
};
