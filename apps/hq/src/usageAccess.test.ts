import { assert, describe, it } from "@effect/vitest";
import type { OrgView } from "./roles.ts";
import { mayReadUsage, usageOwner } from "./usageAccess.ts";
const facts: OrgView = {
  orgId: "ORG",
  freshness: "fresh",
  members: [
    {
      userId: "alice",
      clientUserId: "C-alice",
      name: "Alice",
      kind: "person",
      status: "ACTIVE",
      roleCode: "NO_ACCESS",
      canCreateProjects: false,
    },
    {
      userId: "bob",
      clientUserId: "C-bob",
      name: "Bob",
      kind: "person",
      status: "ACTIVE",
      roleCode: "READ_ONLY",
      canCreateProjects: false,
    },
  ],
  projects: [
    {
      id: "P",
      orgId: "ORG",
      tags: [],
      name: "P",
      status: "ACTIVE",
      publicZone: "p.zone",
      userRoles: [
        { clientUserId: "C-alice", roleCode: "OWNER" },
        { clientUserId: "C-bob", roleCode: "NO_ACCESS" },
      ],
    },
  ],
};
describe("usage source access and current-owner grouping", () => {
  it("project-only operators lose retired access and existing hidden sources are not deleted", () => {
    assert.isTrue(mayReadUsage(facts, "alice", "P", false));
    assert.isFalse(mayReadUsage(facts, "alice", "P", true));
    assert.isFalse(mayReadUsage(facts, "bob", "P", false));
    assert.isTrue(mayReadUsage(facts, "bob", "P", true));
    assert.isFalse(mayReadUsage(facts, "bob", "missing", false));
    for (const status of ["INVITED", "SUSPENDED", "DELETED", "UNKNOWN"])
      assert.isFalse(
        mayReadUsage(
          { ...facts, members: facts.members.map((member) => ({ ...member, status })) },
          "bob",
          "P",
          true,
        ),
      );
    for (const roleCode of ["NO_ACCESS", "UNKNOWN"])
      assert.isFalse(
        mayReadUsage(
          { ...facts, members: facts.members.map((member) => ({ ...member, roleCode })) },
          "bob",
          "P",
          true,
        ),
      );
  });
  it("an explicit OWNER resolves canonically and cannot fall through to login history", () => {
    const input = {
      facts,
      projectId: "P",
      everSignedIn: { "claude-code": "bob" },
      runsWithoutSignIn: true,
      madeBy: "bob",
      standupRequestedBy: null,
    };
    assert.strictEqual(usageOwner(input), "alice");
    assert.isNull(
      usageOwner({
        ...input,
        facts: { ...facts, members: facts.members.filter((member) => member.userId !== "alice") },
      }),
    );
    assert.strictEqual(
      usageOwner({
        ...input,
        facts: {
          ...facts,
          projects: facts.projects.map((project) => ({ ...project, userRoles: [] })),
        },
      }),
      "bob",
    );
  });
});
