import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import type { GiteaPullRequest, GiteaTag } from "../giteaClient.ts";
import type { GroupEnvironment, GroupEnvironmentTier } from "../groupEnvironments.ts";
import { deployedVersion } from "../groupRows.ts";
import type { ZeropsRegistryGroup } from "../groupRegistry.ts";
import type { FailureReason, Known, Shown } from "../knowledge/known.ts";
import { RELEASE_NOTHING_NEW_ON_MAIN } from "../release.ts";
import { CHECKING_RELEASE } from "./release.ts";
import type { Deployment, SettledDeployment, StopService } from "./deployment.ts";
import {
  groupFlow,
  pullKey,
  tiersOnMain,
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

const version = (sha: string) => ({
  name: sha,
  commit: sha.slice(0, 7),
  sha,
  taggedBy: undefined,
  label: sha.slice(0, 7),
});

const running = (sha: string): SettledDeployment => ({
  kind: "running",
  activatedAt: "2026-09-23T09:00:00Z",
  version: version(sha),
});

const deploying = (sha: string, previous: SettledDeployment | null = null): Deployment => ({
  kind: "deploying",
  version: version(sha),
  previous,
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
  tiers: known({ tiers: ["stage", "production"], repositories: new Map([["appdev", "appdev"]]) }),
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

  it("a release held by an input that failed offers Try again, and only then", () => {
    expect(groupFlow(inputs(), RELEASER, NOW).releaseAffordance).toBeNull();
    expect(groupFlow(inputs({ tags: READING }), RELEASER, NOW).releaseAffordance).toBeNull();
    expect(
      groupFlow(inputs({ tags: failed({ kind: "timeout", afterMs: 15_000 }) }), RELEASER, NOW)
        .releaseAffordance,
    ).toEqual({ kind: "retry", label: "Try again" });
  });

  it("a production service no tier builds, or whose repository has no main, has no candidate and holds nothing", () => {
    const flow = groupFlow(
      inputs({
        tiers: known({
          tiers: ["stage", "production"],
          repositories: new Map([
            ["appdev", "appdev"],
            ["static", "static"],
          ]),
        }),
        mainHeads: new Map([
          ["appdev", known(MAIN_SHA)],
          [
            "static",
            { state: "gone", evidence: "direct-not-found", asOf: { ordinal: 1, atMs: NOW - 10 } },
          ],
        ]),
        stops: new Map([
          ["p-stage", known([stopService("p-stage", "appdev", known(running(MAIN_SHA)))])],
          [
            "p-prod",
            known([
              stopService("p-prod", "appdev", known(running(PRODUCTION_SHA))),
              stopService("p-prod", "static", known(running(PRODUCTION_SHA))),
              stopService("p-prod", "worker", known(running(PRODUCTION_SHA))),
            ]),
          ],
        ]),
      }),
      RELEASER,
      NOW,
    );

    expect(flow.release.state).toBe("known");
    expect(flow.releaseGate).toEqual({ allowed: true });
    expect(flow.release.state === "known" ? flow.release.value.entries : []).toEqual([
      { service: "appdev", commit: MAIN_SHA },
    ]);
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

  it("a stop missing its project has nothing to read, so it waits on nothing", () => {
    const flow = groupFlow(
      inputs({ members: known([{ projectId: "p-stage", name: "harbor stage" }]) }),
      RELEASER,
      NOW,
    );

    const stops = flow.stops.state === "known" ? flow.stops.value : [];
    expect(stops.find(({ projectId }) => projectId === "p-prod")).toMatchObject({
      standing: "missing-project",
      services: null,
      deployment: null,
    });
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
    expect(stops.map(({ deployment }) => deployment?.state)).toEqual(["known", "reading"]);
    expect(stops[0]?.deployment).toMatchObject({ value: { kind: "running" } });
  });

  it("a stop deploys while any of its services does", () => {
    const flow = groupFlow(
      inputs({
        stops: new Map([
          [
            "p-stage",
            known([
              stopService("p-stage", "apidev", known(running(PRODUCTION_SHA))),
              stopService("p-stage", "appdev", known(deploying(MAIN_SHA))),
            ]),
          ],
          ["p-prod", known([stopService("p-prod", "appdev", known(running(PRODUCTION_SHA)))])],
        ]),
      }),
      RELEASER,
      NOW,
    );

    const stops = flow.stops.state === "known" ? flow.stops.value : [];
    expect(stops[0]?.deployment).toMatchObject({
      value: { kind: "deploying", version: { sha: MAIN_SHA } },
    });
  });

  it("a production mid-deploy is measured against what it runs until its build activates", () => {
    const midDeploy = (previous: SettledDeployment | null) =>
      groupFlow(
        inputs({
          stops: new Map([
            ["p-stage", known([stopService("p-stage", "appdev", known(running(MAIN_SHA)))])],
            [
              "p-prod",
              known([stopService("p-prod", "appdev", known(deploying(MAIN_SHA, previous)))]),
            ],
          ]),
        }),
        RELEASER,
        NOW,
      );

    // The build may fail: what production runs is still the release's other side.
    expect(midDeploy(running(PRODUCTION_SHA)).releaseGate).toEqual({ allowed: true });
    expect(midDeploy(running(MAIN_SHA)).releaseGate).toEqual({
      allowed: false,
      reason: RELEASE_NOTHING_NEW_ON_MAIN,
    });
  });

  it("a production mid-deploy whose running version nothing names holds the release", () => {
    const midDeploy = (previous: SettledDeployment | null) =>
      groupFlow(
        inputs({
          stops: new Map([
            ["p-stage", known([stopService("p-stage", "appdev", known(running(MAIN_SHA)))])],
            [
              "p-prod",
              known([stopService("p-prod", "appdev", known(deploying(MAIN_SHA, previous)))]),
            ],
          ]),
        }),
        RELEASER,
        NOW,
      );
    const unnamed: SettledDeployment = {
      kind: "running",
      activatedAt: "2026-09-23T09:00:00Z",
      version: deployedVersion(undefined),
    };

    // What runs is not stated yet: it is no proof production runs something older than main.
    expect(midDeploy(null).releaseGate).toEqual({ allowed: false, reason: CHECKING_RELEASE });
    expect(midDeploy(unnamed).releaseGate).toEqual({ allowed: false, reason: CHECKING_RELEASE });
    // A production that ran nothing before its first build has nothing to hold.
    expect(midDeploy({ kind: "none" }).releaseGate).toEqual({ allowed: true });
  });

  it("a merge into a repository feeds the stages that run it, never production", () => {
    const flow = groupFlow(inputs(), RELEASER, NOW);

    expect(flow.feeds("appdev")).toEqual([service("p-stage-appdev", project("p-stage"))]);
    expect(flow.feeds("group")).toEqual([]);
  });

  it("a service whose tier builds from a repository with another name releases that repository's main", () => {
    const flow = groupFlow(
      inputs({
        tiers: known({
          tiers: ["stage", "production"],
          repositories: new Map([["app", "appdev"]]),
        }),
        stops: new Map([
          ["p-stage", known([stopService("p-stage", "app", known(running(MAIN_SHA)))])],
          ["p-prod", known([stopService("p-prod", "app", known(running(PRODUCTION_SHA)))])],
        ]),
      }),
      RELEASER,
      NOW,
    );

    expect(flow.releaseGate).toEqual({ allowed: true });
    expect(flow.release.state === "known" ? flow.release.value.entries : []).toEqual([
      { service: "app", commit: MAIN_SHA },
    ]);
    // A merge into `appdev` deploys the stage's `app`; nothing is named `app` on Gitea.
    expect(flow.feeds("appdev")).toEqual([service("p-stage-app", project("p-stage"))]);
    expect(flow.feeds("app")).toEqual([]);
  });

  it("the release waits for the tiers on main, which name where production's code lives", () => {
    const flow = groupFlow(inputs({ tiers: READING }), RELEASER, NOW);

    expect(flow.release.state).toBe("reading");
    expect(flow.releaseGate).toEqual({ allowed: false, reason: CHECKING_RELEASE });
  });

  it("the tiers on main are those whose import main holds, known once every tier's file is", () => {
    const production = [
      "services:",
      "  - hostname: app",
      "    buildFromGit: https://gitea.example/harbor/appdev.git",
      "  - hostname: db",
    ].join("\n");
    expect(
      tiersOnMain(
        new Map<GroupEnvironmentTier, Shown<string | null>>([
          ["stage", known(null)],
          ["production", known(production)],
        ]),
      ),
    ).toMatchObject({
      state: "known",
      value: { tiers: ["production"], repositories: new Map([["app", "appdev"]]) },
    });
    expect(tiersOnMain(new Map([["production", known(production)]])).state).toBe("unread");
  });
});
