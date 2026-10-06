import { describe, expect, it } from "vite-plus/test";

import type { ZeropsServiceDeployedVersion } from "../data/projections/serviceRuns.ts";
import type { HqJob } from "./hq/environments.ts";
import type { Shown } from "./knowledge/known.ts";

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
  productionRuns,
  rollbackReads,
  rollbackServices,
  type CompareRead,
  type Moved,
  type ProductionRun,
} from "./releaseCompare.ts";

const API = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
const WEB = "77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8";
const OLD = "1111111111111111111111111111111111111111";

/** A service running `sha`, whole. */
const runs = (sha: string): ProductionRun => ({ kind: "commit", sha });
const NOTHING: ProductionRun = { kind: "nothing" };
const UNTOLD: ProductionRun = { kind: "untold" };

describe("what a release would put live: the comparisons to ask HQ for", () => {
  it("asks a repository for what its main has that production does not run", () => {
    expect(
      releaseReads({
        productionRepositories: new Map([["api", "apidev"]]),
        candidate: new Map([["api", API]]),
        running: new Map([["api", runs(OLD)]]),
      }),
    ).toEqual({
      reads: [{ repository: "apidev", query: { base: OLD, head: API }, services: ["api"] }],
      untold: [],
    });
  });

  it("asks from the first commit only where production is listed and runs nothing", () => {
    expect(
      releaseReads({
        productionRepositories: new Map([["api", "apidev"]]),
        candidate: new Map([["api", API]]),
        running: new Map([["api", NOTHING]]),
      }).reads,
    ).toEqual([{ repository: "apidev", query: { head: API }, services: ["api"] }]);
  });

  it("asks nothing for a service production already runs main's head on", () => {
    expect(
      releaseReads({
        productionRepositories: new Map([["api", "apidev"]]),
        candidate: new Map([["api", API]]),
        running: new Map([["api", runs(API)]]),
      }),
    ).toEqual({ reads: [], untold: [] });
  });

  it.each([
    { name: "one whose commit cannot be told", running: new Map([["api", UNTOLD]]) },
    { name: "one nothing is said of", running: new Map<string, ProductionRun>() },
  ])("asks nothing for $name, and names it untold", ({ running }) => {
    expect(
      releaseReads({
        productionRepositories: new Map([["api", "apidev"]]),
        candidate: new Map([["api", API]]),
        running,
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
        running: new Map([
          ["api", runs(OLD)],
          ["web", runs(OLD)],
          ["worker", runs(WEB)],
        ]),
      }).reads,
    ).toEqual([
      { repository: "mono", query: { base: OLD, head: API }, services: ["api", "web"] },
      { repository: "mono", query: { base: WEB, head: API }, services: ["worker"] },
    ]);
  });
});

describe("rollbackServices: the services a roll back redeploys, as its review names them", () => {
  const ENTRIES = [
    { service: "api", commit: OLD },
    { service: "web", commit: WEB },
  ];
  it.each<{
    readonly name: string;
    readonly runs: ReadonlyMap<string, ProductionRun> | undefined;
    readonly services: ReadonlyArray<string>;
  }>([
    {
      name: "the one running another commit than the release lists",
      runs: new Map([
        ["api", runs(API)],
        ["web", runs(WEB)],
      ]),
      services: ["api"],
    },
    {
      name: "one running nothing, which the release brings back",
      runs: new Map([
        ["api", NOTHING],
        ["web", runs(WEB)],
      ]),
      services: ["api"],
    },
    {
      name: "none said to move whose commit cannot be told",
      runs: new Map([
        ["api", UNTOLD],
        ["web", runs(API)],
      ]),
      services: ["web"],
    },
    {
      name: "every service listed while what production runs is not known",
      runs: undefined,
      services: ["api", "web"],
    },
    {
      name: "every service listed where none is known to move",
      runs: new Map([
        ["api", runs(OLD)],
        ["web", runs(WEB)],
      ]),
      services: ["api", "web"],
    },
  ])("names $name", ({ runs: running, services }) => {
    expect(rollbackServices({ entries: ENTRIES, runs: running })).toEqual(services);
  });
});

describe("what a rollback takes off production and brings back: the comparisons to ask HQ for", () => {
  it("asks both ways between what production runs and what the release lists", () => {
    expect(
      rollbackReads({
        productionRepositories: new Map([["api", "apidev"]]),
        entries: [{ service: "api", commit: OLD }],
        running: new Map([["api", runs(API)]]),
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
        running: new Map([["api", NOTHING]]),
      }),
    ).toEqual({
      leaving: [],
      comingBack: [{ repository: "apidev", query: { head: OLD }, services: ["api"] }],
      untold: [],
    });
  });

  it("asks nothing for a service already on the release's commit, and cannot for one untold", () => {
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
        running: new Map([
          ["api", runs(OLD)],
          ["web", UNTOLD],
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

describe("what each production service runs, as a comparison starts from it", () => {
  const known = (value: ZeropsServiceDeployedVersion): Shown<ZeropsServiceDeployedVersion> => ({
    state: "known",
    value,
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  });
  const named = (name: string | null) => known({ activeId: "v1", source: null, name });
  const live = (sha: string): HqJob => ({
    id: "1",
    kind: "deploy",
    service: "api",
    sha,
    state: "live",
    cause: "release",
    ref: "v0.1.0",
    reason: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: "2026-10-02T10:00:00.000Z",
    endedAt: "2026-10-02T10:01:00.000Z",
    supersededBy: null,
  });

  it.each([
    {
      name: "a listed service with no active version runs nothing",
      stated: known({ activeId: null, source: null, name: null }),
      run: { kind: "nothing" },
    },
    {
      name: "a version HQ named runs the commit it spells, whole from HQ's record of the deploy",
      stated: named(`v0.1.0 ${API.slice(0, 7)}`),
      deploys: new Map([["api", { latest: live(API), live: live(API) }]]),
      run: { kind: "commit", sha: API },
    },
    {
      name: "a short sha a release lists for it is taken whole from the release",
      stated: named(`v0.1.0 ${API.slice(0, 7)}`),
      releases: [{ entries: [{ service: "api", commit: API }] }],
      run: { kind: "commit", sha: API },
    },
    {
      name: "a version named whole runs that commit",
      stated: named(`${API} v0.1.0 ada`),
      run: { kind: "commit", sha: API },
    },
    {
      name: "a short sha no record or release lists is untold",
      stated: named(`v0.1.0 ${API.slice(0, 7)}`),
      run: { kind: "untold" },
    },
    {
      name: "a version named by hand is untold",
      stated: named("hotfix"),
      run: { kind: "untold" },
    },
    {
      name: "a running version nobody named is untold",
      stated: named(null),
      run: { kind: "untold" },
    },
    {
      // F10 (e2e, 2026-10-03): a production the import made runs its no-code version, active and
      // sourced NONE (z3-eval's `s3git1`, xyz's `app`) — it runs nothing, and its first release
      // puts the whole of `main` live.
      name: "the import's no-code version runs nothing",
      stated: known({ activeId: "v-import", source: "NONE", name: null }),
      run: { kind: "nothing" },
    },
  ])("$name", ({ stated, deploys, releases, run }) => {
    expect(
      productionRuns({
        services: [{ hostname: "api", serviceId: "s-api" }],
        stated: new Map([["s-api", stated]]),
        named: ["api"],
        deploys: deploys ?? new Map(),
        releases: releases ?? [],
      })?.get("api"),
    ).toEqual(run);
  });

  it("cannot tell what a service runs that the tier or HQ names and the account does not list", () => {
    expect(
      productionRuns({
        services: [],
        stated: new Map(),
        named: ["api"],
        deploys: new Map(),
        releases: [],
      })?.get("api"),
    ).toEqual({ kind: "untold" });
  });

  it.each([
    { name: "production is not listed yet", services: undefined },
    {
      name: "a listed service's version is not read yet",
      services: [{ hostname: "api", serviceId: "s-api" }],
    },
  ])("knows nothing while $name", ({ services }) => {
    expect(
      productionRuns({
        services,
        stated: new Map([["s-api", { state: "unread", waitingFor: null }]]),
        named: ["api"],
        deploys: new Map(),
        releases: [],
      }),
    ).toBeUndefined();
  });
});
