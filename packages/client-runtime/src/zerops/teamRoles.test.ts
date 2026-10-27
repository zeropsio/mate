import { describe, expect, it } from "vite-plus/test";

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
  type TeamRole,
} from "./teamRoles.ts";

describe("a team role, as the organization's membership holds it", () => {
  it.each([
    { role: "owner", membership: { roleCode: "OWNER", canCreateProjects: true } },
    { role: "admin", membership: { roleCode: "ADMIN", canCreateProjects: true } },
    { role: "developer", membership: { roleCode: "NO_ACCESS", canCreateProjects: true } },
    { role: "guest", membership: { roleCode: "NO_ACCESS", canCreateProjects: false } },
  ] satisfies ReadonlyArray<{
    role: TeamRole;
    membership: { roleCode: string; canCreateProjects: boolean };
  }>)("Choosing $role writes $membership.roleCode", ({ role, membership }) => {
    expect(membershipOfTeamRole(role)).toEqual(membership);
    expect(teamRoleOf(membership)).toBe(role);
  });

  it.each([
    { member: { roleCode: "BASIC_USER", canCreateProjects: true }, role: null },
    { member: { roleCode: "READ_ONLY" }, role: null },
    { member: { roleCode: "NO_ACCESS" }, role: "guest" },
    { member: { roleCode: "SOMETHING_NEW", canCreateProjects: true }, role: "developer" },
  ] as const)(
    "A role no preset names is none of them: $member.roleCode is $role",
    ({ member, role }) => {
      expect(teamRoleOf(member)).toBe(role);
    },
  );
});

describe("who may change whom on the team", () => {
  const viewer = (roleCode: string) => ({ roleCode, membershipId: "cu-me" });
  const member = (roleCode: string, pending = false) => ({ id: "cu-them", roleCode, pending });

  it.each([
    {
      sentence: "An owner may make anyone else any role, or take them out",
      viewer: "OWNER",
      member: "ADMIN",
      expected: { roles: ["admin", "developer", "guest", "owner"], end: "remove" },
    },
    {
      sentence: "An admin may make a developer or a guest, nothing higher",
      viewer: "ADMIN",
      member: "BASIC_USER",
      expected: { roles: ["developer", "guest"], end: "remove" },
    },
    {
      sentence: "An admin changes no owner",
      viewer: "ADMIN",
      member: "OWNER",
      expected: null,
    },
    {
      sentence: "An admin changes no other admin",
      viewer: "ADMIN",
      member: "ADMIN",
      expected: null,
    },
    {
      sentence: "Someone who works on every project changes nobody",
      viewer: "BASIC_USER",
      member: "NO_ACCESS",
      expected: null,
    },
  ])("$sentence", ({ viewer: role, member: theirs, expected }) => {
    expect(teamActions({ viewer: viewer(role), member: member(theirs) })).toEqual(expected);
  });

  it("An invitation not joined yet is withdrawn, not removed", () => {
    expect(teamActions({ viewer: viewer("OWNER"), member: member("NO_ACCESS", true) })?.end).toBe(
      "withdraw",
    );
  });

  it("Nobody changes their own role or takes themselves out here", () => {
    expect(
      teamActions({
        viewer: viewer("OWNER"),
        member: { id: "cu-me", roleCode: "OWNER", pending: false },
      }),
    ).toBeNull();
  });

  it("Nobody changes anyone while the viewer's own role is not known", () => {
    expect(teamActions({ viewer: undefined, member: member("NO_ACCESS") })).toBeNull();
  });

  it.each([
    { viewer: "OWNER", roles: ["admin", "developer", "guest", "owner"] },
    { viewer: "ADMIN", roles: ["developer", "guest"] },
    { viewer: "BASIC_USER", roles: [] },
    { viewer: undefined, roles: [] },
  ])("An invitation offers $viewer the roles they may give", ({ viewer, roles }) => {
    expect(invitableTeamRoles(viewer)).toEqual(roles);
  });
});

describe("a team change Zerops would refuse, said before it is sent", () => {
  it.each([
    {
      sentence: "Someone who isn't an owner or admin is told who may",
      input: { viewerRole: "BASIC_USER", memberRole: "NO_ACCESS", roleCode: "NO_ACCESS" },
      words: "Only an organization owner or admin can change the team.",
    },
    {
      sentence: "An admin changing an owner is told admins can't",
      input: { viewerRole: "ADMIN", memberRole: "OWNER", roleCode: "NO_ACCESS" },
      words: "Admins can't change an owner's or another admin's role.",
    },
    {
      sentence: "An admin taking another admin out is told admins can't",
      input: { viewerRole: "ADMIN", memberRole: "ADMIN", roleCode: null },
      words: "Admins can't remove an owner or another admin.",
    },
    {
      sentence: "An admin making someone an admin is told only an owner may",
      input: { viewerRole: "ADMIN", memberRole: "NO_ACCESS", roleCode: "ADMIN" },
      words: "Only an organization owner can make someone an owner or admin.",
    },
    {
      sentence: "An owner making someone an owner is let through",
      input: { viewerRole: "OWNER", memberRole: "ADMIN", roleCode: "OWNER" },
      words: null,
    },
    {
      sentence: "An admin making a guest a developer is let through",
      input: { viewerRole: "ADMIN", memberRole: "NO_ACCESS", roleCode: "NO_ACCESS" },
      words: null,
    },
    {
      sentence: "An admin changing a developer's finances is told only an owner may",
      input: {
        viewerRole: "ADMIN",
        memberRole: "NO_ACCESS",
        roleCode: "NO_ACCESS",
        finances: true,
      },
      words: "Only an organization owner can change who sees finances.",
    },
  ])("$sentence", ({ input, words }) => {
    expect(teamChangeRefusal(input)).toBe(words);
  });
});

describe("a membership in full: a preset or Advanced", () => {
  const membership = (
    roleCode: "OWNER" | "ADMIN" | "BASIC_USER" | "READ_ONLY" | "NO_ACCESS",
    create = false,
    view = false,
    edit = false,
  ) => ({ roleCode, canCreateProjects: create, canViewFinances: view, canEditFinances: edit });

  it.each([
    {
      sentence: "An owner preset holds every flag",
      value: membership("OWNER", true, true, true),
      preset: "owner",
    },
    {
      sentence: "An admin preset creates projects and sees no finances",
      value: membership("ADMIN", true),
      preset: "admin",
    },
    {
      sentence: "A developer is no organization role who may create projects",
      value: membership("NO_ACCESS", true),
      preset: "developer",
    },
    {
      sentence: "A guest is no organization role who may create nothing",
      value: membership("NO_ACCESS"),
      preset: "guest",
    },
    {
      sentence: "A developer who sees finances is no preset: Advanced holds it",
      value: membership("NO_ACCESS", true, true),
      preset: null,
    },
    {
      sentence: "Someone who works on every project is no preset",
      value: membership("BASIC_USER", true),
      preset: null,
    },
  ] as const)("$sentence", ({ value, preset }) => {
    expect(presetOf(value)).toBe(preset);
    if (preset !== null) expect(presetMembership(preset)).toEqual(value);
  });

  it.each([
    {
      sentence: "An owner editor may give every role and set every flag of a developer",
      editor: "OWNER",
      target: membership("NO_ACCESS", true),
      roles: { OWNER: false, ADMIN: false, BASIC_USER: false, READ_ONLY: false, NO_ACCESS: false },
      flags: { canCreateProjects: false, canViewFinances: false, canEditFinances: false },
    },
    {
      sentence: "An admin editor gives no owner or admin, and never touches finances",
      editor: "ADMIN",
      target: membership("NO_ACCESS", true),
      roles: { OWNER: true, ADMIN: true, BASIC_USER: false, READ_ONLY: false, NO_ACCESS: false },
      flags: { canCreateProjects: false, canViewFinances: true, canEditFinances: true },
    },
    {
      sentence: "An owner's flags are all held on",
      editor: "OWNER",
      target: membership("OWNER", true, true, true),
      roles: { OWNER: false, ADMIN: false, BASIC_USER: false, READ_ONLY: false, NO_ACCESS: false },
      flags: { canCreateProjects: true, canViewFinances: true, canEditFinances: true },
    },
    {
      sentence: "An admin always creates projects",
      editor: "OWNER",
      target: membership("ADMIN", true),
      roles: { OWNER: false, ADMIN: false, BASIC_USER: false, READ_ONLY: false, NO_ACCESS: false },
      flags: { canCreateProjects: true, canViewFinances: false, canEditFinances: false },
    },
    {
      sentence: "Editing finances holds seeing them on",
      editor: "OWNER",
      target: membership("NO_ACCESS", false, true, true),
      roles: { OWNER: false, ADMIN: false, BASIC_USER: false, READ_ONLY: false, NO_ACCESS: false },
      flags: { canCreateProjects: false, canViewFinances: true, canEditFinances: false },
    },
    {
      sentence: "Someone who isn't an owner or admin may set nothing",
      editor: "BASIC_USER",
      target: membership("NO_ACCESS"),
      roles: { OWNER: true, ADMIN: true, BASIC_USER: true, READ_ONLY: true, NO_ACCESS: true },
      flags: { canCreateProjects: false, canViewFinances: true, canEditFinances: true },
    },
  ] as const)("$sentence", ({ editor, target, roles, flags }) => {
    const locks = membershipLocks(editor, target);
    expect(
      Object.fromEntries(Object.entries(locks.roles).map(([k, v]) => [k, v.disabled])),
    ).toEqual(roles);
    expect(
      Object.fromEntries(Object.entries(locks.flags).map(([k, v]) => [k, v.disabled])),
    ).toEqual(flags);
  });

  it("Another role starts its flags again: an owner made an admin keeps no finances", () => {
    expect(withRole("OWNER", membership("OWNER", true, true, true), "ADMIN")).toEqual(
      membership("ADMIN", true),
    );
  });

  it("An admin editor's role change keeps the finances only an owner may change", () => {
    expect(withRole("ADMIN", membership("NO_ACCESS", false, true), "READ_ONLY")).toEqual(
      membership("READ_ONLY", false, true),
    );
  });

  it("Editing finances turned on turns seeing them on", () => {
    expect(settledMembership("OWNER", membership("NO_ACCESS", false, false, true))).toEqual(
      membership("NO_ACCESS", false, true, true),
    );
  });
});
