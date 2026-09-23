import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import type { ProjectRef } from "../data/types.ts";
import type { ForgeFact, ForgeStore, PullKey } from "../forge/forgeStore.ts";
import type { Known, Shown } from "../knowledge/known.ts";
import { deployedVersion } from "../groupRows.ts";
import { RECIPE_TIER_PATHS } from "../recipeTier.ts";
import type { DeploymentStore } from "./deploymentStore.ts";
import type { Deployment, StopService } from "./deployment.ts";
import { pullKey, releaseContentKey } from "./groupFlow.ts";
import {
  groupFlowFacts,
  groupFlowInputs,
  groupFlowStops,
  unboundGroupFlowInputs,
  type GroupFlowSource,
} from "./groupFlowReads.ts";

const GITEA = "https://gitea.example";
const PROD = project("p-prod");

const known = <T>(value: T): Known<T> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 1 },
  coverage: "complete",
  freshness: { kind: "live" },
});

/** A forge that holds exactly `held`, by fact. */
function forge(held: ReadonlyArray<readonly [ForgeFact, Shown<unknown>]>): ForgeStore {
  const byKey = new Map(held.map(([fact, shown]) => [JSON.stringify(fact), shown]));
  return {
    read: (fact: ForgeFact) =>
      byKey.get(JSON.stringify(fact)) ?? { state: "unread", waitingFor: null },
    mergeState: (pull: PullKey) =>
      byKey.has(JSON.stringify({ kind: "pull", ...pull }))
        ? known({ kind: "open", mergeability: { kind: "mergeable" }, checks: known("none") })
        : { state: "unread", waitingFor: null },
  } as unknown as ForgeStore;
}

const deployments = (stops: ReadonlyMap<string, Shown<ReadonlyArray<StopService>>>) =>
  ({
    stop: (ref: ProjectRef) => stops.get(ref.projectId) ?? { state: "unread", waitingFor: null },
  }) as unknown as DeploymentStore;

const repo = (name: string) => ({ origin: GITEA, owner: "harbor", repo: name });

const SOURCE: GroupFlowSource = {
  entry: { groupId: "g1", slug: "harbor", projects: [], matesMayRelease: false },
  giteaOrigin: GITEA,
  members: known([{ projectId: "p-prod", name: "harbor production", project: PROD }]),
};

const PRODUCTION_STOP = known([
  { service: service("prod-app", PROD), hostname: "appdev", deployment: known({ kind: "none" }) },
] satisfies ReadonlyArray<StopService>);

/** A tier's `import.yaml` on the group repo's `main`. */
const tier = (path: string) => ({ kind: "file", ...repo("group"), path }) as const;

/** A tier whose one service builds from `repository`. */
const tierYaml = (hostname: string, repository: string) =>
  [
    "services:",
    `  - hostname: ${hostname}`,
    "    type: nodejs@22",
    `    buildFromGit: ${GITEA}/harbor/${repository}.git`,
  ].join("\n");

const HELD: ReadonlyArray<readonly [ForgeFact, Shown<unknown>]> = [
  [tier(RECIPE_TIER_PATHS.stage), known(null)],
  [tier(RECIPE_TIER_PATHS.production), known(tierYaml("appdev", "appdev"))],
  [{ kind: "repos", origin: GITEA, org: "harbor" }, known([{ name: "appdev" }])],
  [
    { kind: "declarations", ...repo("group") },
    known([{ name: "production", tier: "production", project: "p-prod", sources: "release" }]),
  ],
  [{ kind: "open-pulls", ...repo("appdev") }, known([4])],
  [
    { kind: "pull", ...repo("appdev"), number: 4 },
    known({ pull: { number: 4, title: "x", state: "open", head: { sha: "h4" } } }),
  ],
];

describe("a group flow's reads", () => {
  it("demands what what is known so far names: the lists, each head's checks, production's main", () => {
    const stores = {
      forge: forge(HELD),
      deployments: deployments(new Map([["p-prod", PRODUCTION_STOP]])),
    };

    expect(groupFlowFacts(stores, SOURCE)).toEqual([
      { kind: "repos", origin: GITEA, org: "harbor" },
      { kind: "declarations", ...repo("group") },
      { kind: "tags", ...repo("group") },
      tier(RECIPE_TIER_PATHS.stage),
      tier(RECIPE_TIER_PATHS.production),
      { kind: "branch", ...repo("appdev"), branch: "main" },
      { kind: "open-pulls", ...repo("appdev") },
      { kind: "statuses", ...repo("appdev"), sha: "h4" },
    ]);
  });

  it("reads each input as its store holds it, and waits for Gitea without a forge", () => {
    const stores = {
      forge: forge(HELD),
      deployments: deployments(new Map([["p-prod", PRODUCTION_STOP]])),
    };
    const inputs = groupFlowInputs(stores, SOURCE);

    expect(inputs.repos).toMatchObject({ state: "known", value: ["appdev"] });
    expect(inputs.pulls.get(pullKey("appdev", 4))).toMatchObject({
      state: "known",
      value: { pull: { number: 4 }, state: { kind: "open" } },
    });
    expect(inputs.stops.get("p-prod")).toBe(PRODUCTION_STOP);
    expect(inputs.mainHeads.get("appdev")).toEqual({ state: "unread", waitingFor: null });

    const withoutForge = groupFlowInputs({ ...stores, forge: null }, SOURCE);
    expect(withoutForge.tags).toEqual({ state: "unread", waitingFor: "gitea-session" });
    expect(groupFlowFacts({ ...stores, forge: null }, SOURCE)).toEqual([]);
  });

  it("demands its members' stops, and none while the members are not known", () => {
    expect(groupFlowStops(SOURCE)).toEqual([PROD]);
    expect(
      groupFlowStops({ ...SOURCE, members: { state: "reading", sinceMs: 1, attempt: 1 } }),
    ).toEqual([]);
  });

  it("a service whose tier builds from a repository with another name reads that repository's main", () => {
    const held: ReadonlyArray<readonly [ForgeFact, Shown<unknown>]> = [
      ...HELD,
      [tier(RECIPE_TIER_PATHS.production), known(tierYaml("app", "appdev"))],
    ];
    const stores = {
      forge: forge(held),
      deployments: deployments(
        new Map([
          [
            "p-prod",
            known([
              {
                service: service("prod-app", PROD),
                hostname: "app",
                deployment: known({ kind: "none" }),
              },
            ] satisfies ReadonlyArray<StopService>),
          ],
        ]),
      ),
    };

    const facts = groupFlowFacts(stores, SOURCE);
    expect(facts).toContainEqual({ kind: "branch", ...repo("appdev"), branch: "main" });
    expect(facts).not.toContainEqual({ kind: "branch", ...repo("app"), branch: "main" });
    const inputs = groupFlowInputs(stores, SOURCE);
    expect(inputs.tiers).toMatchObject({
      state: "known",
      value: { tiers: ["production"], repositories: new Map([["app", "appdev"]]) },
    });
    expect([...inputs.mainHeads.keys()]).toEqual(["appdev"]);
  });

  it("reads a release's contents: what main has over production, or main's head for a first release", () => {
    const MAIN = "a".repeat(40);
    const RUNS = "b".repeat(40);
    const withProduction = (deployment: Shown<Deployment>) => ({
      forge: forge([
        ...HELD,
        [{ kind: "tags", ...repo("group") }, known([])],
        [{ kind: "branch", ...repo("appdev"), branch: "main" }, known(MAIN)],
        [
          { kind: "compare", ...repo("appdev"), base: RUNS, head: MAIN },
          known([{ sha: MAIN, subject: "Add cart" }]),
        ],
        [
          { kind: "commit", ...repo("appdev"), sha: MAIN },
          known({ sha: MAIN, subject: "First", files: [], additions: 1, deletions: 0 }),
        ],
      ]),
      deployments: deployments(
        new Map([
          [
            "p-prod",
            known([
              { service: service("prod-app", PROD), hostname: "appdev", deployment },
            ] satisfies ReadonlyArray<StopService>),
          ],
        ]),
      ),
    });
    const running = withProduction(
      known({
        kind: "running",
        activatedAt: null,
        version: { ...deployedVersion(RUNS), label: "v1" },
      }),
    );
    expect(groupFlowFacts(running, SOURCE)).toContainEqual({
      kind: "compare",
      ...repo("appdev"),
      base: RUNS,
      head: MAIN,
    });
    const ahead = { repository: "appdev", from: RUNS, head: MAIN };
    expect(groupFlowInputs(running, SOURCE).contents.get(releaseContentKey(ahead))).toMatchObject({
      state: "known",
      value: [{ sha: MAIN, subject: "Add cart" }],
    });

    const first = withProduction(known({ kind: "none" }));
    expect(groupFlowFacts(first, SOURCE)).toContainEqual({
      kind: "commit",
      ...repo("appdev"),
      sha: MAIN,
    });
    const head = { repository: "appdev", from: undefined, head: MAIN };
    expect(groupFlowInputs(first, SOURCE).contents.get(releaseContentKey(head))).toMatchObject({
      state: "known",
      value: [{ sha: MAIN, subject: "First" }],
    });
  });

  it("before the epoch's first grant every input of a group waits for the grant", () => {
    const inputs = unboundGroupFlowInputs(SOURCE);
    const waiting = { state: "unread", waitingFor: "access-grant" };
    expect(inputs.members).toBe(SOURCE.members);
    for (const shown of [inputs.declarations, inputs.repos, inputs.tags, inputs.tiers]) {
      expect(shown).toEqual(waiting);
    }
  });
});
