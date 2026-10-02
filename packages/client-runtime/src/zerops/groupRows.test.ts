import { describe, expect, it } from "vite-plus/test";

import {
  environmentNameUnderGroup,
  buildGroupRows,
  deployedCommit,
  deployedVersion,
  deployStatusContext,
  deployTone,
  environmentRow,
  firstDeployFailure,
  firstDeployOnHead,
  jobDuration,
  GROUP_BEING_SET_UP_LINE,
  mateRow,
  pullRequestRow,
  type EnvironmentServiceState,
  type MateRowState,
} from "./groupRows.ts";

const SHA = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
const OTHER = "77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8";

function service(
  hostname: string,
  state: "pending" | "success" | "failure" | undefined,
  options: { readonly environment?: string; readonly version?: string | undefined } = {},
): EnvironmentServiceState {
  return {
    hostname,
    ...(options.version === undefined ? {} : { appVersionName: options.version }),
    ...(state === undefined
      ? {}
      : {
          statuses: [
            { context: deployStatusContext(options.environment ?? "stage", hostname), state },
          ],
        }),
  };
}

describe("deployedCommit", () => {
  it.each([
    { name: "a stage version, named by its commit", value: SHA, expected: SHA },
    {
      name: "a production version, named by commit, tag and tagger",
      value: `${SHA} v1.2.0 u-jan`,
      expected: SHA,
    },
    { name: "an upper-case sha", value: SHA.toUpperCase(), expected: SHA },
    // Nothing of ours named it, so it does not name a commit.
    { name: "a hand-made version", value: "manual upload", expected: undefined },
    { name: "a bare short sha, which no writer names", value: "3f9c1b2", expected: undefined },
    {
      name: "a stage version, named by branch and short sha",
      value: "main 3f9c1b2",
      expected: "3f9c1b2",
    },
    {
      name: "a production version, named by tag and short sha",
      value: "v1.2.0 3f9c1b2",
      expected: "3f9c1b2",
    },
    { name: "a hand-made two-word version", value: "hotfix friday", expected: undefined },
    { name: "nothing deployed", value: undefined, expected: undefined },
  ])("reads $name", ({ value, expected }) => {
    expect(deployedCommit(value)).toBe(expected);
  });
});

describe("deployedVersion", () => {
  it.each([
    {
      name: "a release, which everybody calls by its tag",
      value: `${SHA} v1.2.0 u-jan`,
      expected: { name: "v1.2.0", commit: "3f9c1b2", sha: SHA, taggedBy: "u-jan", label: "v1.2.0" },
    },
    {
      name: "a stage deploy, which nobody named, so the commit is the answer",
      value: SHA,
      expected: {
        name: undefined,
        commit: "3f9c1b2",
        sha: SHA,
        taggedBy: undefined,
        label: "3f9c1b2",
      },
    },
    {
      name: "a release named by its tag and short sha",
      value: "v1.2.0 3f9c1b2",
      expected: {
        name: "v1.2.0",
        commit: "3f9c1b2",
        sha: "3f9c1b2",
        taggedBy: undefined,
        label: "v1.2.0",
      },
    },
    {
      // The row already says the branch a stage follows; the commit is what it adds.
      name: "a stage deploy named by its branch and short sha, called by the commit",
      value: "main 3f9c1b2",
      expected: {
        name: undefined,
        branch: "main",
        commit: "3f9c1b2",
        sha: "3f9c1b2",
        taggedBy: undefined,
        label: "3f9c1b2",
      },
    },
    {
      name: "a tag nobody signed",
      value: `${SHA} v1.2.0`,
      expected: {
        name: "v1.2.0",
        commit: "3f9c1b2",
        sha: SHA,
        taggedBy: undefined,
        label: "v1.2.0",
      },
    },
    {
      // Somebody typed this into `zcli`; it is still what is running, and it
      // is still the best name anyone has for it.
      name: "a hand-made deploy, whose name is the whole of it",
      value: "hotfix for the outage",
      expected: {
        name: "hotfix for the outage",
        commit: undefined,
        sha: undefined,
        taggedBy: undefined,
        label: "hotfix for the outage",
      },
    },
    {
      name: "nothing deployed",
      value: undefined,
      expected: {
        name: undefined,
        commit: undefined,
        sha: undefined,
        taggedBy: undefined,
        label: undefined,
      },
    },
    {
      name: "a blank name, which is nothing deployed by another route",
      value: "   ",
      expected: {
        name: undefined,
        commit: undefined,
        sha: undefined,
        taggedBy: undefined,
        label: undefined,
      },
    },
  ])("reads $name", ({ value, expected }) => {
    expect(deployedVersion(value)).toEqual(expected);
  });
});

describe("deployTone", () => {
  it.each([
    { name: "nothing deployed yet", services: [service("api", undefined)], expected: "neutral" },
    { name: "a deploy in flight", services: [service("api", "pending")], expected: "pending" },
    { name: "a deploy that landed", services: [service("api", "success")], expected: "good" },
    { name: "a deploy that failed", services: [service("api", "failure")], expected: "bad" },
    {
      // Averaging a failure away is how a screen says "configured" for a
      // broken setup.
      name: "one service failing among three",
      services: [service("api", "success"), service("web", "failure"), service("db", "success")],
      expected: "bad",
    },
    {
      name: "one service still going",
      services: [service("api", "success"), service("web", "pending")],
      expected: "pending",
    },
  ])("reads $name as $expected", ({ services, expected }) => {
    expect(deployTone({ environment: "stage", services })).toBe(expected);
  });

  it("ignores a status written for another environment", () => {
    const foreign: EnvironmentServiceState = {
      hostname: "api",
      statuses: [{ context: deployStatusContext("production", "api"), state: "failure" }],
    };
    expect(deployTone({ environment: "stage", services: [foreign] })).toBe("neutral");
  });
});

describe("environmentRow", () => {
  const base = {
    projectId: "p-stage",
    name: "Acme - stage",
    tier: "stage" as const,
    environment: "acme-stage",
  };

  it("names the service the platform names a split stop by — the first by hostname that runs", () => {
    // The platform's stop is its first running service by hostname (`stopDeploymentOf`); the row
    // compares its version with that one, so it names the same service whatever the order read.
    const web = "e1e2e3e4e5e6e7e8e9e0e1e2e3e4e5e6e7e8e9e0";
    const api = "a1a2a3a4a5a6a7a8a9a0a1a2a3a4a5a6a7a8a9a0";
    const row = environmentRow({
      ...base,
      sources: ["main"],
      services: [
        service("web", "success", { environment: base.environment, version: web }),
        service("cache", undefined),
        service("api", "success", { environment: base.environment, version: api }),
      ],
    });
    expect(row.version.sha).toBe(api);
  });

  it("names its source and nothing else before the first deploy", () => {
    const row = environmentRow({
      ...base,
      sources: ["main"],
      services: [service("api", undefined)],
    });
    expect(row.line).toBe("main");
    expect(row.commit).toBeUndefined();
    expect(row.tone).toBe("neutral");
  });

  it("names the commit it actually runs once something is deployed", () => {
    const row = environmentRow({
      ...base,
      sources: ["main"],
      services: [service("api", "success", { environment: "acme-stage", version: SHA })],
    });
    expect(row.line).toBe("main · 3f9c1b2");
    expect(row.tone).toBe("good");
  });

  it("stays on the commit it runs when the last deploy failed", () => {
    // The sha is the version's, not the branch head's: what is running is what
    // is running, whatever the failed attempt was for.
    const row = environmentRow({
      ...base,
      sources: ["main"],
      services: [service("api", "failure", { environment: "acme-stage", version: SHA })],
    });
    expect(row.line).toBe("main · 3f9c1b2");
    expect(row.tone).toBe("bad");
  });

  it("joins several sources, the way the broker merges them", () => {
    const row = environmentRow({
      ...base,
      sources: ["main", "feature/invoices"],
      services: [],
    });
    expect(row.line).toBe("main + feature/invoices");
  });

  it("says release for a production, not a branch", () => {
    const row = environmentRow({
      ...base,
      name: "Acme - production",
      tier: "production",
      environment: "production",
      sources: "release",
      services: [
        service("api", "success", { environment: "production", version: `${SHA} v1.2.0 u-jan` }),
      ],
    });
    // The tag, because that is what everyone calls this deploy; the sha is on
    // the row's `version` for whoever needs it.
    expect(row.line).toBe("release · v1.2.0");
    expect(row.version).toEqual({
      name: "v1.2.0",
      commit: "3f9c1b2",
      sha: SHA,
      taggedBy: "u-jan",
      label: "v1.2.0",
    });
    expect(row.commit).toBe("3f9c1b2");
  });

  it("falls back to the commit where nobody named the deploy", () => {
    const row = environmentRow({
      ...base,
      sources: ["main"],
      services: [service("api", "success", { environment: "acme-stage", version: SHA })],
    });
    expect(row.version.label).toBe("3f9c1b2");
    expect(row.version.name).toBeUndefined();
  });

  it("names a repository only where the recipe does, never the hostname", () => {
    // Reading by hostname answered 404 for every stage and production of the
    // owner's 2026-09-17 run (`DeployStatusRead.repo`), so guessing it here
    // would mint a link that goes nowhere — worse than plain text.
    const guessed = environmentRow({
      ...base,
      sources: ["main"],
      services: [{ hostname: "app", appVersionName: SHA }],
    });
    expect(guessed.versionRepository).toBeUndefined();

    const known = environmentRow({
      ...base,
      sources: ["main"],
      services: [{ hostname: "app", repository: "appdev", appVersionName: SHA }],
    });
    expect(known.versionRepository).toBe("appdev");
  });

  it("carries a hand-made deploy's name, which no sha would have told anyone", () => {
    const row = environmentRow({
      ...base,
      sources: ["main"],
      services: [service("api", "success", { environment: "acme-stage", version: "hotfix" })],
    });
    expect(row.line).toBe("main · hotfix");
    expect(row.version.label).toBe("hotfix");
    expect(row.commit).toBeUndefined();
  });
});

describe("mateRow", () => {
  const mate: MateRowState = {
    projectId: "p-fen",
    name: "Fen",
    visibility: "open",
    registration: "registered",
  };

  it("says nothing about a Mate you open — the face carries that", () => {
    expect(mateRow(mate)).toEqual({
      kind: "mate",
      projectId: "p-fen",
      name: "Fen",
      visibility: "open",
      line: "",
      tone: "neutral",
    });
  });

  it("says whose it is for a Mate you cannot open", () => {
    const row = mateRow({ ...mate, visibility: "listed", ownerName: "Jan Novák" });
    expect(row.line).toBe("Jan Novák's Mate — only Jan Novák opens it.");
    expect(row.tone).toBe("neutral");
  });

  it("says what a Mate waiting for an owner's registry write is missing", () => {
    const row = mateRow({ ...mate, registration: "awaiting-owner" }, [
      { id: "cu-1", user: { fullName: "Jan" } },
    ]);
    expect(row.line).toBe("Waiting for Jan to add it to the project — until then it cannot push.");
    expect(row.tone).toBe("pending");
  });

  it("says whose it is before it says anything about the registry", () => {
    // A row they cannot open is not the place to explain the registry.
    const row = mateRow({ ...mate, visibility: "listed", registration: "awaiting-owner" });
    expect(row.line).toBe("Only its owner opens this Mate.");
  });
});

describe("pullRequestRow", () => {
  it("names the change and who proposed it", () => {
    expect(
      pullRequestRow({
        number: 12,
        title: "Add a worker",
        state: "open",
        user: { login: "mate-p1" },
      }),
    ).toEqual({
      kind: "pull-request",
      number: 12,
      title: "Add a worker",
      line: "#12 · mate-p1",
      tone: "pending",
    });
  });

  it("names the change alone when Gitea did not say who", () => {
    expect(pullRequestRow({ number: 12, title: "Add a worker", state: "open" }).line).toBe("#12");
  });
});

describe("buildGroupRows", () => {
  const rows = buildGroupRows({
    groupId: "g-1",
    slug: "acme",
    gitea: "ready",
    mates: [
      { projectId: "p-fen", name: "Fen", visibility: "open", registration: "registered" },
      { projectId: "p-nova", name: "Nova", visibility: "listed", registration: "registered" },
    ],
    environments: [
      {
        projectId: "p-prod",
        name: "Acme - production",
        tier: "production",
        environment: "production",
        sources: "release",
        services: [service("api", "success", { environment: "production", version: SHA })],
      },
      {
        projectId: "p-stage",
        name: "Acme - stage",
        tier: "stage",
        environment: "acme-stage",
        sources: ["main"],
        services: [service("api", "success", { environment: "acme-stage", version: OTHER })],
      },
    ],
    pullRequests: [{ number: 12, title: "Add a worker", state: "open" }],
  });

  it("reads Mates, then where the code runs, then what is waiting to change", () => {
    expect(rows.rows.map((row) => row.kind)).toEqual([
      "mate",
      "mate",
      "environment",
      "environment",
      "pull-request",
    ]);
  });

  it("puts the stages before the production — the order code travels", () => {
    const environments = rows.rows.filter((row) => row.kind === "environment");
    expect(environments.map((row) => row.name)).toEqual(["Acme - stage", "Acme - production"]);
  });

  it("says nothing about a group whose Gitea is up", () => {
    expect(rows.line).toBe("");
  });

  it.each([
    { gitea: "being-set-up" as const, expected: GROUP_BEING_SET_UP_LINE },
    // Not asked yet: a line that appears and then disappears is the layout
    // shift this screen refuses.
    { gitea: "unknown" as const, expected: "" },
    { gitea: "ready" as const, expected: "" },
  ])("says $expected while its Gitea is $gitea", ({ gitea, expected }) => {
    const group = buildGroupRows({
      groupId: "g-1",
      slug: "acme",
      gitea,
      mates: [],
      environments: [],
      pullRequests: [],
    });
    expect(group.line).toBe(expected);
    expect(group.rows).toEqual([]);
  });
});

describe("environmentNameUnderGroup", () => {
  const cases: ReadonlyArray<[string | undefined, string, string]> = [
    // The prefix the heading already carries, in every separator a person types.
    ["Links", "Links - stage", "stage"],
    ["Links", "Links – stage", "stage"],
    ["Links", "Links-stage", "stage"],
    ["Links", "Links stage", "stage"],
    ["Links", "Links_stage", "stage"],
    ["Links", "Links / production", "production"],
    ["Links", "links - STAGE", "STAGE"],
    ["  Links  ", "Links - stage", "stage"],
    // A name that is the group's, or somebody else's, stays whole: there is
    // nothing left to say, or nothing of ours to drop.
    ["Links", "Links", "Links"],
    ["Links", "Links - ", "Links -"],
    ["Links", "Notes - stage", "Notes - stage"],
    ["Links", "My Links - stage", "My Links - stage"],
    // Nothing known about the group leaves the name exactly as Zerops has it.
    [undefined, "Links - stage", "Links - stage"],
    ["", "Links - stage", "Links - stage"],
    ["   ", "Links - stage", "Links - stage"],
  ];

  for (const [group, environment, expected] of cases) {
    it(`reads ${JSON.stringify(environment)} under ${JSON.stringify(group)} as ${JSON.stringify(expected)}`, () => {
      expect(environmentNameUnderGroup(group, environment)).toBe(expected);
    });
  }
});

describe("jobDuration", () => {
  // A fixed instant spelled out, so the test reaches no clock of its own.
  const at = (seconds: number) =>
    `1970-01-01T${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}Z`;

  it.each([
    [0, 4, "4s"],
    [0, 59, "59s"],
    [0, 92, "1m 32s"],
    [0, 3600, "1h 00m"],
    [0, 3864, "1h 04m"],
  ])("reads %i→%i as %s", (from, to, expected) => {
    expect(jobDuration(at(from), at(to))).toBe(expected);
  });

  it("says nothing for a step still going, having nothing to say yet", () => {
    expect(jobDuration(at(0), undefined)).toBeUndefined();
    expect(jobDuration(undefined, at(4))).toBeUndefined();
  });

  it("never reads a clock skew as a negative duration", () => {
    expect(jobDuration(at(10), at(4))).toBe("0s");
  });
});

describe("firstDeployOnHead — the one truth table for the head a stage deploys", () => {
  const HEAD = "9a8b7c6d5e4f30211203f4e5d6c7b8a9f0e1d2c3";
  const at = (minute: number) => `2026-10-02T22:${String(minute).padStart(2, "0")}:00Z`;
  const posted = (
    context: string,
    state: "pending" | "success" | "failure" | "error",
    minute: number | undefined,
    description?: string,
    id?: number,
  ) => ({
    context,
    state,
    ...(minute === undefined ? {} : { created_at: at(minute) }),
    ...(description === undefined ? {} : { description }),
    ...(id === undefined ? {} : { id }),
  });
  const BROKER = "mate/deploy/abacus-stage/app";
  const PUSH = "Zerops deploy / deploy (push)";
  const on = (statuses: ReadonlyArray<ReturnType<typeof posted>>) =>
    firstDeployOnHead({ environment: "abacus-stage", hostname: "app", statuses });

  it.each([
    {
      // Run 5: the push job's Test step failed; the dispatch, posting nothing, failed too.
      case: "3: the push job failed, the broker asked: failed, no reason, read on",
      statuses: [
        posted(PUSH, "failure", 12, "Failing after 9s"),
        posted(BROKER, "pending", 7, "dispatched"),
      ],
      verdict: { kind: "failed", reason: undefined, final: false },
    },
    {
      case: "3: the push job failed with no time posted: failed all the same",
      statuses: [posted(PUSH, "failure", undefined)],
      verdict: { kind: "failed", reason: undefined, final: false },
    },
    {
      case: "1: the broker's own job report: failed, final, and why",
      statuses: [posted(BROKER, "failure", 14, "failed: the build step exited with 1")],
      verdict: { kind: "failed", reason: "the build step exited with 1", final: true },
    },
    {
      case: "4: a refusal the broker retries: not failed",
      statuses: [posted(BROKER, "failure", 14, "has no workflow zerops.yml for the stage")],
      verdict: { kind: "open" },
    },
    {
      case: "4: a read the broker failed and retries: not failed",
      statuses: [posted(BROKER, "error", 14, "could not read the environments")],
      verdict: { kind: "open" },
    },
    {
      case: "2: the grant's deploying newer than a push failure: past Test, not failed",
      statuses: [posted(BROKER, "pending", 15, "deploying 9a8b7c6"), posted(PUSH, "failure", 12)],
      verdict: { kind: "granted" },
    },
    {
      case: "the broker deployed it: not failed, nothing more to read",
      statuses: [posted(BROKER, "success", 16, "deployed"), posted(PUSH, "failure", 12)],
      verdict: { kind: "deployed" },
    },
    {
      case: "a push failure, then a success of the same context: only the newest counts",
      statuses: [posted(PUSH, "success", 15), posted(PUSH, "failure", 12)],
      verdict: { kind: "open" },
    },
    {
      case: "listed out of order: the newest by time, not the first listed",
      statuses: [posted(PUSH, "failure", 12), posted(PUSH, "success", 15)],
      verdict: { kind: "open" },
    },
    {
      case: "listed out of order in one second: the newest by id",
      statuses: [
        posted(BROKER, "failure", 14, "failed: it broke", 7),
        posted(BROKER, "pending", 14, "deploying", 9),
      ],
      verdict: { kind: "granted" },
    },
    {
      case: "another environment's deploy failing: not this stage's",
      statuses: [posted("mate/deploy/abacus-production/app", "failure", 12, "failed: no")],
      verdict: { kind: "open" },
    },
    { case: "nothing posted yet", statuses: [], verdict: { kind: "open" } },
  ])("$case", ({ statuses, verdict }) => {
    expect(on(statuses as ReadonlyArray<ReturnType<typeof posted>>)).toEqual(verdict);
  });

  it("is carried on the stage's row as its failure, and only there", () => {
    const failing = [
      {
        hostname: "app",
        repository: "appdev",
        head: { sha: HEAD, statuses: [posted(PUSH, "failure", 12)] },
      },
    ];
    const row = (tier: "stage" | "production") =>
      environmentRow({
        projectId: "p-abacus-stage",
        name: "Abacus - stage",
        tier,
        sources: tier === "stage" ? ["main"] : "release",
        services: failing,
        environment: "abacus-stage",
      });
    expect(row("stage").firstDeployFailure).toEqual({ reason: undefined });
    expect(row("production").firstDeployFailure).toBeUndefined();
    expect(firstDeployFailure({ environment: "abacus-stage", services: failing })).toEqual({
      reason: undefined,
    });
  });
});
