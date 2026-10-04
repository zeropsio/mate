/**
 * Each project's own grants — every member's, its `userRoles` — joined onto the project rows the
 * client draws and asks HQ's rule over.
 *
 * The platform's records carry no `userRoles` (`data/dto.ts`); the access grant's rounds read them
 * with every project they verify (`ProjectEffectiveAccess.userRoles`). Without them HQ's rule reads
 * a member's org role where their grant on a project stands above it — a NO_ACCESS member OWNER on
 * one of an application's projects was offered none of its changes (F12, e2e 2026-10-03) — and a
 * Mate's `OWNER` is never found, so its owner reads as whoever signed its agent in (F11).
 *
 * Pure (rule R1).
 *
 * @module projectGrants
 */
import type { ProjectGrant } from "./data/types.ts";
import type { Known } from "./knowledge/known.ts";

/** Each project's grants, by its id. */
export type ProjectGrants = ReadonlyMap<string, ReadonlyArray<ProjectGrant>>;

/**
 * The grants each project's verifying read carried, by its id; none for access no read said, and
 * none before a round has verified anything.
 */
export function projectGrantsOf(
  evidence: {
    readonly projects: ReadonlyMap<
      string,
      { readonly access: { readonly userRoles?: ReadonlyArray<ProjectGrant> | undefined } }
    >;
  } | null,
): ProjectGrants {
  const grants = new Map<string, ReadonlyArray<ProjectGrant>>();
  for (const [projectId, { access }] of evidence?.projects ?? []) {
    if (access.userRoles !== undefined) grants.set(projectId, access.userRoles);
  }
  return grants;
}

/** A project row with the grants its read named; one no read named, as it is. */
export function withProjectGrants<P extends { readonly id: string }>(
  project: P,
  grants: ProjectGrants,
): P {
  const userRoles = grants.get(project.id);
  return userRoles === undefined ? project : { ...project, userRoles };
}

/** A listing's rows with their projects' grants; a listing not known, as it is. */
export function grantListing<R extends { readonly project: { readonly id: string } }>(
  listing: Known<ReadonlyArray<R>>,
  grants: ProjectGrants,
): Known<ReadonlyArray<R>> {
  if (listing.state !== "known") return listing;
  return {
    ...listing,
    value: listing.value.map((row) => {
      const project = withProjectGrants(row.project, grants);
      return project === row.project ? row : { ...row, project };
    }),
  };
}
