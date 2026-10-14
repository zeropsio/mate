import { describe, expect, it } from "@effect/vitest";
import { HqEnvironmentId } from "@t3tools/contracts";
import { CreateReleaseRequest, type HqGitReleasePreflight } from "@t3tools/shared/hqRelease";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AtomRegistry } from "effect/reactivity";

import { mountRoster } from "../../zerops/testing/accountRoster.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { hqAppDetailScope } from "../families/hqAppDetail.ts";
import { canonicalProjectFlow } from "../projections/projectFlow.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import { makeOperations } from "./coordinator.ts";
import { makeHqExecutor, type HqWrites } from "./executors/hq.ts";
import { GIT_PREFLIGHT_PENDING } from "../../zerops/release.ts";
import { releaseRequestOf } from "./flowWrites.ts";

const AT = "2026-10-13T10:00:00Z";
const API = "a".repeat(40);
const GROUP = "9".repeat(40);
const ATTACHMENT = {
  environmentId: HqEnvironmentId.make("git-prod"),
  createdAt: AT,
  target: { kind: "git", branch: "production", delivery: "direct" },
} as const;
const REMOTE = {
  url: "https://github.com/acme/api.git",
  repositoryId: "1",
  keptAt: AT,
  keptBy: "Zerops custodian",
  expiresAt: null,
  invalidSince: null,
};
const READY: HqGitReleasePreflight = {
  repo: "api",
  remote: REMOTE,
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

let revision = 0;
/** HQ's app-detail stream saying records of the Git production's application. */
function detail(store: AccountStore, records: Readonly<Record<string, unknown>>) {
  store.dispatch({
    kind: "delivery",
    via: "hq-stream",
    scopes: [{ scope: hqAppDetailScope("org", "shop"), generation: 0 }],
    reset: false,
    rows: Object.entries(records).map(([id, value]) => ({
      family: "hqAppDetail",
      id: `shop/${id}`,
      revision: { kind: "hq", incarnation: "i", revision: (revision += 1) },
      value: value as never,
    })),
    removals: [],
  });
}

/** An application whose production is a branch of a Git repository, as HQ tells it. */
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
              can: {},
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
        { kind: "preflight", repo: review.repo, value: review },
      ]),
    ),
  });
  const flow = canonicalProjectFlow.derive(readsOfState(store.state()), key);
  registry.dispose();
  return { store, flow };
}

function hqRecording(store: AccountStore) {
  const requests: unknown[] = [];
  const release: HqWrites["release"] = async (_appId, request) => {
    requests.push(request);
    return {
      made: {
        tag: request.tag,
        sha: GROUP,
        entries: request.entries,
        by: "ada",
        at: AT,
        state: "approved",
        reason: null,
        rollbackOf: null,
      },
      deploys: undefined,
    };
  };
  const operations = makeOperations({
    store,
    executors: {
      hq: makeHqExecutor({
        apiOf: (orgId) => (orgId === "org" ? ({ release } as unknown as HqWrites) : null),
        zerops: {
          mintIntegrationToken: () => Promise.reject(new Error("Unexpected token mint")),
          deleteIntegrationToken: () => Promise.reject(new Error("Unexpected token deletion")),
        },
      }),
    },
    makeId: () => "r1",
  });
  return { operations, requests };
}

describe("a Git production's release", () => {
  it.effect("A Git production release sends its preflight and target, and HQ accepts it", () =>
    Effect.gen(function* () {
      const { store, flow } = gitProduction([READY]);
      if (flow === undefined) throw new Error("The Git production's flow must be read");
      const request = releaseRequestOf(flow.release, "v0.1.0");
      if ("refused" in request) throw new Error(request.refused);
      const { operations, requests } = hqRecording(store);
      yield* operations.submit({ ...request, orgId: "org", appId: "shop" });
      expect(requests).toEqual([
        {
          tag: "v0.1.0",
          groupHead: GROUP,
          entries: [{ service: "api", sha: API }],
          target: "git",
          releaseTarget: ATTACHMENT,
          preflight: [READY],
        },
      ]);
      // HQ decodes the request with this schema before it releases.
      expect(() => Schema.decodeUnknownSync(CreateReleaseRequest)(requests[0])).not.toThrow();
    }),
  );

  it.each([
    { name: "no preflight yet", preflight: [] },
    { name: "a preflight of another commit", preflight: [{ ...READY, sha: "c".repeat(40) }] },
    {
      name: "a preflight of a replaced token",
      preflight: [{ ...READY, remote: { ...REMOTE, keptAt: "2026-10-13T11:00:00Z" } }],
    },
  ])("A Git production release waits for HQ's ready preflight: $name", ({ preflight }) => {
    const { flow } = gitProduction(preflight);
    if (flow === undefined) throw new Error("The Git production's flow must be read");
    expect(flow.release.git?.preflight).toBeUndefined();
    expect(flow.release.gate.allowed).toBe(true);
    expect(releaseRequestOf(flow.release, "v0.1.0")).toEqual({
      refused: GIT_PREFLIGHT_PENDING,
      says: false,
    });
  });
});
