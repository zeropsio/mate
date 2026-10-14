import { describe, expect, it } from "vite-plus/test";

import {
  invitableTeamRoles,
  membershipOfTeamRole,
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
      input: { viewerRole: "BASIC_USER", memberRole: "NO_ACCESS", role: "guest" as const },
      words: "Only an organization owner or admin can change the team.",
    },
    {
      sentence: "An admin changing an owner is told admins can't",
      input: { viewerRole: "ADMIN", memberRole: "OWNER", role: "guest" as const },
      words: "Admins can't change an owner's or another admin's role.",
    },
    {
      sentence: "An admin taking another admin out is told admins can't",
      input: { viewerRole: "ADMIN", memberRole: "ADMIN", role: null },
      words: "Admins can't remove an owner or another admin.",
    },
    {
      sentence: "An admin making someone an admin is told only an owner may",
      input: { viewerRole: "ADMIN", memberRole: "NO_ACCESS", role: "admin" as const },
      words: "Only an organization owner can make someone an owner or admin.",
    },
    {
      sentence: "An owner making someone an owner is let through",
      input: { viewerRole: "OWNER", memberRole: "ADMIN", role: "owner" as const },
      words: null,
    },
    {
      sentence: "An admin making a guest a developer is let through",
      input: { viewerRole: "ADMIN", memberRole: "NO_ACCESS", role: "developer" as const },
      words: null,
    },
  ])("$sentence", ({ input, words }) => {
    expect(teamChangeRefusal(input)).toBe(words);
  });
});
