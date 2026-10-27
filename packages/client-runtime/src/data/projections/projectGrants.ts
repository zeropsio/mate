/**
 * Everybody's grants on each of some projects (`userRoles`), as the project's own row names them
 * (`families/project.ts`): read only while a screen holds that row's detail
 * (`{ family: "project", listing: "project" }`), since a listing row names at most the viewer's.
 * Retained grants stay visible while the row is read again; `status` says whether a read is under
 * way, answered or failed — never the absence of grants.
 *
 * @module data/projections/projectGrants
 */
import { detailScopeOf } from "../demand.ts";
import type { ProjectValue } from "../families/project.ts";
import type { StreamKey } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface ProjectGrantsRead {
  /** Everybody's grants as the own row last named them; `undefined` until one did. */
  readonly grants: ProjectValue["userRoles"];
  /**
   * `ready` once the held own row answered; `failed` while its read faults, or its owner refused
   * or withheld it.
   */
  readonly status: "loading" | "ready" | "failed";
}

export const projectsGrants: Projection<
  { readonly orgId: string; readonly projectIds: ReadonlyArray<string> },
  Readonly<Record<string, ProjectGrantsRead>>
> = {
  name: "projectsGrants",
  keyOf: ({ orgId, projectIds }) => `${orgId}/${projectIds.join(",")}`,
  derive: (read, { orgId, projectIds }) =>
    Object.fromEntries(
      projectIds.map((projectId): [string, ProjectGrantsRead] => {
        const fact = read.fact("project", projectId);
        const stream = read.stream(
          detailScopeOf(orgId, { family: "project", listing: "project", ownerId: projectId }),
        );
        const link = stream.parent === null ? null : read.stream(stream.parent as StreamKey);
        let grants: ProjectValue["userRoles"];
        switch (fact.kind) {
          case "known":
            grants = fact.value.userRoles;
            break;
          case "unknown":
          case "deleted":
          case "withheld":
            break;
        }
        const failing =
          (link?.fault ?? stream.fault) !== null ||
          stream.phase === "refused" ||
          link?.phase === "refused" ||
          fact.kind === "withheld" ||
          fact.kind === "deleted";
        return [
          projectId,
          {
            grants,
            status: failing
              ? "failed"
              : grants !== undefined && stream.phase === "live"
                ? "ready"
                : "loading",
          },
        ];
      }),
    ),
  equals: sameValue,
};
