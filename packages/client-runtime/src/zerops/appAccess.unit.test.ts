import { expect, it } from "vite-plus/test";

import { appAccessActions, appAccessLevel } from "./appAccess.ts";

/** An app with production and stage, a Mate serving as stage, and two more Mates. */
const PROJECTS = { places: ["prod", "stage", "devstage"], mates: ["m-own", "m-other"] };
const OWNED = ["m-own"];

const level = (orgRole: string, entries: Record<string, string>) =>
  appAccessLevel({
    orgRole,
    grantOf: (projectId) => entries[projectId],
    projects: PROJECTS,
    owned: OWNED,
  });

// witness: packages/client-runtime/src/zerops/appAccess.ts | if (reaches.every((one) => one === "work" || one === "administer")) return "work"; → if (reaches.some((one) => one === "work" || one === "administer")) return "work";
it("ZV59: A member works on an application where every place it runs gives them full access and only looks where every place is read only, their organization role counting where no grant says otherwise; places that differ or shut them out are neither", () => {
  expect(level("NO_ACCESS", { prod: "BASIC_USER", stage: "BASIC_USER", devstage: "OWNER" })).toBe(
    "work",
  );
  expect(level("NO_ACCESS", { prod: "READ_ONLY", stage: "READ_ONLY", devstage: "READ_ONLY" })).toBe(
    "look",
  );
  expect(level("READ_ONLY", {})).toBe("look");
  expect(
    level("NO_ACCESS", { prod: "READ_ONLY", stage: "BASIC_USER", devstage: "BASIC_USER" }),
  ).toBeNull();
  expect(level("BASIC_USER", { prod: "NO_ACCESS" })).toBeNull();
});

const viewer = (roleCode: string) => ({ roleCode, membershipId: "cu-me" });
const member = (roleCode: string, pending = false, id = "cu-them") => ({ id, roleCode, pending });

// witness: packages/client-runtime/src/zerops/appAccess.ts | if (member.id === viewer.membershipId || roleAtLeast(member.roleCode, "ADMIN")) return null; → if (roleAtLeast(member.roleCode, "ADMIN")) return null;
it("ZV60: Only an organization owner or admin changes a member's access to an application, never an owner's or an admin's nor their own, and nobody while the viewer is unknown; an invitation not joined yet is withdrawn, not removed", () => {
  expect(appAccessActions({ viewer: viewer("OWNER"), member: member("NO_ACCESS") })).toEqual({
    end: "remove",
  });
  expect(appAccessActions({ viewer: viewer("ADMIN"), member: member("BASIC_USER") })).toEqual({
    end: "remove",
  });
  expect(appAccessActions({ viewer: viewer("OWNER"), member: member("NO_ACCESS", true) })).toEqual({
    end: "withdraw",
  });
  expect(appAccessActions({ viewer: viewer("OWNER"), member: member("ADMIN") })).toBeNull();
  expect(appAccessActions({ viewer: viewer("ADMIN"), member: member("OWNER") })).toBeNull();
  expect(
    appAccessActions({ viewer: viewer("OWNER"), member: member("BASIC_USER", false, "cu-me") }),
  ).toBeNull();
  expect(
    appAccessActions({ viewer: viewer("BASIC_USER"), member: member("NO_ACCESS") }),
  ).toBeNull();
  expect(appAccessActions({ viewer: undefined, member: member("NO_ACCESS") })).toBeNull();
});
