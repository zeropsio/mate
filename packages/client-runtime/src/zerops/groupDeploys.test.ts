import { describe, expect, it } from "vite-plus/test";

import {
  appRecipeOf,
  deployWord,
  environmentRowInputsOf,
  groupStopsOf,
  releaseDeploys,
} from "./groupDeploys.ts";
import type { HqDeploy, HqEnvironment } from "./hq/environments.ts";

const API = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
const WEB = "77ab0e1f2d3c4b5a69788796a5b4c3d2e1f0a9b8";
const OLD = "1111111111111111111111111111111111111111";

const services = [
  { projectId: "p-stage", serviceId: "s1", hostname: "api" },
  { projectId: "p-stage", serviceId: "s2", hostname: "web" },
  { projectId: "p-prod", serviceId: "s3", hostname: "api" },
  { projectId: "p-mate", serviceId: "s4", hostname: "api" },
];

function record(state: HqDeploy["state"], sha: string): HqDeploy {
  return {
    sha,
    state,
    failure: state === "failed" ? "job" : null,
    message: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: "2026-10-02T10:00:00.000Z",
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
    deploys: [],
    ...overrides,
  };
}

describe("the join — HQ's record of an environment, a version and a deploy", () => {
  it("reads each environment HQ records, in its order, with each service's deploys", () => {
    const apiDeploys = { service: "api", latest: record("failed", API), live: record("live", OLD) };
    const inputs = environmentRowInputsOf({
      environments: [
        environment({ projectId: "p-prod", tier: "production", name: "production", order: 2 }),
        environment({
          projectId: "p-stage",
          tier: "stage",
          name: "stage",
          order: 1,
          deploys: [apiDeploys],
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
        services: [
          {
            hostname: "api",
            repository: "apidev",
            appVersionName: `main ${OLD.slice(0, 7)}`,
            deploy: { latest: apiDeploys.latest, live: apiDeploys.live },
          },
          { hostname: "web" },
        ],
      },
      {
        projectId: "p-prod",
        name: "production",
        tier: "production",
        sources: "release",
        environment: "production",
        services: [{ hostname: "api", repository: "apidev" }],
      },
    ]);
  });
});

describe("a service HQ records a deploy of", () => {
  it("stands in its environment's row though the account does not list it", () => {
    const latest = record("failed", API);
    const [stage] = environmentRowInputsOf({
      environments: [
        environment({
          projectId: "p-stage",
          tier: "stage",
          name: "stage",
          deploys: [
            { service: "api", latest: record("live", API), live: record("live", API) },
            { service: "worker", latest, live: null },
          ],
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
          deploys: [{ service: "api", latest: record("failed", WEB), live: null }],
        }),
        environment({
          projectId: "p-prod",
          tier: "production",
          name: "production",
          order: 2,
          deploys: [{ service: "api", latest: record("failed", API), live: record("live", OLD) }],
        }),
      ],
      projectNames: new Map(),
      services,
      versions: new Map([["s3", `v1.0.0 ${OLD.slice(0, 7)}`]]),
    });
    const { failed, production } = releaseDeploys(inputs);
    expect([...failed]).toEqual([[`api@${API}`, "2026-10-02T10:00:00.000Z"]]);
    expect([...production]).toEqual([["api", OLD.slice(0, 7)]]);
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
      recipe: { tiers: ["stage", "production"], repositories: new Map([["api", "apidev"]]) },
    });
    expect(stops.declarations).toEqual([
      { name: "stage", tier: "stage", project: "p-stage", sources: ["main"], deploy: undefined },
    ]);
    expect(stops.environments.map((entry) => [entry.name, entry.services])).toEqual([
      [
        "Acme - stage",
        [{ hostname: "api", repository: "apidev", appVersionName: `main ${API.slice(0, 7)}` }],
      ],
    ]);
    expect(stops.missing.map((row) => row.tier)).toEqual(["production"]);
  });

  it("asks for no tier while the recipe is not read", () => {
    const stops = groupStopsOf({
      environments: [],
      projects,
      versions: new Map(),
      recipe: undefined,
    });
    expect(stops.missing).toEqual([]);
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
    });
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

  it("reads both sides from the sha in the deployed version's name", () => {
    const commits = releaseDeploys(
      snapshot(
        new Map([
          ["s1", `${API} v1.2.0 ada`],
          ["s2", WEB],
          ["s3", OLD],
        ]),
      ),
    );
    expect([...commits.stage]).toEqual([
      ["api", API],
      ["web", WEB],
    ]);
    expect([...commits.production]).toEqual([["api", OLD]]);
  });

  it("leaves out a service whose version somebody named by hand", () => {
    const commits = releaseDeploys(snapshot(new Map([["s1", "hotfix"]])));
    expect(commits.stage.size).toBe(0);
  });

  it("has nothing to compare for a group that has deployed nothing", () => {
    const commits = releaseDeploys(snapshot(new Map()));
    expect(commits.stage.size).toBe(0);
    expect(commits.production.size).toBe(0);
  });

  it("takes the first declared stage where two of them run the same service", () => {
    const commits = releaseDeploys(
      snapshot(
        new Map([
          ["s4", OLD],
          ["s1", API],
        ]),
        [
          { ...stage, order: 2 },
          environment({ projectId: "p-mate", tier: "stage", name: "stage-client-x", order: 1 }),
          { ...production, order: 3 },
        ],
      ),
    );
    expect(commits.stage.get("api")).toBe(OLD);
  });
});
