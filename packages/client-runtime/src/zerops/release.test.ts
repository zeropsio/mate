import { describe, expect, it } from "vite-plus/test";

import { environmentRow, type EnvironmentRow } from "./groupRows.ts";
import {
  compareForRelease,
  flowReleaseOf,
  isReleaseTag,
  releaseRunBy,
  nameStopByRelease,
  releaseEntries,
  releaseGate,
  releaseCandidate,
  releaseEnded,
  releaseInFlight,
  releaseInFlightReason,
  releaseOffer,
  releaseRow,
  releaseWord,
  RELEASE_CHECKING,
  RELEASE_NOTHING_MERGED,
  RELEASE_NOTHING_NEW_ON_MAIN,
  shortCommit,
  type FlowRelease,
  type FlowReleaseRow,
} from "./release.ts";
import type { MovedCommits } from "./releaseCompare.ts";
import type { ReleaseRollout } from "@t3tools/shared/hqRelease";

const API = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
/** What goes live, compared: nothing beyond what each case's own entries say. */
const COMPARED: MovedCommits = { state: "known", moved: [] };
const WEB = "77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8";
const OLD = "1111111111111111111111111111111111111111";

describe("a release's name", () => {
  it.each([
    { tag: "v1.2.3", expected: true },
    { tag: "v1.2", expected: false },
    { tag: "1.2.3", expected: false },
    { tag: "v1.2.3-rc1", expected: false },
  ])("recognises $tag as ours: $expected", ({ tag, expected }) => {
    expect(isReleaseTag(tag)).toBe(expected);
  });
});

describe("what Release shows before it is pressed", () => {
  it("says, per service, what the stage runs against what production runs", () => {
    expect(
      compareForRelease({
        candidate: new Map([
          ["api", API],
          ["web", WEB],
        ]),
        production: new Map([
          ["api", OLD],
          ["web", WEB],
        ]),
      }),
    ).toEqual([
      { service: "api", candidate: "3f9c1b2", production: "1111111", changed: true },
      { service: "web", candidate: "77ab0e1", production: "77ab0e1", changed: false },
    ]);
  });

  it("names a service production has but the stage has not deployed to", () => {
    expect(
      compareForRelease({ candidate: new Map(), production: new Map([["api", API]]) }),
    ).toEqual([{ service: "api", candidate: undefined, production: "3f9c1b2", changed: false }]);
  });

  it("lists every service the stage has a commit for, changed or not", () => {
    expect(
      releaseEntries(
        new Map([
          ["api", API],
          ["web", WEB],
        ]),
      ),
    ).toHaveLength(2);
  });

  it("lists nothing for a version name that is not a commit", () => {
    expect(releaseEntries(new Map([["api", "hotfix"]]))).toEqual([]);
  });
});

/** HQ's rule, in its words (`releasePermission`, `hqRefusalWords`). */
const RELEASER = { allowed: true } as const;
const NOT_RELEASER = { allowed: false, reason: "Only somebody with Basic user can." } as const;

describe("the gate HQ's rule decides", () => {
  const entries = [{ service: "api", commit: API }];

  it.each([
    { name: "a releaser with something to release", permission: RELEASER, entries, allowed: true },
    {
      name: "somebody HQ's rule refuses, in its words",
      permission: NOT_RELEASER,
      entries,
      allowed: false,
      reason: NOT_RELEASER.reason,
    },
    {
      name: "somebody HQ's rule cannot be asked about yet",
      permission: undefined,
      entries,
      allowed: false,
      reason: RELEASE_CHECKING,
    },
    {
      name: "a releaser with nothing merged",
      permission: RELEASER,
      entries: [],
      allowed: false,
      reason: RELEASE_NOTHING_MERGED,
    },
  ])("for $name", ({ permission, entries: list, allowed, reason }) => {
    const gate = releaseGate({ permission, entries: list });
    expect(gate.allowed).toBe(allowed);
    if (!gate.allowed) expect(gate.reason).toBe(reason);
  });

  // What goes live is what the review shows before the press (main C05): a release is not offered
  // over a list still being read, nor over one HQ could not compare.
  it.each([
    { name: "still being read", live: { state: "reading" } as const, reason: RELEASE_CHECKING },
    {
      name: "not compared, in HQ's words",
      live: { state: "failed", reason: "HQ has no such commit." } as const,
      reason: "Can't check what can be released: HQ has no such commit.",
    },
  ])("holds a releaser back while what goes live is $name", ({ live, reason }) => {
    expect(releaseGate({ permission: RELEASER, entries, live })).toEqual({
      allowed: false,
      reason,
    });
  });
});

describe("what Release offers, from what the environments run", () => {
  const stage = new Map([
    ["api", API],
    ["web", WEB],
  ]);

  it("compares the stage against production, per service, and offers the next patch", () => {
    const offer = releaseOffer({
      live: COMPARED,
      permission: RELEASER,
      candidate: stage,
      production: new Map([
        ["api", OLD],
        ["web", WEB],
      ]),
      tags: ["v1.2.0"],
    });
    expect(offer.gate.allowed).toBe(true);
    expect(offer.suggestion).toBe("v1.2.1");
    expect(offer.comparison).toEqual([
      { service: "api", candidate: "3f9c1b2", production: "1111111", changed: true },
      { service: "web", candidate: "77ab0e1", production: "77ab0e1", changed: false },
    ]);
  });

  it("carries what HQ compared it would put live once known, and holds Release until then", () => {
    const moved = {
      repository: "apidev",
      services: ["api"],
      commits: [
        {
          sha: API,
          subject: "Quicker gallery",
          authorName: "Ada",
          at: "2026-10-02T10:00:00.000Z",
          change: null,
        },
      ],
      total: 1,
      truncated: false,
    };
    const offer = (live: MovedCommits) =>
      releaseOffer({
        permission: RELEASER,
        candidate: stage,
        production: new Map([["api", OLD]]),
        tags: ["v1.2.0"],
        live,
      });
    expect(offer({ state: "known", moved: [moved] })).toMatchObject({
      gate: { allowed: true },
      contents: [moved],
    });
    expect(offer({ state: "reading" })).toMatchObject({
      gate: { allowed: false, reason: RELEASE_CHECKING },
      contents: [],
    });
  });

  it.each([
    {
      name: "a stage two services ahead of production",
      permission: RELEASER,
      stage,
      production: new Map([["api", OLD]]),
      allowed: true,
    },
    {
      name: "a production already running everything main holds",
      permission: RELEASER,
      stage,
      production: new Map(stage),
      allowed: false,
      reason: RELEASE_NOTHING_NEW_ON_MAIN,
    },
    {
      name: "repositories with nothing merged",
      permission: RELEASER,
      stage: new Map<string, string>(),
      production: new Map([["api", OLD]]),
      allowed: false,
      reason: RELEASE_NOTHING_MERGED,
    },
    {
      name: "somebody who is not a releaser",
      permission: NOT_RELEASER,
      stage,
      production: new Map<string, string>(),
      allowed: false,
      reason: NOT_RELEASER.reason,
    },
  ])("answers, for $name", ({ permission, stage: stageCommits, production, allowed, reason }) => {
    const gate = releaseOffer({
      live: COMPARED,
      permission,
      candidate: stageCommits,
      production,
      tags: [],
    }).gate;
    expect(gate.allowed).toBe(allowed);
    if (!gate.allowed) expect(gate.reason).toBe(reason);
  });

  it("carries the entries the tag would list, so the verb tags what the offer showed", () => {
    const offer = releaseOffer({
      live: COMPARED,
      permission: RELEASER,
      candidate: new Map([
        ["api", API.toUpperCase()],
        ["web", "hotfix"],
      ]),
      production: new Map(),
      tags: [],
    });
    expect(offer.entries).toEqual([{ service: "api", commit: API }]);
  });
});

/**
 * A release lists what is merged, whether or not the group has a stage (D28).
 * The owner, 2026-09-18, on a project whose stage was mid-deploy: "I hope that
 * even with stage prod release is not tied to stage in any way."
 */
describe("a release lists what is merged", () => {
  const main = new Map([["app", API]]);

  it.each([
    {
      name: "a production that has never deployed",
      candidate: main,
      production: new Map<string, string>(),
      allowed: true,
    },
    {
      name: "a production behind main",
      candidate: main,
      production: new Map([["app", OLD]]),
      allowed: true,
    },
    {
      name: "a production already running main",
      candidate: main,
      production: new Map(main),
      allowed: false,
      reason: RELEASE_NOTHING_NEW_ON_MAIN,
    },
    {
      name: "repositories with nothing merged",
      candidate: new Map<string, string>(),
      production: new Map<string, string>(),
      allowed: false,
      reason: RELEASE_NOTHING_MERGED,
    },
  ])("answers, for $name", ({ candidate, production, allowed, reason }) => {
    const offer = releaseOffer({
      live: COMPARED,
      permission: RELEASER,
      candidate,
      production,
      tags: [],
    });
    expect(offer.gate.allowed).toBe(allowed);
    if (!offer.gate.allowed) expect(offer.gate.reason).toBe(reason);
    expect(offer.entries).toEqual(
      [...candidate.entries()].map(([service, commit]) => ({ service, commit })),
    );
  });

  it("never says a sentence about a stage, which a release does not depend on", () => {
    for (const reason of [RELEASE_NOTHING_MERGED, RELEASE_NOTHING_NEW_ON_MAIN]) {
      expect(reason).not.toMatch(/stage/iu);
    }
  });
});

describe("what a release lists, from HQ's repositories", () => {
  const repos = [
    { name: "appdev", mainHead: API, updatedAt: "2026-10-02T09:00:00.000Z" },
    { name: "webdev", mainHead: null, updatedAt: "2026-10-02T08:00:00.000Z" },
    { name: "group", mainHead: OLD, updatedAt: "2026-10-02T09:30:00.000Z" },
  ];

  it("takes each production runtime at its repository's main, and the recipe's main to tag", () => {
    expect(
      releaseCandidate({
        productionRepositories: new Map([
          ["app", "appdev"],
          ["web", "webdev"],
          ["mail", "mailer"],
        ]),
        repos,
      }),
    ).toEqual({ candidate: new Map([["app", API]]), groupHead: OLD });
  });

  it("has nothing to tag where the recipe has no main", () => {
    expect(
      releaseCandidate({ productionRepositories: new Map(), repos: repos.slice(0, 2) }).groupHead,
    ).toBeUndefined();
  });
});

describe("a release as HQ records it", () => {
  it("reads as the flow lists it: its verdict, its entries and when it was made", () => {
    expect(
      flowReleaseOf({
        tag: "v0.1.2",
        sha: OLD,
        entries: [
          { service: "api", sha: API },
          { service: "web", sha: WEB },
        ],
        by: "u1",
        at: "2026-10-02T10:00:00.000Z",
        state: "approved",
        reason: null,
        rollbackOf: null,
      }),
    ).toEqual({
      tag: "v0.1.2",
      verdict: "approved",
      detail: undefined,
      line: "api 3f9c1b2 · web 77ab0e1",
      entries: [
        { service: "api", commit: API },
        { service: "web", commit: WEB },
      ],
      taggedAt: "2026-10-02T10:00:00.000Z",
    });
  });

  it("carries why a refused one was refused", () => {
    expect(
      flowReleaseOf({
        tag: "v0.1.1",
        sha: OLD,
        entries: [{ service: "api", sha: API }],
        by: "u1",
        at: "2026-10-01T10:00:00.000Z",
        state: "refused",
        reason: "the tag's commit failed its checks",
        rollbackOf: null,
      }),
    ).toMatchObject({ verdict: "refused", detail: "the tag's commit failed its checks" });
  });
});

describe("the one word beside a release's dot", () => {
  it.each([
    { verdict: "approved", word: "Approved" },
    { verdict: "refused", word: "Refused" },
  ] as const)("says $word for $verdict", ({ verdict, word }) => {
    expect(releaseWord(verdict)).toBe(word);
  });
});

describe("shortCommit", () => {
  it("shortens a commit to the seven characters people read it by", () => {
    expect(shortCommit(API)).toBe("3f9c1b2");
  });
});

describe("a release's row", () => {
  const TAGGED = "2026-09-25T07:00:00Z";
  const EARLIER = "2026-09-25T06:00:00Z";
  const EARLIEST = "2026-09-25T05:00:00Z";
  const release = (
    tag: string,
    over: Partial<FlowRelease> & { readonly api?: string; readonly web?: string } = {},
  ): FlowRelease => {
    const { api = API, web = WEB, ...rest } = over;
    return {
      tag,
      verdict: "approved",
      detail: undefined,
      line: `api ${shortCommit(api)} · web ${shortCommit(web)}`,
      entries: [
        { service: "api", commit: api },
        { service: "web", commit: web },
      ],
      taggedAt: TAGGED,
      ...rest,
    };
  };
  const runs = (api: string, web: string) =>
    new Map([
      ["api", api],
      ["web", web],
    ]);
  const NONE_FAILED = new Map<string, string>();

  /** The newest-first list's rows, each told whether it is the one `releaseRunBy` names. */
  const rows = (
    releases: ReadonlyArray<FlowRelease>,
    production: ReadonlyMap<string, string>,
    failed: ReadonlyMap<string, string> = NONE_FAILED,
  ) => {
    const live = releaseRunBy(releases, production);
    return releases.map((entry, index) =>
      releaseRow(entry, index, {
        production,
        failed,
        live: entry.tag === live,
        newer: releases.slice(0, index),
      }),
    );
  };
  const brief = (row: FlowReleaseRow) => ({
    tag: row.tag,
    standing: row.standing,
    word: row.word,
    rollBack: row.rollBack,
  });

  it.each([
    {
      name: "the newest runs: it reads Live and offers no roll-back",
      releases: [release("v1.3.0"), release("v1.2.0", { api: OLD })],
      production: runs(API, WEB),
      failed: NONE_FAILED,
      expected: [
        { tag: "v1.3.0", standing: "live", word: "Live", rollBack: false },
        { tag: "v1.2.0", standing: undefined, word: "Approved", rollBack: true },
      ],
    },
    {
      name: "an older one runs: it reads Live, the other approved ones offer a roll-back",
      releases: [
        release("v1.3.0", { web: OLD }),
        release("v1.2.0"),
        release("v1.1.0", { api: OLD, web: OLD }),
      ],
      production: runs(API, WEB),
      failed: NONE_FAILED,
      expected: [
        { tag: "v1.3.0", standing: undefined, word: "Approved", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
        { tag: "v1.1.0", standing: undefined, word: "Approved", rollBack: true },
      ],
    },
    {
      name: "a roll-back re-tags an earlier message verbatim: only the newest is Live, neither rolls back",
      releases: [release("v1.4.0"), release("v1.3.0", { api: OLD }), release("v1.2.0")],
      production: runs(API, WEB),
      failed: NONE_FAILED,
      expected: [
        { tag: "v1.4.0", standing: "live", word: "Live", rollBack: false },
        { tag: "v1.3.0", standing: undefined, word: "Approved", rollBack: true },
        { tag: "v1.2.0", standing: undefined, word: "Approved", rollBack: false },
      ],
    },
    {
      name: "a commit it lists failed its production deploy after it was made: Deploy failed",
      releases: [release("v1.3.0"), release("v1.2.0", { web: OLD, taggedAt: EARLIER })],
      production: runs(API, OLD),
      failed: new Map([[`web@${WEB}`, "2026-09-25T07:05:00Z"]]),
      expected: [
        { tag: "v1.3.0", standing: "deploy-failed", word: "Deploy failed", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      // HQ deploys production to the newest release only: an older one listing the same commit
      // did not fail with it.
      name: "an older release lists the failed commit: its failure is the newest's that lists it",
      releases: [
        release("v1.4.0"),
        release("v1.3.0", { web: OLD, taggedAt: EARLIER }),
        release("v1.2.0", { taggedAt: EARLIEST }),
      ],
      production: runs(API, OLD),
      failed: new Map([[`web@${WEB}`, "2026-09-25T07:05:00Z"]]),
      expected: [
        { tag: "v1.4.0", standing: "deploy-failed", word: "Deploy failed", rollBack: false },
        { tag: "v1.3.0", standing: "live", word: "Live", rollBack: false },
        { tag: "v1.2.0", standing: undefined, word: "Approved", rollBack: true },
      ],
    },
    {
      name: "a failure posted before it was made belongs to an earlier release of the commit",
      releases: [release("v1.3.0"), release("v1.2.0", { web: OLD, taggedAt: EARLIER })],
      production: runs(API, OLD),
      failed: new Map([[`web@${WEB}`, "2026-09-25T06:55:00Z"]]),
      expected: [
        { tag: "v1.3.0", standing: undefined, word: "Approved", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "a failed commit production runs anyway is not what failed",
      releases: [release("v1.3.0"), release("v1.2.0", { web: OLD, taggedAt: EARLIER })],
      production: runs(OLD, WEB),
      failed: new Map([[`web@${WEB}`, "2026-09-25T07:05:00Z"]]),
      expected: [
        { tag: "v1.3.0", standing: undefined, word: "Approved", rollBack: false },
        { tag: "v1.2.0", standing: undefined, word: "Approved", rollBack: true },
      ],
    },
    {
      name: "a refused release never deployed: never Live, never Deploy failed",
      releases: [
        release("v1.4.0", { verdict: "refused", detail: "ada is not a releaser" }),
        release("v1.3.0", { verdict: "refused", web: OLD, detail: "No stage runs it." }),
        release("v1.2.0"),
      ],
      production: runs(API, WEB),
      failed: new Map([[`web@${OLD}`, "2026-09-25T07:05:00Z"]]),
      expected: [
        { tag: "v1.4.0", standing: undefined, word: "Refused", rollBack: false },
        { tag: "v1.3.0", standing: undefined, word: "Refused", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "production runs none of them: every row keeps HQ's word",
      releases: [release("v1.3.0"), release("v1.2.0", { api: OLD })],
      production: new Map<string, string>(),
      failed: NONE_FAILED,
      expected: [
        { tag: "v1.3.0", standing: undefined, word: "Approved", rollBack: false },
        { tag: "v1.2.0", standing: undefined, word: "Approved", rollBack: true },
      ],
    },
  ])("$name", ({ releases, production, failed, expected }) => {
    expect(rows(releases, production, failed).map(brief)).toEqual(expected);
  });

  it("says which of its commits failed, on which service, and nothing for any other row", () => {
    const [failed, live] = rows(
      [release("v1.3.0"), release("v1.2.0", { web: OLD, taggedAt: EARLIER })],
      runs(API, OLD),
      new Map([[`web@${WEB}`, "2026-09-25T07:05:00Z"]]),
    );
    expect(failed!.failedEntry).toEqual({ service: "web", commit: WEB });
    expect(live!.failedEntry).toBeUndefined();
  });

  it("never names a release that lists nothing as Live", () => {
    const empty = release("v1.3.0", { entries: [], line: "" });
    expect(releaseRunBy([empty, release("v1.2.0")], runs(API, WEB))).toBe("v1.2.0");
    expect(releaseRunBy([empty], runs(API, WEB))).toBeUndefined();
  });

  it("compares full commits, never the short ones people read", () => {
    const short = release("v1.3.0", {
      entries: [
        { service: "api", commit: shortCommit(API) },
        { service: "web", commit: shortCommit(WEB) },
      ],
    });
    expect(releaseRunBy([short], runs(API, WEB))).toBeUndefined();
  });

  it("keeps a refusal's reason as the line, and a release's contents otherwise", () => {
    const [refused, live] = rows(
      [
        release("v1.3.0", { verdict: "refused", detail: "ada is not a releaser" }),
        release("v1.2.0"),
      ],
      runs(API, WEB),
    );
    expect(refused!.line).toBe("ada is not a releaser");
    expect(live!.line).toBe("api 3f9c1b2 · web 77ab0e1");
  });
});

describe("the release a stop is named by", () => {
  // Beviro production (2026-09-25): medusa has run one commit since v0.1.9, nextstore moved in
  // every release after it. The first labelled service, medusa, named the stop v0.1.9.
  const MEDUSA = "a".repeat(40);
  const NEXT = (n: number) => String(n).repeat(40);
  const beviro = [13, 12, 11, 10, 9].map((patch) => ({
    tag: `v0.1.${String(patch)}`,
    verdict: "approved" as const,
    entries: [
      { service: "medusa", commit: MEDUSA },
      { service: "nextstore", commit: NEXT(patch - 8) },
    ],
  }));
  const running = (entries: ReadonlyArray<readonly [string, string]>) => new Map(entries);

  it.each([
    {
      name: "Beviro: medusa unchanged since v0.1.9, nextstore on v0.1.13's commit → v0.1.13",
      releases: beviro,
      running: running([
        ["medusa", MEDUSA],
        ["nextstore", NEXT(5)],
      ]),
      expected: "v0.1.13",
    },
    {
      name: "the stop runs an older release whole → that release",
      releases: beviro,
      running: running([
        ["medusa", MEDUSA],
        ["nextstore", NEXT(2)],
      ]),
      expected: "v0.1.10",
    },
    {
      name: "no release lists what the stop runs → none",
      releases: beviro,
      running: running([
        ["medusa", MEDUSA],
        ["nextstore", "f".repeat(40)],
      ]),
      expected: undefined,
    },
    {
      name: "a release that lists nothing is skipped",
      releases: [{ tag: "v0.1.14", verdict: "approved" as const, entries: [] }, ...beviro],
      running: running([
        ["medusa", MEDUSA],
        ["nextstore", NEXT(5)],
      ]),
      expected: "v0.1.13",
    },
    {
      name: "a service the release lists that the stop does not run → no match",
      releases: beviro,
      running: running([["medusa", MEDUSA]]),
      expected: undefined,
    },
  ])("$name", ({ releases, running, expected }) => {
    expect(releaseRunBy(releases, running)).toBe(expected);
  });

  it("names the stop by the tag, keeps the first labelled service's commit, drops its tagger", () => {
    const row: EnvironmentRow = environmentRow({
      projectId: "p-prod",
      name: "production",
      tier: "production",
      sources: "release",
      services: [
        { hostname: "medusa", appVersionName: `${MEDUSA} v0.1.9 ada` },
        { hostname: "nextstore", appVersionName: `${NEXT(5)} v0.1.13 broker` },
      ],
    });
    const named = nameStopByRelease(row, "v0.1.13");
    expect(named.version).toEqual({
      name: "v0.1.13",
      label: "v0.1.13",
      commit: shortCommit(MEDUSA),
      sha: MEDUSA,
      taggedBy: undefined,
    });
    expect(named.commit).toBe(shortCommit(MEDUSA));
    expect(named.line).toBe("release · v0.1.13");
    expect(named.tone).toBe(row.tone);
  });
});

describe("a release in flight", () => {
  const newest = {
    tag: "v0.1.3",
    verdict: "approved" as const,
    entries: [
      { service: "api", commit: API },
      { service: "web", commit: WEB },
    ],
    taggedAt: "2026-09-24T10:00:00Z",
  };
  const rollout = (tag: string, ended: boolean): ReleaseRollout => ({
    id: "7",
    tag,
    planned: true,
    ended,
    endedAt: ended ? "2026-09-24T11:20:00Z" : null,
    leftOut: [],
  });

  // HQ's rollout of the newest release says when it ends, in each production; no clock does.
  it.each([
    {
      name: "on its way while HQ's rollout of it has not ended",
      release: newest,
      rollouts: [rollout("v0.1.3", false)],
      inFlight: "v0.1.3",
      ended: undefined,
    },
    {
      name: "on its way while any production's rollout of it has not ended",
      release: newest,
      rollouts: [rollout("v0.1.3", true), rollout("v0.1.3", false)],
      inFlight: "v0.1.3",
      ended: undefined,
    },
    {
      name: "on its way before HQ streams its rollout: an older release's is no end of it",
      release: newest,
      rollouts: [rollout("v0.1.2", true)],
      inFlight: "v0.1.3",
      ended: undefined,
    },
    {
      name: "on its way before HQ planned it",
      release: newest,
      rollouts: [null],
      inFlight: "v0.1.3",
      ended: undefined,
    },
    {
      name: "ended once HQ ended its rollout in every production",
      release: newest,
      rollouts: [rollout("v0.1.3", true)],
      inFlight: undefined,
      ended: "v0.1.3",
    },
    {
      name: "neither where the project has no production environment to deploy it to",
      release: newest,
      rollouts: [],
      inFlight: undefined,
      ended: undefined,
    },
    {
      name: "neither where HQ tells no release's end",
      release: newest,
      rollouts: [undefined],
      inFlight: undefined,
      ended: undefined,
    },
    {
      name: "neither for a release HQ refused",
      release: { ...newest, verdict: "refused" as const },
      rollouts: [rollout("v0.1.3", false)],
      inFlight: undefined,
      ended: undefined,
    },
    {
      name: "neither for a snapshot, which deploys nothing",
      release: { ...newest, snapshot: true },
      rollouts: [null],
      inFlight: undefined,
      ended: undefined,
    },
    {
      name: "neither without a release",
      release: undefined,
      rollouts: [rollout("v0.1.3", false)],
      inFlight: undefined,
      ended: undefined,
    },
  ])("$name", ({ release, rollouts, inFlight, ended }) => {
    expect(releaseInFlight({ newest: release, rollouts })).toBe(inFlight);
    expect(releaseEnded({ newest: release, rollouts })).toBe(ended);
  });

  it("keeps Release from being offered, and says which tag is on its way", () => {
    const gate = releaseOffer({
      live: COMPARED,
      permission: RELEASER,
      candidate: new Map([["api", API]]),
      production: new Map([["api", OLD]]),
      inFlight: "v0.1.3",
      tags: ["v0.1.3"],
    }).gate;
    expect(gate).toEqual({ allowed: false, reason: releaseInFlightReason("v0.1.3") });
  });
});

describe("a production whose version names spell short shas", () => {
  // Since 2026-09-30 a release's deploy is named `{tag} {short sha}` — by main's broker, and by
  // HQ's Core after it — so what production runs
  // reads as the seven-hex prefix of the commit a release lists.
  const short = (sha: string) => sha.slice(0, 7);
  const RUNS = new Map([
    ["api", short(API)],
    ["web", short(WEB)],
  ]);
  const TAGGED = "2026-09-30T10:00:00Z";
  const listing = (tag: string, api = API) => ({
    tag,
    verdict: "approved" as const,
    detail: undefined,
    line: "",
    entries: [
      { service: "api", commit: api },
      { service: "web", commit: WEB },
    ],
    taggedAt: TAGGED,
  });

  it("compares the stage's commit against it as the same commit", () => {
    expect(
      compareForRelease({ candidate: new Map([["api", API]]), production: RUNS }).find(
        (row) => row.service === "api",
      ),
    ).toEqual({ service: "api", candidate: "3f9c1b2", production: "3f9c1b2", changed: false });
  });

  it("names the release it runs, and not one listing another commit", () => {
    expect(releaseRunBy([listing("v1.1.0", OLD), listing("v1.0.0")], RUNS)).toBe("v1.0.0");
  });

  it("reads a failure under the short name as the listed commit's", () => {
    const release = listing("v1.1.0", OLD);
    const row = releaseRow(release, 0, {
      production: RUNS,
      failed: new Map([[`api@${short(OLD)}`, "2026-09-30T10:05:00Z"]]),
      live: false,
      newer: [],
    });
    expect(row.standing).toBe("deploy-failed");
  });
});
