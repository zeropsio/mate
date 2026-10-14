/**
 * A person's place on an organization's team, in the four roles Mate offers: **owner**, **admin**,
 * **developer** — no organization-wide access, their own projects and the ones they're given, and
 * may start new ones — and **guest** — only the projects they're given. Zerops holds the role as a
 * membership's `roleCode` with `canCreateProjects`; `BASIC_USER` and `READ_ONLY` are Zerops roles
 * no preset names, shown as they are and changed only into a preset.
 *
 * Who may change whom is Zerops's rule (measured 2026-10-14): only an owner or an admin calls
 * `PUT /client-user/{id}`; an owner sets any role; an admin sets `BASIC_USER` and below, and never
 * changes an owner's or another admin's membership. Finances stay Zerops HQ's: no preset sets them.
 *
 * Pure: the viewer's and the member's memberships arrive read.
 *
 * @module zerops/teamRoles
 */
import { asOrgRole, roleAtLeast } from "@t3tools/shared/zeropsRoles";

export type TeamRole = "owner" | "admin" | "developer" | "guest";

/** A membership's role and its one right Mate sets. */
export interface TeamMembership {
  readonly roleCode: string;
  readonly canCreateProjects: boolean;
}

const MEMBERSHIP: Readonly<Record<TeamRole, TeamMembership>> = {
  owner: { roleCode: "OWNER", canCreateProjects: true },
  admin: { roleCode: "ADMIN", canCreateProjects: true },
  developer: { roleCode: "NO_ACCESS", canCreateProjects: true },
  guest: { roleCode: "NO_ACCESS", canCreateProjects: false },
};

/** What a preset writes to the membership. */
export const membershipOfTeamRole = (role: TeamRole): TeamMembership => MEMBERSHIP[role];

/** The preset a membership holds; `null` for a Zerops role no preset names. */
export function teamRoleOf(member: {
  readonly roleCode?: string | undefined;
  readonly canCreateProjects?: boolean | undefined;
}): TeamRole | null {
  switch (asOrgRole(member.roleCode)) {
    case "OWNER":
      return "owner";
    case "ADMIN":
      return "admin";
    case "BASIC_USER":
    case "READ_ONLY":
      return null;
    case "NO_ACCESS":
      return member.canCreateProjects === true ? "developer" : "guest";
  }
}

/** The presets, in the order they are offered. */
const ALL: ReadonlyArray<TeamRole> = ["admin", "developer", "guest", "owner"];

/** The presets a viewer may give: an owner any, an admin those below an admin, others none. */
export function invitableTeamRoles(viewerRole: string | undefined): ReadonlyArray<TeamRole> {
  if (roleAtLeast(viewerRole, "OWNER")) return ALL;
  if (roleAtLeast(viewerRole, "ADMIN")) return ["developer", "guest"];
  return [];
}

/**
 * What the viewer may do to a member: give them one of `roles`, and take them out — or, an
 * invitation not joined yet, withdraw it. `null` where they may do neither: their own row, a
 * viewer who isn't an owner or admin, an admin looking at an owner or another admin.
 */
export function teamActions(input: {
  readonly viewer: { readonly roleCode?: string; readonly membershipId: string } | undefined;
  readonly member: { readonly id: string; readonly roleCode?: string; readonly pending: boolean };
}): { readonly roles: ReadonlyArray<TeamRole>; readonly end: "remove" | "withdraw" } | null {
  const { viewer, member } = input;
  if (viewer === undefined || member.id === viewer.membershipId) return null;
  if (teamChangeRefusal({ viewerRole: viewer.roleCode, memberRole: member.roleCode, role: null }))
    return null;
  return {
    roles: invitableTeamRoles(viewer.roleCode),
    end: member.pending ? "withdraw" : "remove",
  };
}

/** Why Zerops would refuse a change, in words; `null` where it would take it. */
export function teamChangeRefusal(input: {
  readonly viewerRole: string | undefined;
  readonly memberRole: string | undefined;
  /** The preset to give; `null` to take them out. */
  readonly role: TeamRole | null;
}): string | null {
  if (!roleAtLeast(input.viewerRole, "ADMIN"))
    return "Only an organization owner or admin can change the team.";
  if (roleAtLeast(input.viewerRole, "OWNER")) return null;
  if (roleAtLeast(input.memberRole, "ADMIN"))
    return input.role === null
      ? "Admins can't remove an owner or another admin."
      : "Admins can't change an owner's or another admin's role.";
  if (input.role === "owner" || input.role === "admin")
    return "Only an organization owner can make someone an owner or admin.";
  return null;
}
