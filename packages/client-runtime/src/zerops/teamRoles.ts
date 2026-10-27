/**
 * A person's place on an organization's team, in the four roles Mate offers: **owner**, **admin**,
 * **developer** — no organization-wide access, their own projects and the ones they're given, and
 * may start new ones — and **guest** — only the projects they're given. Zerops holds the role as a
 * membership's `roleCode` with `canCreateProjects`; `BASIC_USER` and `READ_ONLY` are Zerops roles
 * no preset names, shown as they are and changed only into a preset.
 *
 * Who may change whom is Zerops's rule (measured 2026-10-14): only an owner or an admin calls
 * `PUT /client-user/{id}`; an owner sets any role; an admin sets `BASIC_USER` and below, and never
 * changes an owner's or another admin's membership. Only an owner sets the two finance flags.
 *
 * A membership is a role and three flags (`OrgMembership`); a preset is one combination of them,
 * and *Advanced* sets any other. The locks (`membershipLocks`) are Zerops's rules for which
 * combinations it holds: an owner always creates projects and sees and edits finances, an admin
 * always creates projects, editing finances implies seeing them.
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

/** The roles Zerops holds, as *Advanced* offers them: highest first. */
export const ORG_ROLE_CODES = ["OWNER", "ADMIN", "BASIC_USER", "READ_ONLY", "NO_ACCESS"] as const;
export type OrgRoleCode = (typeof ORG_ROLE_CODES)[number];

/** A membership whole: its role and its three flags, as `PUT /client-user/{id}` takes it. */
export interface OrgMembership {
  readonly roleCode: OrgRoleCode;
  readonly canCreateProjects: boolean;
  readonly canViewFinances: boolean;
  readonly canEditFinances: boolean;
}

export type MembershipFlag = "canCreateProjects" | "canViewFinances" | "canEditFinances";
export const MEMBERSHIP_FLAGS: ReadonlyArray<MembershipFlag> = [
  "canCreateProjects",
  "canViewFinances",
  "canEditFinances",
];

/** The presets, in the order they are drawn. */
export const TEAM_PRESETS: ReadonlyArray<TeamRole> = ["owner", "admin", "developer", "guest"];

/** A preset's whole membership: an owner sees and edits finances, nobody else by a preset. */
export const presetMembership = (role: TeamRole): OrgMembership => ({
  roleCode: MEMBERSHIP[role].roleCode as OrgRoleCode,
  canCreateProjects: MEMBERSHIP[role].canCreateProjects,
  canViewFinances: role === "owner",
  canEditFinances: role === "owner",
});

/** A membership as the member list names it, a flag it leaves out being off. */
export const membershipOf = (member: {
  readonly roleCode?: string | undefined;
  readonly canCreateProjects?: boolean | undefined;
  readonly canViewFinances?: boolean | undefined;
  readonly canEditFinances?: boolean | undefined;
}): OrgMembership => ({
  roleCode: asOrgRole(member.roleCode),
  canCreateProjects: member.canCreateProjects === true,
  canViewFinances: member.canViewFinances === true,
  canEditFinances: member.canEditFinances === true,
});

/** The preset a membership is exactly, its flags too; `null` for any other combination. */
export const presetOf = (membership: OrgMembership): TeamRole | null =>
  TEAM_PRESETS.find((role) => sameMembership(presetMembership(role), membership)) ?? null;

export const sameMembership = (a: OrgMembership, b: OrgMembership): boolean =>
  a.roleCode === b.roleCode && MEMBERSHIP_FLAGS.every((flag) => a[flag] === b[flag]);

/** Why a role or a flag can't be set; `forced`, the value Zerops holds for it whatever is sent. */
export interface MembershipLock {
  readonly disabled: boolean;
  readonly forced?: boolean;
  readonly reason?: string;
}

const OPEN: MembershipLock = { disabled: false };

/**
 * What an editor may set of a membership: each role, and each flag given the role chosen. Zerops's
 * rules: only an owner sets finances; an owner's flags are all on; an admin always creates
 * projects; editing finances implies seeing them; an admin gives `BASIC_USER` and below.
 */
export function membershipLocks(
  editorRole: string | undefined,
  target: Pick<OrgMembership, "roleCode" | "canEditFinances">,
): {
  readonly roles: Readonly<Record<OrgRoleCode, MembershipLock>>;
  readonly flags: Readonly<Record<MembershipFlag, MembershipLock>>;
} {
  const editorOwner = roleAtLeast(editorRole, "OWNER");
  const editorAdmin = roleAtLeast(editorRole, "ADMIN");
  const ownerForced = { disabled: true, forced: true, reason: "Always on for an owner" };
  const ownersOnly = { disabled: true, reason: "Only an owner can change this" };
  const roles = Object.fromEntries(
    ORG_ROLE_CODES.map((role): [OrgRoleCode, MembershipLock] => [
      role,
      editorOwner
        ? OPEN
        : !editorAdmin
          ? { disabled: true, reason: "Only an owner or admin can give roles" }
          : roleAtLeast(role, "ADMIN")
            ? { disabled: true, reason: "Only an owner can give this role" }
            : OPEN,
    ]),
  ) as Record<OrgRoleCode, MembershipLock>;
  const owner = target.roleCode === "OWNER";
  return {
    roles,
    flags: {
      canCreateProjects: owner
        ? ownerForced
        : target.roleCode === "ADMIN"
          ? { disabled: true, forced: true, reason: "Always on for an admin" }
          : OPEN,
      canEditFinances: owner ? ownerForced : editorOwner ? OPEN : ownersOnly,
      canViewFinances: owner
        ? ownerForced
        : !editorOwner
          ? ownersOnly
          : target.canEditFinances
            ? { disabled: true, forced: true, reason: "Editing finances includes seeing them" }
            : OPEN,
    },
  };
}

/** A membership with every flag Zerops holds for its role set as it holds it. */
export function settledMembership(
  editorRole: string | undefined,
  next: OrgMembership,
): OrgMembership {
  const { flags } = membershipLocks(editorRole, next);
  const held = (flag: MembershipFlag) => flags[flag].forced ?? next[flag];
  return {
    roleCode: next.roleCode,
    canCreateProjects: held("canCreateProjects"),
    canViewFinances: held("canViewFinances"),
    canEditFinances: held("canEditFinances"),
  };
}

/**
 * Another role chosen in *Advanced*: its flags start again from what the role holds by itself, so
 * an owner made an admin doesn't keep finances. A flag the editor can't change keeps its value.
 */
export function withRole(
  editorRole: string | undefined,
  current: OrgMembership,
  roleCode: OrgRoleCode,
): OrgMembership {
  const { flags } = membershipLocks(editorRole, { roleCode, canEditFinances: false });
  const flag = (key: MembershipFlag) =>
    flags[key].forced ?? (flags[key].disabled ? current[key] : false);
  return settledMembership(editorRole, {
    roleCode,
    canCreateProjects: flag("canCreateProjects"),
    canViewFinances: flag("canViewFinances"),
    canEditFinances: flag("canEditFinances"),
  });
}

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
  if (
    teamChangeRefusal({ viewerRole: viewer.roleCode, memberRole: member.roleCode, roleCode: null })
  )
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
  /** The role to give; `null` to take them out. */
  readonly roleCode: string | null;
  /** Whether the change sets their finance flags otherwise than they are. */
  readonly finances?: boolean;
}): string | null {
  if (!roleAtLeast(input.viewerRole, "ADMIN"))
    return "Only an organization owner or admin can change the team.";
  if (roleAtLeast(input.viewerRole, "OWNER")) return null;
  if (roleAtLeast(input.memberRole, "ADMIN"))
    return input.roleCode === null
      ? "Admins can't remove an owner or another admin."
      : "Admins can't change an owner's or another admin's role.";
  if (input.roleCode !== null && roleAtLeast(input.roleCode, "ADMIN"))
    return "Only an organization owner can make someone an owner or admin.";
  if (input.finances === true) return "Only an organization owner can change who sees finances.";
  return null;
}
