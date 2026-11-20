import { expect, it } from "@effect/vitest";
import { it as plainIt } from "vite-plus/test";
import type { HqChange } from "@t3tools/shared/hqChanges";
import type { Release, HqGitReleasePreflight } from "@t3tools/shared/hqRelease";
import { HqEnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { mountRoster } from "../../zerops/testing/accountRoster.ts";
import { GIT_PREFLIGHT_PENDING } from "../../zerops/release.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { ORG } from "../__fixtures__/account.ts";
import { hqAppDetailScope, type HqAppDetailValue } from "../families/hqAppDetail.ts";
import { projectFlow } from "../projections/projectFlow.ts";
import { operationProgress } from "../projections/operation.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import { releaseRequestOf } from "./flowWrites.ts";
const SHA = "a".repeat(40);
const HEAD = "b".repeat(40);
const LINK = { appId: "shop", repo: "web", number: 7 };
const change = (state: HqChange["state"]): HqChange => ({
  appId: "shop",
  repo: "web",
  number: 7,
  mateProjectId: "ada",
  branch: "change",
  receipt: null,
  title: "Add a page",
  body: "",
  state,
  head: HEAD,
  mergedSha: null,
  landedHead: null,
  openedAt: "2026-10-06T00:00:00Z",
  mergedAt: null,
  closedAt: null,
  updatedAt: "2026-10-06T00:00:00Z",
  mergeability: "clean",
  behind: false,
  ready: true,
  comments: 0,
});
let revision = 0;
/** HQ's app-detail stream saying records of the Git production's application. */
function detail(store: AccountStore, records: Readonly<Record<string, HqAppDetailValue>>) {
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope: hqAppDetailScope("org", "shop"), generation: 0 }],
    reset: false,
    rows: Object.entries(records).map(([id, value]) => ({
      family: "hqAppDetail",
      id: `shop/${id}`,
      revision: { kind: "hq", incarnation: "i", revision: (revision += 1) },
      value,
    })),
    removals: [],
  });
}

function submitThroughHq(store: AccountStore, writes: Partial<HqWrites>) {
  return makeOperations({
    store,
    makeId: () => "r1",
    executors: {
      hq: makeHqExecutor({
        apiOf: () => writes as HqWrites,
        zerops: {
          mintIntegrationToken: () => Promise.reject(new Error("Unexpected token mint")),
          deleteIntegrationToken: () => Promise.reject(new Error("Unexpected token deletion")),
        },
      }),
    },
  });
}
const progress = (store: AccountStore) =>
  operationProgress.derive(readsOfState(store.state()), "r1");

// witness: packages/client-runtime/src/data/operations/flowWrites.ts | return state === "closed" → return state === "merged"
it.effect("OP35: A colleague's merge ends a pending Close without claiming it was closed", () =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    detail(store, { changes: { kind: "changes", value: [change("open")] } });
    const operations = submitThroughHq(store, { closeChange: async () => change("closed") });
    yield* operations.submit({ kind: "close-change", orgId: ORG, link: LINK, expectedHead: HEAD });
    detail(store, { changes: { kind: "changes", value: [change("merged")] } });
    expect(progress(store)).toEqual({
      stage: "done",
      operationId: "web#7",
      outcome: "failed",
      reason: "The change was merged instead of closed.",
    });
  }),
);

// witness: packages/client-runtime/src/data/operations/flowWrites.ts | return listed.state === "approved" → return listed.state === "refused"
it.effect("OP36: A release HQ records as refused ends failed, in HQ's words", () =>
  Effect.gen(function* () {
    const store = makeAccountStore(AtomRegistry.make());
    const made: Release = {
      tag: "v1.0.1",
      sha: SHA,
      entries: [{ service: "api", sha: SHA }],
      by: "ada",
      at: "2026-10-06T00:00:00Z",
      state: "refused",
      reason: "Production is busy.",
      rollbackOf: null,
    };
    const operations = submitThroughHq(store, {
      release: async () => ({ made, deploys: undefined }),
    });
    yield* operations.submit({
      kind: "release",
      orgId: ORG,
      appId: "shop",
      tag: "v1.0.1",
      groupHead: HEAD,
      entries: [{ service: "api", sha: SHA }],
    });
    detail(store, { releases: { kind: "releases", value: [made] } });
    expect(progress(store)).toEqual({
      stage: "done",
      operationId: "v1.0.1",
      outcome: "failed",
      reason: "Production is busy.",
    });
  }),
);
const AT = "2026-10-13T10:00:00Z";
const API = "a".repeat(40);
const GROUP = "9".repeat(40);
const ATTACHMENT = {
  environmentId: HqEnvironmentId.make("git-prod"),
  createdAt: AT,
  target: { kind: "git", branch: "production", delivery: "direct" },
} as const;
// HQ says one credential's instant two ways: its repositories trimmed, its preflight to the microsecond.
const REMOTE = {
  url: "https://github.com/acme/api.git",
  repositoryId: "1",
  keptAt: "2026-10-13T09:59:34.64522Z",
  keptBy: "Zerops custodian",
  expiresAt: null,
  invalidSince: null,
  via: "token" as const,
  githubAppId: null,
};
const READY: HqGitReleasePreflight = {
  repo: "api",
  remote: { ...REMOTE, keptAt: "2026-10-13T09:59:34.645220Z" },
  ref: "refs/heads/production",
  before: null,
  sha: API,
  verdict: "ready",
  reason: null,
  checkedAt: AT,
};
const key = {
  orgId: "org",
  appId: "shop",
  hqAddress: "https://hq.test",
  viewer: { id: "org", name: "Org", membershipId: "owner", roleCode: "OWNER" },
};
function gitProduction(preflight: ReadonlyArray<HqGitReleasePreflight>) {
  const registry = AtomRegistry.make();
  const store = mountRoster(registry, "org", []);
  seedHqNavigation(store, "org", {
    structure: {
      ungrouped: [],
      apps: [
        {
          id: "shop",
          name: "Shop",
          projects: [],
          environments: [
            {
              id: ATTACHMENT.environmentId,
              target: ATTACHMENT.target,
              tier: "production",
              name: "production",
              sources: ["release"],
              order: 1,
              keyHeld: true,
              keyInvalid: false,
              birth: null,
              release: null,
              jobs: [],
            },
          ],
        },
      ],
    },
    releaseOffers: {
      shop: {
        head: GROUP,
        suggestion: "v0.1.0",
        summary: { subjects: ["Ship it"], total: 1, more: 0, atLeast: false },
        gate: { allow: true },
        releaseTarget: ATTACHMENT,
        inFlight: null,
      },
    },
  });
  detail(store, {
    releases: { kind: "releases", value: [] },
    repos: {
      kind: "repos",
      value: [
        { name: "group", mainHead: GROUP, updatedAt: AT },
        { name: "api", mainHead: API, updatedAt: AT, remote: REMOTE },
      ],
    },
    ...Object.fromEntries(
      preflight.map((review) => [
        `preflight:${review.repo}`,
        { kind: "preflight", repo: review.repo, value: review } as const,
      ]),
    ),
  });
  const flow = projectFlow.derive(readsOfState(store.state()), key);
  registry.dispose();
  return flow;
}

{
  const it = plainIt;

  // witness: packages/client-runtime/src/data/operations/flowWrites.ts | offer.git !== undefined && offer.git.preflight === undefined → offer.git !== undefined && offer.git.preflight !== undefined
  it("OP37: A Git production release waits for HQ's ready preflight", () => {
    for (const preflight of [
      [],
      [{ ...READY, sha: "c".repeat(40) }],
      [{ ...READY, remote: { ...READY.remote, keptAt: "2026-10-13T11:00:00.000000Z" } }],
    ]) {
      const flow = gitProduction(preflight);
      if (flow === undefined) throw new Error("The Git production's flow must be read");
      expect(flow.release.git?.preflight).toBeUndefined();
      expect(flow.release.gate.allowed).toBe(true);
      expect(releaseRequestOf(flow.release, "v0.1.0")).toEqual({
        refused: GIT_PREFLIGHT_PENDING,
        says: false,
      });
    }
  });
}
