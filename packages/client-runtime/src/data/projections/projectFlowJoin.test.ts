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
  readonly live?: ReadonlyMap<
    string,
    {
      readonly moved: MovedCommits;
      readonly untold: ReadonlyArray<string>;
      readonly runs: ReadonlyMap<string, ProductionRun> | undefined;
    }
  >;
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
        reason: "You need at least Basic user access to this project's production to release it.",
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
