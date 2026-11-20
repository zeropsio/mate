import { expect, it } from "vite-plus/test";

import {
  invitableTeamRoles,
  membershipLocks,
  membershipOfTeamRole,
  presetMembership,
  presetOf,
  settledMembership,
  withRole,
  teamActions,
  teamChangeRefusal,
  teamRoleOf,
} from "./teamRoles.ts";

const viewer = (roleCode: string) => ({ roleCode, membershipId: "cu-me" });
const member = (roleCode: string, pending = false) => ({ id: "cu-them", roleCode, pending });
const membership = (
  roleCode: "OWNER" | "ADMIN" | "BASIC_USER" | "READ_ONLY" | "NO_ACCESS",
  create = false,
  view = false,
  edit = false,
) => ({ roleCode, canCreateProjects: create, canViewFinances: view, canEditFinances: edit });

// witness: packages/client-runtime/src/zerops/teamRoles.ts | developer: { roleCode: "NO_ACCESS", canCreateProjects: true }, → developer: { roleCode: "NO_ACCESS", canCreateProjects: false },
it("ZV69: Each team role is one membership: an owner is the organization's owner, an admin its admin, a developer no organization role who may create projects and a guest no organization role who may create nothing, and each membership reads back as its role", () => {
  for (const { role, membership } of [
    { role: "owner", membership: { roleCode: "OWNER", canCreateProjects: true } },
    { role: "admin", membership: { roleCode: "ADMIN", canCreateProjects: true } },
    { role: "developer", membership: { roleCode: "NO_ACCESS", canCreateProjects: true } },
    { role: "guest", membership: { roleCode: "NO_ACCESS", canCreateProjects: false } },
  ] as const) {
    expect(membershipOfTeamRole(role)).toEqual(membership);
    expect(teamRoleOf(membership)).toBe(role);
  }
});

// witness: packages/client-runtime/src/zerops/teamRoles.ts | case "BASIC_USER": → case "UNNAMED":
it("ZV70: A Zerops role no team role names, working on or seeing every project, is none of them, and a role Mate does not know reads as no organization role", () => {
  expect(teamRoleOf({ roleCode: "BASIC_USER", canCreateProjects: true })).toBe(null);
  expect(teamRoleOf({ roleCode: "READ_ONLY" })).toBe(null);
  expect(teamRoleOf({ roleCode: "NO_ACCESS" })).toBe("guest");
  expect(teamRoleOf({ roleCode: "SOMETHING_NEW", canCreateProjects: true })).toBe("developer");
});

// witness: packages/client-runtime/src/zerops/teamRoles.ts | if (roleAtLeast(input.memberRole, "ADMIN")) → if (false)
it("ZV71: An owner may give anyone else any team role or take them out, an admin only a developer or a guest role and never on an owner or another admin, and nobody else changes anybody", () => {
  expect(teamActions({ viewer: viewer("OWNER"), member: member("ADMIN") })).toEqual({
    roles: ["admin", "developer", "guest", "owner"],
    end: "remove",
  });
  expect(teamActions({ viewer: viewer("ADMIN"), member: member("BASIC_USER") })).toEqual({
    roles: ["developer", "guest"],
    end: "remove",
  });
  expect(teamActions({ viewer: viewer("ADMIN"), member: member("OWNER") })).toBeNull();
  expect(teamActions({ viewer: viewer("ADMIN"), member: member("ADMIN") })).toBeNull();
  expect(teamActions({ viewer: viewer("BASIC_USER"), member: member("NO_ACCESS") })).toBeNull();
});

// witness: packages/client-runtime/src/zerops/teamRoles.ts | if (roleAtLeast(viewerRole, "OWNER")) return ALL; → if (roleAtLeast(viewerRole, "OWNER")) return [];
it("ZV72: An invitation offers the viewer exactly the team roles they may give: an owner all four, an admin a developer or a guest, anyone else none", () => {
  expect(invitableTeamRoles("OWNER")).toEqual(["admin", "developer", "guest", "owner"]);
  expect(invitableTeamRoles("ADMIN")).toEqual(["developer", "guest"]);
  expect(invitableTeamRoles("BASIC_USER")).toEqual([]);
  expect(invitableTeamRoles(undefined)).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/teamRoles.ts | if (viewer === undefined || member.id === viewer.membershipId) return null; → if (viewer === undefined) return null;
it("ZV73: An invitation not joined yet is withdrawn, not removed; nobody changes their own membership, and nobody changes anyone while the viewer is not known", () => {
  expect(teamActions({ viewer: viewer("OWNER"), member: member("NO_ACCESS", true) })?.end).toBe(
    "withdraw",
  );
  expect(
    teamActions({
      viewer: viewer("OWNER"),
      member: { id: "cu-me", roleCode: "OWNER", pending: false },
    }),
  ).toBeNull();
  expect(teamActions({ viewer: undefined, member: member("NO_ACCESS") })).toBeNull();
});

// witness: packages/client-runtime/src/zerops/teamRoles.ts | if (input.roleCode !== null && roleAtLeast(input.roleCode, "ADMIN")) → if (false)
it("ZV74: A team change Zerops would refuse is refused before it is sent: by anyone below an admin, by an admin on an owner or another admin, making someone an owner or admin, or changing finances; an owner's change and an admin's change below admin go through", () => {
  expect(
    teamChangeRefusal({ viewerRole: "BASIC_USER", memberRole: "NO_ACCESS", roleCode: "NO_ACCESS" }),
  ).not.toBeNull();
  expect(
    teamChangeRefusal({ viewerRole: "ADMIN", memberRole: "OWNER", roleCode: "NO_ACCESS" }),
  ).not.toBeNull();
  expect(
    teamChangeRefusal({ viewerRole: "ADMIN", memberRole: "ADMIN", roleCode: null }),
  ).not.toBeNull();
  expect(
    teamChangeRefusal({ viewerRole: "ADMIN", memberRole: "NO_ACCESS", roleCode: "ADMIN" }),
  ).not.toBeNull();
  expect(
    teamChangeRefusal({ viewerRole: "OWNER", memberRole: "ADMIN", roleCode: "OWNER" }),
  ).toBeNull();
  expect(
    teamChangeRefusal({ viewerRole: "ADMIN", memberRole: "NO_ACCESS", roleCode: "NO_ACCESS" }),
  ).toBeNull();
  expect(
    teamChangeRefusal({
      viewerRole: "ADMIN",
      memberRole: "NO_ACCESS",
      roleCode: "NO_ACCESS",
      finances: true,
    }),
  ).not.toBeNull();
});

// witness: packages/client-runtime/src/zerops/teamRoles.ts | canViewFinances: role === "owner", → canViewFinances: role !== "guest",
it("ZV75: A preset is one exact membership: an owner holds every flag, an admin creates projects and sees no finances, and any other combination, a developer who sees finances included, is no preset", () => {
  for (const { value, preset } of [
    { value: membership("OWNER", true, true, true), preset: "owner" },
    { value: membership("ADMIN", true), preset: "admin" },
    { value: membership("NO_ACCESS", true), preset: "developer" },
    { value: membership("NO_ACCESS"), preset: "guest" },
    { value: membership("NO_ACCESS", true, true), preset: null },
    { value: membership("BASIC_USER", true), preset: null },
  ] as const) {
    expect(presetOf(value)).toBe(preset);
    if (preset !== null) expect(presetMembership(preset)).toEqual(value);
  }
});

// witness: packages/client-runtime/src/zerops/teamRoles.ts | : roleAtLeast(role, "ADMIN") → : false
it("ZV76: An owner editing a membership may give every role and set every flag; an admin gives no owner or admin role and never touches finances; anyone else sets nothing", () => {
  for (const { editor, target, roles, flags } of [
    {
      editor: "OWNER",
      target: membership("NO_ACCESS", true),
      roles: { OWNER: false, ADMIN: false, BASIC_USER: false, READ_ONLY: false, NO_ACCESS: false },
      flags: { canCreateProjects: false, canViewFinances: false, canEditFinances: false },
    },
    {
      editor: "ADMIN",
      target: membership("NO_ACCESS", true),
      roles: { OWNER: true, ADMIN: true, BASIC_USER: false, READ_ONLY: false, NO_ACCESS: false },
      flags: { canCreateProjects: false, canViewFinances: true, canEditFinances: true },
    },
    {
      editor: "BASIC_USER",
      target: membership("NO_ACCESS"),
      roles: { OWNER: true, ADMIN: true, BASIC_USER: true, READ_ONLY: true, NO_ACCESS: true },
      flags: { canCreateProjects: false, canViewFinances: true, canEditFinances: true },
    },
  ] as const) {
    const locks = membershipLocks(editor, target);
    expect(
      Object.fromEntries(Object.entries(locks.roles).map(([key, lock]) => [key, lock.disabled])),
    ).toEqual(roles);
    expect(
      Object.fromEntries(Object.entries(locks.flags).map(([key, lock]) => [key, lock.disabled])),
    ).toEqual(flags);
  }
});

// witness: packages/client-runtime/src/zerops/teamRoles.ts | ? { disabled: true, forced: true, reason: "Always on for an admin" } → ? OPEN
it("ZV77: Zerops holds an owner's flags all on, an admin's project creation on, and seeing finances on wherever editing them is, whatever is sent", () => {
  for (const { editor, target, roles, flags } of [
    {
      editor: "OWNER",
      target: membership("OWNER", true, true, true),
      roles: { OWNER: false, ADMIN: false, BASIC_USER: false, READ_ONLY: false, NO_ACCESS: false },
      flags: { canCreateProjects: true, canViewFinances: true, canEditFinances: true },
    },
    {
      editor: "OWNER",
      target: membership("ADMIN", true),
      roles: { OWNER: false, ADMIN: false, BASIC_USER: false, READ_ONLY: false, NO_ACCESS: false },
      flags: { canCreateProjects: true, canViewFinances: false, canEditFinances: false },
    },
    {
      editor: "OWNER",
      target: membership("NO_ACCESS", false, true, true),
      roles: { OWNER: false, ADMIN: false, BASIC_USER: false, READ_ONLY: false, NO_ACCESS: false },
      flags: { canCreateProjects: false, canViewFinances: true, canEditFinances: false },
    },
  ] as const) {
    const locks = membershipLocks(editor, target);
    expect(
      Object.fromEntries(Object.entries(locks.roles).map(([key, lock]) => [key, lock.disabled])),
    ).toEqual(roles);
    expect(
      Object.fromEntries(Object.entries(locks.flags).map(([key, lock]) => [key, lock.disabled])),
    ).toEqual(flags);
  }
  const { flags } = membershipLocks("OWNER", membership("OWNER", true, true, true));
  expect(flags.canCreateProjects.forced).toBe(true);
  expect(flags.canViewFinances.forced).toBe(true);
  expect(flags.canEditFinances.forced).toBe(true);
  expect(settledMembership("OWNER", membership("NO_ACCESS", false, false, true))).toEqual(
    membership("NO_ACCESS", false, true, true),
  );
});

// witness: packages/client-runtime/src/zerops/teamRoles.ts | flags[key].forced ?? (flags[key].disabled ? current[key] : false); → flags[key].forced ?? current[key];
it("ZV78: Choosing another role starts its flags again from what that role holds by itself, keeping only the flags the editor may not change", () => {
  expect(withRole("OWNER", membership("OWNER", true, true, true), "ADMIN")).toEqual(
    membership("ADMIN", true),
  );
  expect(withRole("ADMIN", membership("NO_ACCESS", false, true), "READ_ONLY")).toEqual(
    membership("READ_ONLY", false, true),
  );
});
