/**
 * Where the organization's HQ places each project (ADR 0002): its application, its kind — a Mate,
 * a stage, the production — and a Mate's name and face. HQ is the structure's only writer; the
 * client reads it from HQ's stream and joins it onto the projects it reads from Zerops
 * (`ZeropsProject.hq`), where they enter the screen. A Mate HQ holds in no application is placed
 * by its record alone; a project HQ does not place at all is in no application, and no Mate's
 * name or face is known for it.
 *
 * Pure: no network (rule R1).
 *
 * @module hq/placement
 */
import type { OverviewLogins } from "@t3tools/shared/mateLink";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import type { Known } from "../knowledge/known.ts";
import type { HqMate, HqStructure } from "./client.ts";

export type HqPlacement =
  | {
      readonly appId: string;
      readonly appName: string;
      readonly kind: RoleProjectKind;
      /** A Mate's name and face as HQ records them (`readMateFace`). */
      readonly mate: HqMate | null;
    }
  /** A Mate HQ holds in no application (`HqStructure.ungrouped`). */
  | { readonly appId: null; readonly appName: null; readonly kind: "mate"; readonly mate: HqMate };

/** Every kind this build reads: a kind HQ adds later places nothing here until it does. */
const PROJECT_KINDS: Readonly<Record<RoleProjectKind, true>> = {
  mate: true,
  devstage: true,
  stage: true,
  production: true,
};

/** Whether HQ's `kind` is one this build reads. */
export const isRoleProjectKind = (kind: string): kind is RoleProjectKind =>
  Object.hasOwn(PROJECT_KINDS, kind);

/**
 * Each project HQ places, by its id; a kind this build does not know places nothing. Each Mate's
 * record carries its logins as HQ's overview of it says them (`logins`, by project), where HQ
 * holds one for the reader.
 */
export function placementsOf(
  structure: HqStructure,
  logins: ReadonlyMap<string, OverviewLogins> = new Map(),
): ReadonlyMap<string, HqPlacement> {
  const withLogins = (projectId: string, mate: HqMate): HqMate => {
    const told = logins.get(projectId);
    return told === undefined ? mate : { ...mate, logins: told };
  };
  const placements = new Map<string, HqPlacement>();
  for (const app of structure.apps) {
    for (const project of app.projects) {
      const { kind } = project;
      if (!isRoleProjectKind(kind)) continue;
      placements.set(project.projectId, {
        appId: app.id,
        appName: app.name,
        kind,
        mate: project.mate === null ? null : withLogins(project.projectId, project.mate),
      });
    }
  }
  for (const { projectId, mate } of structure.ungrouped) {
    placements.set(projectId, {
      appId: null,
      appName: null,
      kind: "mate",
      mate: withLogins(projectId, mate),
    });
  }
  return placements;
}

/**
 * The project with where HQ places it now: a project it does not place carries no placement — one
 * it placed before and no longer does loses its. The same object where nothing changes.
 */
export function placeProject<P extends { readonly id: string; readonly hq?: HqPlacement }>(
  project: P,
  placements: ReadonlyMap<string, HqPlacement>,
): P {
  const placement = placements.get(project.id);
  if (placement !== undefined)
    return project.hq === placement ? project : { ...project, hq: placement };
  if (project.hq === undefined) return project;
  const { hq: _dropped, ...rest } = project;
  return rest as P;
}

/** The projects, each with where HQ places it now (`placeProject`). */
export function placeProjects<P extends { readonly id: string; readonly hq?: HqPlacement }>(
  projects: ReadonlyArray<P>,
  placements: ReadonlyMap<string, HqPlacement>,
): ReadonlyArray<P> {
  return projects.map((project) => placeProject(project, placements));
}

/**
 * A listing's rows, each with its project where HQ places it now (`placeProject`): the same listing
 * where it holds no rows, and the same row where its project's place did not change.
 */
export function placeListing<
  R extends { readonly project: { readonly id: string; readonly hq?: HqPlacement } },
>(
  listing: Known<ReadonlyArray<R>>,
  placements: ReadonlyMap<string, HqPlacement>,
): Known<ReadonlyArray<R>> {
  if (listing.state !== "known") return listing;
  return {
    ...listing,
    value: listing.value.map((row) => {
      const project = placeProject(row.project, placements);
      return project === row.project ? row : { ...row, project };
    }),
  };
}

/**
 * Where a Mate born under intent `birthId` goes, and as whom (`HqBirth`): its application, its name
 * and its face, while HQ holds the intent open — none once its attach closed it, or where HQ's
 * structure is not known.
 */
export function birthIntentOf(
  structure: HqStructure | null,
  birthId: string,
): { readonly appId: string; readonly name: string; readonly face: string } | undefined {
  for (const app of structure?.apps ?? []) {
    const birth = app.births?.find((entry) => entry.id === birthId);
    if (birth !== undefined) return { appId: app.id, name: birth.name, face: birth.face };
  }
  return undefined;
}
