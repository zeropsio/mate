/**
 * The platform's word on how projects' creations went: each one's newest `project.create` process,
 * as the account holds its processes — its running work, and its history while a screen demands
 * it. A project with no creation process held says nothing yet; the process going terminal ends
 * the wait, never a clock.
 *
 * @module data/projections/creation
 */
import { PROJECT_CREATE_ACTION, type ZeropsProjectCreation } from "../../zerops/projectCreation.ts";
import type { ProcessValue } from "../families/process.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export const projectCreations: Projection<
  { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
  Readonly<Record<string, ZeropsProjectCreation>>
> = {
  name: "projectCreations",
  keyOf: ({ orgId, projectIds }) => `${orgId}/${projectIds.join(",")}`,
  derive: (read, { projectIds }) =>
    Object.fromEntries(
      projectIds.flatMap((projectId) => {
        let newest: ProcessValue | undefined;
        for (const id of read.index("project", projectId)) {
          const fact = read.fact("process", id);
          if (fact.kind !== "known" || fact.value.actionName !== PROJECT_CREATE_ACTION) continue;
          if (newest === undefined || fact.value.created > newest.created) newest = fact.value;
        }
        return newest === undefined
          ? []
          : [
              [
                projectId,
                { processId: newest.id, status: newest.status, error: newest.error ?? null },
              ] as const,
            ];
      }),
    ),
  equals: sameValue,
};
