/**
 * What the verb rule (`@t3tools/shared/zeropsPermissions`) reads of Zerops for the signed-in
 * person, live: their membership in the organization (`organizationUser`) and each project Zerops
 * lists them, with their own override there (`project`, its `userRoles` pushed). `undefined` until
 * both are read: nothing is offered or refused on a guess.
 *
 * @module data/projections/permissionFacts
 */
import type { ApplicationFacts } from "@t3tools/shared/zeropsOffers";
import { operateMatePermission, type PermissionFacts } from "@t3tools/shared/zeropsPermissions";

import { viewerProjectGrant } from "../../zerops/mateAccess.ts";
import type { HqAppValue } from "../families/hqNavigation.ts";
import { projectsScope } from "../families/project.ts";
import type { Projection, ProjectionReads } from "../store.ts";
import { platformMembership } from "./platformCapabilities.ts";

export interface LivePermissionFacts extends PermissionFacts {
  /** Whether each of these projects is read: an offer over one not read yet stays unknown. */
  readonly read: (projectIds: ReadonlyArray<string>) => boolean;
}

export function livePermissionFacts(
  read: ProjectionReads,
  orgId: string,
): LivePermissionFacts | undefined {
  const viewer = platformMembership.derive(read, orgId).viewer;
  // Who they are in Zerops, from the same read their membership comes from (`organizationUser`).
  const user = read.fact("organizationUser", orgId);
  const roster = read.members(projectsScope(orgId));
  if (viewer === undefined || user.kind !== "known" || roster.coverage !== "complete")
    return undefined;
  const listed = new Set(roster.ids);
  const fact = (projectId: string) =>
    listed.has(projectId) ? read.fact("project", projectId) : undefined;
  return {
    member: {
      userId: user.value.id,
      roleCode: viewer.roleCode,
      canCreateProjects: viewer.canCreateProjects,
    },
    project: (projectId) => {
      const project = fact(projectId);
      return project?.kind === "known"
        ? { override: viewerProjectGrant({ project: project.value, viewer }) }
        : undefined;
    },
    read: (projectIds) => projectIds.every((projectId) => fact(projectId)?.kind !== "unknown"),
  };
}

/**
 * Whether the person works in a project — operates its Mate, changes it with their own token: Basic
 * user or above there (`operateMatePermission`). `undefined` until Zerops is read.
 */
export const projectOperator = {
  name: "projectOperator",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) =>
    decided(livePermissionFacts(read, orgId), [projectId], (facts) =>
      operateMatePermission(facts, projectId),
    )?.allow,
  equals: (a, b) => a === b,
} satisfies Projection<{ readonly orgId: string; readonly projectId: string }, boolean | undefined>;

/** An offer record over these projects, once each is read; `undefined` while any is not. */
export function decided<T>(
  facts: LivePermissionFacts | undefined,
  projectIds: ReadonlyArray<string>,
  offers: (facts: LivePermissionFacts) => T,
): T | undefined {
  return facts !== undefined && facts.read(projectIds) ? offers(facts) : undefined;
}

/**
 * An application as the offers read it (`ApplicationFacts`): the projects HQ holds in it, each by
 * its kind there, where it releases to — its production's project, a Git production, or none — and
 * who merges its changes where it limits that.
 */
export function applicationFacts(
  app: Pick<HqAppValue, "environments" | "mergers">,
  placements: ReadonlyArray<{ readonly projectId: string; readonly kind: string }>,
): ApplicationFacts {
  const production = app.environments?.find((environment) => environment.tier === "production");
  return {
    projectIds: placements.map((row) => row.projectId),
    placements,
    ...(app.mergers == null ? {} : { mergers: app.mergers }),
    production:
      production === undefined
        ? null
        : production.target.kind === "zerops"
          ? { kind: "zerops", projectId: production.target.projectId }
          : { kind: "git" },
  };
}

/** The projects an application's offers read: its own, and its production's. */
export const applicationProjects = (app: ApplicationFacts): ReadonlyArray<string> =>
  app.production?.kind === "zerops"
    ? [...app.projectIds, app.production.projectId]
    : app.projectIds;
