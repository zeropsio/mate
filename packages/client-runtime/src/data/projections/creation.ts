/**
 * Setup follows HQ's accepted import identity, even after its press disappears. An unrecorded
 * or unread handle says nothing yet. Initial project creation has its separate operation owner.
 *
 * @module data/projections/creation
 */
import { PROJECT_CREATE_ACTION, type ZeropsProjectCreation } from "../../zerops/projectCreation.ts";
import type { ProcessValue } from "../families/process.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { creationImports } from "./creationImports.ts";
import { sameValue } from "./equal.ts";

export const projectCreations: Projection<
  { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
  Readonly<Record<string, ZeropsProjectCreation>>
> = {
  name: "projectCreations",
  keyOf: ({ orgId, projectIds }) => `${orgId}/${projectIds.join(",")}`,
  derive: (read, { orgId, projectIds }) => {
    const imports = creationImports.derive(read, orgId);
    return Object.fromEntries(
      projectIds.flatMap((projectId) => {
        const id = imports[projectId];
        const fact = id == null ? undefined : read.fact("process", id);
        const creation =
          fact?.kind === "known" && fact.value.projectId === projectId
            ? outcomeOf(fact.value)
            : undefined;
        return creation === undefined ? [] : [[projectId, creation] as const];
      }),
    );
  },
  equals: sameValue,
};

const outcomeOf = (process: ProcessValue): ZeropsProjectCreation => ({
  processId: process.id,
  status: process.status,
  error: process.error ?? null,
});

/** Initial project creation precedes the container import; its operation waits on that owner. */
export function latestProjectCreation(
  read: ProjectionReads,
  projectId: string,
): ZeropsProjectCreation | undefined {
  let newest: ProcessValue | undefined;
  for (const id of read.index("project", projectId)) {
    const fact = read.fact("process", id);
    if (fact.kind !== "known" || fact.value.actionName !== PROJECT_CREATE_ACTION) continue;
    if (newest === undefined || fact.value.created > newest.created) newest = fact.value;
  }
  return newest === undefined ? undefined : outcomeOf(newest);
}
