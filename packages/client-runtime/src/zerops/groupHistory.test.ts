import { describe, expect, it } from "vite-plus/test";

import { groupHistory, historyAge, historyLine, releaseTagsByCommit } from "./groupHistory.ts";

const SHA_A = "3f9c1b2a4d5e6f70819293a4b5c6d7e8f9012345";
const SHA_B = "aa11bb22cc33dd44ee55ff6677889900aabbccdd";
const SHA_C = "ffeeddccbbaa99887766554433221100ffeeddcc";

const commit = (sha: string, subject: string, extra: Record<string, unknown> = {}) => ({
  sha,
  subject,
  ...extra,
});

describe("a group's history", () => {
  it("keeps every commit on the branch, annotated or not", () => {
    const history = groupHistory({
      commits: [commit(SHA_A, "Add a footer"), commit(SHA_B, "Rename the heading")],
      deployed: new Map([["production", SHA_A]]),
      tags: new Map(),
    });
    expect(history.map((entry) => entry.subject)).toEqual(["Add a footer", "Rename the heading"]);
    // The history is the branch's, not the deployments': a commit nobody
    // deployed is still something that happened.
    expect(history[1]?.deployedTo).toEqual([]);
  });

  it("folds every environment running a commit onto it, in the order given", () => {
    const history = groupHistory({
      commits: [commit(SHA_A, "Add a footer")],
      deployed: new Map([
        ["stage", SHA_A],
        ["production", SHA_A],
      ]),
      tags: new Map(),
    });
    // The file's order, which is stage before production.
    expect(history[0]?.deployedTo).toEqual(["stage", "production"]);
  });

  it("names the release a commit shipped under", () => {
    const history = groupHistory({
      commits: [commit(SHA_A, "Add a footer"), commit(SHA_B, "Rename the heading")],
      deployed: new Map(),
      tags: new Map([
        [SHA_A, "v1.2.0"],
        [SHA_C, "v1.1.0"],
      ]),
    });
    expect(history[0]?.tags).toEqual(["v1.2.0"]);
    // A tag on a commit this branch does not carry annotates nothing.
    expect(history[1]?.tags).toEqual([]);
  });

  it("matches on the whole sha, never a prefix of one", () => {
    const history = groupHistory({
      commits: [commit(SHA_A, "Add a footer")],
      // What a person typed into a hand-made deploy, and a short sha: neither
      // is a commit the branch can be said to be running.
      deployed: new Map([
        ["stage", SHA_A.slice(0, 7)],
        ["production", "hotfix-cache-headers"],
      ]),
      tags: new Map(),
    });
    expect(history[0]?.deployedTo).toEqual([]);
  });

  it("reads the commit down to the seven characters a person uses", () => {
    const [entry] = groupHistory({
      commits: [commit(SHA_A, "Add a footer")],
      deployed: new Map(),
      tags: new Map(),
    });
    expect(entry?.shortSha).toBe(SHA_A.slice(0, 7));
  });

  describe("the line under the subject", () => {
    const base = {
      sha: SHA_A,
      shortSha: "3f9c1b2",
      subject: "Add a footer",
      at: undefined,
      tags: [],
    };

    it("says who wrote it and where it is running", () => {
      expect(historyLine({ ...base, author: "mate-links-dev", deployedTo: ["production"] })).toBe(
        "mate-links-dev · production",
      );
    });

    it("says nothing rather than moving the rows below it for an empty line", () => {
      expect(historyLine({ ...base, author: undefined, deployedTo: [] })).toBeUndefined();
    });
  });
});

describe("the release a commit shipped in", () => {
  const tag = (name: string, message: string | undefined) => ({ name, message });

  it("matches on the sha in the message, not on what the tag points at", () => {
    // The tag lives on the group repository; the shas in it are the services'.
    const byCommit = releaseTagsByCommit([
      tag("v1.2.0", `app ${SHA_A}\nweb ${SHA_B}`),
      tag("v1.1.0", `app ${SHA_C}`),
    ]);
    expect(byCommit.get(SHA_A)).toBe("v1.2.0");
    expect(byCommit.get(SHA_B)).toBe("v1.2.0");
    expect(byCommit.get(SHA_C)).toBe("v1.1.0");
  });

  it("names the release that first shipped a commit, not the last that still ran it", () => {
    // A commit stays listed by every release made while it is still deployed.
    const byCommit = releaseTagsByCommit([
      tag("v1.3.0", `app ${SHA_A}`),
      tag("v1.1.0", `app ${SHA_A}`),
      tag("v1.2.0", `app ${SHA_A}`),
    ]);
    expect(byCommit.get(SHA_A)).toBe("v1.1.0");
  });

  it("ignores a tag that is not one of ours, and a message it cannot read", () => {
    const byCommit = releaseTagsByCommit([
      tag("nightly", `app ${SHA_A}`),
      tag("v2.0.0", "deployed everything, finally"),
      tag("v2.0.1", `app ${SHA_B.slice(0, 7)}`),
    ]);
    expect(byCommit.size).toBe(0);
  });

  it("folds onto the history as the name a commit went live under", () => {
    const tags = releaseTagsByCommit([tag("v1.2.0", `app ${SHA_A}`)]);
    const [first, second] = groupHistory({
      commits: [
        { sha: SHA_A, subject: "Add a footer" },
        { sha: SHA_B, subject: "Rename the heading" },
      ],
      deployed: new Map(),
      tags,
    });
    expect(first?.tags).toEqual(["v1.2.0"]);
    expect(second?.tags).toEqual([]);
  });
});

describe("historyAge", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");

  it.each([
    ["2026-09-19T11:59:40Z", "now"],
    ["2026-09-19T11:57:00Z", "3m"],
    ["2026-09-19T08:00:00Z", "4h"],
    ["2026-09-13T12:00:00Z", "6d"],
    ["2026-07-19T12:00:00Z", "2mo"],
    ["2025-07-19T12:00:00Z", "1y"],
  ])("reads %s as %s", (at, expected) => {
    expect(historyAge(at, now)).toBe(expected);
  });

  it("says nothing where Gitea sent no date, rather than an epoch", () => {
    expect(historyAge(undefined, now)).toBeUndefined();
    expect(historyAge("not a date", now)).toBeUndefined();
  });

  it("reads a committer's skewed future clock as now, never as a negative", () => {
    expect(historyAge("2026-09-19T12:30:00Z", now)).toBe("now");
  });
});

describe("historyLine with a clock", () => {
  const entry = {
    sha: "a".repeat(40),
    shortSha: "aaaaaaa",
    subject: "Cache the link previews",
    author: "Theo",
    at: "2026-09-19T08:00:00Z",
    deployedTo: ["production"],
    tags: [],
  };
  const now = Date.parse("2026-09-19T12:00:00Z");

  it("puts the age last, after who wrote it and where it runs", () => {
    expect(historyLine(entry, now)).toBe("Theo · production · 4h");
  });

  it("leaves the age out when no clock is given, so the line stays pure", () => {
    expect(historyLine(entry)).toBe("Theo · production");
  });

  it("still answers with the age alone when nothing else is known", () => {
    expect(historyLine({ ...entry, author: undefined, deployedTo: [] }, now)).toBe("4h");
  });
});
