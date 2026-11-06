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

  it("A Git environment keeps no deploy token and its other verbs are the structure's", () => {
    expect(gitEnvironmentOffers(facts("BASIC_USER"))).toEqual({
      keep_deploy_token: refused("unknown_kind"),
      remove_git_environment: refused("not_structure_writer"),
      redeploy: refused("not_structure_writer"),
    });
  });
});
