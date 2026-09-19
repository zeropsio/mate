import { describe, expect, it } from "vite-plus/test";

import { groupHistory, historyLine } from "./groupHistory.ts";

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
        ["v1.2.0", SHA_A],
        ["v1.1.0", SHA_C],
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
