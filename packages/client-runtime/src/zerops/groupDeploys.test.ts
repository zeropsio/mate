import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { STATUS_RECHECK_LADDER_MS, VERDICT_RECHECK_LADDER_MS } from "./forge/statusMemo.ts";
import type { GiteaCommitStatus } from "./giteaClient.ts";
import {
  buildGroupEnvironmentRowInputs,
  buildGroupEnvironmentRows,
  deployStatusKey,
  deployWord,
  planDeployStatusReads,
  planDeployedVersionReads,
  firstDeployHeadLadder,
  firstDeployHeadSettled,
  planFirstDeployHeadReads,
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
    {
      // Gitea's `commits/{ref}/statuses` resolves a sha of seven or more characters itself.
      name: "versions named by branch or tag and a short sha, asked about by it",
      versions: [
        { hostname: "api", appVersionName: "main 3f9c1b2" },
        { hostname: "web", appVersionName: "v1.2.0 77ab0e1" },
      ],
      expected: ["acme/api@3f9c1b2", "acme/web@77ab0e1"],
    },
    {
      name: "a push of a dirty working tree, which is no commit",
      versions: [{ hostname: "api", appVersionName: "main 3f9c1b2-dirty" }],
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
      name: "a stage the broker deployed under short names",
      versions: new Map([
        ["s1", "main 3f9c1b2"],
        ["s2", "main 77ab0e1"],
      ]),
      statuses: new Map([
        ["acme/api@3f9c1b2", [status("mate/deploy/stage/api", "success")]],
        ["acme/web@77ab0e1", [status("mate/deploy/stage/web", "success")]],
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
          // The tag, not the sha: `v1.2.0` is what everybody calls this deploy.
          name: "Acme CRM - production",
          line: "release · v1.2.0",
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
    { tone: "pending", word: "Deploying…" },
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

  // The broker deploys a production service only from the repository its tier
  // names, so a release that listed any other one would list a commit that is
  // never deployed — and the app held Release as in flight for 30 minutes
  // waiting for it (2026-09-26: a stray `mailpit` service matched a repository
  // of the same name, and `v0.1.31` sat at "Releasing").
  it.each([
    ["the tier names no repository at all", new Map<string, string>()],
    ["the tier names one for another service", new Map([["web", "webdev"]])],
  ])("asks for nothing where %s", (_, tierRepositories) => {
    expect(
      planMainHeadReads({ declarations: [production], services, repositories: tierRepositories }),
    ).toEqual([]);
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

describe("what a stage's first deploy has to read", () => {
  const repositories = new Map([
    ["api", "apidev"],
    ["web", "webdev"],
  ]);
  const NOTHING = new Map<string, string>();
  it.each([
    {
      case: "a declared stage that runs nothing: each service's repository's main",
      declarations: [stage, production],
      versions: NOTHING,
      reads: ["p-stage stage api@apidev", "p-stage stage web@webdev"],
    },
    {
      case: "the stage runs a deploy: nothing",
      declarations: [stage, production],
      versions: new Map([["s1", `main ${API.slice(0, 7)}`]]),
      reads: [],
    },
    {
      case: "the import's no-code version, which names no commit: still its first deploy",
      declarations: [stage],
      versions: new Map([["s1", ""]]),
      reads: ["p-stage stage api@apidev", "p-stage stage web@webdev"],
    },
    {
      case: "no stage declared: nothing",
      declarations: [production],
      versions: NOTHING,
      reads: [],
    },
    { case: "nothing declared: nothing", declarations: [], versions: NOTHING, reads: [] },
  ])("$case", ({ declarations, versions, reads }) => {
    expect(
      planFirstDeployHeadReads({ declarations, services, versions, repositories }).map(
        (read) => `${read.projectId} ${read.environment} ${read.hostname}@${read.repo}`,
      ),
    ).toEqual(reads);
  });

  it("asks nothing of a service the tiers build from no repository of the group", () => {
    expect(
      planFirstDeployHeadReads({
        declarations: [stage],
        services,
        versions: NOTHING,
        repositories: new Map(),
      }),
    ).toEqual([]);
  });
});

describe("how often a first deploy's head is read again", () => {
  const NOW = Date.parse("2026-10-02T22:30:00Z");
  const head = (minutesAgo: number | undefined) => ({
    sha: API,
    statuses: [
      {
        context: "mate/deploy/stage/api",
        state: "pending" as const,
        ...(minutesAgo === undefined
          ? {}
          : { created_at: DateTime.formatIso(DateTime.makeUnsafe(NOW - minutesAgo * 60_000)) }),
      },
    ],
  });
  const madeAgo = (minutes: number) =>
    DateTime.formatIso(DateTime.makeUnsafe(NOW - minutes * 60_000));
  it.each([
    {
      case: "a head not read before",
      previous: undefined,
      sha: API,
      asked: undefined,
      ladder: "busy",
    },
    {
      case: "a new head on main",
      previous: head(60),
      sha: WEB,
      asked: madeAgo(60),
      ladder: "busy",
    },
    {
      case: "a head whose job posted a minute ago",
      previous: head(1),
      sha: API,
      asked: undefined,
      ladder: "busy",
    },
    {
      // H1: the push job failed long before; the stage made a moment ago asks for its deploy now.
      case: "an old head, the stage just made",
      previous: head(50),
      sha: API,
      asked: madeAgo(1),
      ladder: "busy",
    },
    {
      case: "a head quiet past the window",
      previous: head(15),
      sha: API,
      asked: undefined,
      ladder: "quiet",
    },
    {
      case: "a head quiet past the broker's patience: no more reads",
      previous: head(35),
      sha: API,
      asked: madeAgo(40),
      ladder: "resting",
    },
    {
      case: "a head that says not when, its ask unknown: no more reads",
      previous: head(undefined),
      sha: API,
      asked: undefined,
      ladder: "resting",
    },
  ])("$case", ({ previous, sha, asked, ladder }) => {
    expect(firstDeployHeadLadder(previous, sha, asked, NOW)).toBe(
      ladder === "busy"
        ? STATUS_RECHECK_LADDER_MS
        : ladder === "quiet"
          ? VERDICT_RECHECK_LADDER_MS
          : undefined,
    );
  });

  it.each([
    { case: "still pending", statuses: [status("mate/deploy/stage/api", "pending")], done: false },
    {
      // Rule 3: a dispatch that gets past its steps after a push failure turns it.
      case: "the push job failed: read on",
      statuses: [
        { context: "Zerops deploy / deploy (push)", state: "failure" as const },
        status("mate/deploy/stage/api", "pending"),
      ],
      done: false,
    },
    {
      case: "the push job failed and nothing else is posted: read on",
      statuses: [{ context: "Zerops deploy / deploy (push)", state: "failure" as const }],
      done: false,
    },
    {
      case: "the broker's own job report: final",
      statuses: [
        { context: "mate/deploy/stage/api", state: "failure" as const, description: "failed: x" },
      ],
      done: true,
    },
    {
      // H2: the broker retries a refusal; its retry must be read.
      case: "a refusal the broker retries: read on",
      statuses: [
        {
          context: "mate/deploy/stage/api",
          state: "failure" as const,
          description: "has no workflow zerops.yml",
        },
      ],
      done: false,
    },
    { case: "deployed", statuses: [status("mate/deploy/stage/api", "success")], done: true },
    { case: "nothing posted yet", statuses: [], done: false },
  ])("is settled where $case", ({ statuses, done }) => {
    expect(firstDeployHeadSettled({ environment: "stage", hostname: "api" }, statuses)).toBe(done);
  });
});
