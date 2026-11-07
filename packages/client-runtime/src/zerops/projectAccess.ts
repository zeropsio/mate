/**
 * Who reaches a Zerops project, as Zerops keeps it: the organization role, unless the project names
 * its own grant for the member (`userRoles`), which wins in both directions. Mate offers the two
 * levels a person can be given on a project — full access (`ADMIN`) or read only (`READ_ONLY`) —,
 * hiding it from someone who works on or sees every project (`NO_ACCESS`; never an owner or an
 * admin, whom Zerops refuses it: `noAccessRoleInvalid`, measured 2026-10-14), and removing
 * someone's grant, which hands them back to their organization role.
 *
 * Two shapes of the same record. A creation sends the project's list (`POST /client/{id}/project`
 * with `userRoles`, or `PUT /project/{id}` right after an import, `writeNewProjectAccess`). A change
 * to a project that exists is written on each person's own list (`PUT /client-user/{id}/roles`),
 * never on the project: `PUT /project/{id}` with `userRoles` replaces the whole list, cannot name an
 * integration token and drops a Mate key's own grant (measured 2026-10-03,
 * `f7-handover-probe.json`).
 *
 * Pure: the lists arrive read.
 *
 * @module zerops/projectAccess
 */
import { asOrgRole, roleAtLeast } from "@t3tools/shared/zeropsRoles";

import type { ProjectGrantEntry } from "./appAccess.ts";

/** The levels Mate gives on a project: full access, read only, or hidden. */
export type ProjectAccessRole = "ADMIN" | "READ_ONLY" | "NO_ACCESS";

/** One entry of a project's `userRoles`, as `GET /project/{id}` names it. */
export interface ProjectGrant {
  /** The membership (`clientUser`) id. */
  readonly clientUserId: string;
  readonly roleCode: string;
}

/**
 * One person's grant on one project to set: a level, the Mate's owner marker (`OWNER`), or `null`
 * to drop their own grant there.
 */
export interface ProjectAccessChange {
  readonly clientUserId: string;
  readonly projectId: string;
  readonly roleCode: ProjectAccessRole | "OWNER" | null;
}

/**
 * Whether the viewer may change a member's access to projects, as Zerops takes the write: an owner
 * anyone's, an admin their own and anyone's below an admin, nobody else anything (the membership
 * rule in `teamRoles`, measured 2026-10-14). Zerops refuses the rest; this decides what is offered.
 */
export function mayChangeAccess(input: {
  readonly viewerRole: string | undefined;
  readonly memberRole: string | undefined;
  /** The member is the viewer. */
  readonly self: boolean;
}): boolean {
  if (!roleAtLeast(input.viewerRole, "ADMIN")) return false;
  return (
    roleAtLeast(input.viewerRole, "OWNER") || input.self || !roleAtLeast(input.memberRole, "ADMIN")
  );
}

/**
 * Whether `role` already gives what `target` would: a grant naming it changes nothing. No
 * organization role gives the owner marker: an organization owner holds it only as a grant.
 */
const roleGives = (role: string | undefined, target: ProjectAccessRole | "OWNER") => {
  if (target === "OWNER") return false;
  const held = asOrgRole(role);
  return held === target || (target === "ADMIN" && held === "OWNER");
};

/**
 * A member's whole list with their grant on some projects changed, every other project's kept in
 * its place. A level their organization role already gives is dropped rather than written; a
 * project they own (`OWNER`) is theirs and never changed here.
 */
export function planMemberProjectGrants(input: {
  readonly current: ReadonlyArray<ProjectGrantEntry>;
  readonly orgRole: string | undefined;
  readonly changes: ReadonlyArray<{
    readonly projectId: string;
    readonly roleCode: ProjectAccessRole | "OWNER" | null;
  }>;
}): { readonly list: ReadonlyArray<ProjectGrantEntry>; readonly changed: boolean } {
  const held = new Map(input.current.map(({ projectId, roleCode }) => [projectId, roleCode]));
  const next = new Map<string, string | null>();
  for (const { projectId, roleCode } of input.changes) {
    const was = held.get(projectId);
    if (was === "OWNER") continue;
    const grant = roleCode === null || roleGives(input.orgRole, roleCode) ? null : roleCode;
    if (grant === (was ?? null)) continue;
    next.set(projectId, grant);
  }
  const list = [
    ...input.current.flatMap((entry): Array<ProjectGrantEntry> => {
      if (!next.has(entry.projectId))
        return [{ projectId: entry.projectId, roleCode: entry.roleCode }];
      const roleCode = next.get(entry.projectId);
      return roleCode == null ? [] : [{ projectId: entry.projectId, roleCode }];
    }),
    ...[...next].flatMap(([projectId, roleCode]) =>
      held.has(projectId) || roleCode === null ? [] : [{ projectId, roleCode }],
    ),
  ];
  return { list, changed: next.size > 0 };
}

/**
 * Who a Mate added to a project that exists is marked the owner of it by (`OWNER`, the marker a
 * hand-over moves): its adder, where the project's row names no `OWNER` and the adder's
 * organization role is admin or owner, the roles Zerops lets give themselves that grant
 * (ZEROPS-075). Nobody otherwise: a project with its owner keeps them, and below admin Zerops
 * refuses the write (ZEROPS-063), so the Mate stays no one's until it is handed over.
 */
export function ownerAtAdd(input: {
  /** The project's `userRoles`, as its row carries them. */
  readonly userRoles: ReadonlyArray<ProjectGrant> | undefined;
  /** The person adding it: their membership id and organization role. */
  readonly adder: { readonly membershipId: string; readonly roleCode?: string | undefined };
}): string | null {
  if (!roleAtLeast(input.adder.roleCode, "ADMIN")) return null;
  if (input.userRoles?.some((entry) => asOrgRole(entry.roleCode) === "OWNER")) return null;
  return input.adder.membershipId;
}

/** A project's list with one person's grant set — or, `null`, dropped — everyone else kept. */
export function withProjectGrant(
  list: ReadonlyArray<ProjectGrant>,
  clientUserId: string,
  roleCode: string | null,
): ReadonlyArray<ProjectGrant> {
  const held = list.some((entry) => entry.clientUserId === clientUserId);
  if (roleCode === null) return list.filter((entry) => entry.clientUserId !== clientUserId);
  return held
    ? list.map((entry) =>
        entry.clientUserId === clientUserId ? { clientUserId, roleCode } : entry,
      )
    : [...list, { clientUserId, roleCode }];
}

/** A project's list as `POST /client/{id}/project` takes it: each person by membership id. */
export const creationUserRoles = (
  list: ReadonlyArray<ProjectGrant>,
): ReadonlyArray<{ readonly id: string; readonly roleCode: string }> =>
  list.map(({ clientUserId, roleCode }) => ({ id: clientUserId, roleCode }));
