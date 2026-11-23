/**
 * Who reaches a Zerops project, as Zerops keeps it: the organization role, unless the project names
 * its own grant for the member (`userRoles`), which wins in both directions. Mate offers the two
 * levels a person can be given on a project — full access (`ADMIN`) or read only (`READ_ONLY`) —,
 * hiding it from someone who works on or sees every project (`NO_ACCESS`; never an owner or an
 * admin, whom Zerops refuses it: `noAccessRoleInvalid`, measured 2026-10-14), and removing
 * someone's grant, which hands them back to their organization role.
 *
 * A project's list is written by HQ's operations, never here: `PUT /project/{id}` with `userRoles`
 * replaces the whole list, cannot name an integration token and drops a Mate key's own grant
 * (measured 2026-10-03, `f7-handover-probe.json`). A creation hands HQ the list it asked for.
 *
 * Pure: the lists arrive read.
 *
 * @module zerops/projectAccess
 */
import { asOrgRole, roleAtLeast } from "@t3tools/shared/zeropsRoles";

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
 * Who a Mate's project is marked the owner of by (`OWNER`, the marker a hand-over moves): its
 * adder, where the project names no `OWNER` and the adder is an organization owner, the one role
 * Zerops lets write that grant. An admin's is refused ("Cannot manage role 'OWNER' - your role
 * 'ADMIN' has insufficient privileges.", a live Add's `POST /client/{id}/project`, 2026-11-10), and
 * below admin too (ZEROPS-063). Nobody otherwise: a project with its owner keeps them, and an
 * admin's Mate stays no one's until it is handed over; a developer's own project Zerops marks itself.
 */
export function ownerAtAdd(input: {
  /** The project's `userRoles`, as its row carries them. */
  readonly userRoles: ReadonlyArray<ProjectGrant> | undefined;
  /** The person adding it: their membership id and organization role. */
  readonly adder: { readonly membershipId: string; readonly roleCode?: string | undefined };
}): string | null {
  if (!mayWriteOwnerMarker(input.adder.roleCode)) return null;
  if (input.userRoles?.some((entry) => asOrgRole(entry.roleCode) === "OWNER")) return null;
  return input.adder.membershipId;
}

/** Whether a person of this organization role may write an `OWNER` grant (`ownerAtAdd`). */
const mayWriteOwnerMarker = (roleCode: string | undefined) => roleAtLeast(roleCode, "OWNER");

/**
 * A recorded project list as this presser may send it: an `OWNER` marker written for an earlier
 * press is dropped for anyone but an organization owner, whom alone Zerops lets write it.
 */
export function grantsWritableBy(
  list: ReadonlyArray<ProjectGrant>,
  roleCode: string | undefined,
): ReadonlyArray<ProjectGrant> {
  return mayWriteOwnerMarker(roleCode)
    ? list
    : list.filter((entry) => asOrgRole(entry.roleCode) !== "OWNER");
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
