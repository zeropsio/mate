import * as Schema from "effect/Schema";
import { HqGitNavigationEnvironment } from "@t3tools/shared/hqStream";
import { gitEnvironment, gitRemote, gitPreflight } from "../data/__fixtures__/hqWire.ts";
import { gitDeliveryOf } from "./gitDelivery.ts";
import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canonicalEnvironmentRowInputsOf,
  appRecipeOf,
  deployWord,
  releaseDeploys,
} from "./groupDeploys.ts";
import { canonicalEnvironmentRow } from "./groupRows.ts";
import { canonicalEnvironmentsOf, type HqEnvironment } from "./hq/environments.ts";

const API = "3f9c1b2e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d";
const OLD = "1111111111111111111111111111111111111111";

function environment(
  overrides: Partial<HqEnvironment> & Pick<HqEnvironment, "tier" | "name">,
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

it("HQ's environment identity keys its row while its target joins the Zerops project.", () => {
  const environments = canonicalEnvironmentsOf([
    {
      ...environment({ tier: "stage", name: "Stage" }),
      id: "environment-stage",
      target: { kind: "zerops", projectId: "project-stage" },
    },
  ])!;
  const inputs = canonicalEnvironmentRowInputsOf({
    environments,
    projectNames: new Map([[ProjectId.make("project-stage"), "Project name"]]),
    services: [
      { projectId: ProjectId.make("project-stage"), serviceId: "api", hostname: "api" },
      { projectId: ProjectId.make("environment-stage"), serviceId: "decoy", hostname: "wrong" },
    ],
    versions: new Map([
      ["api", API],
      ["decoy", OLD],
    ]),
  });
  expect(
    inputs.map((input) => ({
      id: input.id,
      target: input.target,
      name: input.name,
      services: input.services.map((service) => service.serviceId),
    })),
  ).toEqual([
    {
      id: "environment-stage",
      target: { kind: "zerops", projectId: "project-stage" },
      name: "Project name",
      services: ["api"],
    },
  ]);
  const rows = inputs.map(canonicalEnvironmentRow);
  expect(rows.map((row) => ({ id: row.id, sha: row.version.sha }))).toEqual([
    { id: "environment-stage", sha: API },
  ]);
  expect(rows[0]).not.toHaveProperty("projectId");
});

const readGitEnvironment = Schema.decodeUnknownSync(HqGitNavigationEnvironment);

it("Git dispatch precedes Zerops project, service, version and recipe reads", () => {
  const environment = readGitEnvironment({
    ...gitEnvironment,
    tier: "stage",
  });
  const git = {
    repos: [
      { name: "web", mainHead: gitPreflight.sha, updatedAt: gitRemote.keptAt, remote: gitRemote },
    ],
  };
  let zeropsReads = 0;
  const input: Parameters<typeof canonicalEnvironmentRowInputsOf>[0] = {
    environments: [environment],
    git,
    get projectNames(): ReadonlyMap<ProjectId, string> {
      zeropsReads++;
      throw new Error("Git demanded Zerops projects");
    },
    get services(): Parameters<typeof canonicalEnvironmentRowInputsOf>[0]["services"] {
      zeropsReads++;
      throw new Error("Git demanded Zerops services");
    },
    get versions(): ReadonlyMap<string, string> {
      zeropsReads++;
      throw new Error("Git demanded Zerops versions");
    },
    get declared(): undefined {
      zeropsReads++;
      throw new Error("Git demanded a service recipe");
    },
  };
  expect(canonicalEnvironmentRowInputsOf(input)[0]).toMatchObject({
    id: "git-production",
    services: [],
    git: gitDeliveryOf(environment, git),
  });
  expect(zeropsReads).toBe(0);
});

it("Git waiting comparisons use the last confirmed pushed sha while a newer release waits", () => {
  const current = gitEnvironment.jobs[0];
  const environment = readGitEnvironment({
    ...gitEnvironment,
    jobs: [
      {
        ...current,
        id: "queued",
        sha: "c".repeat(40),
        state: "queued",
        ref: "v3.0.0",
        evidence: { nextActor: "hq", nextAction: "Wait for the active writer" },
      },
      current,
    ],
  });
  const rows = canonicalEnvironmentRowInputsOf({
    environments: [environment],
    projectNames: new Map(),
    services: [],
    versions: new Map(),
    git: { releases: [] },
  });
  expect([...releaseDeploys(rows).production]).toEqual([["web", gitPreflight.sha]]);
});
