import { describe, expect, it } from "vite-plus/test";

import {
  groupHistory,
  historyAge,
  historyLine,
  historyEarlier,
  historyNote,
  releaseTagsByCommit,
} from "./groupHistory.ts";

const SHA_A = "3f9c1b2a4d5e6f70819293a4b5c6d7e8f9012345";
const SHA_B = "aa11bb22cc33dd44ee55ff6677889900aabbccdd";
const SHA_C = "ffeeddccbbaa99887766554433221100ffeeddcc";

/** A commit as HQ's comparison lists it: none of HQ's changes landed it. */
const commit = (sha: string, subject: string) => ({
  sha,
  subject,
  authorName: "ada",
  at: "2026-09-19T08:00:00Z",
  change: null,
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
        [SHA_A, ["v1.2.0"]],
        [SHA_C, ["v1.1.0"]],
      ]),
    });
    expect(history[0]?.tags).toEqual(["v1.2.0"]);
    // A tag on a commit this branch does not carry annotates nothing.
    expect(history[1]?.tags).toEqual([]);
  });

  it.each([
    // Since 2026-09-30 a version's name spells its commit short.
    { name: "the short sha a version name spells", runs: SHA_A.slice(0, 7), expected: ["stage"] },
    { name: "the whole sha an older name spells", runs: SHA_A, expected: ["stage"] },
    { name: "a short sha another commit begins", runs: SHA_B.slice(0, 7), expected: [] },
    { name: "a prefix shorter than seven", runs: SHA_A.slice(0, 6), expected: [] },
    { name: "a dirty working tree's token", runs: `${SHA_A.slice(0, 7)}-dirty`, expected: [] },
    {
      name: "what a person typed into a hand-made deploy",
      runs: "hotfix-cache-headers",
      expected: [],
    },
  ])("places a stage running $name", ({ runs, expected }) => {
    const history = groupHistory({
      commits: [commit(SHA_A, "Add a footer"), commit(SHA_B, "Rename the heading")],
      deployed: new Map([["stage", runs]]),
      tags: new Map(),
    });
    expect(history[0]?.deployedTo).toEqual(expected);
  });

  it("places a short sha two of the branch's commits begin on neither", () => {
    const twin = `${SHA_A.slice(0, 7)}${"0".repeat(33)}`;
    const history = groupHistory({
      commits: [commit(SHA_A, "Add a footer"), commit(twin, "Rename the heading")],
      deployed: new Map([["stage", SHA_A.slice(0, 7)]]),
      tags: new Map(),
    });
    expect(history.map((entry) => entry.deployedTo)).toEqual([[], []]);
  });

  it("reads the commit down to the seven characters a person uses", () => {
    const [entry] = groupHistory({
      commits: [commit(SHA_A, "Add a footer")],
      deployed: new Map(),
      tags: new Map(),
    });
    expect(entry?.shortSha).toBe(SHA_A.slice(0, 7));
  });

  it("carries the change HQ landed it with, and none for a commit no change landed", () => {
    const landed = { number: 7, title: "Add a footer", mateProjectId: "p-wren" };
    const [first, second] = groupHistory({
      commits: [{ ...commit(SHA_A, "Add a footer"), change: landed }, commit(SHA_B, "Rename")],
      deployed: new Map(),
      tags: new Map(),
    });
    expect(first?.change).toEqual(landed);
    expect(second?.change).toBeNull();
  });

  describe("the line under the subject", () => {
    const base = {
      sha: SHA_A,
      shortSha: "3f9c1b2",
      subject: "Add a footer",
      at: undefined,
      tags: [],
      change: null,
    };

    it("says who wrote it and where it is running", () => {
      expect(historyLine({ ...base, author: "ada", deployedTo: ["production"] })).toBe(
        "ada · production",
      );
    });

    it("says nothing rather than moving the rows below it for an empty line", () => {
      expect(historyLine({ ...base, author: undefined, deployedTo: [] })).toBeUndefined();
    });
  });
});

describe("the release a commit shipped in", () => {
  /** A release HQ records, listing `entries` (`{service: sha}`). */
  const release = (
    tag: string,
    entries: Record<string, string>,
    verdict: "approved" | "refused" = "approved",
  ) => ({
    tag,
    verdict,
    entries: Object.entries(entries).map(([service, commit]) => ({ service, commit })),
  });

  it("matches on the commits a release lists, whatever repository each is", () => {
    const byCommit = releaseTagsByCommit([
      release("v1.2.0", { app: SHA_A, web: SHA_B }),
      release("v1.1.0", { app: SHA_C }),
    ]);
    expect(byCommit.get(SHA_A)).toEqual(["v1.2.0"]);
    expect(byCommit.get(SHA_B)).toEqual(["v1.2.0"]);
    expect(byCommit.get(SHA_C)).toEqual(["v1.1.0"]);
  });

  it("names the release that first shipped a commit, not the last that still ran it", () => {
    // A commit stays listed by every release made while it is still deployed.
    const byCommit = releaseTagsByCommit([
      release("v1.3.0", { app: SHA_A }),
      release("v1.1.0", { app: SHA_A }),
      release("v1.2.0", { app: SHA_A }),
    ]);
    expect(byCommit.get(SHA_A)).toEqual(["v1.1.0"]);
  });

  // e2e 2026-10-03: after B rolled back to v0.1.0, History named 30f75f9 v0.1.0 alone, though
  // v0.1.2 brought it back.
  it("names a roll back on the commits it brought back too", () => {
    const byCommit = releaseTagsByCommit([
      release("v0.1.2", { app: SHA_A }),
      release("v0.1.1", { app: SHA_B }),
      release("v0.1.0", { app: SHA_A }),
    ]);
    expect(byCommit.get(SHA_A)).toEqual(["v0.1.0", "v0.1.2"]);
    expect(byCommit.get(SHA_B)).toEqual(["v0.1.1"]);
  });

  it("names a roll back on no commit it did not bring back: a service that never moved", () => {
    const byCommit = releaseTagsByCommit([
      release("v1.3.0", { app: SHA_A, web: SHA_C }),
      release("v1.2.0", { app: SHA_B, web: SHA_C }),
      release("v1.1.0", { app: SHA_A, web: SHA_C }),
    ]);
    expect(byCommit.get(SHA_A)).toEqual(["v1.1.0", "v1.3.0"]);
    expect(byCommit.get(SHA_C)).toEqual(["v1.1.0"]);
  });

  it("names no commit by a release HQ refused: it never went live", () => {
    expect(releaseTagsByCommit([release("v1.1.0", { app: SHA_A }, "refused")]).size).toBe(0);
  });

  it("folds onto the history as the name a commit went live under", () => {
    const tags = releaseTagsByCommit([release("v1.2.0", { app: SHA_A })]);
    const [first, second] = groupHistory({
      commits: [commit(SHA_A, "Add a footer"), commit(SHA_B, "Rename the heading")],
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

  it("says nothing where no date is known, rather than an epoch", () => {
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
    change: null,
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

describe("historyLine naming", () => {
  // A Mate's change, landed by HQ: whoever git says wrote the commit, it is the Mate's.
  const entry = {
    sha: "a".repeat(40),
    shortSha: "aaaaaaa",
    subject: "Deploy the link keeper",
    author: "Mate HQ",
    at: "2026-09-19T08:00:00Z",
    deployedTo: ["Links - production"],
    tags: [],
    change: { number: 4, title: "Deploy the link keeper", mateProjectId: "PXGYIVK9RLWlE3eTL3QwoW" },
  };
  const now = Date.parse("2026-09-19T12:00:00Z");
  const names = { mateNames: new Map([["PXGYIVK9RLWlE3eTL3QwoW", "Theo"]]) };

  it("names the Mate whose change landed it, not the commit's author", () => {
    expect(historyLine(entry, now, names)).toBe("Theo · Links - production · 4h");
  });

  it("drops a Mate it cannot name instead of falling back to the author", () => {
    expect(historyLine(entry, now)).toBe("Links - production · 4h");
  });

  it("names a person's commit by its author", () => {
    expect(historyLine({ ...entry, author: "ales", change: null }, now, names)).toBe(
      "ales · Links - production · 4h",
    );
  });

  // D3: a stop is named as its project is in Zerops, whole — never read back for a prefix.
  it("names a stop whole, as Zerops has it", () => {
    expect(historyLine({ ...entry, deployedTo: ["Linkshop staging"] }, now)).toBe(
      "Linkshop staging · 4h",
    );
  });
});

describe("historyNote", () => {
  it.each([
    ["reading", "Reading the history…"],
    ["empty", "Nothing has landed on this repository yet."],
  ] as const)("says %s as %s", (kind, expected) => {
    expect(historyNote(kind)).toBe(expected);
  });
});

describe("historyEarlier", () => {
  // HQ lists the newest hundred commits of a history and counts the rest.
  it.each([
    [{ shown: 100, total: 347 }, "247 earlier commits"],
    [{ shown: 100, total: 101 }, "1 earlier commit"],
    [{ shown: 100, total: 10000 }, "9900+ earlier commits"],
  ])("says %o as %s", ({ shown, total }, expected) => {
    expect(historyEarlier(shown, total)).toBe(expected);
  });

  it("says nothing where every commit is shown", () => {
    expect(historyEarlier(12, 12)).toBeUndefined();
  });
});
