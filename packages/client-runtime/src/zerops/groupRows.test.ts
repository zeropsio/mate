import { describe, expect, it } from "vite-plus/test";

import {
  environmentNameUnderGroup,
  deployedCommit,
  deployedVersion,
  deployTone,
  environmentRow,
  type EnvironmentServiceState,
} from "./groupRows.ts";
import type { HqDeploy } from "./hq/environments.ts";

const SHA = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";

function service(
  hostname: string,
  state: HqDeploy["state"] | undefined,
  options: { readonly version?: string | undefined } = {},
): EnvironmentServiceState {
  return {
    hostname,
    ...(options.version === undefined ? {} : { appVersionName: options.version }),
    ...(state === undefined ? {} : { deploy: { latest: deployRecord(state), live: null } }),
  };
}

function deployRecord(state: HqDeploy["state"], sha = SHA): HqDeploy {
  return {
    sha,
    state,
    failure: state === "failed" ? "job" : null,
    message: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: "2026-10-02T10:00:00.000Z",
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
    { name: "nothing deployed yet", states: [undefined], expected: "neutral" },
    { name: "a deploy HQ has yet to start", states: ["pending"], expected: "pending" },
    { name: "a deploy HQ runs", states: ["deploying"], expected: "pending" },
    { name: "a deploy that went live", states: ["live"], expected: "good" },
    { name: "a deploy that failed", states: ["failed"], expected: "bad" },
    {
      // Averaging a failure away is how a screen says "configured" for a
      // broken setup.
      name: "one service failing among three",
      states: ["live", "failed", undefined],
      expected: "bad",
    },
    { name: "one service still deploying", states: ["live", "deploying"], expected: "pending" },
    { name: "a failure behind one still going", states: ["deploying", "failed"], expected: "bad" },
  ] as const)("reads HQ's record of $name as $expected", ({ states, expected }) => {
    expect(deployTone(states.map((state, index) => service(`app${String(index)}`, state)))).toBe(
      expected,
    );
  });
});

describe("environmentRow", () => {
  const base = {
    projectId: "p-stage",
    name: "Acme - stage",
    tier: "stage" as const,
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
      services: [service("api", "live", { version: SHA })],
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
      services: [service("api", "failed", { version: SHA })],
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
      sources: "release",
      services: [service("api", "live", { version: `${SHA} v1.2.0 u-jan` })],
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
      services: [service("api", "live", { version: SHA })],
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
      services: [service("api", "live", { version: "hotfix" })],
    });
    expect(row.line).toBe("main · hotfix");
    expect(row.version.label).toBe("hotfix");
    expect(row.commit).toBeUndefined();
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
