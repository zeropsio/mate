import { describe, expect, it } from "vite-plus/test";

import {
  environmentNameUnderGroup,
  buildGroupRows,
  deployedCommit,
  deployedVersion,
  deployStatusContext,
  deployTone,
  environmentRow,
  jobDuration,
  stopSourceLine,
  GROUP_BEING_SET_UP_LINE,
  mateRow,
  missingEnvironmentRows,
  MISSING_ENVIRONMENT_LINE,
  pullRequestRow,
  shortCommit,
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
    { name: "a short sha, which never compares equal", value: "3f9c1b2", expected: undefined },
    { name: "nothing deployed", value: undefined, expected: undefined },
  ])("reads $name", ({ value, expected }) => {
    expect(deployedCommit(value)).toBe(expected);
  });

  it("shortens a commit to the seven characters people read it by", () => {
    expect(shortCommit(SHA)).toBe("3f9c1b2");
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

describe("missingEnvironmentRows", () => {
  // The owner, twice on 2026-09-17: "it never asked me to setup production".
  const cases = [
    {
      name: "asks for both once the recipe offers both and the group has neither",
      tiersOnMain: ["stage", "production"],
      declared: [],
      want: ["Stage", "Production"],
    },
    {
      name: "asks only for what is missing",
      tiersOnMain: ["stage", "production"],
      declared: ["stage"],
      want: ["Production"],
    },
    {
      name: "asks for nothing before the recipe is on main",
      tiersOnMain: [],
      declared: [],
      want: [],
    },
    {
      name: "asks for nothing the recipe does not offer",
      tiersOnMain: ["stage"],
      declared: [],
      want: ["Stage"],
    },
    {
      name: "stage before production, whatever the order on main",
      tiersOnMain: ["production", "stage"],
      declared: [],
      want: ["Stage", "Production"],
    },
  ] as const;

  for (const tc of cases) {
    it(tc.name, () => {
      const rows = missingEnvironmentRows({
        tiersOnMain: tc.tiersOnMain,
        declarations: tc.declared.map((tier) => ({ tier })),
      });
      expect(rows.map((row) => row.name)).toEqual(tc.want);
      for (const row of rows) {
        expect(row.kind).toBe("missing-environment");
        expect(row.line).toBe(MISSING_ENVIRONMENT_LINE);
      }
    });
  }
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

describe("stopSourceLine", () => {
  it.each([
    ["release", "A release — it moves only when somebody tags one"],
    ["main", "Every merge to main"],
    ["main + develop", "Every merge to main + develop"],
    ["—", "Nothing yet"],
    ["", "Nothing yet"],
  ])("reads %s as a sentence, not a keyword", (source, expected) => {
    expect(stopSourceLine(source)).toBe(expected);
  });
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
