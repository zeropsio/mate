/**
 * Setup follows HQ's accepted import identity, even after its press disappears. An unrecorded
 * or unread handle says nothing yet.
 *
 * @module data/projections/creation
 */
import type { ZeropsProjectCreation } from "../../zerops/projectCreation.ts";
import type { ProcessValue } from "../../zerops/projectProcesses.ts";
import type { Projection } from "../store.ts";
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
