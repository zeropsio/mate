import { creationHandoff } from "../data/projections/creationHandoff.ts";
import { describe, expect, it } from "vite-plus/test";

import { environmentRow, type EnvironmentRow } from "./groupRows.ts";
import {
  compareForRelease,
  flowReleaseOf,
  isReleaseTag,
  releaseRunBy,
  nameStopByRelease,
  releaseEntries,
  releaseCandidate,
  releaseInFlight,
  releaseRow,
  releaseStalled,
  releaseWord,
  RELEASE_CHECKING,
  RELEASE_NOTHING_MERGED,
  RELEASE_NOTHING_NEW_ON_MAIN,
  shortCommit,
  type FlowRelease,
  type FlowReleaseRow,
} from "./release.ts";
import type { ReleaseDeployFailure } from "./groupDeploys.ts";
import type { ReleaseRollout } from "@t3tools/shared/hqRelease";

const API = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
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
  it("says, per service, what main holds against what production runs", () => {
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

  it("names a service production runs but main has no commit for", () => {
    expect(
      compareForRelease({ candidate: new Map(), production: new Map([["api", API]]) }),
    ).toEqual([{ service: "api", candidate: undefined, production: "3f9c1b2", changed: false }]);
  });

  it("lists every service main has a commit for, changed or not", () => {
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
const NOT_RELEASER = { allowed: false, reason: "Only somebody with Basic user can." } as const;

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

  it("lists a release an older HQ recorded as a snapshot like any other: read-only history", () => {
    const row = releaseRow(
      flowReleaseOf({
        tag: "v0.1.0",
        sha: OLD,
        entries: [{ service: "api", sha: API }],
        by: "u1",
        at: "2026-10-02T10:00:00.000Z",
        state: "approved",
        reason: null,
        rollbackOf: null,
        snapshot: true,
      }),
      1,
      { production: new Map(), failed: [], live: false },
    );
    expect([row.word, row.standing]).toEqual(["Approved", undefined]);
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
  const NONE_FAILED: ReadonlyArray<ReleaseDeployFailure> = [];
  /** HQ's failed job of `service` at `sha`, as the rollout of release `tag` asked for it. */
  const failure = (tag: string, service: string, sha: string): ReleaseDeployFailure => ({
    tag,
    service,
    sha,
  });

  /** The newest-first list's rows, each told whether it is the one `releaseRunBy` names. */
  const rows = (
    releases: ReadonlyArray<FlowRelease>,
    production: ReadonlyMap<string, string>,
    failed: ReadonlyArray<ReleaseDeployFailure> = NONE_FAILED,
  ) => {
    const live = releaseRunBy(releases, production);
    return releases.map((entry, index) =>
      releaseRow(entry, index, {
        production,
        failed,
        live: entry.tag === live,
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
      name: "a commit it lists failed the production deploy its rollout asked for: Deploy failed",
      releases: [release("v1.3.0"), release("v1.2.0", { web: OLD })],
      production: runs(API, OLD),
      failed: [failure("v1.3.0", "web", WEB)],
      expected: [
        { tag: "v1.3.0", standing: "deploy-failed", word: "Deploy failed", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      // A failure is the release's whose rollout asked for the job: an older one listing the same
      // commit did not fail with it.
      name: "an older release lists the failed commit: the failure is the rollout's that asked",
      releases: [release("v1.4.0"), release("v1.3.0", { web: OLD }), release("v1.2.0")],
      production: runs(API, OLD),
      failed: [failure("v1.4.0", "web", WEB)],
      expected: [
        { tag: "v1.4.0", standing: "deploy-failed", word: "Deploy failed", rollBack: false },
        { tag: "v1.3.0", standing: "live", word: "Live", rollBack: false },
        { tag: "v1.2.0", standing: undefined, word: "Approved", rollBack: true },
      ],
    },
    {
      name: "a failure another release's rollout asked for is not this one's, whatever it lists",
      releases: [release("v1.3.0"), release("v1.2.0", { web: OLD })],
      production: runs(API, OLD),
      failed: [failure("v1.1.0", "web", WEB)],
      expected: [
        { tag: "v1.3.0", standing: undefined, word: "Approved", rollBack: false },
        { tag: "v1.2.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "a failed commit production runs anyway is not what failed",
      releases: [release("v1.3.0"), release("v1.2.0", { web: OLD })],
      production: runs(OLD, WEB),
      failed: [failure("v1.3.0", "web", WEB)],
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
      failed: [failure("v1.3.0", "web", OLD)],
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
      [release("v1.3.0"), release("v1.2.0", { web: OLD })],
      runs(API, OLD),
      [failure("v1.3.0", "web", WEB)],
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
  const rollout = (
    tag: string,
    ended: boolean,
    over: Partial<ReleaseRollout> = {},
  ): ReleaseRollout => ({
    id: "7",
    tag,
    planned: true,
    ended,
    endedAt: ended ? "2026-09-24T11:20:00Z" : null,
    landed: false,
    leftOut: [],
    ...over,
  });

  // HQ's rollout of the newest release says when it ends, in each production; no clock does, and
  // nothing it has not said is read as on its way.
  it.each([
    {
      name: "on its way while HQ's rollout of it has not ended",
      release: newest,
      rollouts: [rollout("v0.1.3", false)],
      inFlight: "v0.1.3",
      stalled: undefined,
    },
    {
      name: "on its way before HQ planned it",
      release: newest,
      rollouts: [rollout("v0.1.3", false, { planned: false })],
      inFlight: "v0.1.3",
      stalled: undefined,
    },
    {
      name: "on its way while any production's rollout of it has not ended",
      release: newest,
      rollouts: [rollout("v0.1.3", true), rollout("v0.1.3", false)],
      inFlight: "v0.1.3",
      stalled: undefined,
    },
    {
      name: "ended with something of it not live: stalled",
      release: newest,
      rollouts: [rollout("v0.1.3", true)],
      inFlight: undefined,
      stalled: "v0.1.3",
    },
    {
      // Review #6: HQ says it landed before production's version is read — never stalled.
      name: "ended with all of it live: landed, never stalled",
      release: newest,
      rollouts: [rollout("v0.1.3", true, { landed: true })],
      inFlight: undefined,
      stalled: undefined,
    },
    {
      // Review (delta #9): a Core from before `landed` says nothing of whether it landed — ended,
      // and never stalled without the owner's word: what production runs says the rest.
      name: "ended where HQ tells no landing: neither in flight nor stalled",
      release: newest,
      rollouts: [(({ landed: _landed, ...rest }) => rest)(rollout("v0.1.3", true))],
      inFlight: undefined,
      stalled: undefined,
    },
    {
      // Review #2: made before rollouts were, or recorded from git — HQ says it ended.
      name: "a release HQ ended with no rollout of its own: never on its way",
      release: newest,
      rollouts: [rollout("v0.1.3", true, { id: null })],
      inFlight: undefined,
      stalled: "v0.1.3",
    },
    {
      name: "neither where HQ's rollout names another release: nothing said of this one",
      release: newest,
      rollouts: [rollout("v0.1.2", false)],
      inFlight: undefined,
      stalled: undefined,
    },
    {
      name: "neither where HQ names no release there",
      release: newest,
      rollouts: [null],
      inFlight: undefined,
      stalled: undefined,
    },
    {
      name: "neither where the project has no production environment to deploy it to",
      release: newest,
      rollouts: [],
      inFlight: undefined,
      stalled: undefined,
    },
    {
      name: "neither where HQ tells no release's end (a Core older than this client)",
      release: newest,
      rollouts: [undefined],
      inFlight: undefined,
      stalled: undefined,
    },
    {
      name: "neither for a release HQ refused",
      release: { ...newest, verdict: "refused" as const },
      rollouts: [rollout("v0.1.3", false)],
      inFlight: undefined,
      stalled: undefined,
    },
    {
      name: "neither without a release",
      release: undefined,
      rollouts: [rollout("v0.1.3", false)],
      inFlight: undefined,
      stalled: undefined,
    },
  ])("$name", ({ release, rollouts, inFlight, stalled }) => {
    expect(releaseInFlight({ newest: release, rollouts })).toBe(inFlight);
    expect(releaseStalled({ newest: release, rollouts })).toBe(stalled);
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

  it("compares main's commit against it as the same commit", () => {
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
      failed: [{ tag: "v1.1.0", service: "api", sha: short(OLD) }],
      live: false,
    });
    expect(row.standing).toBe("deploy-failed");
  });
});

// Adding a production is the intent to release (P7): once it is there, main has code and the person
// may release, its first release's review opens by itself; otherwise the production row says it
// waits, and nothing opens.
describe("creationHandoff", () => {
  it.each([
    {
      case: "HQ does not hold the production yet",
      input: { hasProduction: false, gate: { allowed: true } as const },
      want: "wait",
    },
    {
      case: "the release is offered: main has code and the person may release",
      input: { hasProduction: true, gate: { allowed: true } as const },
      want: "open",
    },
    {
      case: "the gate is still checking",
      input: { hasProduction: true, gate: { allowed: false, reason: RELEASE_CHECKING } as const },
      want: "wait",
    },
    {
      case: "main has no code",
      input: {
        hasProduction: true,
        gate: { allowed: false, reason: RELEASE_NOTHING_MERGED } as const,
      },
      want: "drop",
    },
    {
      case: "HQ's rule refuses the person the release",
      input: { hasProduction: true, gate: { ...NOT_RELEASER, refusedBy: "hq" as const } },
      want: "drop",
    },
    {
      case: "main already has all of it",
      input: {
        hasProduction: true,
        gate: { allowed: false, reason: RELEASE_NOTHING_NEW_ON_MAIN } as const,
      },
      want: "drop",
    },
    {
      case: "HQ is not answering",
      input: {
        hasProduction: true,
        gate: { allowed: false, reason: "HQ unavailable since 10:00." } as const,
      },
      want: "wait",
    },
    {
      case: "what goes live could not be compared yet",
      input: {
        hasProduction: true,
        gate: {
          allowed: false,
          reason: "Can't check what can be released: HQ has no such commit.",
        } as const,
      },
      want: "wait",
    },
  ])("is $want when $case", ({ input, want }) => {
    expect(creationHandoff(input)).toBe(want);
  });
});
