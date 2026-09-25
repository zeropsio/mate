import { describe, expect, it } from "vite-plus/test";

import type { GiteaCommit } from "./giteaClient.ts";
import type { ReleaseEntry, ReleaseVerdict } from "./release.ts";
import {
  releaseCarried,
  releaseCarriedToggleLabel,
  releaseDescription,
  releasesCarried,
  type ReleaseServiceChange,
} from "./releaseCarried.ts";

const sha = (char: string) => char.repeat(40);

/** A repository's default branch, newest first: `f` is the head, `a` the oldest read. */
const BRANCH: ReadonlyArray<GiteaCommit> = ["f", "e", "d", "c", "b", "a"].map((char) => ({
  sha: sha(char),
  subject: `Commit ${char}`,
}));
const OTHER: ReadonlyArray<GiteaCommit> = ["9", "8", "7"].map((char) => ({
  sha: sha(char),
  subject: `Other ${char}`,
}));

const entries = (...pairs: ReadonlyArray<readonly [string, string]>): ReadonlyArray<ReleaseEntry> =>
  pairs.map(([service, commit]) => ({ service, commit }));

const SINGLE_REPO = new Map([
  ["app", "group"],
  ["worker", "group"],
]);
const SPLIT = new Map([
  ["api", "api"],
  ["web", "web"],
]);
const COMMITS = new Map([
  ["group", BRANCH],
  ["api", BRANCH],
  ["web", OTHER],
]);

const carried = (
  release: ReadonlyArray<ReleaseEntry>,
  older: ReadonlyArray<ReadonlyArray<ReleaseEntry>>,
  repositoryOf: ReadonlyMap<string, string>,
  commits: ReadonlyMap<string, ReadonlyArray<GiteaCommit>> = COMMITS,
) =>
  releaseCarried({ entries: release, older, repositoryOf, commits }).map((change) => ({
    service: change.service,
    repository: change.repository,
    commits: change.commits.map((commit) => commit.sha[0]),
  }));

describe("what a release carried", () => {
  it.each([
    [
      "a single repository's services at one sha are one change, named by the first",
      entries(["app", sha("e")], ["worker", sha("e")]),
      [entries(["app", sha("c")], ["worker", sha("c")])],
      SINGLE_REPO,
      COMMITS,
      [{ service: "app", repository: "group", commits: ["e", "d"] }],
    ],
    [
      "a service added to a single repository's group is measured by its repository's older sha",
      entries(["worker", sha("e")], ["app", sha("e")]),
      [entries(["app", sha("e")])],
      SINGLE_REPO,
      COMMITS,
      [],
    ],
    [
      "a service added after an unmoved one is measured the same way",
      entries(["app", sha("e")], ["worker", sha("e")]),
      [entries(["app", sha("e")])],
      SINGLE_REPO,
      COMMITS,
      [],
    ],
    [
      "a split group where one service moved is that service's change alone",
      entries(["api", sha("f")], ["web", sha("9")]),
      [entries(["api", sha("d")], ["web", sha("9")])],
      SPLIT,
      COMMITS,
      [{ service: "api", repository: "api", commits: ["f", "e"] }],
    ],
    [
      "a split group where both moved is two changes, in entry order",
      entries(["api", sha("f")], ["web", sha("9")]),
      [entries(["api", sha("e")], ["web", sha("7")])],
      SPLIT,
      COMMITS,
      [
        { service: "api", repository: "api", commits: ["f"] },
        { service: "web", repository: "web", commits: ["9", "8"] },
      ],
    ],
    [
      "a service at the same sha as before carried nothing",
      entries(["api", sha("e")]),
      [entries(["api", sha("e")])],
      SPLIT,
      COMMITS,
      [],
    ],
    [
      "a head outside what was read says nothing rather than guess",
      entries(["api", sha("0")]),
      [entries(["api", sha("e")])],
      SPLIT,
      COMMITS,
      [],
    ],
    [
      "an older sha outside what was read carries everything to the end of the read",
      entries(["api", sha("c")]),
      [entries(["api", sha("0")])],
      SPLIT,
      COMMITS,
      [{ service: "api", repository: "api", commits: ["c", "b", "a"] }],
    ],
    [
      "the oldest release carries everything up to its sha",
      entries(["api", sha("b")]),
      [],
      SPLIT,
      COMMITS,
      [{ service: "api", repository: "api", commits: ["b", "a"] }],
    ],
    [
      "a roll back to an older sha carried nothing new",
      entries(["api", sha("c")]),
      [entries(["api", sha("e")])],
      SPLIT,
      COMMITS,
      [],
    ],
    [
      "an uppercase sha in the branch still matches",
      entries(["api", sha("e")]),
      [entries(["api", sha("c")])],
      SPLIT,
      new Map([["api", BRANCH.map((commit) => ({ ...commit, sha: commit.sha.toUpperCase() }))]]),
      [{ service: "api", repository: "api", commits: ["E", "D"] }],
    ],
    [
      "a service with no repository, or a repository not read, is left out",
      entries(["api", sha("e")], ["cache", sha("1")], ["web", sha("9")]),
      [entries(["api", sha("c")], ["web", sha("7")])],
      SPLIT,
      new Map([["api", BRANCH]]),
      [{ service: "api", repository: "api", commits: ["e", "d"] }],
    ],
  ] as const)("%s", (_case, release, older, repositoryOf, commits, expected) => {
    expect(carried(release, older, repositoryOf, commits)).toEqual(expected);
  });
});

describe("what every release carried", () => {
  it.each([
    ["the newest, against the one before it", "v1.5.0", ["f"]],
    ["one in the middle, against the one before it", "v1.3.0", ["d"]],
    ["the last shown, against the one past the list's end", "v1.1.0", ["b"]],
    ["the oldest, to the end of what was read", "v1.0.0", ["a"]],
  ] as const)("pairs %s", (_case, tag, expected) => {
    const releases = ["f", "e", "d", "c", "b", "a"].map((char, index) => ({
      tag: `v1.${String(5 - index)}.0`,
      verdict: "approved" as const,
      entries: entries(["api", sha(char)]),
    }));
    const byTag = releasesCarried({ releases, repositoryOf: SPLIT, commits: COMMITS });
    expect(byTag.size).toBe(releases.length);
    expect(
      byTag.get(tag)?.flatMap((change) => change.commits.map((commit) => commit.sha[0])),
    ).toEqual(expected);
  });

  const listed = (tag: string, verdict: ReleaseVerdict, ...pairs: Array<[string, string]>) => ({
    tag,
    verdict,
    entries: entries(...pairs),
  });

  it.each([
    [
      "a release whose tag could not be read is passed over",
      [
        listed("v5", "approved", ["api", sha("f")]),
        listed("v4", "approved"),
        listed("v3", "approved", ["api", sha("c")]),
      ],
      ["f", "e", "d"],
    ],
    [
      "a refused release, which never deployed",
      [
        listed("v5", "approved", ["api", sha("f")]),
        listed("v4", "refused", ["api", sha("e")]),
        listed("v3", "approved", ["api", sha("c")]),
      ],
      ["f", "e", "d"],
    ],
  ] as const)("measures the newest past %s", (_case, releases, expected) => {
    const byTag = releasesCarried({ releases, repositoryOf: SPLIT, commits: COMMITS });
    expect(
      byTag.get("v5")?.flatMap((change) => change.commits.map((commit) => commit.sha[0])),
    ).toEqual(expected);
  });
});

describe("the line a release says it carried", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");
  const LINE = "titan 1bcc930";
  const MATE = "mate-PXGYIVK9RLWlE3eTL3QwoW";
  const names = { mateNames: new Map([["PXGYIVK9RLWlE3eTL3QwoW", "Theo"]]) };
  const change = (
    service: string,
    subjects: ReadonlyArray<string>,
    head: Partial<GiteaCommit> = {},
  ): ReleaseServiceChange => ({
    service,
    repository: service,
    commits: subjects.map((subject, index) => ({
      sha: sha(String(index)),
      subject,
      ...(index === 0 ? { author: "ales", at: "2026-09-19T08:00:00Z", ...head } : {}),
    })),
  });

  it.each([
    [
      "one commit says its subject and nothing more",
      [change("titan", ["v0.23.0: the void (#32)"])],
      undefined,
      { primary: "v0.23.0: the void (#32)", secondary: `ales · 4h · ${LINE}` },
    ],
    [
      "several commits say how many more",
      [change("nextstore", ["Fix the cart", "b", "c", "d"])],
      undefined,
      { primary: "Fix the cart, +3 more", secondary: `ales · 4h · ${LINE}` },
    ],
    [
      "two services moved name the one it leads with",
      [change("api", ["Fix the cart", "b"]), change("web", ["Restyle", "c"])],
      undefined,
      { primary: "api: Fix the cart, +3 more", secondary: `ales · 4h · ${LINE}` },
    ],
    [
      "a Mate's commit is the Mate's, never its login",
      [change("titan", ["Deploy the link keeper"], { author: MATE })],
      names,
      { primary: "Deploy the link keeper", secondary: `Theo · 4h · ${LINE}` },
    ],
    [
      "no author and no date leave the shas alone",
      [change("titan", ["Deploy"], { author: undefined, at: undefined })],
      undefined,
      { primary: "Deploy", secondary: LINE },
    ],
    ["nothing carried says nothing", [], undefined, undefined],
  ] as const)("%s", (_case, changes, withNames, expected) => {
    expect(releaseDescription(changes, LINE, now, withNames)).toEqual(expected);
  });
});

describe("what a release row's chevron does, for a screen reader", () => {
  it.each([
    [false, "Show what v0.1.27 carried"],
    [true, "Hide what v0.1.27 carried"],
  ] as const)("open %s reads %s", (open, expected) => {
    expect(releaseCarriedToggleLabel("v0.1.27", open)).toBe(expected);
  });
});
