import { describe, expect, it } from "vite-plus/test";

import {
  COMPARE_COUNT_MAX,
  type CompareCommit,
  type CompareResponse,
} from "@t3tools/shared/hqChanges";

import {
  carriedReads,
  compareReadKey,
  movedCommits,
  movedCount,
  releaseReads,
  rollbackReads,
  wholeProduction,
  type CompareRead,
  type Moved,
} from "./releaseCompare.ts";

const API = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
const WEB = "77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8";
const OLD = "1111111111111111111111111111111111111111";

describe("what a release would put live: the comparisons to ask HQ for", () => {
  it("asks a repository for what its main has that production does not run", () => {
    expect(
      releaseReads({
        productionRepositories: new Map([["api", "apidev"]]),
        candidate: new Map([["api", API]]),
        production: new Map([["api", OLD]]),
      }),
    ).toEqual({
      reads: [{ repository: "apidev", query: { base: OLD, head: API }, services: ["api"] }],
      untold: [],
    });
  });

  it("asks from the first commit where production runs nothing yet: a first release", () => {
    expect(
      releaseReads({
        productionRepositories: new Map([["api", "apidev"]]),
        candidate: new Map([["api", API]]),
        production: new Map(),
      }).reads,
    ).toEqual([{ repository: "apidev", query: { head: API }, services: ["api"] }]);
  });

  it("asks nothing for a service production already runs main's head on, by either spelling", () => {
    expect(
      releaseReads({
        productionRepositories: new Map([
          ["api", "apidev"],
          ["web", "webdev"],
        ]),
        candidate: new Map([
          ["api", API],
          ["web", WEB],
        ]),
        production: new Map([
          ["api", API],
          ["web", WEB.slice(0, 7)],
        ]),
      }),
    ).toEqual({ reads: [], untold: [] });
  });

  it("cannot ask for a service whose commit is known only by its version name's seven hex", () => {
    expect(
      releaseReads({
        productionRepositories: new Map([["api", "apidev"]]),
        candidate: new Map([["api", API]]),
        production: new Map([["api", OLD.slice(0, 7)]]),
      }),
    ).toEqual({ reads: [], untold: ["api"] });
  });

  it("asks a repository once for the services that run one commit of it, apart for one behind", () => {
    expect(
      releaseReads({
        productionRepositories: new Map([
          ["api", "mono"],
          ["web", "mono"],
          ["worker", "mono"],
        ]),
        candidate: new Map([
          ["api", API],
          ["web", API],
          ["worker", API],
        ]),
        production: new Map([
          ["api", OLD],
          ["web", OLD],
          ["worker", WEB],
        ]),
      }).reads,
    ).toEqual([
      { repository: "mono", query: { base: OLD, head: API }, services: ["api", "web"] },
      { repository: "mono", query: { base: WEB, head: API }, services: ["worker"] },
    ]);
  });
});

describe("what a rollback takes off production and brings back: the comparisons to ask HQ for", () => {
  it("asks both ways between what production runs and what the release lists", () => {
    expect(
      rollbackReads({
        productionRepositories: new Map([["api", "apidev"]]),
        entries: [{ service: "api", commit: OLD }],
        production: new Map([["api", API]]),
      }),
    ).toEqual({
      leaving: [{ repository: "apidev", query: { base: OLD, head: API }, services: ["api"] }],
      comingBack: [{ repository: "apidev", query: { base: API, head: OLD }, services: ["api"] }],
      untold: [],
    });
  });

  it("takes nothing off a service production runs nothing on, and brings back all the release lists", () => {
    expect(
      rollbackReads({
        productionRepositories: new Map([["api", "apidev"]]),
        entries: [{ service: "api", commit: OLD }],
        production: new Map(),
      }),
    ).toEqual({
      leaving: [],
      comingBack: [{ repository: "apidev", query: { head: OLD }, services: ["api"] }],
      untold: [],
    });
  });

  it("asks nothing for a service already on the release's commit, and cannot for one known short", () => {
    expect(
      rollbackReads({
        productionRepositories: new Map([
          ["api", "apidev"],
          ["web", "webdev"],
        ]),
        entries: [
          { service: "api", commit: OLD },
          { service: "web", commit: OLD },
        ],
        production: new Map([
          ["api", OLD.slice(0, 7)],
          ["web", WEB.slice(0, 7)],
        ]),
      }),
    ).toEqual({ leaving: [], comingBack: [], untold: ["web"] });
  });
});

describe("what moves, as HQ answered the comparisons", () => {
  const commit = (sha: string, subject: string): CompareCommit => ({
    sha,
    subject,
    authorName: "Ada",
    at: "2026-10-02T10:00:00.000Z",
    change: null,
  });
  const read: CompareRead = {
    repository: "mono",
    query: { base: OLD, head: API },
    services: ["api", "web"],
  };

  it("reads each comparison HQ answered as the commits it moves, and the services they move on", () => {
    expect(
      movedCommits({
        reads: [read],
        answers: new Map([
          [
            compareReadKey(read),
            {
              base: OLD,
              head: API,
              commits: [commit(API, "Quicker gallery"), commit(WEB, "Tidy the footer")],
              truncated: false,
              total: 2,
            },
          ],
        ]),
        failures: new Map(),
      }),
    ).toEqual({
      state: "known",
      moved: [
        {
          repository: "mono",
          services: ["api", "web"],
          commits: [commit(API, "Quicker gallery"), commit(WEB, "Tidy the footer")],
          total: 2,
          truncated: false,
        },
      ],
    });
  });

  it("is still reading while a comparison is unanswered: never nothing moving", () => {
    expect(movedCommits({ reads: [read], answers: new Map(), failures: new Map() })).toEqual({
      state: "reading",
    });
  });

  it("says why where HQ did not answer a comparison, before any still being read", () => {
    const other: CompareRead = { repository: "docs", query: { head: WEB }, services: ["docs"] };
    expect(
      movedCommits({
        reads: [other, read],
        answers: new Map(),
        failures: new Map([[compareReadKey(read), "HQ has no such commit."]]),
      }),
    ).toEqual({ state: "failed", reason: "HQ has no such commit." });
  });

  it("keeps an answer beside a later failure: two commits compare the same for ever", () => {
    const answered: CompareResponse = {
      base: OLD,
      head: API,
      commits: [commit(API, "Quicker gallery")],
      truncated: false,
      total: 1,
    };
    expect(
      movedCommits({
        reads: [read],
        answers: new Map([[compareReadKey(read), answered]]),
        failures: new Map([[compareReadKey(read), "HQ is not answering."]]),
      }).state,
    ).toBe("known");
  });

  it("takes no answer about another pair of commits than the read asked for", () => {
    const first: CompareRead = { repository: "mono", query: { head: API }, services: ["api"] };
    expect(
      movedCommits({
        reads: [first],
        answers: new Map([
          [
            compareReadKey(first),
            { base: OLD, head: API, commits: [], truncated: false, total: 0 },
          ],
        ]),
        failures: new Map(),
      }),
    ).toEqual({ state: "reading" });
  });
});

describe("how many commits move", () => {
  const listed = (repository: string, shas: ReadonlyArray<string>, total = shas.length): Moved => ({
    repository,
    services: [repository],
    commits: shas.map((sha) => ({
      sha,
      subject: sha,
      authorName: "Ada",
      at: "2026-10-02T10:00:00.000Z",
      change: null,
    })),
    total,
    truncated: total > shas.length,
  });

  it("counts a commit once however many reads of its repository list it", () => {
    expect(
      movedCount([listed("mono", [API, WEB]), listed("mono", [API]), listed("docs", [OLD])]),
    ).toEqual({ count: 3, atLeast: false });
  });

  it("counts a list HQ cut short by HQ's own count", () => {
    expect(movedCount([listed("mono", [API, WEB], 347)])).toEqual({ count: 347, atLeast: false });
  });

  it("says at least as many where HQ stopped counting", () => {
    expect(movedCount([listed("mono", [API], COMPARE_COUNT_MAX)])).toEqual({
      count: COMPARE_COUNT_MAX,
      atLeast: true,
    });
  });

  it("says at least as many where reads of one repository that overlap are cut short", () => {
    expect(movedCount([listed("mono", [API, WEB], 120), listed("mono", [API], 3)])).toEqual({
      count: 120,
      atLeast: true,
    });
  });
});

describe("what each release carried: the comparisons to ask HQ for", () => {
  type Listed = {
    readonly tag: string;
    readonly verdict: "approved" | "refused";
    readonly at: Record<string, string>;
  };
  const release = ({ tag, verdict, at }: Listed) => ({
    tag,
    verdict,
    entries: Object.entries(at).map(([service, commit]) => ({ service, commit })),
  });

  it.each<[string, ReadonlyArray<Listed>, ReadonlyArray<CompareRead>]>([
    [
      "a release, from the commit the release before it lists",
      [
        { tag: "v0.1.1", verdict: "approved", at: { api: API } },
        { tag: "v0.1.0", verdict: "approved", at: { api: OLD } },
      ],
      [{ repository: "apidev", query: { base: OLD, head: API }, services: ["api"] }],
    ],
    [
      "nothing for a service at the commit the release before it lists",
      [
        { tag: "v0.1.1", verdict: "approved", at: { api: API, web: WEB } },
        { tag: "v0.1.0", verdict: "approved", at: { api: API, web: OLD } },
      ],
      [{ repository: "mono", query: { base: OLD, head: WEB }, services: ["web"] }],
    ],
    [
      "one read for a repository's services, named by the first that moved",
      [
        { tag: "v0.1.1", verdict: "approved", at: { web: WEB, worker: WEB } },
        { tag: "v0.1.0", verdict: "approved", at: { web: OLD, worker: API } },
      ],
      [{ repository: "mono", query: { base: OLD, head: WEB }, services: ["web"] }],
    ],
    [
      "a service no older release lists, from the commit another of its repository's had",
      [
        { tag: "v0.1.1", verdict: "approved", at: { worker: WEB, web: WEB } },
        { tag: "v0.1.0", verdict: "approved", at: { web: OLD } },
      ],
      [{ repository: "mono", query: { base: OLD, head: WEB }, services: ["worker"] }],
    ],
    [
      "a release, from the nearest older one that was not refused: a refused one never deployed",
      [
        { tag: "v0.1.2", verdict: "approved", at: { api: API } },
        { tag: "v0.1.1", verdict: "refused", at: { api: WEB } },
        { tag: "v0.1.0", verdict: "approved", at: { api: OLD } },
      ],
      [{ repository: "apidev", query: { base: OLD, head: API }, services: ["api"] }],
    ],
    [
      "the first release, from its repository's first commit",
      [{ tag: "v0.1.0", verdict: "approved", at: { api: OLD } }],
      [{ repository: "apidev", query: { head: OLD }, services: ["api"] }],
    ],
  ])("%s", (_, releases, reads) => {
    const carried = carriedReads({
      releases: releases.map(release),
      repositoryOf: new Map([
        ["api", "apidev"],
        ["web", "mono"],
        ["worker", "mono"],
      ]),
    });
    expect(carried.get(releases[0]!.tag)).toEqual(reads);
  });
});

describe("production's commits, whole for a comparison", () => {
  it("takes a commit known only short whole from a release that lists it for the service", () => {
    const releases = [
      { entries: [{ service: "api", commit: API }] },
      { entries: [{ service: "web", commit: OLD }] },
    ];
    expect(
      wholeProduction(
        new Map([
          ["api", API.slice(0, 7)],
          ["web", WEB.slice(0, 7)],
          ["docs", OLD],
        ]),
        releases,
      ),
    ).toEqual(
      new Map([
        ["api", API],
        ["web", WEB.slice(0, 7)],
        ["docs", OLD],
      ]),
    );
  });
});
