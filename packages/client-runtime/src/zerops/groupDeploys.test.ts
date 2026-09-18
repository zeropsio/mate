import { describe, expect, it } from "vite-plus/test";

import type { GiteaCommitStatus } from "./giteaClient.ts";
import {
  buildGroupEnvironmentRowInputs,
  buildGroupEnvironmentRows,
  deployStatusKey,
  deployWord,
  planDeployStatusReads,
  planDeployedVersionReads,
  planMainHeadReads,
  releaseDeploys,
} from "./groupDeploys.ts";
import type { GroupEnvironment } from "./groupEnvironments.ts";

const API = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
const WEB = "77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8";
const OLD = "1111111111111111111111111111111111111111";

const stage: GroupEnvironment = {
  name: "stage",
  tier: "stage",
  project: "p-stage",
  sources: ["main"],
  deploy: "on-push",
};
const production: GroupEnvironment = {
  name: "production",
  tier: "production",
  project: "p-prod",
  sources: "release",
  deploy: undefined,
};

const services = [
  { projectId: "p-stage", serviceId: "s1", hostname: "api" },
  { projectId: "p-stage", serviceId: "s2", hostname: "web" },
  { projectId: "p-prod", serviceId: "s3", hostname: "api" },
  { projectId: "p-mate", serviceId: "s4", hostname: "api" },
];

function status(context: string, state: GiteaCommitStatus["state"]): GiteaCommitStatus {
  return { context, state };
}

describe("planning the reads", () => {
  it("asks Zerops only about the projects an environment declares", () => {
    expect(
      planDeployedVersionReads({ declarations: [stage, production], services }).map(
        (read) => read.serviceId,
      ),
    ).toEqual(["s1", "s2", "s3"]);
  });

  it("asks about nothing when the group declares no environment", () => {
    expect(planDeployedVersionReads({ declarations: [], services })).toEqual([]);
  });

  it.each([
    {
      name: "one commit per service",
      versions: [
        { hostname: "api", appVersionName: API },
        { hostname: "web", appVersionName: `${WEB} v1.2.0 ada` },
      ],
      expected: [`acme/api@${API}`, `acme/web@${WEB}`],
    },
    {
      name: "the same commit twice, asked about once",
      versions: [
        { hostname: "api", appVersionName: API },
        { hostname: "api", appVersionName: `${API} v1.2.0 ada` },
      ],
      expected: [`acme/api@${API}`],
    },
    {
      name: "a service with nothing deployed",
      versions: [{ hostname: "api", appVersionName: undefined }],
      expected: [],
    },
    {
      // The promoted runtime `app` builds from the pair's repository `appdev`
      // (the owner's run, 2026-09-17: reading `todo/app` answered 404).
      name: "a runtime whose tier names another repository",
      versions: [{ hostname: "app", appVersionName: API, repository: "appdev" }],
      expected: [`acme/app@${API}`],
    },
    {
      name: "a version somebody named by hand",
      versions: [{ hostname: "api", appVersionName: "hotfix" }],
      expected: [],
    },
  ])("plans status reads for $name", ({ versions, expected }) => {
    expect(planDeployStatusReads({ owner: "acme", versions }).map(deployStatusKey)).toEqual(
      expected,
    );
  });

  it("reads the statuses on the tier's repository and keys them by the hostname", () => {
    const reads = planDeployStatusReads({
      owner: "acme",
      versions: [
        { hostname: "app", appVersionName: API, repository: "appdev" },
        { hostname: "worker", appVersionName: API },
      ],
    });
    expect(reads.map((read) => [read.repo, deployStatusKey(read)])).toEqual([
      ["appdev", `acme/app@${API}`],
      ["worker", `acme/worker@${API}`],
    ]);
  });
});

describe("the join — a declaration, a version and a status", () => {
  const projectNames = new Map([
    ["p-stage", "Acme CRM - stage"],
    ["p-prod", "Acme CRM - production"],
  ]);

  const assemble = (input: {
    readonly versions?: ReadonlyMap<string, string>;
    readonly statuses?: ReadonlyMap<string, ReadonlyArray<GiteaCommitStatus>>;
    readonly declarations?: ReadonlyArray<GroupEnvironment>;
  }) =>
    buildGroupEnvironmentRows({
      owner: "acme",
      declarations: input.declarations ?? [stage, production],
      projectNames,
      services,
      versions: input.versions ?? new Map(),
      statuses: input.statuses ?? new Map(),
    });

  it.each([
    {
      name: "nothing deployed anywhere",
      versions: new Map<string, string>(),
      statuses: new Map<string, ReadonlyArray<GiteaCommitStatus>>(),
      expected: [
        { name: "Acme CRM - stage", line: "main", commit: undefined, tone: "neutral" },
        { name: "Acme CRM - production", line: "release", commit: undefined, tone: "neutral" },
      ],
    },
    {
      name: "a commit and no Gitea session to grade it",
      versions: new Map([["s1", API]]),
      statuses: new Map<string, ReadonlyArray<GiteaCommitStatus>>(),
      expected: [
        { name: "Acme CRM - stage", line: "main · 3f9c1b2", commit: "3f9c1b2", tone: "neutral" },
        { name: "Acme CRM - production", line: "release", commit: undefined, tone: "neutral" },
      ],
    },
    {
      name: "a stage the broker deployed",
      versions: new Map([
        ["s1", API],
        ["s2", WEB],
      ]),
      statuses: new Map([
        [`acme/api@${API}`, [status("mate/deploy/stage/api", "success")]],
        [`acme/web@${WEB}`, [status("mate/deploy/stage/web", "success")]],
      ]),
      expected: [
        { name: "Acme CRM - stage", line: "main · 3f9c1b2", commit: "3f9c1b2", tone: "good" },
        { name: "Acme CRM - production", line: "release", commit: undefined, tone: "neutral" },
      ],
    },
    {
      name: "one service of a stage still going",
      versions: new Map([
        ["s1", API],
        ["s2", WEB],
      ]),
      statuses: new Map([
        [`acme/api@${API}`, [status("mate/deploy/stage/api", "success")]],
        [`acme/web@${WEB}`, [status("mate/deploy/stage/web", "pending")]],
      ]),
      expected: [
        { name: "Acme CRM - stage", line: "main · 3f9c1b2", commit: "3f9c1b2", tone: "pending" },
        { name: "Acme CRM - production", line: "release", commit: undefined, tone: "neutral" },
      ],
    },
    {
      name: "one service of a stage refused — the worst wins",
      versions: new Map([
        ["s1", API],
        ["s2", WEB],
      ]),
      statuses: new Map([
        [`acme/api@${API}`, [status("mate/deploy/stage/api", "success")]],
        [`acme/web@${WEB}`, [status("mate/deploy/stage/web", "failure")]],
      ]),
      expected: [
        { name: "Acme CRM - stage", line: "main · 3f9c1b2", commit: "3f9c1b2", tone: "bad" },
        { name: "Acme CRM - production", line: "release", commit: undefined, tone: "neutral" },
      ],
    },
    {
      name: "a production running a released commit",
      versions: new Map([["s3", `${API} v1.2.0 ada`]]),
      statuses: new Map([[`acme/api@${API}`, [status("mate/deploy/production/api", "success")]]]),
      expected: [
        { name: "Acme CRM - stage", line: "main", commit: undefined, tone: "neutral" },
        {
          name: "Acme CRM - production",
          line: "release · 3f9c1b2",
          commit: "3f9c1b2",
          tone: "good",
        },
      ],
    },
  ])("reads $name", ({ versions, statuses, expected }) => {
    expect(
      assemble({ versions, statuses }).map((row) => ({
        name: row.name,
        line: row.line,
        commit: row.commit,
        tone: row.tone,
      })),
    ).toEqual(expected);
  });

  it("does not take another environment's status for its own", () => {
    // The same commit of the same repository, graded for the stage only: the
    // production row must stay silent rather than borrow the verdict.
    const [, prod] = assemble({
      versions: new Map([
        ["s1", API],
        ["s3", API],
      ]),
      statuses: new Map([[`acme/api@${API}`, [status("mate/deploy/stage/api", "success")]]]),
    });
    expect(prod?.tone).toBe("neutral");
    expect(prod?.line).toBe("release · 3f9c1b2");
  });

  it("names an environment from the file when the project is out of reach", () => {
    const rows = buildGroupEnvironmentRowInputs({
      owner: "acme",
      declarations: [stage],
      projectNames: new Map(),
      services,
      versions: new Map(),
      statuses: new Map(),
    });
    expect(rows[0]?.name).toBe("stage");
  });

  it("keeps the file's order, leaving the group's own list to sort it", () => {
    const rows = assemble({
      declarations: [production, { ...stage, name: "stage-client-x", project: "p-stage" }, stage],
    });
    expect(rows.map((row) => row.tier)).toEqual(["production", "stage", "stage"]);
  });
});

describe("the word beside the dot", () => {
  it.each([
    { tone: "good", word: "Deployed" },
    { tone: "pending", word: "Deploying" },
    { tone: "bad", word: "Failed" },
    { tone: "neutral", word: undefined },
  ] as const)("says $word for $tone", ({ tone, word }) => {
    expect(deployWord(tone)).toBe(word);
  });
});

describe("what a release compares", () => {
  const snapshot = (
    versions: ReadonlyMap<string, string>,
    declarations: ReadonlyArray<GroupEnvironment> = [stage, production],
  ) =>
    buildGroupEnvironmentRowInputs({
      owner: "acme",
      declarations,
      projectNames: new Map(),
      services,
      versions,
      statuses: new Map(),
    });

  it("reads both sides from the sha in the deployed version's name", () => {
    const commits = releaseDeploys(
      snapshot(
        new Map([
          ["s1", `${API} v1.2.0 ada`],
          ["s2", WEB],
          ["s3", OLD],
        ]),
      ),
    );
    expect([...commits.stage]).toEqual([
      ["api", API],
      ["web", WEB],
    ]);
    expect([...commits.production]).toEqual([["api", OLD]]);
  });

  it("leaves out a service whose version somebody named by hand", () => {
    const commits = releaseDeploys(snapshot(new Map([["s1", "hotfix"]])));
    expect(commits.stage.size).toBe(0);
  });

  it("has nothing to compare for a group that has deployed nothing", () => {
    const commits = releaseDeploys(snapshot(new Map()));
    expect(commits.stage.size).toBe(0);
    expect(commits.production.size).toBe(0);
  });

  it("takes the first declared stage where two of them run the same service", () => {
    const commits = releaseDeploys(
      snapshot(
        new Map([
          ["s4", OLD],
          ["s1", API],
        ]),
        [{ ...stage, name: "stage-client-x", project: "p-mate" }, stage, production],
      ),
    );
    expect(commits.stage.get("api")).toBe(OLD);
  });
});

/**
 * A release lists what is merged (D28, `release.ts`) — never what a stage
 * happens to run — so every production service's repository is asked for its
 * default branch, stage or no stage.
 */
describe("what a release has to read", () => {
  const repositories = new Map([["api", "apidev"]]);

  it("asks for the repository of every service the production runs", () => {
    expect(planMainHeadReads({ declarations: [production], services, repositories })).toEqual([
      { hostname: "api", repo: "apidev" },
    ]);
  });

  it("asks under the hostname where the tier names no repository", () => {
    expect(
      planMainHeadReads({ declarations: [production], services, repositories: new Map() }),
    ).toEqual([{ hostname: "api", repo: "api" }]);
  });

  it("asks the same for a project that also has a stage", () => {
    expect(
      planMainHeadReads({ declarations: [stage, production], services, repositories }),
    ).toEqual([{ hostname: "api", repo: "apidev" }]);
  });

  it("asks for nothing where no production is declared", () => {
    expect(planMainHeadReads({ declarations: [], services, repositories })).toEqual([]);
  });
});
