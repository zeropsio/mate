import { expect, it } from "vite-plus/test";

import type { ProjectGrantEntry } from "./appAccess.ts";
import {
  grantsWritableBy,
  mayChangeAccess,
  ownerAtAdd,
  planMemberProjectGrants,
  withProjectGrant,
  type ProjectGrant,
} from "./projectAccess.ts";

const list = (entries: Record<string, string>): ReadonlyArray<ProjectGrantEntry> =>
  Object.entries(entries).map(([projectId, roleCode]) => ({ projectId, roleCode }));
const asRecord = (entries: ReadonlyArray<ProjectGrantEntry>) =>
  Object.fromEntries(entries.map(({ projectId, roleCode }) => [projectId, roleCode]));

// witness: packages/client-runtime/src/zerops/projectAccess.ts | held.has(projectId) || roleCode === null ? [] → true ? []
it("ZV61: Changing a person's access to some projects writes their whole list: a grant added last, replaced in place or dropped, and every other project's grant kept in its place", () => {
  expect(
    planMemberProjectGrants({
      orgRole: "NO_ACCESS",
      current: list({ elsewhere: "BASIC_USER" }),
      changes: [{ projectId: "stage", roleCode: "ADMIN" }],
    }).list,
  ).toEqual(list({ elsewhere: "BASIC_USER", stage: "ADMIN" }));
  expect(
    planMemberProjectGrants({
      orgRole: "NO_ACCESS",
      current: list({ prod: "ADMIN", elsewhere: "BASIC_USER" }),
      changes: [{ projectId: "prod", roleCode: "READ_ONLY" }],
    }).list,
  ).toEqual(list({ prod: "READ_ONLY", elsewhere: "BASIC_USER" }));
  expect(
    planMemberProjectGrants({
      orgRole: "BASIC_USER",
      current: list({ prod: "READ_ONLY", elsewhere: "ADMIN" }),
      changes: [{ projectId: "prod", roleCode: null }],
    }).list,
  ).toEqual(list({ elsewhere: "ADMIN" }));
  expect(
    planMemberProjectGrants({
      orgRole: "READ_ONLY",
      current: list({ elsewhere: "READ_ONLY" }),
      changes: [{ projectId: "prod", roleCode: "NO_ACCESS" }],
    }).list,
  ).toEqual(list({ elsewhere: "READ_ONLY", prod: "NO_ACCESS" }));
  expect(
    planMemberProjectGrants({
      orgRole: "NO_ACCESS",
      current: list({ prod: "READ_ONLY" }),
      changes: [
        { projectId: "prod", roleCode: "ADMIN" },
        { projectId: "stage", roleCode: "ADMIN" },
        { projectId: "m-1", roleCode: "ADMIN" },
      ],
    }).list,
  ).toEqual(list({ prod: "ADMIN", stage: "ADMIN", "m-1": "ADMIN" }));
});

// witness: packages/client-runtime/src/zerops/projectAccess.ts | return held === target || (target === "ADMIN" && held === "OWNER"); → return held === target;
it("ZV62: A project level the person's organization role already gives is not written, an owner's full access included, and hiding a project from someone whose role reaches nothing only drops their grant there", () => {
  expect(
    asRecord(
      planMemberProjectGrants({
        orgRole: "READ_ONLY",
        current: list({ prod: "ADMIN" }),
        changes: [{ projectId: "prod", roleCode: "READ_ONLY" }],
      }).list,
    ),
  ).toEqual({});
  expect(
    asRecord(
      planMemberProjectGrants({
        orgRole: "OWNER",
        current: list({}),
        changes: [{ projectId: "prod", roleCode: "ADMIN" }],
      }).list,
    ),
  ).toEqual({});
  expect(
    asRecord(
      planMemberProjectGrants({
        orgRole: "NO_ACCESS",
        current: list({ prod: "READ_ONLY" }),
        changes: [{ projectId: "prod", roleCode: "NO_ACCESS" }],
      }).list,
    ),
  ).toEqual({});
});

// witness: packages/client-runtime/src/zerops/projectAccess.ts | if (was === "OWNER") continue; → if (was === "NEVER") continue;
it("ZV63: A project a person owns is never changed by a change of their access, while the owner marker is no role's and is written as a grant, over an admin's own grant too", () => {
  expect(
    planMemberProjectGrants({
      orgRole: "BASIC_USER",
      current: list({ "their-mate": "OWNER" }),
      changes: [{ projectId: "their-mate", roleCode: "READ_ONLY" }],
    }).list,
  ).toEqual(list({ "their-mate": "OWNER" }));
  expect(
    planMemberProjectGrants({
      orgRole: "OWNER",
      current: list({ elsewhere: "READ_ONLY" }),
      changes: [{ projectId: "mate", roleCode: "OWNER" }],
    }).list,
  ).toEqual(list({ elsewhere: "READ_ONLY", mate: "OWNER" }));
  expect(
    planMemberProjectGrants({
      orgRole: "ADMIN",
      current: list({ mate: "ADMIN" }),
      changes: [{ projectId: "mate", roleCode: "OWNER" }],
    }).list,
  ).toEqual(list({ mate: "OWNER" }));
});

// witness: packages/client-runtime/src/zerops/projectAccess.ts | return { list, changed: next.size > 0 }; → return { list, changed: true };
it("ZV64: A change of project access that changes nothing writes nothing", () => {
  expect(
    planMemberProjectGrants({
      current: list({ prod: "ADMIN" }),
      orgRole: "NO_ACCESS",
      changes: [{ projectId: "prod", roleCode: "ADMIN" }],
    }).changed,
  ).toBe(false);
  expect(
    planMemberProjectGrants({
      orgRole: "NO_ACCESS",
      current: list({ elsewhere: "BASIC_USER" }),
      changes: [{ projectId: "stage", roleCode: "ADMIN" }],
    }).changed,
  ).toBe(true);
});

// witness: packages/client-runtime/src/zerops/projectAccess.ts | || input.self || → ||
it("ZV65: An organization owner may change anyone's access to projects and an admin their own and anyone's below an admin; nobody else may change any", () => {
  expect(mayChangeAccess({ viewerRole: "OWNER", memberRole: "ADMIN", self: false })).toBe(true);
  expect(mayChangeAccess({ viewerRole: "ADMIN", memberRole: "ADMIN", self: true })).toBe(true);
  expect(mayChangeAccess({ viewerRole: "ADMIN", memberRole: "ADMIN", self: false })).toBe(false);
  expect(mayChangeAccess({ viewerRole: "ADMIN", memberRole: "OWNER", self: false })).toBe(false);
  expect(mayChangeAccess({ viewerRole: "ADMIN", memberRole: "BASIC_USER", self: false })).toBe(
    true,
  );
  expect(mayChangeAccess({ viewerRole: "BASIC_USER", memberRole: "NO_ACCESS", self: false })).toBe(
    false,
  );
  expect(mayChangeAccess({ viewerRole: undefined, memberRole: "NO_ACCESS", self: false })).toBe(
    false,
  );
});

// witness: packages/client-runtime/src/zerops/projectAccess.ts | roleAtLeast(roleCode, "OWNER") → roleAtLeast(roleCode, "ADMIN")
it("ZV66: A Mate added to a project that exists is marked its adder's only where the adder is an organization owner and the project names no owner yet; any other adder's, or one whose role is not read, is marked no one's", () => {
  const owner = (
    roleCode: string | undefined,
    userRoles: ReadonlyArray<ProjectGrant> | undefined,
  ) => ownerAtAdd({ userRoles, adder: { membershipId: "cu-me", roleCode } });
  expect(owner("ADMIN", [])).toBe(null);
  expect(owner("OWNER", undefined)).toBe("cu-me");
  expect(owner("OWNER", [{ clientUserId: "cu-me", roleCode: "READ_ONLY" }])).toBe("cu-me");
  expect(owner("OWNER", [{ clientUserId: "cu-ada", roleCode: "OWNER" }])).toBe(null);
  expect(owner("BASIC_USER", [])).toBe(null);
  expect(owner("READ_ONLY", [])).toBe(null);
  expect(owner("NO_ACCESS", [])).toBe(null);
  expect(owner(undefined, [])).toBe(null);
});

// witness: packages/client-runtime/src/zerops/projectAccess.ts | : list.filter((entry) => asOrgRole(entry.roleCode) !== "OWNER"); → : list;
it("ZV67: A project list recorded for an earlier press is sent by anyone but an organization owner without its owner marker", () => {
  const recorded = [
    { clientUserId: "cu-ada", roleCode: "OWNER" },
    { clientUserId: "cu-bo", roleCode: "ADMIN" },
  ];
  const withoutOwner = [{ clientUserId: "cu-bo", roleCode: "ADMIN" }];
  expect(grantsWritableBy(recorded, "OWNER")).toEqual(recorded);
  expect(grantsWritableBy(recorded, "ADMIN")).toEqual(withoutOwner);
  expect(grantsWritableBy(recorded, undefined)).toEqual(withoutOwner);
});

// witness: packages/client-runtime/src/zerops/projectAccess.ts | if (roleCode === null) return list.filter((entry) => entry.clientUserId !== clientUserId); → if (roleCode === null) return list;
it("ZV68: Setting one person's grant in a project's list keeps everyone else's in place, a person new to it added last, and dropping theirs removes only their entry", () => {
  const roles: ReadonlyArray<ProjectGrant> = [
    { clientUserId: "cu-ada", roleCode: "ADMIN" },
    { clientUserId: "cu-bo", roleCode: "READ_ONLY" },
  ];

  expect(withProjectGrant(roles, "cu-ada", "READ_ONLY")).toEqual([
    { clientUserId: "cu-ada", roleCode: "READ_ONLY" },
    { clientUserId: "cu-bo", roleCode: "READ_ONLY" },
  ]);
  expect(withProjectGrant(roles, "cu-cy", "ADMIN")).toEqual([
    ...roles,
    { clientUserId: "cu-cy", roleCode: "ADMIN" },
  ]);
  expect(withProjectGrant(roles, "cu-ada", null)).toEqual([
    { clientUserId: "cu-bo", roleCode: "READ_ONLY" },
  ]);
});
