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
    {
      userId: "carol",
      clientUserId: "C-carol",
      name: "Carol",
      kind: "person",
      status: "ACTIVE",
      roleCode: "BASIC_USER",
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
        { clientUserId: "C-carol", roleCode: "NO_ACCESS" },
      ],
    },
  ],
};
describe("usage source access and current-owner grouping", () => {
  it("project-only operators lose retired access and existing hidden sources are not deleted", () => {
    assert.isTrue(mayReadUsage(facts, "alice", "P", false));
    assert.isFalse(mayReadUsage(facts, "alice", "P", true));
    assert.isFalse(mayReadUsage(facts, "bob", "P", false));
    assert.isTrue(mayReadUsage(facts, "carol", "gone", true));
    assert.isFalse(mayReadUsage(facts, "bob", "missing", false));
    for (const status of ["INVITED", "SUSPENDED", "DELETED", "UNKNOWN"])
      assert.isFalse(
        mayReadUsage(
          { ...facts, members: facts.members.map((member) => ({ ...member, status })) },
          "carol",
          "gone",
          true,
        ),
      );
    for (const roleCode of ["NO_ACCESS", "UNKNOWN"])
      assert.isFalse(
        mayReadUsage(
          { ...facts, members: facts.members.map((member) => ({ ...member, roleCode })) },
          "carol",
          "gone",
          true,
        ),
      );
  });
  it("a retired Mate's usage is read by no one who could not observe it while live", () => {
    // An org Read only member never observed a Mate, live or retired.
    assert.isFalse(mayReadUsage(facts, "bob", "gone", true));
    assert.isFalse(mayReadUsage(facts, "bob", "P", true));
    // A project Zerops still shows keeps its override over the retired record.
    assert.isFalse(mayReadUsage(facts, "carol", "P", true));
  });
  it.each([
    { agent: "an agent that waits on a sign-in", runsWithoutSignIn: false },
    { agent: "a sign-in-free agent", runsWithoutSignIn: true },
  ])(
    "a Mate Zerops names no OWNER of stays its maker's whoever signs it in later, on $agent",
    ({ runsWithoutSignIn }) => {
      const input = {
        facts: {
          ...facts,
          projects: facts.projects.map((project) => ({ ...project, userRoles: [] })),
        },
        projectId: "P",
        everSignedIn: {},
        runsWithoutSignIn,
        madeBy: "carol",
        standupRequestedBy: null,
      };
      assert.strictEqual(usageOwner(input), "carol");
      assert.strictEqual(usageOwner({ ...input, everSignedIn: { codex: "bob" } }), "carol");
      assert.strictEqual(
        usageOwner({ ...input, everSignedIn: { "claude-code": "bob", codex: "alice" } }),
        "carol",
      );
    },
  );
  it("a Mate recorded before HQ kept its maker is its stand-up asker's, else its signer's", () => {
    const input = {
      facts: {
        ...facts,
        projects: facts.projects.map((project) => ({ ...project, userRoles: [] })),
      },
      projectId: "P",
      everSignedIn: { codex: "bob" },
      runsWithoutSignIn: false,
      madeBy: null,
      standupRequestedBy: "carol",
    };
    assert.strictEqual(usageOwner(input), "carol");
    assert.strictEqual(usageOwner({ ...input, standupRequestedBy: null }), "bob");
  });
  it("an integration token recorded as a Mate's maker never owns it", () => {
    const input = {
      facts: {
        ...facts,
        members: [
          ...facts.members,
          {
            userId: "token-1",
            clientUserId: "C-token-1",
            name: "CI",
            kind: "token" as const,
            status: "ACTIVE",
            roleCode: "ADMIN",
            canCreateProjects: true,
          },
        ],
        projects: facts.projects.map((project) => ({ ...project, userRoles: [] })),
      },
      projectId: "P",
      everSignedIn: { codex: "bob" },
      runsWithoutSignIn: false,
      madeBy: "token-1",
      standupRequestedBy: null,
    };
    assert.strictEqual(usageOwner(input), "bob");
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
