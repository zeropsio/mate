import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  RELEASE_NO_PRODUCTION,
  type AppRecipe,
  type CanonicalGroupStops,
  type GroupEnvironmentRowInput,
  type MovedCommits,
  type ReleaseGate,
} from "@t3tools/client-runtime/zerops";
import type { HqChange, RepoListEntry } from "@t3tools/shared/hqChanges";
import type { Release } from "@t3tools/shared/hqRelease";
import type {
  HqNavigationApp,
  HqNavigationChange,
  HqPushNavigationJob,
} from "@t3tools/shared/hqStream";
import { expect, it } from "vite-plus/test";

import { gitDeliveryOf, type GitDelivery } from "../../zerops/gitDelivery.ts";
import { releaseReview } from "../../zerops/reviewVerdict.ts";
import { groupChangesOf, joinProjectFlows, type ReleaseLive } from "./projectFlowJoin.ts";

/** A deployed Zerops environment, addressed by its project. */
type Input = GroupEnvironmentRowInput & { readonly projectId: string };

const stopsOf = (environments: ReadonlyArray<Input> = []): CanonicalGroupStops => {
  const identified = environments.map(({ projectId, ...entry }) => ({
    ...entry,
    id: HqEnvironmentId.make(projectId),
    target: { kind: "zerops" as const, projectId: ProjectId.make(projectId) },
  }));
  return {
    unread: [],
    declarations: identified.map((entry) => ({
      name: entry.environment,
      tier: entry.tier,
      sources: entry.sources,
      id: entry.id,
      target: entry.target,
    })),
    environments: identified,
  };
};

const NOTHING_WITHHELD: ReadonlyMap<string, string> = new Map();

const GROUPS = [
  { groupId: "g1", slug: "harbor" },
  { groupId: "g2", slug: "links" },
];

function join(input: {
  readonly navigationOffers?:
    | Readonly<Record<string, HqNavigationApp["releaseOffer"] | undefined>>
    | undefined;
  readonly review?: boolean;
  readonly stops?: ReadonlyMap<string, CanonicalGroupStops>;
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
    withheld: input.withheld ?? NOTHING_WITHHELD,
  });
}

// witness: packages/client-runtime/src/data/projections/projectFlowJoin.ts | (entry) => entry.tier === "production" && withheld.has(entry.id), → (entry) => entry.tier === "stage" && withheld.has(entry.id),
it("PJ52: Nothing is offered for release against a production the grant withholds, and the offer says why", () => {
  const MERGED = "2".repeat(40);
  const GROUP_MAIN = "9".repeat(40);
  const production: Input = {
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
  const compared: MovedCommits = {
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
  const first: Release = {
    tag: "v0.1.0",
    sha: "9".repeat(40),
    entries: [{ service: "app", sha: "1".repeat(40) }],
    by: "u1",
    at: "2026-09-24T09:00:00Z",
    state: "approved",
    reason: null,
    rollbackOf: null,
  };
  const release = join({
    review: true,
    navigationOffers: {
      g1: {
        head: GROUP_MAIN,
        suggestion: "v0.1.1",
        inFlight: null,
        gate: { allow: true },
        summary: { total: 1, more: 0, subjects: ["Quicker gallery"], atLeast: false },
      },
    },
    stops: new Map([["g1", stopsOf([production])]]),
    releases: new Map([["g1", [first]]]),
    repos: new Map([["g1", repos]]),
    recipes: new Map([["g1", recipe]]),
    permissions: new Map([["g1", { allowed: true }]]),
    live: new Map([["g1", { moved: compared, untold: [], runs: undefined }]]),
    withheld: new Map([["prod-1", "Checking your access to this project…"]]),
  }).get("g1")?.release;
  expect(release?.gate).toEqual({
    allowed: false,
    reason: "Checking your access to this project…",
  });
  expect(release?.entries).toEqual([]);
  expect(release?.contents).toEqual([]);
  expect(release?.runs).toBeUndefined();
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
  via: "token" as const,
  githubAppId: null,
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
const pushed = (repo: string, sha: string): HqPushNavigationJob => ({
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
});

// witness: packages/client-runtime/src/zerops/gitDelivery.ts | const preflight = preflights.find((entry) => entry.verdict !== "ready"); → const preflight = preflights.find((entry) => entry.verdict === "diverged");
it("PJ53: A release whose preflight has a credential, diverged or unknown blocker is never offered", () => {
  const reasons = {
    credential: "GitHub refused this token; Workflows: Read and write is needed.",
    diverged: "production has commits Mate doesn't; Mate didn't push over them.",
    unknown: "GitHub asked Mate to wait until 12:00.",
  } as const;
  for (const verdict of ["credential", "diverged", "unknown"] as const) {
    const delivery: GitDelivery = gitDeliveryOf(
      {
        id: GIT_ATTACHMENT.environmentId,
        target: GIT_TARGET,
        tier: "production",
        jobs: [pushed("API_v2", GIT_OLD), pushed("Web-App", GIT_OLD)],
      },
      {
        releases: [],
        repos: GIT_REPOS,
        preflight: {
          API_v2: {
            repo: "API_v2",
            remote: GIT_REMOTE,
            ref: "refs/heads/production",
            before: GIT_OLD,
            sha: GIT_SHA,
            verdict,
            reason: reasons[verdict],
            checkedAt: GIT_AT,
          },
        },
      },
    )!;
    const flow = join({
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
            git: {
              attachment: GIT_ATTACHMENT,
              delivery,
              replaceTokenPermission: { allowed: true },
              preflight: GIT_READY,
            },
          },
        ],
      ]),
    }).get("g1")!;
    const review = releaseReview({
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
    expect(flow.release.gate).toEqual({ allowed: false, reason: delivery.release.reason });
    expect(review.verdict.why).toBe(delivery.release.reason?.replace(/\.$/u, ""));
    expect(review.primary).toEqual(
      verdict === "credential" ? { label: "Replace token", enabled: true, safe: false } : undefined,
    );
    expect(review.secondary?.label).toBe("Cancel");
    expect(review.verdict.fix).toBeUndefined();
  }
});

// witness: packages/client-runtime/src/zerops/projectFlow.ts | row.repo === change.repo && row.number === change.number && row.state !== "open" → false
it("PJ94: A change HQ's held detail says merged is listed only as merged, never as open from a navigation row that still lists it", () => {
  const listed: HqNavigationChange = {
    repo: "api",
    number: 26,
    mateProjectId: "mate",
    title: "Add a health check",
    state: "open",
    hasHead: true,
    updatedAt: "2026-11-19T06:52:00Z",
    mergeability: "clean",
    ready: true,
    pullRequest: { number: 26, url: "https://github.com/acme/api/pull/26", state: "open" },
  };
  const landed: HqChange = {
    appId: "merge-lab",
    repo: "api",
    number: 26,
    mateProjectId: "mate",
    branch: "health-check",
    title: "Add a health check",
    body: "Report whether the application is ready.",
    state: "merged",
    head: "a".repeat(40),
    mergedSha: "b".repeat(40),
    landedHead: "a".repeat(40),
    openedAt: "2026-11-19T06:40:00Z",
    mergedAt: "2026-11-19T06:52:40Z",
    closedAt: null,
    updatedAt: "2026-11-19T06:52:40Z",
    mergeability: "clean",
    behind: false,
    ready: true,
    comments: 0,
    receipt: null,
  };
  const changes = groupChangesOf(
    { "merge-lab": [listed] },
    new Map([["merge-lab", [landed]]]),
    "https://hq.example",
  ).get("merge-lab");
  expect(changes?.pullRequests).toEqual([]);
  expect(changes?.merged.map((pull) => [pull.repository, pull.number, pull.merged])).toEqual([
    ["api", 26, true],
  ]);
});
