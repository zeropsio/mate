import { HqEnvironmentId, ProjectId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";

import { mountRoster } from "../../zerops/testing/accountRoster.ts";
import { type CanonicalHqEnvironment, type HqJob } from "../../zerops/hq/environments.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { hqAppsScope } from "../families/hqNavigation.ts";
import type { OperationReceipt } from "../model.ts";
import { readsOfState } from "../store.ts";
import { environmentById } from "./appEnvironments.ts";
import { projectFlow } from "./projectFlow.ts";

const key = {
  orgId: "org",
  appId: "shop",
  hqAddress: "https://hq.test",
  viewer: { id: "org", name: "Org", membershipId: "owner", roleCode: "OWNER" },
};

/** Production "prod" of application "shop" running web at v1.2.3, beside an application "other". */
function fixture() {
  const registry = AtomRegistry.make();
  const store = mountRoster(
    registry,
    "org",
    [{ id: "prod", name: "Shop - Production", status: "ACTIVE" }],
    {
      services: [
        {
          id: "web",
          activeAppVersion: { id: "v1", name: "v1.2.3", source: "GIT" },
          projectId: "prod",
          name: "web",
          status: "ACTIVE",
          isSystem: false,
          serviceStackTypeInfo: {
            serviceStackTypeName: "Node.js",
            serviceStackTypeVersionName: "nodejs@24",
            serviceStackTypeCategory: "USER",
          },
        },
      ],
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
              id: HqEnvironmentId.make("prod"),
              target: { kind: "zerops", projectId: ProjectId.make("prod") },
              sources: ["release"],
              order: 1,
              keyHeld: true,
              keyInvalid: false,
              jobs: [],
              release: null,
              birth: null,
            },
          ],
        },
        { id: "other", name: "Other", projects: [] },
      ],
    },
  });
  return { registry, store, read: () => projectFlow.derive(readsOfState(store.state()), key) };
}

const SHA = "1234567890123456789012345678901234567890";
const OTHER_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const job = (service: string, sha: string, id: string): HqJob => ({
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
});
const runtimeEnvironment: CanonicalHqEnvironment = {
  id: HqEnvironmentId.make("environment-stage"),
  target: { kind: "zerops", projectId: ProjectId.make("project-stage") },
  tier: "stage",
  name: "Stage",
  sources: ["main"],
  order: 2,
  keyHeld: true,
  keyInvalid: false,
  jobs: [job("api", SHA, "job-api"), job("worker", OTHER_SHA, "job-worker")],
  release: null,
  birth: null,
};
const gitEnvironment: CanonicalHqEnvironment = {
  ...runtimeEnvironment,
  id: HqEnvironmentId.make("git-id-is-a-real-project"),
  target: { kind: "git", branch: "main", delivery: "direct" },
  order: 1,
  name: "Git",
  jobs: [],
};

// witness: packages/client-runtime/src/data/projections/projectFlow.ts | ? [environment.target.projectId] : [] → ? [environment.id] : []
it("PJ50: An environment's id never opens a Zerops project", () => {
  const registry = AtomRegistry.make();
  const store = mountRoster(registry, "org", [
    { id: "git-id-is-a-real-project", name: "Decoy", status: "ACTIVE" },
    { id: "project-stage", name: "Shop - Stage", status: "ACTIVE" },
  ]);
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
          environments: [runtimeEnvironment, gitEnvironment],
        },
      ],
    },
  });
  const reads = readsOfState(store.state());
  const projectsRead: string[] = [];
  const tracked: typeof reads = {
    ...reads,
    fact: (family, id) => {
      if (family === "project") projectsRead.push(id);
      return reads.fact(family, id);
    },
  };
  const flow = projectFlow.derive(tracked, key)!;
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
  registry.dispose();
});

// witness: packages/client-runtime/src/data/operations/receipts.ts | receipt.outcome.kind === "failed" || → receipt.outcome.kind !== "pending" ||
it("PJ51: An accepted release keeps production releasing until HQ publishes its rollout, and stops holding it once HQ reports the rollout failed or cancelled", () => {
  const intent = {
    kind: "release" as const,
    orgId: "org",
    appId: "shop",
    tag: "v1.2.4",
    groupHead: "a".repeat(40),
    entries: [],
  };

  // An accepted release to a Zerops production, held until HQ publishes its ended rollout.
  const f = fixture();
  const atom = f.store.data.project(projectFlow, key);
  const read = () => f.registry.get(atom)!.release;
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
  expect(read().inFlight).toBeUndefined();
  f.store.dispatch({ kind: "operation-receipt", receipt });
  expect(read().inFlight).toBe("v1.2.4");
  expect(read().gate).toEqual({ allowed: false, reason: "Releasing v1.2.4…" });
  f.store.dispatch({
    kind: "operation-receipt",
    receipt: { ...receipt, outcome: { kind: "succeeded", evidence: "The release is listed." } },
  });
  expect(read().inFlight).toBe("v1.2.4");
  const app = readsOfState(f.store.state()).fact("hqApp", "shop");
  if (app.kind !== "known" || !Array.isArray(app.value.environments))
    throw new Error("App fixture missing");
  const environments = app.value.environments;
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
            },
            environments: environments.map((environment) => ({
              ...environment,
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
  expect(read().inFlight).toBe("v1.2.4");
  publish(true);
  expect(f.store.state().indexes.get("accepted-release:shop")?.size).toBe(0);
  expect(read().inFlight).toBeUndefined();
  f.registry.dispose();

  // HQ reports the accepted release failed, or cancelled: production is no longer held.
  for (const outcome of ["failed", "cancelled"] as const) {
    const ended = fixture();
    const accepted: OperationReceipt = {
      requestId: "release-request",
      operationId: "v1.2.4",
      executor: "hq",
      affected: [],
      handles: [],
      acceptance: { kind: "accepted" },
      outcome: { kind: "pending" },
    };
    ended.store.dispatch({ kind: "operation-recorded", requestId: accepted.requestId, intent });
    ended.store.dispatch({ kind: "operation-receipt", receipt: accepted });
    expect(ended.read()?.release.inFlight).toBe("v1.2.4");
    ended.store.dispatch({
      kind: "operation-receipt",
      receipt: { ...accepted, outcome: { kind: outcome, evidence: "HQ ended the release." } },
    });
    expect(ended.read()?.release.inFlight).toBeUndefined();
    expect(ended.store.state().indexes.get("accepted-release:shop")?.size).toBe(0);
    ended.registry.dispose();
  }
});
