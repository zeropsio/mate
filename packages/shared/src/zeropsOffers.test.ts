import { describe, expect, it } from "vite-plus/test";

import type { PermissionFacts } from "./zeropsPermissions.ts";
import {
  applicationOffers,
  environmentOffers,
  gitEnvironmentOffers,
  organizationOffers,
  placementOffers,
} from "./zeropsOffers.ts";

/** A person of `orgRole` whom Zerops lists each project in `overrides`, with that override there. */
const facts = (
  orgRole: string,
  overrides: Readonly<Record<string, string | undefined>> = {},
  status = "ACTIVE",
): PermissionFacts => ({
  member: { roleCode: orgRole, status, canCreateProjects: false },
  project: (projectId) =>
    Object.hasOwn(overrides, projectId) ? { override: overrides[projectId] } : undefined,
});

/** The same person, known by their Zerops user id: what an application's merge limit names. */
const person = (
  userId: string,
  orgRole: string,
  overrides: Readonly<Record<string, string | undefined>> = {},
): PermissionFacts => ({
  ...facts(orgRole, overrides),
  member: { userId, roleCode: orgRole, status: "ACTIVE", canCreateProjects: false },
});

/** An application of one Mate project that releases to Git, limiting who merges to `people`. */
const limited = (people: ReadonlyArray<string> | undefined) => ({
  projectIds: ["mate"],
  production: { kind: "git" } as const,
  placements: [{ projectId: "mate", kind: "mate" }],
  ...(people === undefined ? {} : { mergers: { people } }),
});

const ALLOW = { allow: true };
const refused = (reason: string) => ({ allow: false, reason });

describe("zeropsOffers", () => {
  it.each([
    ["OWNER", ALLOW],
    ["ADMIN", ALLOW],
    ["BASIC_USER", refused("not_structure_writer")],
  ])("The organization's structure is offered to its owners and admins: %s", (role, decision) => {
    expect(organizationOffers(facts(role))).toMatchObject({
      structure: decision,
      rename_app: decision,
      delete_app: decision,
    });
  });

  it.each([
    ["Basic user by the organization", "BASIC_USER", undefined, ALLOW],
    ["an admin overridden to Read only", "ADMIN", "READ_ONLY", refused("not_mate_operator")],
    ["Read only raised to Basic user", "READ_ONLY", "BASIC_USER", ALLOW],
  ])(
    "A Mate is operated by Basic user or above on its project: %s",
    (_label, orgRole, override, decision) => {
      const offers = placementOffers(
        facts(orgRole, { mate: override }),
        { projectId: "mate", kind: "mate" },
        { projectIds: ["mate"] },
      );
      expect(offers?.observe_mate).toEqual(decision);
    },
  );

  it.each([
    ["Basic user there", { mate: undefined, prod: "BASIC_USER" }, "READ_ONLY", ALLOW],
    [
      "Read only there",
      { mate: undefined, prod: "READ_ONLY" },
      "BASIC_USER",
      refused("not_releaser"),
    ],
  ])(
    "Releasing to a Zerops production takes Basic user or above on it: %s",
    (_label, overrides, orgRole, decision) => {
      const offers = applicationOffers(facts(orgRole, overrides), {
        projectIds: ["mate"],
        production: { kind: "zerops", projectId: "prod" },
        placements: [
          { projectId: "mate", kind: "mate" },
          { projectId: "prod", kind: "production" },
        ],
      });
      expect(offers.release).toEqual(decision);
    },
  );

  it("An invited member is offered nothing", () => {
    const invited = facts("OWNER", { prod: undefined }, "INVITED");
    expect(organizationOffers(invited).create_app).toEqual(refused("not_active_member"));
    expect(
      environmentOffers(invited, { projectId: "prod", tier: "stage" }, { projectIds: [] }),
    ).toEqual({
      keep_deploy_token: refused("not_active_member"),
      redeploy: refused("not_active_member"),
    });
  });

  // witness: packages/shared/src/zeropsOffers.ts | changePermission(facts, "merge_change", app.projectIds, app.mergers) → changePermission(facts, "merge_change", app.projectIds)
  it("Where a project limits who merges, a person who can push but is not named does not merge", () => {
    const offers = applicationOffers(
      person("u-kim", "BASIC_USER", { mate: undefined }),
      limited(["u-ada", "u-sam"]),
    );
    expect(offers.merge_change).toEqual(refused("not_app_merger"));
    expect(offers.comment_change).toEqual(ALLOW);
    expect(offers.close_change).toEqual(ALLOW);
  });

  // witness: packages/shared/src/zeropsPermissions.ts | limit.people.includes(member.userId) → false
  it("A person the project names merges", () => {
    const offers = applicationOffers(
      person("u-ada", "BASIC_USER", { mate: undefined }),
      limited(["u-ada", "u-sam"]),
    );
    expect(offers.merge_change).toEqual(ALLOW);
  });

  // witness: packages/shared/src/zeropsPermissions.ts | writer(member) || (member.userId !== undefined → (member.userId !== undefined
  it.each(["OWNER", "ADMIN"])(
    "The organization's owners and admins merge with nobody named: %s",
    (orgRole) => {
      const offers = applicationOffers(person("u-kim", orgRole, { mate: undefined }), limited([]));
      expect(offers.merge_change).toEqual(ALLOW);
    },
  );

  // witness: packages/shared/src/zeropsPermissions.ts | !mergesWithin(member, mergers) → !mergesWithin({ ...member, roleCode: roleOn(facts, member, projectIds[0]!) }, mergers)
  it("Admin on one of the project's Zerops projects is not the organization's: a person raised there still does not merge", () => {
    const offers = applicationOffers(
      person("u-kim", "BASIC_USER", { mate: "ADMIN" }),
      limited(["u-ada"]),
    );
    expect(offers.merge_change).toEqual(refused("not_app_merger"));
  });

  // witness: packages/shared/src/zeropsPermissions.ts | if (!developsIn(facts, member, projectIds)) return refuse("not_app_developer"); →
  it("A person who cannot push is told that first, whoever the project names", () => {
    const offers = applicationOffers(
      person("u-kim", "READ_ONLY", { mate: undefined }),
      limited(["u-ada"]),
    );
    expect(offers.merge_change).toEqual(refused("not_app_developer"));
  });

  // witness: packages/shared/src/zeropsPermissions.ts | changePermission(facts, "merge_change", projectIds, mergers); → changePermission(facts, "merge_change", projectIds);
  it("Releasing to a Git production is held for whoever the merge limit holds", () => {
    const outside = person("u-kim", "BASIC_USER", { mate: undefined });
    expect(applicationOffers(outside, limited(["u-ada"])).release).toEqual(
      refused("not_app_merger"),
    );
    expect(applicationOffers(outside, limited(undefined)).release).toEqual(ALLOW);
  });

  it("A Git environment keeps no deploy token and its other verbs are the structure's", () => {
    expect(gitEnvironmentOffers(facts("BASIC_USER"))).toEqual({
      keep_deploy_token: refused("unknown_kind"),
      remove_git_environment: refused("not_structure_writer"),
      redeploy: refused("not_structure_writer"),
    });
  });
});
