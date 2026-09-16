import { describe, expect, it } from "vite-plus/test";

import {
  BROKER_TOKEN_NAME,
  deriveEnvironmentName,
  environmentBranchName,
  environmentCommitMessage,
  findBrokerToken,
  planEnvironmentWrite,
  readGroupEnvironments,
  withBrokerProjectGrant,
  withGroupEnvironment,
  type GroupEnvironment,
} from "./groupEnvironments.ts";

const ONE_STAGE = `version: 1
environments:
  stage:
    tier: stage
    project: p-stage
    sources: [main]
    deploy: on-push
`;

const FULL = `version: 1
environments:
  stage:
    tier: stage
    project: p-stage
    sources: [main]
    deploy: on-push
  stage-client-x:
    tier: stage
    project: p-clientx
    # Shown to a client, so it carries the invoices work too.
    sources: [main, feature/invoices]
  production:
    tier: production
    project: p-prod
    sources: release
    gates:
      requireOnStage: stage
`;

const STAGE: GroupEnvironment = {
  name: "stage",
  tier: "stage",
  project: "p-new",
  sources: ["main"],
  deploy: undefined,
};

describe("readGroupEnvironments", () => {
  it("reads every environment, its tier, its project and what feeds it", () => {
    expect(readGroupEnvironments(FULL)).toEqual([
      {
        name: "stage",
        tier: "stage",
        project: "p-stage",
        sources: ["main"],
        deploy: "on-push",
      },
      {
        name: "stage-client-x",
        tier: "stage",
        project: "p-clientx",
        sources: ["main", "feature/invoices"],
        deploy: undefined,
      },
      {
        name: "production",
        tier: "production",
        project: "p-prod",
        sources: "release",
        deploy: undefined,
      },
    ]);
  });

  it.each([
    { name: "an empty file", yaml: "" },
    { name: "a file with a version and no environments", yaml: "version: 1\n" },
    { name: "an environments key with nothing under it", yaml: "version: 1\nenvironments:\n" },
  ])("reads $name as no environments", ({ yaml }) => {
    expect(readGroupEnvironments(yaml)).toEqual([]);
  });

  it("skips an entry it cannot make sense of rather than failing the read", () => {
    const yaml = `environments:
  broken:
    tier: staging
    project: p-1
  stage:
    tier: stage
    project: p-stage
    sources: [main]
`;
    expect(readGroupEnvironments(yaml).map((entry) => entry.name)).toEqual(["stage"]);
  });

  it("stops at the next top-level key", () => {
    expect(readGroupEnvironments(`${ONE_STAGE}other:\n  nope: true\n`)).toHaveLength(1);
  });
});

describe("withGroupEnvironment", () => {
  it("gives an empty file the header it needs", () => {
    const write = withGroupEnvironment("", STAGE);
    expect(write.ok && write.yaml).toBe(`version: 1
environments:
  stage:
    tier: stage
    project: p-new
    sources: [main]
    deploy: on-push
`);
    expect(write.ok && write.branch).toBe("mate-app/env-stage");
  });

  it("adds a second stage and keeps the first", () => {
    const write = withGroupEnvironment(ONE_STAGE, {
      ...STAGE,
      name: "stage-client-x",
      project: "p-clientx",
      sources: ["main", "feature/invoices"],
    });
    expect(write.ok && write.yaml).toBe(`version: 1
environments:
  stage:
    tier: stage
    project: p-stage
    sources: [main]
    deploy: on-push
  stage-client-x:
    tier: stage
    project: p-clientx
    sources: [main, feature/invoices]
    deploy: on-push
`);
  });

  it("writes a production with sources: release, whatever it was handed", () => {
    const write = withGroupEnvironment(ONE_STAGE, {
      ...STAGE,
      name: "production",
      tier: "production",
      project: "p-prod",
      sources: ["main"],
    });
    expect(write.ok && write.yaml).toContain(
      "  production:\n    tier: production\n    project: p-prod\n    sources: release\n",
    );
    // A production takes no `deploy`: it deploys what an approved tag lists.
    expect(write.ok && write.yaml).not.toContain("    sources: release\n    deploy:");
  });

  it("keeps a gates block and a comment somebody wrote", () => {
    const write = withGroupEnvironment(FULL, { ...STAGE, name: "stage-two", project: "p-two" });
    expect(write.ok && write.yaml).toContain(
      "# Shown to a client, so it carries the invoices work too.",
    );
    expect(write.ok && write.yaml).toContain("      requireOnStage: stage");
  });

  it.each([
    {
      name: "a second production",
      entry: { ...STAGE, name: "prod-2", tier: "production" as const },
      yaml: FULL,
      reason: "This project already has a production.",
    },
    {
      name: "a name already taken",
      entry: STAGE,
      yaml: ONE_STAGE,
      reason: "This project already has an environment called stage.",
    },
    {
      name: "a blank name",
      entry: { ...STAGE, name: "  " },
      yaml: "",
      reason: "An environment needs a name.",
    },
    {
      name: "a name a branch cannot carry",
      entry: { ...STAGE, name: "Stage One" },
      yaml: "",
      reason: "An environment's name is lower-case letters, digits and dashes.",
    },
  ])("refuses $name", ({ entry, yaml, reason }) => {
    expect(withGroupEnvironment(yaml, entry)).toEqual({ ok: false, reason });
  });

  it("names the branch and the commit after the environment", () => {
    expect(environmentBranchName("stage-client-x")).toBe("mate-app/env-stage-client-x");
    expect(environmentCommitMessage({ name: "production", tier: "production" })).toBe(
      "Add the production production environment",
    );
  });
});

describe("planEnvironmentWrite", () => {
  it.each([
    { userCanMerge: true, merge: true },
    { userCanMerge: false, merge: false },
    // Gitea did not answer: a pull request somebody can merge beats a merge
    // call that fails after the branch exists.
    { userCanMerge: undefined, merge: false },
  ])("merges when Gitea says $userCanMerge", ({ userCanMerge, merge }) => {
    expect(planEnvironmentWrite({ name: "stage", userCanMerge })).toEqual({
      branch: "mate-app/env-stage",
      merge,
    });
  });
});

describe("the broker's grants", () => {
  const TOKENS = [
    { id: "t-1", name: "zcp-fen" },
    { id: "t-2", name: BROKER_TOKEN_NAME },
    { id: "t-3", name: "mate-door:p-1:abc" },
  ];

  it("finds the broker's token by its name", () => {
    expect(findBrokerToken(TOKENS)?.id).toBe("t-2");
    expect(findBrokerToken([TOKENS[0]!])).toBeUndefined();
  });

  it("adds the new project and keeps every grant it already had", () => {
    const write = withBrokerProjectGrant(
      [
        { projectId: "p-gitea", roleCode: "BASIC_USER" },
        { projectId: "p-stage", roleCode: "BASIC_USER" },
      ],
      "p-prod",
    );
    expect(write).toEqual({
      ok: true,
      grants: [
        { projectId: "p-gitea", roleCode: "BASIC_USER" },
        { projectId: "p-stage", roleCode: "BASIC_USER" },
        { projectId: "p-prod", roleCode: "BASIC_USER" },
      ],
    });
  });

  it("gives back the same list for a project it already reaches, so the write is skipped", () => {
    const grants = [{ projectId: "p-stage", roleCode: "BASIC_USER" as const }];
    const write = withBrokerProjectGrant(grants, "p-stage");
    expect(write.ok && write.grants).toBe(grants);
  });

  it("raises a project it reaches at less than BASIC_USER, in place", () => {
    const write = withBrokerProjectGrant(
      [
        { projectId: "p-gitea", roleCode: "BASIC_USER" },
        { projectId: "p-stage", roleCode: "READ_ONLY" },
      ],
      "p-stage",
    );
    expect(write.ok && write.grants).toEqual([
      { projectId: "p-gitea", roleCode: "BASIC_USER" },
      { projectId: "p-stage", roleCode: "BASIC_USER" },
    ]);
  });

  it("starts a token with no grants at all off with one", () => {
    expect(withBrokerProjectGrant(undefined, "p-stage")).toEqual({
      ok: true,
      grants: [{ projectId: "p-stage", roleCode: "BASIC_USER" }],
    });
  });

  it("refuses a blank project rather than writing a grant to nothing", () => {
    expect(withBrokerProjectGrant([], "  ")).toEqual({
      ok: false,
      reason: "There is no project to give the broker.",
    });
  });
});

describe("deriveEnvironmentName", () => {
  it.each([
    { displayName: "Acme CRM - stage", tier: "stage" as const, expected: "acme-crm-stage" },
    { displayName: "Ácme — Production", tier: "production" as const, expected: "acme-production" },
    // A workflow's deploy step asks for it by name and it becomes a branch, so
    // it has to start with a letter.
    { displayName: "2024 Launch", tier: "stage" as const, expected: "launch" },
    { displayName: "   ", tier: "production" as const, expected: "production" },
    { displayName: "!!!", tier: "stage" as const, expected: "stage" },
  ])("turns $displayName into $expected", ({ displayName, tier, expected }) => {
    expect(deriveEnvironmentName(displayName, tier)).toBe(expected);
  });

  it("numbers past a name the document already declares", () => {
    expect(deriveEnvironmentName("Acme - stage", "stage", ["acme-stage"])).toBe("acme-stage-2");
    expect(deriveEnvironmentName("Acme - stage", "stage", ["acme-stage", "acme-stage-2"])).toBe(
      "acme-stage-3",
    );
  });
});
