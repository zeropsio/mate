import { expect, it } from "vite-plus/test";

import {
  grantsWritableBy,
  mayChangeAccess,
  ownerAtAdd,
  withProjectGrant,
  type ProjectGrant,
} from "./projectAccess.ts";

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
