import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import type { GiteaPullRequest, GiteaTag } from "../giteaClient.ts";
import type { GroupEnvironment } from "../groupEnvironments.ts";
import type { ZeropsRegistryGroup } from "../groupRegistry.ts";
import type { FailureReason, Known, Shown } from "../knowledge/known.ts";
import { CHECKING_RELEASE } from "./release.ts";
import type { Deployment, StopService } from "./deployment.ts";
import {
  groupFlow,
  pullKey,
  type GroupFlowInputs,
  type GroupFlowMember,
  type GroupFlowPull,
} from "./groupFlow.ts";

const NOW = 1_000_000;
const MAIN_SHA = "a".repeat(40);
const PRODUCTION_SHA = "b".repeat(40);

const known = <T>(value: T): Known<T> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: NOW - 1_000 },
  coverage: "complete",
  freshness: { kind: "live" },
});
const READING: Known<never> = { state: "reading", sinceMs: NOW - 100, attempt: 1 };
const failed = (failure: FailureReason): Known<never> => ({
  state: "failed",
  failure,
  atMs: NOW - 10,
  attempt: 3,
  retryAtMs: null,
});

const ENTRY: ZeropsRegistryGroup = {
  groupId: "g1",
  slug: "harbor",
  projects: [],
  matesMayRelease: false,
};

const DECLARATIONS: ReadonlyArray<GroupEnvironment> = [
  { name: "stage", tier: "stage", project: "p-stage", sources: ["main"], deploy: undefined },
  {
    name: "production",
    tier: "production",
    project: "p-prod",
    sources: "release",
    deploy: undefined,
  },
];

const MEMBERS: ReadonlyArray<GroupFlowMember> = [
  { projectId: "p-stage", name: "harbor stage" },
  { projectId: "p-prod", name: "harbor production" },
];

const running = (sha: string): Deployment => ({
  kind: "running",
  activatedAt: "2026-09-23T09:00:00Z",
  version: { name: sha, commit: sha.slice(0, 7), sha, taggedBy: undefined, label: sha.slice(0, 7) },
});

const stopService = (
  projectId: string,
  hostname: string,
  deployment: Shown<Deployment>,
): StopService => ({
  service: service(`${projectId}-${hostname}`, project(projectId)),
  hostname,
  deployment,
});

const pull = (number: number, overrides: Partial<GiteaPullRequest> = {}): GiteaPullRequest => ({
  number,
  title: `Change ${number}`,
  state: "open",
  head: { ref: "mate/ada", sha: "c".repeat(40) },
  base: { ref: "main", sha: MAIN_SHA },
  mergeable: true,
  ...overrides,
});

const openPull = (number: number): GroupFlowPull => ({
  pull: pull(number),
  state: {
    kind: "open",
    mergeability: { kind: "mergeable" },
    checks: known("passing" as const),
  },
});

const TAGS: ReadonlyArray<GiteaTag> = [{ name: "v1.0.0", message: "" }];

/** A group whose every input is known: production runs `b…`, `main` holds `a…`. */
const inputs = (overrides: Partial<GroupFlowInputs> = {}): GroupFlowInputs => ({
  entry: ENTRY,
  members: known(MEMBERS),
  declarations: known(DECLARATIONS),
  repos: known(["appdev", "group"]),
  openPulls: new Map([
    ["appdev", known([4])],
    ["group", known([])],
  ]),
  pulls: new Map([[pullKey("appdev", 4), known(openPull(4))]]),
  tags: known(TAGS),
  mainHeads: new Map([["appdev", known(MAIN_SHA)]]),
  stops: new Map([
    ["p-stage", known([stopService("p-stage", "appdev", known(running(MAIN_SHA)))])],
    ["p-prod", known([stopService("p-prod", "appdev", known(running(PRODUCTION_SHA)))])],
  ]),
  ...overrides,
});

const RELEASER = { mayRelease: true };

describe("groupFlow (DESIGN §4.7)", () => {
  it("offers the release once both halves are known and fresh", () => {
    const flow = groupFlow(inputs(), RELEASER, NOW);

    expect(flow.release.state).toBe("known");
    expect(flow.releaseGate).toEqual({ allowed: true });
    expect(flow.release.state === "known" ? flow.release.value.entries : []).toEqual([
      { service: "appdev", commit: MAIN_SHA },
    ]);
  });

  it("the release offer is Checking while a stop is unknown and names the cause when one failed", () => {
    const productionStop = (deployment: Shown<Deployment>) =>
      inputs({
        stops: new Map([
          ["p-stage", known([stopService("p-stage", "appdev", known(running(MAIN_SHA)))])],
          ["p-prod", known([stopService("p-prod", "appdev", deployment)])],
        ]),
      });

    const checking = groupFlow(productionStop(READING), RELEASER, NOW);
    expect(checking.release.state).toBe("reading");
    expect(checking.releaseGate).toEqual({ allowed: false, reason: CHECKING_RELEASE });

    const listing = groupFlow(inputs({ stops: new Map() }), RELEASER, NOW);
    expect(listing.releaseGate).toEqual({ allowed: false, reason: CHECKING_RELEASE });

    const broken = groupFlow(
      productionStop(failed({ kind: "transport", detail: "socket closed" })),
      RELEASER,
      NOW,
    );
    expect(broken.release.state).toBe("failed");
    expect(broken.releaseGate).toEqual({
      allowed: false,
      reason: "Couldn't read what can be released. Zerops didn't answer.",
    });
  });

  it("a stop that fails or waits holds the release, never the pull requests", () => {
    const flow = groupFlow(
      inputs({ stops: new Map([["p-prod", failed({ kind: "server", status: 502 })]]) }),
      RELEASER,
      NOW,
    );

    expect(flow.pullRequests.state).toBe("known");
    expect(flow.pullRequests.state === "known" ? flow.pullRequests.value : []).toEqual([
      { repository: "appdev", pull: openPull(4).pull, state: openPull(4).state },
    ]);
  });

  it("a Gitea read that failed names Gitea, and a stale input holds the release", () => {
    const broken = groupFlow(
      inputs({ tags: failed({ kind: "timeout", afterMs: 15_000 }) }),
      RELEASER,
      NOW,
    );
    expect(broken.releaseGate).toEqual({
      allowed: false,
      reason: "Couldn't read what can be released. Gitea didn't answer.",
    });

    const stale = groupFlow(
      inputs({
        tags: {
          state: "known",
          value: TAGS,
          asOf: { ordinal: 1, atMs: NOW - 1_000 },
          coverage: "complete",
          freshness: { kind: "stale", reason: { kind: "invalidated" }, sinceMs: NOW - 5 },
        },
      }),
      RELEASER,
      NOW,
    );
    expect(stale.release.state).toBe("known");
    expect(stale.releaseGate).toEqual({ allowed: false, reason: "Not up to date." });
  });

  it("the pull requests wait for every repository's open list, not for the other half", () => {
    const flow = groupFlow(
      inputs({
        openPulls: new Map([["appdev", known([4])]]),
        declarations: READING,
        stops: new Map(),
      }),
      RELEASER,
      NOW,
    );

    expect(flow.pullRequests.state).toBe("unread");
  });

  it("a stop is declared, missing its project, or not declared yet (D7)", () => {
    const flow = groupFlow(
      inputs({
        members: known([
          { projectId: "p-stage", name: "harbor stage" },
          { projectId: "p-extra", name: "harbor extra" },
        ]),
      }),
      RELEASER,
      NOW,
    );

    expect(flow.stops.state).toBe("known");
    expect(
      (flow.stops.state === "known" ? flow.stops.value : []).map(
        ({ projectId, standing, tier }) => ({ projectId, standing, tier }),
      ),
    ).toEqual([
      { projectId: "p-stage", standing: "declared", tier: "stage" },
      { projectId: "p-prod", standing: "missing-project", tier: "production" },
      { projectId: "p-extra", standing: "not-declared", tier: null },
    ]);
  });

  it("a stop runs its first running service, and none only when every service runs none", () => {
    const flow = groupFlow(
      inputs({
        stops: new Map([
          [
            "p-stage",
            known([
              stopService("p-stage", "apidev", known({ kind: "none" })),
              stopService("p-stage", "appdev", known(running(MAIN_SHA))),
            ]),
          ],
          [
            "p-prod",
            known([
              stopService("p-prod", "apidev", known({ kind: "none" })),
              stopService("p-prod", "appdev", READING),
            ]),
          ],
        ]),
      }),
      RELEASER,
      NOW,
    );

    const stops = flow.stops.state === "known" ? flow.stops.value : [];
    expect(stops.map(({ deployment }) => deployment.state)).toEqual(["known", "reading"]);
    expect(stops[0]?.deployment).toMatchObject({ value: { kind: "running" } });
  });

  it("a merge into a repository feeds the stages that run it, never production", () => {
    const flow = groupFlow(inputs(), RELEASER, NOW);

    expect(flow.feeds("appdev")).toEqual([service("p-stage-appdev", project("p-stage"))]);
    expect(flow.feeds("group")).toEqual([]);
  });
});
