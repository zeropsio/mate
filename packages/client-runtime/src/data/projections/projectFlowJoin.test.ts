import { HqEnvironmentId } from "@t3tools/contracts";
import { gitDeliveryOf, type GitDelivery } from "../../zerops/gitDelivery.ts";
import { releaseReview } from "../../zerops/reviewVerdict.ts";
import type { HqPushNavigationJob } from "@t3tools/shared/hqStream";
import type { ReleaseLive } from "./projectFlowJoin.ts";
import {
  RELEASE_CHECKING,
  RELEASE_NO_PRODUCTION,
  type AppRecipe,
  type GroupEnvironmentRowInput,
  type GroupStops,
  type MovedCommits,
  type ProductionRun,
  type ReleaseGate,
} from "@t3tools/client-runtime/zerops";
import { jobInFlight, type HqJob } from "@t3tools/client-runtime/zerops/hq";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { HqNavigationApp } from "@t3tools/shared/hqStream";
import type { Release, ReleaseRollout } from "@t3tools/shared/hqRelease";
import { describe, expect, it } from "vite-plus/test";

import { joinProjectFlows } from "./projectFlowJoin.ts";

const GROUPS = [
  { groupId: "g1", slug: "harbor" },
  { groupId: "g2", slug: "links" },
];

const stopsOf = (environments: ReadonlyArray<GroupEnvironmentRowInput> = []): GroupStops => ({
  unread: [],
  declarations: environments.map((entry) => ({
    name: entry.environment,
    tier: entry.tier,
    project: entry.projectId,
    sources: entry.sources,
  })),
  environments,
});

const NOTHING_WITHHELD: ReadonlyMap<string, string> = new Map();

/** A release HQ approved of `entries` (`{service: sha}`), made at `at`. */
const approved = (tag: string, entries: Record<string, string>, at: string): Release => ({
  tag,
  sha: "9".repeat(40),
  entries: Object.entries(entries).map(([service, sha]) => ({ service, sha })),
  by: "u1",
  at,
  state: "approved",
  reason: null,
  rollbackOf: null,
});
const FIRST = approved("v0.1.0", { app: "1".repeat(40) }, "2026-09-24T09:00:00Z");

/** HQ's job of a production deploy of `sha`, in `state` since `at`. */
const record = (sha: string, state: HqJob["state"], at: string): HqJob => ({
  id: "1",
  kind: "deploy",
  service: "app",
  sha,
  state,
  cause: "release",
  ref: "v0.1.1",
  reason: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
  at,
  endedAt: jobInFlight({ state }) ? null : at,
  supersededBy: null,
});

function join(input: {
  readonly navigationOffers?:
    | Readonly<Record<string, HqNavigationApp["releaseOffer"] | undefined>>
    | undefined;
  readonly review?: boolean;
  readonly stops?: ReadonlyMap<string, GroupStops>;
  readonly releases?: ReadonlyMap<string, ReadonlyArray<Release>>;
  readonly repos?: ReadonlyMap<string, ReadonlyArray<RepoListEntry>>;
  readonly recipes?: ReadonlyMap<string, AppRecipe>;
  readonly permissions?: ReadonlyMap<string, ReleaseGate | undefined>;
  readonly live?: ReadonlyMap<string, ReleaseLive>;
  readonly withheld?: ReadonlyMap<string, string>;
}) {
  return joinProjectFlows({
    groups: GROUPS,
    navigationOffers: input.navigationOffers ?? {
      g1: {
        head: null,
        suggestion: "v0.1.0",
        gate: { allow: false, reason: RELEASE_NO_PRODUCTION },
        inFlight: null,
        summary: { total: 0, more: 0, subjects: [], atLeast: false },
      },
    },
    review: input.review,
    stops: input.stops ?? new Map(),
    releases: input.releases ?? new Map(),
    repos: input.repos ?? new Map(),
    recipes: input.recipes ?? new Map(),
    permissions: input.permissions ?? new Map(),
    live: input.live ?? new Map(),
    changes: null,
    changesFailure: undefined,
    changesRefused: new Map(),
    withheld: input.withheld ?? NOTHING_WITHHELD,
  });
}

describe("joinProjectFlows", () => {
  it("offers the navigation release review before any application detail is read", () => {
    const offer = {
      head: "9".repeat(40),
      suggestion: "v0.1.1",
      gate: { allow: true },
      inFlight: null,
      summary: { total: 1, more: 0, subjects: ["Ship the storefront"], atLeast: false },
    } as const;
    const flow = join({ navigationOffers: { g1: offer }, review: false }).get("g1");
    expect(flow?.release.gate).toEqual({ allowed: true });
    expect(flow?.release.suggestion).toBe("v0.1.1");
    expect(flow?.release.summary?.subjects).toEqual(["Ship the storefront"]);
    expect(flow?.releasesKnown).toBe(false);
    expect(flow?.recipeRead).toBe(false);
    expect(flow?.release.entries).toEqual([]);
  });

  it("carries that HQ has not read the release offer yet, so its zero summary is not a count", () => {
    const offer = {
      head: null,
      suggestion: "v0.1.1",
      gate: { allow: false, reason: "Reading what a release would carry…" },
      inFlight: null,
      summary: { total: 0, changeCount: 0, more: 0, subjects: [], atLeast: false },
    } as const;
    const read = (summaryRead?: "pending") =>
      join({
        navigationOffers: { g1: summaryRead === undefined ? offer : { ...offer, summaryRead } },
        review: false,
      }).get("g1")?.release.summaryRead;
    expect([read("pending"), read()]).toEqual(["pending", undefined]);
  });

  it("shows an omitted navigation release offer as unknown", () => {
    const flow = join({
      navigationOffers: { g1: undefined },
      review: false,
      stops: new Map([["g1", stopsOf()]]),
    }).get("g1");
    expect(flow?.release?.gate).toEqual({ allowed: false, reason: "Release offer is unknown." });
  });
  it("G2 resolving leaves G1's flow", () => {
    const g1Stops = stopsOf();
    const g1Releases = [FIRST];
    const before = join({
      stops: new Map([["g1", g1Stops]]),
      releases: new Map([["g1", g1Releases]]),
    });
    const after = join({
      stops: new Map([
        ["g1", g1Stops],
        ["g2", stopsOf()],
      ]),
      releases: new Map([["g1", g1Releases]]),
    });
    expect(after.get("g2")).toBeDefined();
    expect(after.get("g1")).toBe(before.get("g1"));
  });

  it("knows a group's environments once HQ has told them", () => {
    const stage: GroupEnvironmentRowInput = {
      projectId: "stage-1",
      name: "harbor stage",
      tier: "stage",
      sources: ["main"],
      environment: "stage",
      keyHeld: true,
      keyInvalid: false,
      services: [],
    };
    expect(join({ releases: new Map([["g1", [FIRST]]]) }).get("g1")?.declarationsRead).toBe(false);
    const flow = join({ stops: new Map([["g1", stopsOf([stage])]]) }).get("g1");
    expect(flow?.declarationsRead).toBe(true);
    expect(flow?.declarations.map(({ project }) => project)).toEqual(["stage-1"]);
    expect(flow?.environments.map(({ name }) => name)).toEqual(["harbor stage"]);
  });

  it("knows whether the recipe is read, which says whether a missing tier is absent or unknown", () => {
    const recipe = { tiers: ["stage"], repositories: new Map(), productionRepositories: new Map() };
    expect(join({ stops: new Map([["g1", stopsOf()]]) }).get("g1")?.recipeRead).toBe(false);
    expect(
      join({
        stops: new Map([["g1", stopsOf()]]),
        recipes: new Map([["g1", recipe as unknown as AppRecipe]]),
      }).get("g1")?.recipeRead,
    ).toBe(true);
  });

  it("knows a group's releases once HQ has answered them", () => {
    expect(join({ stops: new Map([["g1", stopsOf()]]) }).get("g1")?.releasesKnown).toBe(false);
    expect(join({ releases: new Map([["g1", []]]) }).get("g1")?.releasesKnown).toBe(true);
  });

  describe("the release offered", () => {
    const MERGED = "2".repeat(40);
    const GROUP_MAIN = "9".repeat(40);
    const production: GroupEnvironmentRowInput = {
      projectId: "prod-1",
      name: "harbor production",
      tier: "production",
      sources: "release",
      environment: "production",
      keyHeld: true,
      keyInvalid: false,
      services: [{ hostname: "app", appVersionName: `v0.1.0 ${"1".repeat(7)}` }],
    };
    const repos: ReadonlyArray<RepoListEntry> = [
      { name: "appdev", mainHead: MERGED, updatedAt: "2026-09-24T09:30:00Z" },
      { name: "group", mainHead: GROUP_MAIN, updatedAt: "2026-09-24T09:30:00Z" },
    ];
    const recipe: AppRecipe = {
      tiers: ["stage", "production"],
      repositories: new Map([["app", "appdev"]]),
      productionRepositories: new Map([["app", "appdev"]]),
      declared: new Map([["production", ["app"]]]),
    };
    /** What HQ compared a release would put live: the one change on appdev. */
    const COMPARED: MovedCommits = {
      state: "known",
      moved: [
        {
          repository: "appdev",
          services: ["app"],
          commits: [
            {
              sha: MERGED,
              subject: "Quicker gallery",
              authorName: "Juno",
              at: "2026-09-24T09:30:00Z",
              change: null,
            },
          ],
          total: 1,
          truncated: false,
        },
      ],
    };
    const offered = (over: {
      readonly permission?: ReleaseGate | undefined;
      readonly repos?: ReadonlyArray<RepoListEntry> | undefined;
      readonly live?: MovedCommits;
      readonly untold?: ReadonlyArray<string>;
      readonly runs?: ReadonlyMap<string, ProductionRun>;
      readonly withheld?: ReadonlyMap<string, string>;
    }) =>
      join({
        review: true,
        navigationOffers: {
          g1:
            over.permission === undefined
              ? null
              : {
                  head: GROUP_MAIN,
                  suggestion: "v0.1.1",
                  inFlight: null,
                  gate: over.permission.allowed
                    ? { allow: true }
                    : { allow: false, reason: "production_not_writable" },
                  summary: { total: 1, more: 0, subjects: ["Quicker gallery"], atLeast: false },
                },
        },
        stops: new Map([["g1", stopsOf([production])]]),
        releases: new Map([["g1", [FIRST]]]),
        repos: over.repos === undefined ? new Map() : new Map([["g1", over.repos]]),
        recipes: new Map([["g1", recipe]]),
        permissions: new Map([["g1", over.permission]]),
        live: new Map([
          ["g1", { moved: over.live ?? COMPARED, untold: over.untold ?? [], runs: over.runs }],
        ]),
        withheld: over.withheld ?? NOTHING_WITHHELD,
      }).get("g1")?.release;

    it("lists each production runtime at its repository's main, to tag the recipe's main", () => {
      const release = offered({ permission: { allowed: true }, repos });
      expect(release?.gate).toEqual({ allowed: true });
      expect(release?.entries).toEqual([{ service: "app", commit: MERGED }]);
      expect(release?.groupHead).toBe(GROUP_MAIN);
      expect(release?.suggestion).toBe("v0.1.1");
      expect(release?.contents).toEqual(COMPARED.moved);
    });

    it("says HQ's rule in its words to one it does not let release", () => {
      const refusal = {
        allowed: false,
        reason: "You need more than Read access to this project's production to release it.",
      } as const;
      const release = offered({ permission: refusal, repos });
      expect(release?.gate).toEqual(refusal);
      expect(release?.permission).toEqual(refusal);
    });

    it.each([
      ["HQ's rule cannot be asked yet", { permission: undefined, repos }],
      ["HQ's repositories are not read yet", { permission: { allowed: true }, repos: undefined }],
      [
        "HQ has not compared what goes live yet",
        { permission: { allowed: true }, repos, live: { state: "reading" } },
      ],
    ] as const)("is checking while %s", (_case, over) => {
      expect(offered(over)?.gate).toEqual({ allowed: false, reason: RELEASE_CHECKING });
    });

    it("names the production services whose commit cannot be told", () => {
      expect(offered({ permission: { allowed: true }, repos, untold: ["app"] })?.untold).toEqual([
        "app",
      ]);
    });

    it("carries what production runs and the repositories it builds from: what a roll back compares from", () => {
      const runs = new Map<string, ProductionRun>([
        ["app", { kind: "commit", sha: "1".repeat(40) }],
      ]);
      const release = offered({ permission: { allowed: true }, repos, runs });
      expect(release?.runs).toBe(runs);
      expect(release?.repositories).toEqual(new Map([["app", "appdev"]]));
    });

    it("says why where HQ could not compare what goes live", () => {
      const release = offered({
        permission: { allowed: true },
        repos,
        live: { state: "failed", reason: "HQ has no such commit." },
      });
      expect(release?.gate).toEqual({
        allowed: false,
        reason: "Can't check what can be released: HQ has no such commit.",
      });
      expect(release?.contents).toEqual([]);
    });

    it("offers nothing against a production the grant withholds, and says why", () => {
      const release = offered({
        permission: { allowed: true },
        repos,
        withheld: new Map([["prod-1", "Checking your access to this project…"]]),
      });
      expect(release?.gate).toEqual({
        allowed: false,
        reason: "Checking your access to this project…",
      });
      expect(release?.entries).toEqual([]);
      expect(release?.contents).toEqual([]);
      expect(release?.runs).toBeUndefined();
    });

    it("draws a new flow once what production runs changes", () => {
      const stops = new Map([["g1", stopsOf([production])]]);
      const releases = new Map([["g1", [FIRST]]]);
      const runsOf = (sha: string) =>
        join({
          stops,
          releases,
          live: new Map([
            [
              "g1",
              {
                moved: COMPARED,
                untold: [],
                runs: new Map<string, ProductionRun>([["app", { kind: "commit", sha }]]),
              },
            ],
          ]),
        }).get("g1")?.release.runs;
      expect(runsOf("1".repeat(40))?.get("app")).toEqual({ kind: "commit", sha: "1".repeat(40) });
      expect(runsOf("3".repeat(40))?.get("app")).toEqual({ kind: "commit", sha: "3".repeat(40) });
    });
  });

  // A production runs several releases at once when its services were released at different
  // times: a release lists only the services whose `main` moved, so a service keeps running a
  // release that is older than the newest. The stop is the newest release all its services run.
  it.each([
    {
      name: "a production running several releases is named by the newest one all its services run",
      tier: "production" as const,
      nextstore: "5".repeat(40),
      label: "v0.1.13",
    },
    {
      name: "a production no release matches keeps its first labelled service's name",
      tier: "production" as const,
      nextstore: "f".repeat(40),
      label: "v0.1.9",
    },
    {
      name: "a stage keeps its first labelled service's name",
      tier: "stage" as const,
      nextstore: "5".repeat(40),
      label: "v0.1.9",
    },
  ])("$name", ({ tier, nextstore, label }) => {
    const MEDUSA = "a".repeat(40);
    const release = (patch: number) =>
      approved(
        `v0.1.${String(patch)}`,
        { medusa: MEDUSA, nextstore: String(patch - 8).repeat(40) },
        `2026-09-2${String(patch - 9)}T09:00:00Z`,
      );
    const flow = join({
      stops: new Map([
        [
          "g1",
          stopsOf([
            {
              projectId: "env-1",
              name: `beviro ${tier}`,
              tier,
              sources: tier === "production" ? "release" : ["main"],
              environment: tier,
              keyHeld: true,
              keyInvalid: false,
              services: [
                { hostname: "medusa", appVersionName: `${MEDUSA} v0.1.9 broker` },
                { hostname: "nextstore", appVersionName: `${nextstore} v0.1.13 broker` },
              ],
            },
          ]),
        ],
      ]),
      releases: new Map([["g1", [13, 12, 11, 10, 9].map(release)]]),
    }).get("g1");
    expect(flow?.environments.map(({ version }) => version.label)).toEqual([label]);
    expect(flow?.environments[0]?.version.sha).toBe(MEDUSA);
  });

  // The release v0.1.1 lists MERGED; production still runs RUNNING, and HQ records how its newest
  // deploy of the app went.
  const RUNNING = "1".repeat(40);
  const MERGED = "2".repeat(40);
  const TAGGED_AT = "2026-09-24T10:00:00Z";
  function flowWithProductionDeploy(
    latest: HqJob | undefined,
    productionRuns = RUNNING,
    release: ReleaseRollout | null = null,
  ) {
    return join({
      stops: new Map([
        [
          "g1",
          stopsOf([
            {
              projectId: "prod-1",
              name: "harbor production",
              tier: "production",
              sources: "release",
              environment: "production",
              keyHeld: true,
              keyInvalid: false,
              release,
              services: [
                {
                  hostname: "app",
                  appVersionName: productionRuns,
                  ...(latest === undefined ? {} : { deploy: { latest, live: null } }),
                },
              ],
            },
          ]),
        ],
      ]),
      releases: new Map([["g1", [approved("v0.1.1", { app: MERGED }, TAGGED_AT), FIRST]]]),
    }).get("g1");
  }

  it("colleague release appears while production is still building", () => {
    const flow = flowWithProductionDeploy(record(MERGED, "building", "2026-09-24T10:01:00Z"));
    expect(flow?.releases.map(({ tag, word }) => ({ tag, word }))).toEqual([
      { tag: "v0.1.1", word: "Approved" },
      { tag: "v0.1.0", word: "Live" },
    ]);
    expect(flow?.environmentInputs[0]?.services[0]?.deploy?.latest?.state).toBe("building");
  });

  const rowsOf = (flow: ReturnType<typeof flowWithProductionDeploy>) =>
    flow?.releases.map(({ tag, standing, word, rollBack }) => ({ tag, standing, word, rollBack }));

  it.each([
    {
      name: "the release production runs reads Live; the newer one is not a state it was in yet",
      latest: record(MERGED, "building", "2026-09-24T10:01:00Z"),
      runs: RUNNING,
      rows: [
        { tag: "v0.1.1", standing: undefined, word: "Approved", rollBack: false },
        { tag: "v0.1.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "the production deploy the newest release's rollout asked for failed: it reads Deploy failed",
      latest: record(MERGED, "failed", "2026-09-24T10:01:00Z"),
      runs: RUNNING,
      rows: [
        { tag: "v0.1.1", standing: "deploy-failed", word: "Deploy failed", rollBack: false },
        { tag: "v0.1.0", standing: "live", word: "Live", rollBack: false },
      ],
    },
    {
      name: "production moved to the newest: it reads Live, the earlier one offers a roll-back",
      latest: record(MERGED, "live", "2026-09-24T10:01:00Z"),
      runs: MERGED,
      rows: [
        { tag: "v0.1.1", standing: "live", word: "Live", rollBack: false },
        { tag: "v0.1.0", standing: undefined, word: "Approved", rollBack: true },
      ],
    },
  ])("$name", ({ latest, runs, rows }) => {
    expect(rowsOf(flowWithProductionDeploy(latest, runs))).toEqual(rows);
  });

  // HQ's rollout of the newest release says whether it is on its way; no clock and no guess from
  // what production runs or which job failed does.
  const rollout = (tag: string, ended: boolean): ReleaseRollout => ({
    id: "7",
    tag,
    planned: true,
    ended,
    endedAt: ended ? "2026-09-24T11:20:00Z" : null,
    landed: false,
    leftOut: [],
  });
  it.each([
    {
      name: "a release HQ names nothing of is never on its way",
      latest: undefined,
      runs: RUNNING,
      release: null,
      inFlight: undefined,
      stalled: undefined,
    },
    {
      name: "a rollout HQ still follows holds it, whatever production runs",
      latest: record(MERGED, "live", "2026-09-24T10:01:00Z"),
      runs: MERGED,
      release: rollout("v0.1.1", false),
      inFlight: "v0.1.1",
      stalled: undefined,
    },
    {
      name: "a job failed and the rollout runs on: still on its way",
      latest: record(MERGED, "failed", "2026-09-24T10:01:00Z"),
      runs: RUNNING,
      release: rollout("v0.1.1", false),
      inFlight: "v0.1.1",
      stalled: undefined,
    },
    {
      name: "HQ ended its rollout with some of it not live: stalled",
      latest: record(MERGED, "refused", "2026-09-24T10:01:00Z"),
      runs: RUNNING,
      release: rollout("v0.1.1", true),
      inFlight: undefined,
      stalled: "v0.1.1",
    },
    {
      name: "an older release's rollout says nothing of the newest",
      latest: undefined,
      runs: RUNNING,
      release: rollout("v0.1.0", true),
      inFlight: undefined,
      stalled: undefined,
    },
  ])("$name", ({ latest, runs, release, inFlight, stalled }) => {
    const flow = flowWithProductionDeploy(latest, runs, release);
    expect([flow?.release.inFlight, flow?.release.stalled]).toEqual([inFlight, stalled]);
  });
});

describe("an application with no production", () => {
  const older = approved("v0.1.1", { app: "2".repeat(40) }, "2026-09-24T10:00:00Z");
  const flow = (stops: GroupStops | undefined) =>
    join({
      navigationOffers: stops === undefined ? { g1: null } : undefined,
      stops: stops === undefined ? new Map() : new Map([["g1", stops]]),
      releases: new Map([["g1", [older, FIRST]]]),
      permissions: new Map([["g1", { allowed: true }]]),
    }).get("g1");
  const production = stopsOf([
    {
      projectId: "p-prod",
      name: "harbor prod",
      tier: "production",
      sources: "release",
      environment: "prod",
      keyHeld: true,
      keyInvalid: false,
      services: [],
    },
  ]);

  it("offers no release and no roll back when none is declared", () => {
    const joined = flow(stopsOf());
    expect(joined?.release.gate).toEqual({ allowed: false, reason: RELEASE_NO_PRODUCTION });
    expect(joined?.releases.map((row) => row.rollBack)).toEqual([false, false]);
  });

  it("claims nothing before HQ has told the environments", () => {
    expect(flow(undefined)?.release.gate.allowed).toBe(false);
    expect(flow(undefined)?.release.gate).not.toEqual({
      allowed: false,
      reason: RELEASE_NO_PRODUCTION,
    });
    expect(flow(undefined)?.releases.map((row) => row.rollBack)).toEqual([false, false]);
  });

  it("offers a roll back to an earlier release once a production is there", () => {
    expect(flow(production)?.releases.map((row) => row.rollBack)).toContain(true);
  });
});

const GIT_AT = "2026-10-13T10:00:00Z";
const GIT_SHA = "a".repeat(40);
const GIT_OLD = "b".repeat(40);
const GIT_TARGET = { kind: "git", branch: "production", delivery: "direct" } as const;
const GIT_ATTACHMENT = {
  environmentId: HqEnvironmentId.make("git-prod"),
  createdAt: GIT_AT,
  target: GIT_TARGET,
};
const GIT_REMOTE = {
  url: "https://github.com/acme/app.git",
  repositoryId: "1",
  keptAt: GIT_AT,
  keptBy: "Zerops custodian",
  expiresAt: null,
  invalidSince: null,
};
const GIT_REPOS = [
  { name: "API_v2", mainHead: GIT_SHA, updatedAt: GIT_AT, remote: GIT_REMOTE },
  {
    name: "Web-App",
    mainHead: GIT_OLD,
    updatedAt: GIT_AT,
    remote: { ...GIT_REMOTE, url: "https://github.com/acme/web.git" },
  },
  { name: "group", mainHead: "9".repeat(40), updatedAt: GIT_AT },
  { name: "not-connected", mainHead: GIT_SHA, updatedAt: GIT_AT, remote: null },
];
/** HQ's ready preflight of what the Git offer lists: each repository's head on its remote branch. */
const GIT_READY = GIT_REPOS.slice(0, 2).map((repo) => ({
  repo: repo.name,
  remote: repo.remote!,
  ref: "refs/heads/production",
  before: GIT_OLD,
  sha: repo.mainHead,
  verdict: "ready" as const,
  reason: null,
  checkedAt: GIT_AT,
}));
const GIT_OFFER = {
  head: "9".repeat(40),
  suggestion: "v0.1.1",
  gate: { allow: true },
  inFlight: null,
  summary: { total: 1, more: 0, subjects: ["Ship it"], atLeast: false },
  releaseTarget: GIT_ATTACHMENT,
} as const;
function pushed(repo: string, sha: string): HqPushNavigationJob {
  return {
    id: repo,
    kind: "push",
    service: repo,
    sha,
    state: "pushed",
    cause: "release",
    ref: "v0.1.0",
    reason: null,
    appVersionId: null,
    processId: null,
    requestedBy: "releaser",
    at: GIT_AT,
    endedAt: GIT_AT,
    supersededBy: null,
    evidence: {
      confirmed: {
        remote: GIT_REMOTE,
        ref: "refs/heads/production",
        before: null,
        after: sha,
        at: GIT_AT,
        via: "answer",
      },
      nextActor: "none",
      nextAction: "",
    },
  };
}
function gitStanding(
  jobs: ReadonlyArray<HqPushNavigationJob> = [
    pushed("API_v2", GIT_OLD),
    pushed("Web-App", GIT_OLD),
  ],
  repos: ReadonlyArray<RepoListEntry> = GIT_REPOS,
  preflight = {},
): GitDelivery {
  return gitDeliveryOf(
    { id: GIT_ATTACHMENT.environmentId, target: GIT_TARGET, tier: "production", jobs },
    { releases: [], repos, preflight },
  )!;
}
function gitJoin(
  over: Parameters<typeof join>[0] = {},
  delivery: GitDelivery | undefined = gitStanding(),
) {
  return join({
    navigationOffers: { g1: GIT_OFFER },
    review: true,
    releases: new Map([["g1", []]]),
    repos: new Map([["g1", GIT_REPOS]]),
    permissions: new Map([["g1", { allowed: true }]]),
    live: new Map([
      [
        "g1",
        {
          moved: { state: "known", moved: [] },
          untold: [],
          runs: undefined,
          git:
            delivery === undefined
              ? undefined
              : {
                  attachment: GIT_ATTACHMENT,
                  delivery,
                  replaceTokenPermission: { allowed: true },
                  preflight: GIT_READY,
                },
        },
      ],
    ]),
    ...over,
  }).get("g1")!;
}
function gitReview(flow: ReturnType<typeof gitJoin>) {
  return releaseReview({
    tag: flow.release.suggestion,
    gate: flow.release.gate,
    permission: flow.release.permission,
    git: flow.release.git,
    changes: flow.release.summary?.total ?? 0,
    onStage: undefined,
    services: flow.release.entries.map(({ service }) => service),
    replaces: { kind: "first" },
    outcome: { kind: "offered" },
    now: Date.parse(GIT_AT),
  });
}
describe("Git release join to review", () => {
  it("reviews connected repository heads against the last confirmed push without any recipe or Zerops demand", () => {
    const demand = () => {
      throw new Error("Git demanded Zerops services, recipe or receiver facts");
    };
    const recipes = new Map<string, AppRecipe>();
    const stops = new Map<string, GroupStops>();
    recipes.get = (id) => (id === "g1" ? demand() : undefined);
    stops.get = (id) => (id === "g1" ? demand() : undefined);
    const flow = gitJoin({ recipes, stops });
    expect(flow.release.entries).toEqual([
      { service: "API_v2", commit: GIT_SHA },
      { service: "Web-App", commit: GIT_OLD },
    ]);
    expect(flow.release.comparison).toEqual([
      { service: "API_v2", candidate: "aaaaaaa", production: "bbbbbbb", changed: true },
      { service: "Web-App", candidate: "bbbbbbb", production: "bbbbbbb", changed: false },
    ]);
    expect(flow.release.runs).toBeUndefined();
    expect(flow.recipeRead).toBe(false);
    expect(flow.release.groupHead).toBe(GIT_OFFER.head);
    const review = gitReview(flow);
    expect(review.primary).toEqual({ label: "Release v0.1.1", enabled: true, safe: false });
    expect(review.secondary).toEqual({ label: "Cancel", enabled: true });
    expect(review.meta).toEqual(["the first release", "2 repositories", "1 change"]);
    expect(review.consequence).toBe(
      "Mate pushes API_v2 to https://github.com/acme/app.git production and Web-App to https://github.com/acme/web.git production. What happens next is up to those repositories. Only Mate may write to production; a commit made there any other way stops Mate's pushes until you settle it.",
    );
    expect(
      review.repositories?.map(({ repository, sha, included, expiry }) => ({
        repository,
        sha,
        included,
        expiry,
      })),
    ).toEqual([
      { repository: "API_v2", sha: GIT_SHA, included: true, expiry: "Expiry not reported" },
      { repository: "Web-App", sha: GIT_OLD, included: true, expiry: "Expiry not reported" },
      { repository: "not-connected", sha: GIT_SHA, included: false, expiry: undefined },
    ]);
  });
  it.each(["roster", "head", "receipt"] as const)(
    "waits for delayed %s evidence and resolves through the same join",
    (part) => {
      const waiting = gitJoin(
        part === "roster"
          ? { repos: new Map() }
          : part === "head"
            ? { navigationOffers: { g1: { ...GIT_OFFER, head: null } } }
            : { live: new Map() },
      );
      expect(gitReview(waiting).primary).toBeUndefined();
      expect(waiting.release.gate).toEqual({ allowed: false, reason: RELEASE_CHECKING });
      const after = gitJoin();
      expect(after.release.entries).toHaveLength(2);
      expect(gitReview(after).primary?.label).toBe("Release v0.1.1");
    },
  );
  it.each(["credential", "diverged", "unknown"] as const)(
    "reads the single %s preflight blocker and never offers Release",
    (verdict) => {
      const reason =
        verdict === "credential"
          ? "GitHub refused this token; Workflows: Read and write is needed."
          : verdict === "diverged"
            ? "production has commits Mate doesn't; Mate didn't push over them."
            : "GitHub asked Mate to wait until 12:00.";
      const delivery = gitStanding(undefined, GIT_REPOS, {
        API_v2: {
          repo: "API_v2",
          remote: GIT_REMOTE,
          ref: "refs/heads/production",
          before: GIT_OLD,
          sha: GIT_SHA,
          verdict,
          reason,
          checkedAt: GIT_AT,
        },
      });
      const flow = gitJoin({}, delivery);
      const review = gitReview(flow);
      expect(flow.release.gate).toEqual({ allowed: false, reason: delivery.release.reason });
      expect(review.verdict.why).toBe(delivery.release.reason?.replace(/\.$/u, ""));
      expect(review.primary).toEqual(
        verdict === "credential"
          ? { label: "Replace token", enabled: true, safe: false }
          : undefined,
      );
      expect(review.secondary?.label).toBe("Cancel");
      expect(review.verdict.fix).toBeUndefined();
    },
  );
  it("withholds an old attachment's receipts after production is replaced", () => {
    const flow = gitJoin({
      navigationOffers: {
        g1: {
          ...GIT_OFFER,
          releaseTarget: { ...GIT_ATTACHMENT, createdAt: "2026-10-13T11:00:00Z" },
        },
      },
    });
    expect(flow.release.comparison.map(({ production }) => production)).toEqual([
      undefined,
      undefined,
    ]);
    expect(gitReview(flow).primary).toBeUndefined();
    expect(flow.release.gate).toEqual({ allowed: false, reason: RELEASE_CHECKING });
  });
  it("refreshes the comparison when a delayed confirmed receipt changes only the last pushed sha", () => {
    const prior = gitJoin();
    const after = gitJoin({}, gitStanding([pushed("API_v2", GIT_SHA), pushed("Web-App", GIT_OLD)]));
    expect(prior.release.comparison[0]).toEqual({
      service: "API_v2",
      candidate: "aaaaaaa",
      production: "bbbbbbb",
      changed: true,
    });
    expect(after.release.comparison[0]).toEqual({
      service: "API_v2",
      candidate: "aaaaaaa",
      production: "aaaaaaa",
      changed: false,
    });
    expect(after).not.toBe(prior);
  });
  it("reads verified token replacement without replaying an old failed version or applying its stale preflight", () => {
    const reason =
      "The person who supplied this token is no longer in this organization. Replace the token.";
    const preflight = {
      API_v2: {
        repo: "API_v2",
        remote: GIT_REMOTE,
        ref: "refs/heads/production",
        before: GIT_OLD,
        sha: GIT_SHA,
        verdict: "credential" as const,
        reason,
        checkedAt: GIT_AT,
      },
    };
    const before = gitJoin({}, gitStanding(undefined, GIT_REPOS, preflight));
    expect(gitReview(before).primary?.label).toBe("Replace token");
    expect(before.release.git?.delivery?.nextActor).toBe("person");
    const repos = GIT_REPOS.map((repo) =>
      repo.name === "API_v2"
        ? { ...repo, remote: { ...GIT_REMOTE, keptAt: "2026-10-13T11:00:00Z" } }
        : repo,
    );
    const after = gitJoin(
      { repos: new Map([["g1", repos]]) },
      gitStanding(undefined, repos, preflight),
    );
    expect(gitReview(after).primary?.label).toBe("Release v0.1.1");
    expect(after.release.entries[0]).toEqual({ service: "API_v2", commit: GIT_SHA });
    expect(gitReview(before).primary?.label).toBe("Replace token");
  });
  it.each(["queued", "submitting", "unresolved"] as const)(
    "consumes the %s writer blocker even when HQ records an end timestamp",
    (state) => {
      const job = {
        ...pushed("API_v2", GIT_SHA),
        state,
        ref: "v0.1.0",
        evidence: {
          nextActor: "hq" as const,
          nextAction: "Wait for the original writer to settle.",
        },
      };
      const delivery = gitStanding([job]);
      const flow = gitJoin({}, delivery);
      expect(flow.release.gate).toEqual({ allowed: false, reason: delivery.release.reason });
      expect(gitReview(flow).primary).toBeUndefined();
      expect(gitReview(flow).verdict.why).toBe(delivery.release.reason?.replace(/\.$/u, ""));
      expect(flow.release.git?.delivery?.activeVersion).toBe(
        state === "queued" ? undefined : "v0.1.0",
      );
      expect(flow.release.git?.delivery?.queuedVersion).toBe(
        state === "queued" ? "v0.1.0" : undefined,
      );
      expect(flow.release.entries[0]?.commit).toBe(GIT_SHA);
    },
  );
  it("retains HQ's explicit in-flight refusal while a newer repository head waits", () => {
    const flow = gitJoin({
      navigationOffers: {
        g1: {
          ...GIT_OFFER,
          gate: { allow: false, reason: "Releasing v0.1.0…" },
          inFlight: "v0.1.0",
        },
      },
    });
    expect(flow.release.inFlight).toBe("v0.1.0");
    expect(flow.release.gate).toEqual({ allowed: false, reason: "Releasing v0.1.0…" });
    expect(gitReview(flow).primary).toBeUndefined();
  });
  it("keeps the accepted repository roster and left-out sha when another connection arrives", () => {
    const accepted: Release = {
      ...FIRST,
      target: "git",
      releaseTarget: GIT_ATTACHMENT,
      entries: [
        { service: "API_v2", sha: GIT_OLD },
        { service: "Web-App", sha: GIT_OLD },
      ],
    };
    const rollout: ReleaseRollout = {
      id: "rollout",
      tag: FIRST.tag,
      ended: true,
      landed: false,
      target: "git",
      releaseTarget: GIT_ATTACHMENT,
      planned: true,
      endedAt: GIT_AT,
      leftOut: [{ service: "Web-App", sha: GIT_OLD, job: null, reason: "Remote unavailable." }],
    };
    const repos = [
      ...GIT_REPOS,
      { name: "new-connection", mainHead: GIT_SHA, updatedAt: GIT_AT, remote: GIT_REMOTE },
    ];
    const delivery = gitDeliveryOf(
      {
        id: GIT_ATTACHMENT.environmentId,
        target: GIT_TARGET,
        tier: "production",
        jobs: [pushed("API_v2", GIT_OLD)],
        release: rollout,
      },
      { releases: [accepted], repos },
    )!;
    const flow = gitJoin({ repos: new Map([["g1", repos]]) }, delivery);
    const model = releaseReview({
      tag: FIRST.tag,
      gate: flow.release.gate,
      permission: flow.release.permission,
      git: flow.release.git,
      changes: 1,
      onStage: undefined,
      services: [],
      replaces: { kind: "first" },
      outcome: { kind: "released", at: GIT_AT },
      now: Date.parse(GIT_AT),
    });
    expect(
      model.repositories?.map(({ repository, sha, included, reason }) => ({
        repository,
        sha,
        included,
        reason,
      })),
    ).toEqual([
      { repository: "API_v2", sha: GIT_OLD, included: true, reason: undefined },
      { repository: "Web-App", sha: GIT_OLD, included: false, reason: "Remote unavailable." },
    ]);
    expect(model.verdict.why).toBe("Pushed 1 of 2: Web-App: Remote unavailable.");
    expect(model.primary).toBeUndefined();
    expect(model.verdict.fix).toBeUndefined();
    expect(model.ifWrong).toBeUndefined();
    expect(flow.release.entries.map(({ service }) => service)).toEqual([
      "API_v2",
      "Web-App",
      "new-connection",
    ]);
  });
  it("keeps HQ's permission refusal even when projected delivery is ready", () => {
    const flow = gitJoin({
      navigationOffers: {
        g1: {
          ...GIT_OFFER,
          gate: { allow: false, reason: "Only application developers can release." },
        },
      },
      permissions: new Map([
        [
          "g1",
          { allowed: false, reason: "Only application developers can release.", refusedBy: "hq" },
        ],
      ]),
    });
    expect(flow.release.gate).toEqual({
      allowed: false,
      reason: "Only application developers can release.",
      refusedBy: "hq",
    });
    expect(gitReview(flow).primary).toBeUndefined();
  });
});
