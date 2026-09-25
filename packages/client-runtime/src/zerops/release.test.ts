import { describe, expect, it } from "vite-plus/test";

import type { GiteaCommitStatus } from "./giteaClient.ts";
import { environmentRow, type EnvironmentRow } from "./groupRows.ts";
import {
  compareForRelease,
  isReleaseTag,
  liveRelease,
  nameStopByRelease,
  newestReleaseTag,
  planReleaseReads,
  readReleaseMessage,
  releaseEntries,
  releaseGate,
  releaseInFlight,
  releaseInFlightReason,
  releaseMessage,
  releaseNamingStop,
  releaseOffer,
  releaseRow,
  releaseStatusContext,
  releaseVerdict,
  releaseWord,
  RELEASE_NOTHING_MERGED,
  RELEASE_NOTHING_NEW_ON_MAIN,
  RELEASE_NOT_A_RELEASER,
  rollbackTo,
  shortCommit,
  suggestReleaseTags,
  type FlowRelease,
  type FlowReleaseRow,
} from "./release.ts";

const API = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
const WEB = "77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8";
const OLD = "1111111111111111111111111111111111111111";

describe("the tag's message", () => {
  it("is one line per service, in service order", () => {
    expect(
      releaseMessage([
        { service: "web", commit: WEB },
        { service: "api", commit: API },
      ]),
    ).toBe(`api ${API}\nweb ${WEB}`);
  });

  it("lower-cases a sha, so it compares equal to a version's name", () => {
    expect(releaseMessage([{ service: "api", commit: API.toUpperCase() }])).toBe(`api ${API}`);
  });

  it("drops anything that is not a full sha rather than writing a tag the broker refuses", () => {
    expect(releaseMessage([{ service: "api", commit: "3f9c1b2" }])).toBe("");
  });

  it.each([
    { name: "two services", message: `api ${API}\nweb ${WEB}`, expected: 2 },
    { name: "blank lines between them", message: `api ${API}\n\n\nweb ${WEB}\n`, expected: 2 },
    {
      name: "a short sha, which makes the whole tag unreadable",
      message: `api 3f9c1b2`,
      expected: 0,
    },
    { name: "a third word", message: `api ${API} extra`, expected: 0 },
    { name: "a line with no sha", message: `api`, expected: 0 },
    { name: "nothing at all", message: "", expected: 0 },
  ])("reads $name", ({ message, expected }) => {
    expect(readReleaseMessage(message)).toHaveLength(expected);
  });

  it("round-trips: what it writes is what it reads", () => {
    const entries = [
      { service: "api", commit: API },
      { service: "web", commit: WEB },
    ];
    expect(readReleaseMessage(releaseMessage(entries))).toEqual(entries);
  });
});

describe("what to call the next release", () => {
  it.each([
    { name: "a group that has never released", tags: [], patch: "v0.1.0", minor: "v0.1.0" },
    { name: "one release", tags: ["v1.2.0"], patch: "v1.2.1", minor: "v1.3.0" },
    {
      name: "the newest by version, not by name",
      tags: ["v1.9.0", "v1.10.0", "v1.2.0"],
      patch: "v1.10.1",
      minor: "v1.11.0",
    },
    {
      name: "tags that are not ours, ignored",
      tags: ["release-3", "v2.0.0", "nightly"],
      patch: "v2.0.1",
      minor: "v2.1.0",
    },
  ])("suggests, for $name", ({ tags, patch, minor }) => {
    expect(suggestReleaseTags(tags)).toEqual({ patch, minor });
  });

  it.each([
    { tag: "v1.2.3", expected: true },
    { tag: "v1.2", expected: false },
    { tag: "1.2.3", expected: false },
    { tag: "v1.2.3-rc1", expected: false },
  ])("recognises $tag as ours: $expected", ({ tag, expected }) => {
    expect(isReleaseTag(tag)).toBe(expected);
  });

  it("has no newest tag among tags that are none of ours", () => {
    expect(newestReleaseTag(["nightly", "release-3"])).toBeUndefined();
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

describe("the app's own gate", () => {
  const entries = [{ service: "api", commit: API }];

  it.each([
    { name: "a releaser with something to release", mayRelease: true, entries, allowed: true },
    {
      name: "somebody who is not in the release right",
      mayRelease: false,
      entries,
      allowed: false,
      reason: RELEASE_NOT_A_RELEASER,
    },
    {
      name: "a releaser with nothing merged",
      mayRelease: true,
      entries: [],
      allowed: false,
      reason: RELEASE_NOTHING_MERGED,
    },
  ])("for $name", ({ mayRelease, entries: list, allowed, reason }) => {
    const gate = releaseGate({ mayRelease, entries: list });
    expect(gate.allowed).toBe(allowed);
    if (!gate.allowed) expect(gate.reason).toBe(reason);
  });
});

describe("what Release offers, from what the environments run", () => {
  const stage = new Map([
    ["api", API],
    ["web", WEB],
  ]);

  it("compares the stage against production, per service, and offers the next patch", () => {
    const offer = releaseOffer({
      mayRelease: true,
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

  it.each([
    {
      name: "a stage two services ahead of production",
      mayRelease: true,
      stage,
      production: new Map([["api", OLD]]),
      allowed: true,
    },
    {
      name: "a production already running everything main holds",
      mayRelease: true,
      stage,
      production: new Map(stage),
      allowed: false,
      reason: RELEASE_NOTHING_NEW_ON_MAIN,
    },
    {
      name: "repositories with nothing merged",
      mayRelease: true,
      stage: new Map<string, string>(),
      production: new Map([["api", OLD]]),
      allowed: false,
      reason: RELEASE_NOTHING_MERGED,
    },
    {
      name: "somebody who is not a releaser",
      mayRelease: false,
      stage,
      production: new Map<string, string>(),
      allowed: false,
      reason: RELEASE_NOT_A_RELEASER,
    },
  ])("answers, for $name", ({ mayRelease, stage: stageCommits, production, allowed, reason }) => {
    const gate = releaseOffer({
      mayRelease,
      candidate: stageCommits,
      production,
      tags: [],
    }).gate;
    expect(gate.allowed).toBe(allowed);
    if (!gate.allowed) expect(gate.reason).toBe(reason);
  });

  it("carries the entries the tag would list, so the verb tags what the offer showed", () => {
    const offer = releaseOffer({
      mayRelease: true,
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
      mayRelease: true,
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
    for (const reason of [
      RELEASE_NOTHING_MERGED,
      RELEASE_NOTHING_NEW_ON_MAIN,
      RELEASE_NOT_A_RELEASER,
    ]) {
      expect(reason).not.toMatch(/stage/iu);
    }
  });
});

describe("rolling back", () => {
  const earlier = `api ${OLD}\nweb ${WEB}`;

  it("is a new tag carrying the earlier one's message, exactly", () => {
    expect(
      rollbackTo({ tag: "v1.2.0", message: earlier, existingTags: ["v1.2.0", "v1.3.0"] }),
    ).toEqual({ tag: "v1.3.1", message: earlier });
  });

  it("never reuses a name, even rolling back to the newest but one", () => {
    const result = rollbackTo({
      tag: "v1.2.0",
      message: earlier,
      existingTags: ["v1.2.0", "v1.3.0"],
    });
    expect(["v1.2.0", "v1.3.0"]).not.toContain(result?.tag);
  });

  it("refuses a tag whose message this build cannot read", () => {
    expect(
      rollbackTo({ tag: "v1.2.0", message: "deployed the invoices work", existingTags: [] }),
    ).toBeUndefined();
  });
});

describe("the broker's verdict on a tag", () => {
  const status = (state: GiteaCommitStatus["state"], description?: string): GiteaCommitStatus => ({
    context: releaseStatusContext("v1.2.0"),
    state,
    ...(description === undefined ? {} : { description }),
  });

  it.each([
    { name: "approved", statuses: [status("success")], verdict: "approved", word: "Approved" },
    {
      name: "refused, with the reason",
      statuses: [status("failure", "ada is not a releaser")],
      verdict: "refused",
      word: "Refused",
    },
    {
      name: "still being checked",
      statuses: [status("pending")],
      verdict: "pending",
      word: "Checking",
    },
    { name: "nothing said yet", statuses: [], verdict: "unknown", word: undefined },
  ] as const)("reads $name", ({ statuses, verdict, word }) => {
    expect(releaseVerdict("v1.2.0", statuses).verdict).toBe(verdict);
    expect(releaseWord(verdict)).toBe(word);
  });

  it("does not take another tag's verdict for this one", () => {
    const statuses = [{ context: "mate/release/v1.1.0", state: "success" } as GiteaCommitStatus];
    expect(releaseVerdict("v1.2.0", statuses).verdict).toBe("unknown");
  });

  it("carries the description a refusal came with", () => {
    expect(releaseVerdict("v1.2.0", [status("failure", "ada is not a releaser")]).detail).toBe(
      "ada is not a releaser",
    );
  });
});

describe("shortCommit", () => {
  it("shortens a commit to the seven characters people read it by", () => {
    expect(shortCommit(API)).toBe("3f9c1b2");
  });
});

describe("a release's row", () => {
  const TAGGED = "2026-09-25T07:00:00Z";
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
      taggedAt: undefined,
      ...rest,
    };
  };
  const runs = (api: string, web: string) =>
    new Map([
      ["api", api],
      ["web", web],
    ]);
  const NONE_FAILED = new Map<string, string | undefined>();

  /** The newest-first list's rows, each told whether it is the one `liveRelease` names. */
  const rows = (
    releases: ReadonlyArray<FlowRelease>,
    production: ReadonlyMap<string, string>,
    failed: ReadonlyMap<string, string | undefined> = NONE_FAILED,
  ) => {
    const live = liveRelease(releases, production);
    return releases.map((entry, index) =>
      releaseRow(entry, index, { production, failed, live: entry.tag === live }),
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
      name: "a commit it lists failed its production deploy after the tag: Deploy failed",
      releases: [release("v1.3.0", { taggedAt: TAGGED }), release("v1.2.0", { web: OLD })],
      production: runs(API, OLD),
      failed: new Map([[`web@${WEB}`, "2026-09-25T07:05:00Z"]]),
      expected: [
        { tag: "v1.3.0", standing: "deploy-failed", word: "Deploy failed", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "a failure with no tag time to measure it against: Deploy failed",
      releases: [release("v1.3.0", { verdict: "unknown" }), release("v1.2.0", { web: OLD })],
      production: runs(API, OLD),
      failed: new Map([[`web@${WEB}`, undefined]]),
      expected: [
        { tag: "v1.3.0", standing: "deploy-failed", word: "Deploy failed", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "an older release with no tag time lists the failed commit: its failure is the newest's",
      releases: [
        release("v1.4.0", { taggedAt: TAGGED }),
        release("v1.3.0", { web: OLD }),
        release("v1.2.0"),
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
      name: "a failure posted before the tag belongs to an earlier release of the commit",
      releases: [release("v1.3.0", { taggedAt: TAGGED }), release("v1.2.0", { web: OLD })],
      production: runs(API, OLD),
      failed: new Map([[`web@${WEB}`, "2026-09-25T06:55:00Z"]]),
      expected: [
        { tag: "v1.3.0", standing: undefined, word: "Approved", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "a failure whose time is not read does not outlast a tag whose time is",
      releases: [release("v1.3.0", { taggedAt: TAGGED })],
      production: runs(API, OLD),
      failed: new Map([[`web@${WEB}`, undefined]]),
      expected: [{ tag: "v1.3.0", standing: undefined, word: "Approved", rollBack: false }],
    },
    {
      name: "a failed commit production runs anyway is not what failed",
      releases: [release("v1.3.0", { taggedAt: TAGGED }), release("v1.2.0", { web: OLD })],
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
      failed: new Map([[`web@${OLD}`, undefined]]),
      expected: [
        { tag: "v1.4.0", standing: undefined, word: "Refused", rollBack: false },
        { tag: "v1.3.0", standing: undefined, word: "Refused", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "one the broker still judges reads Checking and offers no roll-back",
      releases: [release("v1.3.0", { verdict: "pending", web: OLD }), release("v1.2.0")],
      production: runs(API, WEB),
      failed: NONE_FAILED,
      expected: [
        { tag: "v1.3.0", standing: undefined, word: "Checking", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "production runs none of them: every row keeps the broker's word",
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

  it("never names a release that lists nothing as Live", () => {
    const empty = release("v1.3.0", { entries: [], line: "" });
    expect(liveRelease([empty, release("v1.2.0")], runs(API, WEB))).toBe("v1.2.0");
    expect(liveRelease([empty], runs(API, WEB))).toBeUndefined();
  });

  it("compares full commits, never the short ones people read", () => {
    const short = release("v1.3.0", {
      entries: [
        { service: "api", commit: shortCommit(API) },
        { service: "web", commit: shortCommit(WEB) },
      ],
    });
    expect(liveRelease([short], runs(API, WEB))).toBeUndefined();
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
    expect(releaseNamingStop(releases, running)).toBe(expected);
  });

  it("names the stop by the tag and keeps the first labelled service's commit, which compares", () => {
    const row: EnvironmentRow = environmentRow({
      projectId: "p-prod",
      name: "production",
      tier: "production",
      sources: "release",
      environment: "production",
      services: [
        { hostname: "medusa", appVersionName: `${MEDUSA} v0.1.9 broker` },
        { hostname: "nextstore", appVersionName: `${NEXT(5)} v0.1.13 broker` },
      ],
    });
    const named = nameStopByRelease(row, "v0.1.13");
    expect(named.version).toEqual({
      name: "v0.1.13",
      label: "v0.1.13",
      commit: shortCommit(MEDUSA),
      sha: MEDUSA,
      taggedBy: "broker",
    });
    expect(named.commit).toBe(shortCommit(MEDUSA));
    expect(named.line).toBe("release · v0.1.13");
    expect(named.tone).toBe(row.tone);
  });
});

describe("planReleaseReads", () => {
  const table: ReadonlyArray<{
    readonly name: string;
    readonly heads: ReadonlyArray<readonly [string, string]>;
    readonly running: ReadonlyArray<readonly [string, string]>;
    readonly expected: ReadonlyArray<{ service: string; head: string; from: string | undefined }>;
  }> = [
    {
      name: "a service production already runs is not read",
      heads: [["web", "aaa"]],
      running: [["web", "aaa"]],
      expected: [],
    },
    {
      name: "a service production runs behind is read from what it runs",
      heads: [["web", "bbb"]],
      running: [["web", "aaa"]],
      expected: [{ service: "web", head: "bbb", from: "aaa" }],
    },
    {
      // The first release: production runs nothing, so there is no base to
      // compare against — and the head is exactly what would go live.
      name: "a service production runs nothing of is read with no base",
      heads: [["web", "bbb"]],
      running: [],
      expected: [{ service: "web", head: "bbb", from: undefined }],
    },
    {
      name: "every service is decided on its own",
      heads: [
        ["api", "ccc"],
        ["web", "bbb"],
      ],
      running: [["api", "ccc"]],
      expected: [{ service: "web", head: "bbb", from: undefined }],
    },
  ];

  it.each(table.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(planReleaseReads(new Map(row.heads), new Map(row.running))).toEqual(row.expected);
  });
});

describe("a release in flight", () => {
  const TAGGED = "2026-09-24T10:00:00Z";
  const at = (minutes: number) => Date.parse(TAGGED) + minutes * 60_000;
  const newest = {
    tag: "v0.1.3",
    verdict: "pending" as const,
    entries: [
      { service: "api", commit: API },
      { service: "web", commit: WEB },
    ],
    taggedAt: TAGGED,
  };
  const notYet = new Map([
    ["api", OLD],
    ["web", WEB],
  ]);

  it.each([
    {
      name: "Release is not offered while the newest release tag is pending and production does not run it yet",
      release: newest,
      production: notYet,
      nowMs: at(2),
      inFlight: "v0.1.3",
    },
    {
      name: "an approved tag production does not run yet is still in flight",
      release: { ...newest, verdict: "approved" as const },
      production: notYet,
      nowMs: at(2),
      inFlight: "v0.1.3",
    },
    {
      name: "a tag the broker has not spoken about yet is in flight",
      release: { ...newest, verdict: "unknown" as const },
      production: notYet,
      nowMs: at(0),
      inFlight: "v0.1.3",
    },
    {
      name: "a tag production runs is done",
      release: { ...newest, verdict: "approved" as const },
      production: new Map([
        ["api", API],
        ["web", WEB],
      ]),
      nowMs: at(2),
      inFlight: undefined,
    },
    {
      name: "Release is offered again after the in-flight release failed",
      release: { ...newest, verdict: "refused" as const },
      production: notYet,
      nowMs: at(2),
      inFlight: undefined,
    },
    {
      name: "a tag older than 30 minutes with no final state stops counting",
      release: newest,
      production: notYet,
      nowMs: at(31),
      inFlight: undefined,
    },
    {
      name: "a tag whose time is not read is not held in flight",
      release: { ...newest, taggedAt: undefined },
      production: notYet,
      nowMs: at(2),
      inFlight: undefined,
    },
    {
      name: "no release at all",
      release: undefined,
      production: notYet,
      nowMs: at(2),
      inFlight: undefined,
    },
  ])("$name", ({ release, production, nowMs, inFlight }) => {
    expect(releaseInFlight({ newest: release, production, failed: new Map(), nowMs })).toBe(
      inFlight,
    );
  });

  it("keeps Release from being offered, and says which tag is on its way", () => {
    const gate = releaseOffer({
      mayRelease: true,
      candidate: new Map([["api", API]]),
      production: new Map([["api", OLD]]),
      inFlight: "v0.1.3",
      tags: ["v0.1.3"],
    }).gate;
    expect(gate).toEqual({ allowed: false, reason: releaseInFlightReason("v0.1.3") });
  });
});
