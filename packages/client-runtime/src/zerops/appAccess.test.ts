import { describe, expect, it } from "vite-plus/test";

import {
  appAccessActions,
  appAccessLevel,
  planAppGrants,
  type AppAccessChange,
  type ProjectGrantEntry,
} from "./appAccess.ts";

/** An app with production and stage, a Mate serving as stage, and two more Mates. */
const PROJECTS = { places: ["prod", "stage", "devstage"], mates: ["m-own", "m-other"] };
const OWNED = ["m-own"];
const ELSEWHERE: ProjectGrantEntry = { projectId: "p-elsewhere", roleCode: "BASIC_USER" };

const plan = (
  change: AppAccessChange,
  orgRole: string,
  current: ReadonlyArray<ProjectGrantEntry> = [],
) => planAppGrants({ current, orgRole, projects: PROJECTS, owned: OWNED, change });

const grants = (entries: Record<string, string>): ReadonlyArray<ProjectGrantEntry> =>
  Object.entries(entries).map(([projectId, roleCode]) => ({ projectId, roleCode }));

describe("an app's grants for one member, merged into their whole list", () => {
  it.each([
    {
      sentence: "Can work on it: full access to every place, and the app's Mates to look at",
      change: "work" as const,
      orgRole: "NO_ACCESS",
      current: [ELSEWHERE],
      list: {
        "p-elsewhere": "BASIC_USER",
        prod: "BASIC_USER",
        stage: "BASIC_USER",
        devstage: "BASIC_USER",
        "m-other": "READ_ONLY",
      },
    },
    {
      sentence: "Can only look: read only on every place and Mate",
      change: "look" as const,
      orgRole: "NO_ACCESS",
      current: [ELSEWHERE, { projectId: "prod", roleCode: "BASIC_USER" }],
      list: {
        "p-elsewhere": "BASIC_USER",
        prod: "READ_ONLY",
        stage: "READ_ONLY",
        devstage: "READ_ONLY",
        "m-other": "READ_ONLY",
      },
    },
    {
      sentence: "A grant the organization role already gives is no grant: the role covers it",
      change: "work" as const,
      orgRole: "BASIC_USER",
      current: [{ projectId: "stage", roleCode: "NO_ACCESS" }],
      list: {},
    },
    {
      sentence: "Can only look lowers a member who works on every project, here alone",
      change: "look" as const,
      orgRole: "BASIC_USER",
      current: [ELSEWHERE],
      list: {
        "p-elsewhere": "BASIC_USER",
        prod: "READ_ONLY",
        stage: "READ_ONLY",
        devstage: "READ_ONLY",
        "m-other": "READ_ONLY",
      },
    },
    {
      sentence: "Can work on it never lowers what a member already has on someone's Mate",
      change: "work" as const,
      orgRole: "NO_ACCESS",
      current: [{ projectId: "m-other", roleCode: "BASIC_USER" }],
      list: {
        "m-other": "BASIC_USER",
        prod: "BASIC_USER",
        stage: "BASIC_USER",
        devstage: "BASIC_USER",
      },
    },
    {
      sentence: "Removing a member with no organization access drops their grants on the app alone",
      change: "remove" as const,
      orgRole: "NO_ACCESS",
      current: [
        ELSEWHERE,
        { projectId: "prod", roleCode: "BASIC_USER" },
        { projectId: "m-other", roleCode: "READ_ONLY" },
      ],
      list: { "p-elsewhere": "BASIC_USER" },
    },
    {
      sentence:
        "Removing a member whose role reaches every project shuts the app's projects to them",
      change: "remove" as const,
      orgRole: "READ_ONLY",
      current: [ELSEWHERE],
      list: {
        "p-elsewhere": "BASIC_USER",
        prod: "NO_ACCESS",
        stage: "NO_ACCESS",
        devstage: "NO_ACCESS",
        "m-other": "NO_ACCESS",
      },
    },
    {
      sentence: "A member's own Mate is never touched, whatever they are given here",
      change: "remove" as const,
      orgRole: "NO_ACCESS",
      current: [
        { projectId: "m-own", roleCode: "OWNER" },
        { projectId: "m-mine-too", roleCode: "OWNER" },
      ],
      list: { "m-own": "OWNER", "m-mine-too": "OWNER" },
    },
  ])("$sentence", ({ change, orgRole, current, list }) => {
    expect(
      Object.fromEntries(plan(change, orgRole, current).list.map((e) => [e.projectId, e.roleCode])),
    ).toEqual(list);
  });

  it("Projects outside the app keep their grants and their place in the list", () => {
    const next = plan("look", "NO_ACCESS", [
      ELSEWHERE,
      { projectId: "stage", roleCode: "BASIC_USER" },
      { projectId: "p-far", roleCode: "OWNER" },
    ]).list;
    expect(next.map(({ projectId }) => projectId)).toEqual([
      "p-elsewhere",
      "stage",
      "p-far",
      "prod",
      "devstage",
      "m-other",
    ]);
  });

  it("A choice the member already has changes nothing", () => {
    const current = grants({
      prod: "BASIC_USER",
      stage: "BASIC_USER",
      devstage: "BASIC_USER",
      "m-other": "READ_ONLY",
    });
    expect(plan("work", "NO_ACCESS", current).changed).toBe(false);
    expect(plan("look", "NO_ACCESS", current).changed).toBe(true);
  });

  it("Each of the app's projects a change reaches is said beside the list, with what it comes to hold", () => {
    expect(
      plan("remove", "NO_ACCESS", grants({ prod: "READ_ONLY", "m-other": "READ_ONLY" })).touched,
    ).toEqual([
      { projectId: "prod", roleCode: null },
      { projectId: "m-other", roleCode: null },
    ]);
  });

  it.each([
    {
      sentence: "Withdrawing an invitation that opened only this app ends the invitation",
      orgRole: "NO_ACCESS",
      current: grants({ prod: "BASIC_USER", "m-other": "READ_ONLY" }),
      dropMembership: true,
    },
    {
      sentence: "Withdrawing an invitation that opens another app too keeps the invitation",
      orgRole: "NO_ACCESS",
      current: [ELSEWHERE, { projectId: "prod", roleCode: "BASIC_USER" }],
      dropMembership: false,
    },
    {
      sentence: "Withdrawing an invitation whose role reaches every project keeps the invitation",
      orgRole: "READ_ONLY",
      current: [],
      dropMembership: false,
    },
    {
      sentence: "Removing a member never ends their membership",
      orgRole: "NO_ACCESS",
      current: grants({ prod: "BASIC_USER" }),
      dropMembership: false,
      change: "remove" as const,
    },
  ])("$sentence", ({ orgRole, current, dropMembership, change }) => {
    expect(plan(change ?? "withdraw", orgRole, current).dropMembership).toBe(dropMembership);
  });
});

describe("a member's access to an app, as one of the two levels", () => {
  const level = (orgRole: string, entries: Record<string, string>) =>
    appAccessLevel({
      orgRole,
      grantOf: (projectId) => entries[projectId],
      projects: PROJECTS,
      owned: OWNED,
    });

  it.each([
    {
      sentence: "Full access on every place is Can work on it",
      role: "NO_ACCESS",
      grants: { prod: "BASIC_USER", stage: "BASIC_USER", devstage: "OWNER" },
      level: "work",
    },
    {
      sentence: "Read only on every place is Can only look",
      role: "NO_ACCESS",
      grants: { prod: "READ_ONLY", stage: "READ_ONLY", devstage: "READ_ONLY" },
      level: "look",
    },
    {
      sentence: "An organization role reaching every place counts where no grant says otherwise",
      role: "READ_ONLY",
      grants: {},
      level: "look",
    },
    {
      sentence: "Places that differ are neither level",
      role: "NO_ACCESS",
      grants: { prod: "READ_ONLY", stage: "BASIC_USER", devstage: "BASIC_USER" },
      level: null,
    },
    {
      sentence: "No access to a place is neither level",
      role: "BASIC_USER",
      grants: { prod: "NO_ACCESS" },
      level: null,
    },
  ])("$sentence", ({ role, grants: entries, level: expected }) => {
    expect(level(role, entries)).toBe(expected);
  });
});

describe("who may change whose access to an app", () => {
  const viewer = (roleCode: string) => ({ roleCode, membershipId: "cu-me" });
  const member = (roleCode: string, pending = false, id = "cu-them") => ({ id, roleCode, pending });

  it.each([
    {
      sentence: "An owner changes a member's access and removes them",
      viewer: "OWNER",
      member: member("NO_ACCESS"),
      actions: { end: "remove" },
    },
    {
      sentence: "An admin changes a developer's access and removes them",
      viewer: "ADMIN",
      member: member("BASIC_USER"),
      actions: { end: "remove" },
    },
    {
      sentence: "An invitation not joined yet is withdrawn, not removed",
      viewer: "OWNER",
      member: member("NO_ACCESS", true),
      actions: { end: "withdraw" },
    },
    {
      sentence: "Nobody changes an admin's access here: their role gives them everything",
      viewer: "OWNER",
      member: member("ADMIN"),
      actions: null,
    },
    {
      sentence: "An admin never changes an owner's access",
      viewer: "ADMIN",
      member: member("OWNER"),
      actions: null,
    },
    {
      sentence: "Nobody changes their own access here",
      viewer: "OWNER",
      member: member("BASIC_USER", false, "cu-me"),
      actions: null,
    },
    {
      sentence: "A developer changes nobody's access",
      viewer: "BASIC_USER",
      member: member("NO_ACCESS"),
      actions: null,
    },
  ])("$sentence", ({ viewer: role, member: them, actions }) => {
    expect(appAccessActions({ viewer: viewer(role), member: them })).toEqual(actions);
  });

  it("Without knowing who is looking, nobody's access can be changed", () => {
    expect(appAccessActions({ viewer: undefined, member: member("NO_ACCESS") })).toBeNull();
  });
});
