import { expect, it } from "vite-plus/test";

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

// witness: packages/client-runtime/src/zerops/appAccess.ts | return place ? "BASIC_USER" → return place ? "READ_ONLY"
it("ZV51: Giving a person work on an application gives them full access to every place it runs and its other Mates to look at, every project outside the application kept on their list", () => {
  expect(plan("work", "NO_ACCESS", [ELSEWHERE]).list).toEqual([
    ELSEWHERE,
    ...grants({
      prod: "BASIC_USER",
      stage: "BASIC_USER",
      devstage: "BASIC_USER",
      "m-other": "READ_ONLY",
    }),
  ]);
});

// witness: packages/client-runtime/src/zerops/appAccess.ts | return "READ_ONLY"; → return "BASIC_USER";
it("ZV52: Letting a person only look gives them read only on every place and Mate of the application, lowering what they held there, while every other project keeps its grant and its place on their list", () => {
  const readOnly = [
    ELSEWHERE,
    ...grants({
      prod: "READ_ONLY",
      stage: "READ_ONLY",
      devstage: "READ_ONLY",
      "m-other": "READ_ONLY",
    }),
  ];
  expect(
    plan("look", "NO_ACCESS", [ELSEWHERE, { projectId: "prod", roleCode: "BASIC_USER" }]).list,
  ).toEqual(readOnly);
  expect(plan("look", "BASIC_USER", [ELSEWHERE]).list).toEqual(readOnly);
  expect(
    plan("look", "NO_ACCESS", [ELSEWHERE, ...grants({ stage: "BASIC_USER", "p-far": "OWNER" })])
      .list,
  ).toEqual([
    ELSEWHERE,
    ...grants({
      stage: "READ_ONLY",
      "p-far": "OWNER",
      prod: "READ_ONLY",
      devstage: "READ_ONLY",
      "m-other": "READ_ONLY",
    }),
  ]);
});

// witness: packages/client-runtime/src/zerops/appAccess.ts | roleAtLeast(effective, "READ_ONLY") ? undefined : "READ_ONLY" → false ? undefined : "READ_ONLY"
it("ZV53: Work on an application never lowers what a person already holds on one of its Mates", () => {
  expect(plan("work", "NO_ACCESS", grants({ "m-other": "BASIC_USER" })).list).toEqual(
    grants({
      "m-other": "BASIC_USER",
      prod: "BASIC_USER",
      stage: "BASIC_USER",
      devstage: "BASIC_USER",
    }),
  );
});

// witness: packages/client-runtime/src/zerops/appAccess.ts | const grant = target === role ? null : target; → const grant = target;
it("ZV54: A grant the person's organization role already gives is not written: the role covers it", () => {
  expect(plan("work", "BASIC_USER", grants({ stage: "NO_ACCESS" })).list).toEqual([]);
});

// witness: packages/client-runtime/src/zerops/appAccess.ts | return "NO_ACCESS"; → return undefined;
it("ZV55: Removing a person shuts the application's projects to them: their grants there are dropped where their role reaches nothing and written as no access where it reaches every project, each project reached said with what it comes to hold", () => {
  expect(
    plan("remove", "NO_ACCESS", [
      ELSEWHERE,
      ...grants({ prod: "BASIC_USER", "m-other": "READ_ONLY" }),
    ]).list,
  ).toEqual([ELSEWHERE]);
  expect(plan("remove", "READ_ONLY", [ELSEWHERE]).list).toEqual([
    ELSEWHERE,
    ...grants({
      prod: "NO_ACCESS",
      stage: "NO_ACCESS",
      devstage: "NO_ACCESS",
      "m-other": "NO_ACCESS",
    }),
  ]);
  expect(
    plan("remove", "NO_ACCESS", grants({ prod: "READ_ONLY", "m-other": "READ_ONLY" })).touched,
  ).toEqual([
    { projectId: "prod", roleCode: null },
    { projectId: "m-other", roleCode: null },
  ]);
});

// witness: packages/client-runtime/src/zerops/appAccess.ts | ) => owned.includes(projectId) || held.get(projectId) === "OWNER"; → ) => false;
it("ZV56: A Mate the person owns is never touched by a change of their access to its application", () => {
  const owned = grants({ "m-own": "OWNER", "m-mine-too": "OWNER" });
  expect(plan("remove", "NO_ACCESS", owned).list).toEqual(owned);
});

// witness: packages/client-runtime/src/zerops/appAccess.ts | changed: touched.length > 0, → changed: true,
it("ZV57: A level the person already holds on the application changes nothing", () => {
  const current = grants({
    prod: "BASIC_USER",
    stage: "BASIC_USER",
    devstage: "BASIC_USER",
    "m-other": "READ_ONLY",
  });
  expect(plan("work", "NO_ACCESS", current).changed).toBe(false);
  expect(plan("look", "NO_ACCESS", current).changed).toBe(true);
});

// witness: packages/client-runtime/src/zerops/appAccess.ts | role === "NO_ACCESS" && → true &&
it("ZV58: Withdrawing an invitation ends it only where it opens nothing but this application; one opening another application or carrying a role that reaches every project stays, and removing a member never ends their membership", () => {
  expect(
    plan("withdraw", "NO_ACCESS", grants({ prod: "BASIC_USER", "m-other": "READ_ONLY" }))
      .dropMembership,
  ).toBe(true);
  expect(
    plan("withdraw", "NO_ACCESS", [ELSEWHERE, { projectId: "prod", roleCode: "BASIC_USER" }])
      .dropMembership,
  ).toBe(false);
  expect(plan("withdraw", "READ_ONLY", []).dropMembership).toBe(false);
  expect(plan("remove", "NO_ACCESS", grants({ prod: "BASIC_USER" })).dropMembership).toBe(false);
});

const level = (orgRole: string, entries: Record<string, string>) =>
  appAccessLevel({
    orgRole,
    grantOf: (projectId) => entries[projectId],
    projects: PROJECTS,
    owned: OWNED,
  });

// witness: packages/client-runtime/src/zerops/appAccess.ts | if (roles.every((one) => roleAtLeast(one, "BASIC_USER"))) return "work"; → if (roles.some((one) => roleAtLeast(one, "BASIC_USER"))) return "work";
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
