import { describe, expect, it } from "vite-plus/test";

import {
  appRecipeOf,
  deployWord,
  environmentRowInputsOf,
  groupStopsOf,
  releaseDeploys,
  statedActiveVersions,
  statedVersionNames,
} from "./groupDeploys.ts";
import type { ZeropsServiceDeployedVersion } from "../data/projections/serviceRuns.ts";
import { environmentRow } from "./groupRows.ts";
import type { Shown } from "./knowledge/known.ts";
import { jobInFlight, type HqEnvironment, type HqJob } from "./hq/environments.ts";
import { releaseCandidate } from "./release.ts";
import { productionRuns, releaseReads } from "./releaseCompare.ts";
import { sameCommit } from "./versionName.ts";

const API = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
const WEB = "77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8";
const OLD = "1111111111111111111111111111111111111111";

const services = [
  { projectId: "p-stage", serviceId: "s1", hostname: "api" },
  { projectId: "p-stage", serviceId: "s2", hostname: "web" },
  { projectId: "p-prod", serviceId: "s3", hostname: "api" },
  { projectId: "p-mate", serviceId: "s4", hostname: "api" },
];

let jobs = 0;
/** What a job the rollout of release v1.0.1 asked for names. */
const RELEASED = { cause: "release", ref: "v1.0.1" } as const;

/** HQ's job of a deploy of `service` at `sha`, in `state`; each newer than the one made before. */
function record(
  state: HqJob["state"],
  sha: string,
  service = "api",
  asked: Pick<HqJob, "cause" | "ref"> = { cause: "merge", ref: sha },
): HqJob {
  jobs += 1;
  return {
    id: String(jobs),
    kind: "deploy",
    service,
    sha,
    state,
    ...asked,
    reason: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: "2026-10-02T10:00:00.000Z",
    endedAt: jobInFlight({ state }) ? null : "2026-10-02T10:04:00.000Z",
    supersededBy: null,
  };
}

function environment(
  overrides: Partial<HqEnvironment> & Pick<HqEnvironment, "projectId" | "tier" | "name">,
): HqEnvironment {
  return {
    sources: overrides.tier === "production" ? ["release"] : ["main"],
    order: 1,
    keyHeld: true,
    keyInvalid: false,
    jobs: [],
    release: null,
    birth: null,
    ...overrides,
  };
}

describe("the join — HQ's record of an environment, a version and a deploy", () => {
  it("reads each environment HQ records, in its order, with each service's newest and live jobs", () => {
    const live = record("live", OLD);
    const failed = record("failed", API);
    const inputs = environmentRowInputsOf({
      environments: [
        environment({ projectId: "p-prod", tier: "production", name: "production", order: 2 }),
        environment({
          projectId: "p-stage",
          tier: "stage",
          name: "stage",
          order: 1,
          keyInvalid: true,
          jobs: [failed, live],
        }),
      ],
      projectNames: new Map([["p-stage", "Acme - stage"]]),
      services,
      versions: new Map([["s1", `main ${OLD.slice(0, 7)}`]]),
      repositories: new Map([["api", "apidev"]]),
    });
    expect(inputs).toEqual([
      {
        projectId: "p-stage",
        name: "Acme - stage",
        tier: "stage",
        sources: ["main"],
        environment: "stage",
        keyHeld: true,
        keyInvalid: true,
        release: null,
        birth: null,
        services: [
          {
            hostname: "api",
            repository: "apidev",
            appVersionName: `main ${OLD.slice(0, 7)}`,
            serviceId: "s1",
            deploy: { latest: failed, live },
          },
          { hostname: "web", serviceId: "s2" },
        ],
      },
      {
        projectId: "p-prod",
        name: "production",
        tier: "production",
        sources: "release",
        environment: "production",
        keyHeld: true,
        keyInvalid: false,
        release: null,
        birth: null,
        services: [{ hostname: "api", repository: "apidev", serviceId: "s3" }],
      },
    ]);
  });

  it("carries the id of the version each service runs, as the platform states it", () => {
    const [stage] = environmentRowInputsOf({
      environments: [environment({ projectId: "p-stage", tier: "stage", name: "stage" })],
      projectNames: new Map(),
      services,
      versions: new Map(),
      activeVersions: new Map([
        ["s1", "v-api"],
        ["s2", null],
      ]),
    });
    expect(stage?.services).toEqual([
      { hostname: "api", serviceId: "s1", activeVersionId: "v-api" },
      { hostname: "web", serviceId: "s2", activeVersionId: null },
    ]);
  });

  it("reads a delta and a job of a service no newer one replaced, never as a service's deploy", () => {
    const delta: HqJob = { ...record("live", API), kind: "delta", service: null, sha: null };
    const [stage] = environmentRowInputsOf({
      environments: [
        environment({ projectId: "p-stage", tier: "stage", name: "stage", jobs: [delta] }),
      ],
      projectNames: new Map(),
      services,
      versions: new Map(),
    });
    expect(stage?.services.map(({ deploy }) => deploy)).toEqual([undefined, undefined]);
  });
});

describe("a service HQ records a deploy of", () => {
  it("stands in its environment's row though the account does not list it", () => {
    const latest = record("failed", API, "worker");
    const [stage] = environmentRowInputsOf({
      environments: [
        environment({
          projectId: "p-stage",
          tier: "stage",
          name: "stage",
          jobs: [latest, record("live", API)],
        }),
      ],
      projectNames: new Map(),
      services,
      versions: new Map(),
      repositories: new Map([["worker", "workerdev"]]),
    });
    expect(stage?.services.map(({ hostname }) => hostname)).toEqual(["api", "web", "worker"]);
    expect(stage?.services[2]).toEqual({
      hostname: "worker",
      repository: "workerdev",
      deploy: { latest, live: null },
    });
  });
});

describe("what a release compares, from HQ's records", () => {
  it("holds a production deploy HQ records as failed, under its service and commit", () => {
    const inputs = environmentRowInputsOf({
      environments: [
        environment({
          projectId: "p-stage",
          tier: "stage",
          name: "stage",
          jobs: [record("failed", WEB)],
        }),
        environment({
          projectId: "p-prod",
          tier: "production",
          name: "production",
          order: 2,
          jobs: [record("failed", API, "api", RELEASED), record("live", OLD)],
        }),
      ],
      projectNames: new Map(),
      services,
      versions: new Map([["s3", `v1.0.0 ${OLD.slice(0, 7)}`]]),
    });
    const { failed, production } = releaseDeploys(inputs);
    expect(failed).toEqual([{ tag: "v1.0.1", service: "api", sha: API }]);
    expect([...production]).toEqual([["api", OLD.slice(0, 7)]]);
  });

  // A failure is a release's by HQ's own link: its rollout asked for the job, or left the service
  // out for that job of the commit — never by when it failed.
  it.each([
    {
      name: "the release's own job",
      job: () => record("failed", API, "api", RELEASED),
      owned: true,
    },
    {
      name: "a merge's job the release left the service out for",
      job: () => record("failed", API),
      owned: "left out",
    },
    {
      name: "a merge's job the release did not wait for",
      job: () => record("failed", API),
      owned: false,
    },
    {
      name: "another release's job",
      job: () => record("failed", API, "api", { cause: "release", ref: "v1.0.0" }),
      owned: false,
    },
  ] as const)("holds a failed $name as the release's: $owned", ({ job, owned }) => {
    const latest = job();
    const { failed } = releaseDeploys(
      environmentRowInputsOf({
        environments: [
          environment({
            projectId: "p-prod",
            tier: "production",
            name: "production",
            jobs: [latest],
            release: {
              id: "9",
              tag: "v1.0.1",
              planned: true,
              ended: true,
              endedAt: "2026-10-02T10:04:00.000Z",
              landed: false,
              leftOut:
                owned === "left out"
                  ? [
                      {
                        service: "api",
                        sha: API,
                        job: latest.id,
                        reason: "a job of it is under way",
                      },
                    ]
                  : [],
            },
          }),
        ],
        projectNames: new Map(),
        services,
        versions: new Map(),
      }),
    );
    expect(failed.some((failure) => failure.tag === "v1.0.1")).toBe(owned !== false);
  });

  it("carries each production's newest release rollout, as HQ told it, and no stage's", () => {
    const rollout = {
      id: "7",
      tag: "v0.1.3",
      planned: true,
      ended: false,
      endedAt: null,
      landed: false,
      leftOut: [],
    };
    const { rollouts } = releaseDeploys(
      environmentRowInputsOf({
        environments: [
          environment({ projectId: "p-stage", tier: "stage", name: "stage" }),
          environment({
            projectId: "p-prod",
            tier: "production",
            name: "production",
            order: 2,
            release: rollout,
          }),
          environment({ projectId: "p-prod2", tier: "production", name: "unreleased", order: 3 }),
        ],
        projectNames: new Map(),
        services,
        versions: new Map(),
      }),
    );
    expect(rollouts).toEqual([rollout, null]);
  });

  it.each([
    { state: "failed", failed: true },
    { state: "refused", failed: true },
    { state: "queued", failed: false },
    { state: "building", failed: false },
    { state: "superseded", failed: false },
  ] as const)("holds a production job $state as failed: $failed", ({ state, failed }) => {
    const { failed: held } = releaseDeploys(
      environmentRowInputsOf({
        environments: [
          environment({
            projectId: "p-prod",
            tier: "production",
            name: "production",
            jobs: [record(state, API, "api", RELEASED)],
          }),
        ],
        projectNames: new Map(),
        services,
        versions: new Map(),
      }),
    );
    expect(held.length > 0).toBe(failed);
  });
});

describe("an application's stops, as HQ records them", () => {
  const projects = [
    {
      projectId: "p-stage",
      name: "Acme - stage",
      role: "stage" as const,
      services: [{ serviceId: "s1", hostname: "api" }],
    },
    { projectId: "p-mate", name: "Acme - Ada", role: "dev" as const, services: [] },
  ];

  it("declares each environment HQ records, and asks for each tier the recipe offers and none fills", () => {
    const stops = groupStopsOf({
      environments: [environment({ projectId: "p-stage", tier: "stage", name: "stage" })],
      projects,
      versions: new Map([["s1", `main ${API.slice(0, 7)}`]]),
      recipe: {
        tiers: ["stage", "production"],
        repositories: new Map([["api", "apidev"]]),
        productionRepositories: new Map(),
        declared: new Map([["stage", ["api"]]]),
      },
    });
    expect(stops.declarations).toEqual([
      { name: "stage", tier: "stage", project: "p-stage", sources: ["main"] },
    ]);
    expect(stops.environments.map((entry) => [entry.name, entry.services])).toEqual([
      [
        "Acme - stage",
        [
          {
            hostname: "api",
            repository: "apidev",
            appVersionName: `main ${API.slice(0, 7)}`,
            serviceId: "s1",
          },
        ],
      ],
    ]);
  });
});

describe("the version names the account's store states", () => {
  const known = (name: string | null): Shown<ZeropsServiceDeployedVersion> => ({
    state: "known",
    value: { activeId: "v-1", source: "GIT", name },
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  });

  it("names a service only where the store states a name for what it runs", () => {
    expect(
      statedVersionNames(
        new Map<string, Shown<ZeropsServiceDeployedVersion>>([
          ["s1", known(`main ${API.slice(0, 7)}`)],
          ["s2", known(null)],
          ["s3", { state: "unread", waitingFor: null }],
        ]),
      ),
    ).toEqual(new Map([["s1", `main ${API.slice(0, 7)}`]]));
  });

  it("states the id of the version each service runs, null for none, nothing while unread", () => {
    const active = (activeId: string | null): Shown<ZeropsServiceDeployedVersion> => ({
      state: "known",
      value: { activeId, source: "GIT", name: null },
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    });
    expect(
      statedActiveVersions(
        new Map<string, Shown<ZeropsServiceDeployedVersion>>([
          ["s1", active("v-1")],
          ["s2", active(null)],
          ["s3", { state: "unread", waitingFor: null }],
        ]),
      ),
    ).toEqual(
      new Map([
        ["s1", "v-1"],
        ["s2", null],
      ]),
    );
  });
});

describe("what the recipe on main offers", () => {
  const stageTier = [
    "services:",
    "  - hostname: app",
    "    type: nodejs@22",
    "    buildFromGit: https://hq.example/git/app-1/appdev.git",
    "    zeropsSetup: app",
    "  - hostname: db",
    "    type: postgresql@16",
    "",
  ].join("\n");

  it("offers each tier on main, and names the repository each runtime builds from", () => {
    expect(appRecipeOf({ stage: stageTier, production: null })).toEqual({
      tiers: ["stage"],
      repositories: new Map([["app", "appdev"]]),
      productionRepositories: new Map(),
      declared: new Map([["stage", ["app", "db"]]]),
    });
  });

  // What a release lists: each production runtime at its repository's main (C01).
  it("names the repository each production runtime builds from, apart", () => {
    const productionTier = stageTier
      .replace("appdev", "appprod")
      .replace("hostname: app", "hostname: web");
    expect(appRecipeOf({ stage: stageTier, production: productionTier })).toEqual({
      tiers: ["stage", "production"],
      repositories: new Map([
        ["app", "appdev"],
        ["web", "appprod"],
      ]),
      productionRepositories: new Map([["web", "appprod"]]),
      declared: new Map([
        ["stage", ["app", "db"]],
        ["production", ["web", "db"]],
      ]),
    });
  });

  // Audit D2: what each environment's tier declares, so a service a person deleted reads
  // "declared in the recipe, not in Zerops" until a person adds it.
  it("carries into each environment the services its tier declares", () => {
    const recipe = appRecipeOf({ stage: stageTier, production: null });
    const [stage, production] = environmentRowInputsOf({
      environments: [
        environment({ projectId: "p-stage", tier: "stage", name: "stage" }),
        environment({ projectId: "p-prod", tier: "production", name: "production", order: 2 }),
      ],
      projectNames: new Map(),
      services: [],
      versions: new Map(),
      declared: recipe.declared,
    });
    expect([stage?.recipeServices, production?.recipeServices]).toEqual([["app", "db"], undefined]);
  });
});

// F13, 2026-10-03: a stage HQ deployed 6aeae99 to read "No repository is declared" while its tier
// named HQ's `https://<hq>/git/<appId>/appdev` — the tie waited on a version the store had not named.
describe("a stop whose tier builds from HQ's git", () => {
  const MAIN = "6aeae99c1d2e3f405162738495a6b7c8d9e0f1a2";
  const tier = (setup: string) =>
    [
      "services:",
      "  - hostname: app",
      "    type: nodejs@22",
      "    buildFromGit: https://hq.example/git/app-1/appdev",
      `    zeropsSetup: ${setup}`,
      "  - hostname: db",
      "    type: postgresql@16",
      "",
    ].join("\n");
  const recipe = appRecipeOf({ stage: tier("stage"), production: tier("prod") });
  const repos = [
    { name: "appdev", mainHead: MAIN, updatedAt: "2026-10-03T08:00:00.000Z" },
    { name: "group", mainHead: OLD, updatedAt: "2026-10-03T08:00:00.000Z" },
  ];
  const projects = [
    {
      projectId: "p-stage",
      name: "Acme - stage",
      services: [
        { serviceId: "stage-app", hostname: "app" },
        { serviceId: "stage-db", hostname: "db" },
      ],
    },
    {
      projectId: "p-prod",
      name: "Acme - production",
      services: [
        { serviceId: "prod-app", hostname: "app" },
        { serviceId: "prod-db", hostname: "db" },
      ],
    },
  ];
  const environments = [
    environment({ projectId: "p-stage", tier: "stage", name: "stage", order: 1 }),
    environment({ projectId: "p-prod", tier: "production", name: "production", order: 2 }),
  ];
  const rowOf = (projectId: string, versions: ReadonlyMap<string, string>) => {
    const stops = groupStopsOf({ environments, projects, versions, recipe });
    const input = stops.environments.find((entry) => entry.projectId === projectId);
    if (input === undefined) throw new Error(`no stop ${projectId}`);
    return environmentRow(input);
  };

  it.each([
    {
      name: "a stage running main's head",
      projectId: "p-stage",
      versions: new Map([["stage-app", `main ${MAIN.slice(0, 7)}`]]),
      atMainHead: true,
    },
    {
      name: "a stage whose version the store has not named yet",
      projectId: "p-stage",
      versions: new Map<string, string>(),
      atMainHead: false,
    },
    {
      name: "a production on the import's no-code version",
      projectId: "p-prod",
      versions: new Map<string, string>(),
      atMainHead: false,
    },
  ])("$name is tied to appdev", ({ projectId, versions, atMainHead }) => {
    const row = rowOf(projectId, versions);
    expect(row.versionRepository).toBe("appdev");
    // What the stop's page compares with what runs: `main`'s head of the tied repository.
    const mainHead = repos.find(({ name }) => name === row.versionRepository)?.mainHead;
    expect(sameCommit(row.version.sha, mainHead)).toBe(atMainHead);
  });

  it("asks HQ to compare appdev up to main for a production that runs nothing", () => {
    const known = (
      activeId: string | null,
      source: string | null,
    ): Shown<ZeropsServiceDeployedVersion> => ({
      state: "known",
      value: { activeId, source, name: null },
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "live" },
    });
    const { productionRepositories } = recipe;
    const running = productionRuns({
      services: projects[1]?.services,
      stated: new Map([
        ["prod-app", known("v-import", "NONE")],
        ["prod-db", known(null, null)],
      ]),
      named: [...productionRepositories.keys()],
      deploys: new Map(),
      releases: [],
    });
    if (running === undefined) throw new Error("production's runs not known");
    const { reads } = releaseReads({
      productionRepositories,
      candidate: releaseCandidate({ productionRepositories, repos }).candidate,
      running,
    });
    expect(reads).toEqual([{ repository: "appdev", query: { head: MAIN }, services: ["app"] }]);
  });
});

describe("the word beside the dot", () => {
  it.each([
    { tone: "good", word: "Deployed" },
    { tone: "pending", word: "Deploying…" },
    { tone: "bad", word: "Failed" },
    { tone: "neutral", word: undefined },
  ] as const)("says $word for $tone", ({ tone, word }) => {
    expect(deployWord(tone)).toBe(word);
  });
});

describe("what a release compares", () => {
  const stage = environment({ projectId: "p-stage", tier: "stage", name: "stage", order: 1 });
  const production = environment({
    projectId: "p-prod",
    tier: "production",
    name: "production",
    order: 2,
  });
  const snapshot = (
    versions: ReadonlyMap<string, string>,
    environments: ReadonlyArray<HqEnvironment> = [stage, production],
  ) => environmentRowInputsOf({ environments, projectNames: new Map(), services, versions });

  it("reads production from the sha in the deployed version's name, never a stage's", () => {
    const commits = releaseDeploys(
      snapshot(
        new Map([
          ["s1", `${API} v1.2.0 ada`],
          ["s2", WEB],
          ["s3", OLD],
        ]),
      ),
    );
    expect([...commits.production]).toEqual([["api", OLD]]);
  });

  it("leaves out a service whose version somebody named by hand", () => {
    const commits = releaseDeploys(snapshot(new Map([["s3", "hotfix"]])));
    expect(commits.production.size).toBe(0);
  });

  it("has nothing to compare for a group that has deployed nothing", () => {
    expect(releaseDeploys(snapshot(new Map())).production.size).toBe(0);
  });
});
