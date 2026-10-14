import { describe, expect, it } from "vite-plus/test";

import type { ProjectGrantEntry } from "./appAccess.ts";
import {
  creationUserRoles,
  planMemberProjectGrants,
  withProjectGrant,
  type ProjectGrant,
} from "./projectAccess.ts";

const list = (entries: Record<string, string>): ReadonlyArray<ProjectGrantEntry> =>
  Object.entries(entries).map(([projectId, roleCode]) => ({ projectId, roleCode }));
const asRecord = (entries: ReadonlyArray<ProjectGrantEntry>) =>
  Object.fromEntries(entries.map(({ projectId, roleCode }) => [projectId, roleCode]));

describe("one person's access to some projects, merged into their whole list", () => {
  it.each([
    {
      sentence: "Giving full access to a project adds it to their list, every other grant kept",
      orgRole: "NO_ACCESS",
      current: { elsewhere: "BASIC_USER" },
      changes: [{ projectId: "stage", roleCode: "ADMIN" as const }],
      next: { elsewhere: "BASIC_USER", stage: "ADMIN" },
    },
    {
      sentence: "Making someone read only replaces their grant on that project in place",
      orgRole: "NO_ACCESS",
      current: { prod: "ADMIN", elsewhere: "BASIC_USER" },
      changes: [{ projectId: "prod", roleCode: "READ_ONLY" as const }],
      next: { prod: "READ_ONLY", elsewhere: "BASIC_USER" },
    },
    {
      sentence: "Removing access drops their grant there, so their organization role decides again",
      orgRole: "BASIC_USER",
      current: { prod: "READ_ONLY", elsewhere: "ADMIN" },
      changes: [{ projectId: "prod", roleCode: null }],
      next: { elsewhere: "ADMIN" },
    },
    {
      sentence: "A level the organization role already gives is no grant: the role covers it",
      orgRole: "READ_ONLY",
      current: { prod: "ADMIN" },
      changes: [{ projectId: "prod", roleCode: "READ_ONLY" as const }],
      next: {},
    },
    {
      sentence: "An owner's full access is their role's: none is written for them",
      orgRole: "OWNER",
      current: {},
      changes: [{ projectId: "prod", roleCode: "ADMIN" as const }],
      next: {},
    },
    {
      sentence: "A project someone owns stays theirs: no change touches it",
      orgRole: "BASIC_USER",
      current: { "their-mate": "OWNER" },
      changes: [{ projectId: "their-mate", roleCode: "READ_ONLY" as const }],
      next: { "their-mate": "OWNER" },
    },
    {
      sentence: "One write carries every project of an app at once",
      orgRole: "NO_ACCESS",
      current: { prod: "READ_ONLY" },
      changes: [
        { projectId: "prod", roleCode: "ADMIN" as const },
        { projectId: "stage", roleCode: "ADMIN" as const },
        { projectId: "m-1", roleCode: "ADMIN" as const },
      ],
      next: { prod: "ADMIN", stage: "ADMIN", "m-1": "ADMIN" },
    },
  ])("$sentence", ({ orgRole, current, changes, next }) => {
    const planned = planMemberProjectGrants({ current: list(current), orgRole, changes });
    expect(asRecord(planned.list)).toEqual(next);
    expect(planned.changed).toBe(JSON.stringify(current) !== JSON.stringify(next));
  });

  it("A change that changes nothing writes nothing", () => {
    expect(
      planMemberProjectGrants({
        current: list({ prod: "ADMIN" }),
        orgRole: "NO_ACCESS",
        changes: [{ projectId: "prod", roleCode: "ADMIN" }],
      }).changed,
    ).toBe(false);
  });
});

describe("a project's access list, as a creation sends it", () => {
  const roles: ReadonlyArray<ProjectGrant> = [
    { clientUserId: "cu-ada", roleCode: "ADMIN" },
    { clientUserId: "cu-bo", roleCode: "READ_ONLY" },
  ];

  it("Setting someone's level keeps everyone else, in their place", () => {
    expect(withProjectGrant(roles, "cu-ada", "READ_ONLY")).toEqual([
      { clientUserId: "cu-ada", roleCode: "READ_ONLY" },
      { clientUserId: "cu-bo", roleCode: "READ_ONLY" },
    ]);
    expect(withProjectGrant(roles, "cu-cy", "ADMIN")).toEqual([
      ...roles,
      { clientUserId: "cu-cy", roleCode: "ADMIN" },
    ]);
  });

  it("Removing someone drops only their entry", () => {
    expect(withProjectGrant(roles, "cu-ada", null)).toEqual([
      { clientUserId: "cu-bo", roleCode: "READ_ONLY" },
    ]);
  });

  it("A creation names each person by their membership id", () => {
    expect(creationUserRoles(roles)).toEqual([
      { id: "cu-ada", roleCode: "ADMIN" },
      { id: "cu-bo", roleCode: "READ_ONLY" },
    ]);
  });
});
