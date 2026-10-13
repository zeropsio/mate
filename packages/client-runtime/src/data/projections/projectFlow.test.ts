import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";
import { mountRoster } from "../../zerops/testing/accountRoster.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { hqAppFamily, hqAppsScope } from "../families/hqNavigation.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { linkKeys } from "../model.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import type { CanonicalHqEnvironment, HqJob } from "../../zerops/hq/environments.ts";
import { environmentById } from "./appEnvironments.ts";
import { canonicalProjectFlow, projectFlow } from "./projectFlow.ts";

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
