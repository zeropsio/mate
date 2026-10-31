import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { mountRoster } from "../../zerops/testing/accountRoster.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { hqAppFamily, hqAppsScope } from "../families/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { inventoryPlacements } from "./inventory.ts";
import { canonicalHqNavigation } from "./hqNavigation.ts";
import { environmentSlots } from "../../zerops/groupEnvironments.ts";
import { linkKeys, type OperationReceipt } from "../model.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import { hqOffer } from "@t3tools/shared/hqOffers";
import {
  canonicalEnvironmentsOf,
  type CanonicalHqEnvironment,
  type HqJob,
} from "../../zerops/hq/environments.ts";
import { environmentById } from "./appEnvironments.ts";
import { canonicalProjectFlow, projectFlow } from "./projectFlow.ts";
import { productionRelease } from "../../zerops/projectFlow.ts";

const key = {
  orgId: "org",
  appId: "shop",
  hqAddress: "https://hq.test",
  viewer: { id: "org", name: "Org", membershipId: "owner", roleCode: "OWNER" },
};
function fixture(
  versions: ReadonlyArray<
    Pick<import("../families/service.ts").ServiceValue, "id" | "activeAppVersion">
  > = [{ id: "web", activeAppVersion: { id: "v1", name: "v1.2.3", source: "GIT" } }],
) {
  const registry = AtomRegistry.make();
  const store = mountRoster(
    registry,
    "org",
    [{ id: "prod", name: "Shop - Production", status: "ACTIVE" }],
    {
      services: versions.map((version) => ({
        ...version,
        projectId: "prod",
        name: version.id,
        status: "ACTIVE",
        isSystem: false,
        serviceStackTypeInfo: {
          serviceStackTypeName: "Node.js",
          serviceStackTypeVersionName: "nodejs@24",
          serviceStackTypeCategory: "USER",
        },
      })),
    },
  );
  seedHqNavigation(store, "org", {
    structure: {
      ungrouped: [],
      apps: [
        {
          id: "shop",
          name: "Shop",
          projects: [{ projectId: "prod", name: "Production", kind: "production", mate: null }],
          environments: [
            {
              name: "production",
              tier: "production",
              projectId: "prod",
              sources: ["release"],
              order: 1,
              keyHeld: true,
              keyInvalid: false,
              jobs: [],
            },
          ],
        },
        { id: "other", name: "Other", projects: [] },
      ],
    },
  });
  return { registry, store, read: () => projectFlow.derive(readsOfState(store.state()), key) };
}

describe("Projects compact flow", () => {
  it.each([
    { title: "a newer environment with an id but no target", environments: [{ id: "prod" }] },
    { title: "a newer unreadable environments field", environments: 42 },
    { title: "a newer omitted environments field", environments: undefined },
  ])("incomplete newer data never erases known environments: $title", ({ environments }) => {
    const f = fixture();
    const scope = hqAppsScope("org");
    const held = readsOfState(f.store.state()).fact("hqApp", "shop");
    if (held.kind !== "known") throw new Error("Fixture must hold the application");
    const value = hqAppFamily.hq!.decode(
      { ...held.value, name: "Shop partial", environments },
      "app:shop",
    )!;
    f.store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: f.store.state().streams.get(scope)!.generation }],
      reset: false,
      rows: [
        {
          family: "hqApp",
          id: "shop",
          value,
          revision: { kind: "hq", incarnation: "seed", revision: 1_000_000 },
        },
      ],
      removals: [],
    });
    const read = readsOfState(f.store.state());
    expect(read.fact("hqApp", "shop")).toMatchObject({
      kind: "known",
      value: { name: "Shop partial" },
    });
    expect(
      canonicalProjectFlow
        .derive(read, key)
        ?.environments.map(({ id, target }) => ({ id, target })),
    ).toEqual([{ id: "prod", target: { kind: "zerops", projectId: "prod" } }]);
    f.registry.dispose();
  });

  it("Removing production offers its empty slot immediately while the Zerops project still exists", () => {
    const f = fixture();
    const scope = hqAppDetailScope("org", "shop");
    f.store.dispatch({
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    });
    f.store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "handshake" } });
    f.store.dispatch({ kind: "baseline-begin", scope, generation: 0 });
    f.store.dispatch({
      kind: "baseline-commit",
      scope,
      generation: 0,
      via: "hq-stream",
      members: ["shop/recipe:stage", "shop/recipe:production"],
      rows: ["stage", "production"].map((tier) => ({
        family: "hqAppDetail" as const,
        id: `shop/recipe:${tier}`,
        revision: { kind: "hq" as const, incarnation: "seed", revision: 100 },
        value: {
          kind: "recipe" as const,
          value: {
            state: "present" as const,
            mainHead: "a".repeat(40),
            importYaml: "services:\n  - hostname: web\n    type: nodejs@24\n",
          },
        },
      })),
    });
    const atom = f.store.data.project(canonicalProjectFlow, key);
    const changes: Array<{ readonly read: boolean; readonly environments: number }> = [];
    const stop = f.registry.subscribe(
      atom,
      (flow) => {
        changes.push({
          read: flow?.declarationsRead === true,
          environments: flow?.environments.length ?? -1,
        });
      },
      { immediate: true },
    );
    try {
      expect(f.registry.get(atom)?.environments).toHaveLength(1);
      seedHqNavigation(f.store, "org", {
        presses: {},
        structure: {
          apps: [
            {
              id: "shop",
              name: "Shop",
              projects: [],
              environments: [],
              can: { add_production: { allow: true } },
            },
          ],
          ungrouped: [],
        },
      });
      const read = readsOfState(f.store.state());
      const flow = f.registry.get(atom)!;
      expect(read.fact("project", "prod").kind).toBe("known");
      expect(inventoryPlacements.derive(read, "org")?.has("prod")).toBe(false);
      expect(flow.declarationsRead).toBe(true);
      expect(flow.environments).toEqual([]);
      expect(changes.every((change) => change.read)).toBe(true);
      expect(changes.at(-1)?.environments).toBe(0);
      const can = canonicalHqNavigation.derive(read, "org").structure?.apps[0]?.can;
      const rows = environmentSlots({
        environments: flow.environments,
        devstages: [],
        pending: [],
        halfMade: [],
        recipeRead: flow.recipeRead,
        recipeTiers: flow.recipeTiers,
        offered: {
          stage: false,
          production:
            hqOffer(can, "add_production", { current: true, unavailableSince: null }).kind ===
            "allowed",
        },
        productionRuns: "unknown",
        waiting: { count: 0, atLeast: false },
        mainHasCode: true,
        releaseOffered: false,
        releasing: undefined,
      });
      expect(rows.find((row) => row.kind !== "devstage" && row.tier === "production")).toEqual({
        kind: "slot",
        tier: "production",
        name: "Production",
        line: "Not added",
        add: true,
      });
    } finally {
      stop();
      f.registry.dispose();
    }
  });

  it("A project's code repositories are those its dev and stage runtimes build from, never a utility's or a managed service's", () => {
    const scope = hqAppDetailScope("org", "shop");
    const hq = "https://hq.test/git/shop";
    const mateTier = [
      "services:",
      "  - hostname: db",
      "    type: postgresql:single@17",
      "  - hostname: mailpit",
      "    type: alpine@3.24",
      "    buildFromGit: https://github.com/zeropsio/recipe-mailpit",
      "  - hostname: medusadev",
      "    type: alpine/nodejs@24",
      `    buildFromGit: ${hq}/medusadev.git`,
      "  - hostname: medusastage",
      "    type: alpine/nodejs@24",
      `    buildFromGit: ${hq}/medusadev.git`,
      "",
    ].join("\n");
    const stageTier = [
      "services:",
      "  - hostname: mailpit",
      "    type: alpine@3.24",
      "    buildFromGit: https://github.com/zeropsio/recipe-mailpit",
      "  - hostname: nextstore",
      "    type: alpine/nodejs@24",
      `    buildFromGit: ${hq}/nextstoredev.git`,
      "",
    ].join("\n");
    const codeRepos = (tiers: Readonly<Record<string, string | null>>) => {
      const f = fixture();
      f.store.dispatch({
        kind: "stream",
        key: scope,
        now: 0,
        event: { kind: "demand", demanded: true },
      });
      f.store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "handshake" } });
      const records = [
        {
          id: "shop/repos",
          value: {
            kind: "repos" as const,
            value: ["group", "mailpit", "medusadev", "nextstoredev", "db"].map((name) => ({
              name,
              mainHead: "b".repeat(40),
              updatedAt: "2026-10-04T10:37:30.000Z",
              remote: null,
            })),
          },
        },
        ...Object.entries(tiers).map(([tier, importYaml]) => ({
          id: `shop/recipe:${tier}`,
          value: {
            kind: "recipe" as const,
            value:
              importYaml === null
                ? { state: "absent" as const }
                : { state: "present" as const, mainHead: "a".repeat(40), importYaml },
          },
        })),
      ];
      f.store.dispatch({ kind: "baseline-begin", scope, generation: 0 });
      f.store.dispatch({
        kind: "baseline-commit",
        scope,
        generation: 0,
        via: "hq-stream",
        members: records.map(({ id }) => id),
        rows: records.map(({ id, value }) => ({
          family: "hqAppDetail" as const,
          id,
          revision: { kind: "hq" as const, incarnation: "seed", revision: 100 },
          value,
        })),
      });
      try {
        return canonicalProjectFlow
          .derive(readsOfState(f.store.state()), key)
          ?.codeRepos?.map(({ name }) => name);
      } finally {
        f.registry.dispose();
      }
    };
    expect(codeRepos({ mate: mateTier })).toBeUndefined();
    expect(codeRepos({ mate: mateTier, stage: stageTier, production: null })).toEqual([
      "medusadev",
      "nextstoredev",
    ]);
    expect(codeRepos({ stage: null, production: null })).toEqual([]);
  });

  it("shows production's actual version while recipes and release history are unread", () => {
    const f = fixture();
    expect(f.read()?.environments[0]?.version.label).toBe("v1.2.3");
    expect(f.read()?.environments[0]?.name).toBe("Production");
    expect(f.read()?.releasesKnown).toBe(false);
    expect(f.read()?.recipeRead).toBe(false);
    expect(f.read()?.changesKnown).toBe(true);
    f.registry.dispose();
  });
  it("keeps an unaffected application's projected value on an unrelated attention update", () => {
    const f = fixture();
    const atom = f.store.data.project(projectFlow, key);
    const release = f.registry.mount(atom);
    const before = f.registry.get(atom);
    const scope = hqMateScope("org", "other");
    f.store.dispatch({
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    });
    f.store.dispatch({ kind: "baseline-begin", scope, generation: 0 });
    f.store.dispatch({
      kind: "baseline-commit",
      scope,
      generation: 0,
      via: "hq-stream",
      members: ["other"],
      rows: [
        {
          family: "hqMate",
          id: "other",
          revision: { kind: "hq", incarnation: "seed", revision: 100 },
          value: {
            presence: { online: true, since: "2026-10-08T00:00:00Z", overview: "none" },
            overview: null,
            attention: null,
            attentionState: "none",
          },
        },
      ],
    });
    expect(f.registry.get(atom)).toBe(before);
    release();
    f.registry.dispose();
  });
  it("retains the known flow during HQ recovery and withholds the release action", () => {
    const f = fixture();
    f.store.dispatch({
      kind: "stream",
      key: linkKeys.hq("org"),
      now: 0,
      event: {
        kind: "fault",
        jitter: 0,
        fault: { outcome: "transient", message: "503" },
      },
    });
    expect(f.read()?.environments[0]?.version.label).toBe("v1.2.3");
    expect(f.read()?.release.gate).toEqual({
      allowed: false,
      reason: "HQ is not answering right now.",
    });
    f.registry.dispose();
  });
  it("A withheld production explains changed access in the release gate and runtime notice's words.", () => {
    const f = fixture();
    f.store.dispatch({ kind: "access", family: "project", id: "prod", access: "denied" });
    expect(f.read()?.release.gate).toEqual({
      allowed: false,
      reason: "Your access to this project changed.",
    });
    f.registry.dispose();
  });

  it("purges a denied production's protected version without erasing another application", () => {
    const f = fixture();
    f.store.dispatch({ kind: "access", family: "project", id: "prod", access: "denied" });
    expect(f.read()?.environments[0]?.version.label).toBeUndefined();
    expect(f.read()?.release.gate.allowed).toBe(false);
    expect(
      projectFlow.derive(readsOfState(f.store.state()), { ...key, appId: "other" }),
    ).toBeDefined();
    f.registry.dispose();
  });
});

const SHA = "1234567890123456789012345678901234567890";
const OTHER_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
function job(service: string, sha: string, id: string): HqJob {
  return {
    id,
    declaration: "1",
    kind: "deploy",
    service,
    sha,
    state: "live",
    cause: "merge",
    ref: "main",
    reason: null,
    appVersionId: `v-${service}`,
    processId: null,
    requestedBy: null,
    at: "2026-10-13T00:00:00Z",
    endedAt: "2026-10-13T00:01:00Z",
    supersededBy: null,
  };
}
const runtimeEnvironment: CanonicalHqEnvironment = {
  declaration: "1",
  id: HqEnvironmentId.make("environment-stage"),
  target: { kind: "zerops", projectId: ProjectId.make("project-stage") },
  projectId: ProjectId.make("wrong-legacy"),
  tier: "stage",
  name: "Stage",
  sources: ["main"],
  order: 2,
  keyHeld: true,
  keyInvalid: false,
  jobs: [job("api", SHA, "job-api"), job("worker", OTHER_SHA, "job-worker")],
};
const gitEnvironment: CanonicalHqEnvironment = {
  ...runtimeEnvironment,
  id: HqEnvironmentId.make("git-id-is-a-real-project"),
  target: { kind: "git", branch: "main", delivery: "direct" },
  order: 1,
  name: "Git",
  can: {},
  birth: null,
  release: null,
  jobs: [],
};
function seedRuntime(
  store: Parameters<typeof seedHqNavigation>[0],
  environments = [runtimeEnvironment, gitEnvironment],
) {
  seedHqNavigation(store, "org", {
    structure: {
      ungrouped: [],
      apps: [
        {
          id: "shop",
          name: "Shop",
          projects: [
            {
              projectId: "git-id-is-a-real-project",
              name: "Decoy",
              kind: "production",
              mate: null,
            },
          ],
          environments,
        },
      ],
    },
  });
}
it("An environment's id never opens a Zerops project.", () => {
  const registry = AtomRegistry.make();
  const store = mountRoster(registry, "org", [
    { id: "git-id-is-a-real-project", name: "Decoy", status: "ACTIVE" },
    { id: "project-stage", name: "Shop - Stage", status: "ACTIVE" },
  ]);
  seedRuntime(store);
  const reads = readsOfState(store.state());
  const projectsRead: string[] = [];
  const tracked: typeof reads = {
    ...reads,
    fact: (family, id) => {
      if (family === "project") projectsRead.push(id);
      return reads.fact(family, id);
    },
  };
  const flow = canonicalProjectFlow.derive(tracked, key)!;
  expect([...new Set(projectsRead)]).toEqual(["project-stage"]);
  expect(flow.environments.map((row) => ({ id: row.id, target: row.target }))).toEqual([
    { id: "git-id-is-a-real-project", target: { kind: "git", branch: "main", delivery: "direct" } },
    { id: "environment-stage", target: { kind: "zerops", projectId: "project-stage" } },
  ]);
  expect(flow.environments.every((row) => !Object.hasOwn(row, "projectId"))).toBe(true);
  expect(
    environmentById.derive(tracked, { ...key, id: HqEnvironmentId.make("environment-stage") })
      ?.target,
  ).toEqual({ kind: "zerops", projectId: "project-stage" });
  expect(
    environmentById.derive(tracked, { ...key, id: HqEnvironmentId.make("project-stage") }),
  ).toBeUndefined();
  expect(projectFlow.derive(reads, key)?.environments.map((row) => row.projectId)).toEqual([
    "project-stage",
  ]);
  registry.dispose();
});
it("One repository's two runtime services share one environment identity and retain their own jobs.", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const read = () => canonicalProjectFlow.derive(readsOfState(store.state()), key);
  expect(read()).toBeUndefined();
  seedRuntime(store, [runtimeEnvironment]);
  expect(read()?.environments.map((row) => row.id)).toEqual(["environment-stage"]);
  expect(
    read()?.environmentInputs[0]?.services.map((service) => ({
      hostname: service.hostname,
      job: service.deploy?.latest.id,
    })),
  ).toEqual([
    { hostname: "api", job: "job-api" },
    { hostname: "worker", job: "job-worker" },
  ]);
  mountRoster(registry, "org", [{ id: "project-stage", name: "Shop - Stage", status: "ACTIVE" }], {
    into: store,
    services: ["api", "worker"].map((name) => ({
      id: name,
      projectId: "project-stage",
      name,
      status: "ACTIVE",
      isSystem: false,
      serviceStackTypeInfo: {
        serviceStackTypeName: "Node.js",
        serviceStackTypeVersionName: "nodejs@24",
        serviceStackTypeCategory: "USER",
      },
      activeAppVersion: { id: `v-${name}`, name: name === "api" ? SHA : OTHER_SHA, source: "GIT" },
    })),
  });
  const flow = read()!;
  expect(flow.environments.map((row) => row.id)).toEqual(["environment-stage"]);
  expect(
    flow.environmentInputs[0]?.services.map((service) => ({
      serviceId: service.serviceId,
      sha: service.appVersionName,
      job: service.deploy?.latest.id,
    })),
  ).toEqual([
    { serviceId: "api", sha: SHA, job: "job-api" },
    { serviceId: "worker", sha: OTHER_SHA, job: "job-worker" },
  ]);
  expect(flow.environments[0]?.version.sha).toBe(SHA);
  registry.dispose();
});

describe("the version names the account's store states", () => {
  it("names a service only where the store states a name for what it runs", () => {
    const f = fixture([
      { id: "s1", activeAppVersion: { id: "v-1", name: "main 3f9c1b2", source: "GIT" } },
      { id: "s2", activeAppVersion: { id: "v-1", name: null, source: "GIT" } },
      { id: "s3" },
    ]);
    const services = canonicalProjectFlow.derive(readsOfState(f.store.state()), key)
      ?.environmentInputs[0]?.services;
    expect(services?.map(({ serviceId, appVersionName }) => [serviceId, appVersionName])).toEqual([
      ["s1", "main 3f9c1b2"],
      ["s2", undefined],
      ["s3", undefined],
    ]);
    f.registry.dispose();
  });

  it("states the id of the version each service runs, null for none, nothing while unread", () => {
    const f = fixture([
      { id: "s1", activeAppVersion: { id: "v-1", source: "GIT" } },
      { id: "s2", activeAppVersion: null },
      { id: "s3" },
    ]);
    const services = canonicalProjectFlow.derive(readsOfState(f.store.state()), key)
      ?.environmentInputs[0]?.services;
    expect(services?.map(({ serviceId, activeVersionId }) => [serviceId, activeVersionId])).toEqual(
      [
        ["s1", "v-1"],
        ["s2", null],
        ["s3", undefined],
      ],
    );
    f.registry.dispose();
  });
});

describe("what a Mate is told of production", () => {
  const COMMIT = "4be1c0d9a7e2f3b4c5d6e7f8091a2b3c4d5e6f70";
  /** HQ's releases of the application, delivered on its detail scope. */
  function deliverReleases(store: ReturnType<typeof fixture>["store"]) {
    const scope = hqAppDetailScope("org", "shop");
    store.dispatch({
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    });
    store.dispatch({ kind: "stream", key: scope, now: 0, event: { kind: "attempt" } });
    store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      scopes: [{ scope, generation: store.state().streams.get(scope)!.generation }],
      reset: true,
      removals: [],
      rows: [
        {
          family: "hqAppDetail",
          id: "shop/releases",
          value: {
            kind: "releases",
            value: [
              {
                tag: "v0.2.0",
                sha: "a".repeat(40),
                entries: [{ service: "web", sha: COMMIT }],
                at: "2026-10-16T19:44:40Z",
                by: "owner",
                reason: null,
                rollbackOf: null,
                state: "approved",
              },
            ],
          },
          revision: { kind: "hq", incarnation: "i", revision: 1 },
        },
      ],
    });
  }

  it("A Mate is told the project production runs in, so its note can carry production's address", () => {
    const f = fixture([
      {
        id: "web",
        activeAppVersion: { id: "v-2", name: `v0.2.0 ${COMMIT.slice(0, 7)}`, source: "GIT" },
      },
    ]);
    deliverReleases(f.store);
    const flow = canonicalProjectFlow.derive(readsOfState(f.store.state()), key);
    expect(productionRelease(flow)).toEqual({
      tag: "v0.2.0",
      taggedAt: "2026-10-16T19:44:40Z",
      projectId: "prod",
    });
    f.registry.dispose();
  });
});

it.each(
  ["release", "roll-back"].flatMap((kind) =>
    ["zerops", "git"].map((target) => ({ kind: kind as "release" | "roll-back", target })),
  ),
)(
  "An accepted $kind keeps $target production releasing until HQ publishes its rollout",
  ({ kind, target }) => {
    const f = fixture();
    const atom = f.store.data.project(canonicalProjectFlow, key);
    const read = () => f.registry.get(atom)!.release;
    const intent =
      kind === "release"
        ? {
            kind,
            orgId: "org",
            appId: "shop",
            tag: "v1.2.4",
            groupHead: "a".repeat(40),
            entries: [],
          }
        : { kind, orgId: "org", appId: "shop", tag: "v1.2.0", groupHead: "a".repeat(40) };
    const receipt: OperationReceipt = {
      requestId: "release-request",
      operationId: "v1.2.4",
      executor: "hq",
      affected: [],
      handles: [],
      acceptance: { kind: "accepted", result: { tag: "v1.2.4", deploys: undefined } },
      outcome: { kind: "pending" },
    };
    f.store.dispatch({ kind: "operation-recorded", requestId: receipt.requestId, intent });
    expect(read().inFlight, "ASSERTION: submitting a request is not acceptance").toBeUndefined();
    f.store.dispatch({ kind: "operation-receipt", receipt });
    expect(read().inFlight, "ASSERTION: HQ acceptance reaches production before navigation").toBe(
      "v1.2.4",
    );
    expect(read().gate).toEqual({ allowed: false, reason: "Releasing v1.2.4…" });
    f.store.dispatch({
      kind: "operation-receipt",
      receipt: { ...receipt, outcome: { kind: "succeeded", evidence: "The release is listed." } },
    });
    expect(read().inFlight, "ASSERTION: the release record does not end its deployment").toBe(
      "v1.2.4",
    );
    const app = readsOfState(f.store.state()).fact("hqApp", "shop");
    if (app.kind !== "known" || !Array.isArray(app.value.environments))
      throw new Error("App fixture missing");
    const environments = app.value.environments;
    f.store.dispatch({
      kind: "delivery",
      via: "hq-stream",
      reset: false,
      removals: [],
      scopes: [
        {
          scope: hqAppsScope("org"),
          generation: f.store.state().streams.get(hqAppsScope("org"))!.generation,
        },
      ],
      rows: [
        {
          family: "hqApp",
          id: "shop",
          revision: { kind: "hq", incarnation: "seed", revision: 100 },
          value: { ...app.value, releaseOffer: { refused: "forbidden" } },
        },
      ],
    });
    expect(
      read().gate,
      "ASSERTION: accepted work cannot override HQ's explicit refusal",
    ).toMatchObject({ allowed: false, refusedBy: "hq" });
    const publish = (ended: boolean) =>
      f.store.dispatch({
        kind: "delivery",
        via: "hq-stream",
        scopes: [
          {
            scope: hqAppsScope("org"),
            generation: f.store.state().streams.get(hqAppsScope("org"))!.generation,
          },
        ],
        reset: false,
        removals: [],
        rows: [
          {
            family: "hqApp",
            id: "shop",
            revision: { kind: "hq", incarnation: "seed", revision: ended ? 102 : 101 },
            value: {
              ...app.value,
              releaseOffer: {
                head: "a".repeat(40),
                suggestion: "v1.2.5",
                summary: { subjects: [], total: 0, more: 0, atLeast: false },
                gate: ended ? { allow: true } : { allow: false, reason: "Releasing v1.2.4…" },
                inFlight: ended ? null : "v1.2.4",
                ...(target === "git"
                  ? {
                      releaseTarget: {
                        environmentId: HqEnvironmentId.make("prod"),
                        createdAt: "2026-10-25T00:00:00Z",
                        target: {
                          kind: "git" as const,
                          branch: "main",
                          delivery: "direct" as const,
                        },
                      },
                    }
                  : {}),
              },
              environments: environments.map((environment) => ({
                ...environment,
                target:
                  target === "git"
                    ? { kind: "git" as const, branch: "main", delivery: "direct" as const }
                    : environment.target,
                release: {
                  id: "rollout",
                  tag: "v1.2.4",
                  planned: true,
                  ended,
                  endedAt: ended ? "2026-10-25T00:00:00Z" : null,
                  landed: ended,
                  leftOut: [],
                },
              })),
            },
          },
        ],
      });
    publish(false);
    if (target === "git")
      expect(read().git?.attachment.target).toEqual({
        kind: "git",
        branch: "main",
        delivery: "direct",
      });
    expect(read().inFlight, "ASSERTION: navigation takes over the same accepted release").toBe(
      "v1.2.4",
    );
    publish(true);
    const published = readsOfState(f.store.state()).fact("hqApp", "shop");
    expect(
      published.kind === "known"
        ? canonicalEnvironmentsOf(published.value.environments)
        : undefined,
    ).toEqual([expect.objectContaining({ release: expect.objectContaining({ ended: true }) })]);
    expect(f.store.state().indexes.get("accepted-release:shop")?.size).toBe(0);
    expect(
      read().inFlight,
      "ASSERTION: HQ's completed rollout ends the accepted-flight bridge",
    ).toBeUndefined();
    f.registry.dispose();
  },
);

it.each(["failed", "cancelled"] as const)(
  "An accepted release stops holding production when HQ reports it %s",
  (outcome) => {
    const f = fixture();
    const intent = {
      kind: "release" as const,
      orgId: "org",
      appId: "shop",
      tag: "v1.2.4",
      groupHead: "a".repeat(40),
      entries: [],
    };
    const receipt: OperationReceipt = {
      requestId: "release-request",
      operationId: "v1.2.4",
      executor: "hq",
      affected: [],
      handles: [],
      acceptance: { kind: "accepted" },
      outcome: { kind: "pending" },
    };
    f.store.dispatch({ kind: "operation-recorded", requestId: receipt.requestId, intent });
    f.store.dispatch({ kind: "operation-receipt", receipt });
    expect(f.read()?.release.inFlight).toBe("v1.2.4");
    f.store.dispatch({
      kind: "operation-receipt",
      receipt: { ...receipt, outcome: { kind: outcome, evidence: "HQ ended the release." } },
    });
    expect(f.read()?.release.inFlight).toBeUndefined();
    expect(f.store.state().indexes.get("accepted-release:shop")?.size).toBe(0);
    f.registry.dispose();
  },
);
