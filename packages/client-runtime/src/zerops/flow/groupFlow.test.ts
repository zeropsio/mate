import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import type { GiteaCommitStatus, GiteaPullRequest, GiteaTag } from "../giteaClient.ts";
import type { GroupEnvironment, GroupEnvironmentTier } from "../groupEnvironments.ts";
import { deployedVersion, deployStatusContext, environmentRow } from "../groupRows.ts";
import type { ZeropsRegistryGroup } from "../groupRegistry.ts";
import type { FailureReason, Known, Shown } from "../knowledge/known.ts";
import { RELEASE_NOTHING_NEW_ON_MAIN, releaseStatusContext } from "../release.ts";
import { CHECKING_RELEASE } from "./release.ts";
import type { Deployment, SettledDeployment, StopService } from "./deployment.ts";
import {
  groupFlow,
  groupFlowStatusReads,
  pullKey,
  RELEASES_SHOWN,
  releaseContentKey,
  releaseContentReads,
  statusKey,
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
  merged: new Map([
    ["appdev", known([])],
    ["group", known([])],
  ]),
  tags: known(TAGS),
  tiers: known({ tiers: ["stage", "production"], repositories: new Map([["appdev", "appdev"]]) }),
  mainHeads: new Map([["appdev", known(MAIN_SHA)]]),
  statuses: new Map(),
  contents: new Map(),
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

  it("a merge into a repository feeds the stages that run it, never production, known once they and the tiers are", () => {
    const feeds = (overrides: Partial<GroupFlowInputs>, repository: string) =>
      groupFlow(inputs(overrides), RELEASER, NOW).feeds(repository);

    expect(feeds({}, "appdev")).toMatchObject({
      state: "known",
      value: [service("p-stage-appdev", project("p-stage"))],
    });
    expect(feeds({}, "group")).toMatchObject({ state: "known", value: [] });
    // What the stage runs, or where its code lives, still being read names no stage it feeds.
    expect(feeds({ tiers: READING }, "appdev").state).toBe("reading");
    expect(feeds({ stops: new Map([["p-prod", known([])]]) }, "appdev").state).toBe("unread");
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
    expect(flow.feeds("appdev")).toMatchObject({
      value: [service("p-stage-app", project("p-stage"))],
    });
    expect(flow.feeds("app")).toMatchObject({ value: [] });
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

  it("missing tier rows come from the tiers on main", () => {
    const stageOnly = known(DECLARATIONS.filter(({ tier }) => tier === "stage"));
    const missing = (overrides: Partial<GroupFlowInputs>) =>
      groupFlow(inputs({ declarations: stageOnly, ...overrides }), RELEASER, NOW).missing;

    expect(missing({})).toMatchObject({
      state: "known",
      value: [{ kind: "missing-environment", tier: "production", name: "Production" }],
    });
    // A tier main does not offer is not asked for.
    expect(missing({ tiers: known({ tiers: ["stage"], repositories: new Map() }) })).toMatchObject({
      state: "known",
      value: [],
    });
    // A project the tags already make the production fills it before its declaration lands.
    expect(
      missing({
        members: known([...MEMBERS, { projectId: "p-new", name: "harbor prod", role: "prod" }]),
      }),
    ).toMatchObject({ state: "known", value: [] });
    // Nothing is asked for while the tiers on main are being read.
    expect(missing({ tiers: READING }).state).toBe("reading");
  });

  it("release contents come from compare + commit detail", () => {
    const shipped = [{ sha: MAIN_SHA, subject: "Add cart" }];
    const ahead = { service: "appdev", repository: "appdev", from: PRODUCTION_SHA, head: MAIN_SHA };
    expect(releaseContentReads(inputs())).toEqual([ahead]);
    const flow = groupFlow(
      inputs({ contents: new Map([[releaseContentKey(ahead), known(shipped)]]) }),
      RELEASER,
      NOW,
    );
    expect(flow.releaseContents).toMatchObject({
      state: "known",
      value: [{ service: "appdev", commits: shipped }],
    });

    // A production that runs nothing yet puts the head itself live: its one commit is read.
    const first = inputs({
      stops: new Map([
        ["p-stage", known([stopService("p-stage", "appdev", known(running(MAIN_SHA)))])],
        ["p-prod", known([stopService("p-prod", "appdev", known({ kind: "none" }))])],
      ]),
    });
    const firstRead = { ...ahead, from: undefined };
    expect(releaseContentReads(first)).toEqual([firstRead]);
    expect(
      groupFlow(
        { ...first, contents: new Map([[releaseContentKey(firstRead), known(shipped)]]) },
        RELEASER,
        NOW,
      ).releaseContents,
    ).toMatchObject({ state: "known", value: [{ service: "appdev", commits: shipped }] });

    // Still reading what `main` carries: the offer stands, its contents are being checked.
    const reading = groupFlow(
      inputs({ contents: new Map([[releaseContentKey(ahead), READING]]) }),
      RELEASER,
      NOW,
    );
    expect(reading.release.state).toBe("known");
    expect(reading.releaseContents.state).toBe("reading");

    // Production already runs main: nothing to read, nothing it would carry.
    const current = inputs({
      stops: new Map([
        ["p-stage", known([stopService("p-stage", "appdev", known(running(MAIN_SHA)))])],
        ["p-prod", known([stopService("p-prod", "appdev", known(running(MAIN_SHA)))])],
      ]),
    });
    expect(releaseContentReads(current)).toEqual([]);
    expect(groupFlow(current, RELEASER, NOW).releaseContents).toMatchObject({
      state: "known",
      value: [],
    });
  });

  it("releases come newest first from the group repo's tags, each row waiting only for the broker's verdict on its own commit", () => {
    const tag = (name: string, sha: string): GiteaTag => ({
      name,
      message: `appdev ${MAIN_SHA}`,
      commit: { sha },
    });
    const verdict = (name: string, state: GiteaCommitStatus["state"], description?: string) =>
      known([{ context: releaseStatusContext(name), state, description }]);
    const tags = known([
      tag("v1.0.0", "s1"),
      tag("v1.10.0", "s3"),
      { name: "latest", commit: { sha: "s3" } },
      tag("v1.2.0", "s2"),
    ]);
    const statuses = new Map([
      [statusKey("group", "s1"), verdict("v1.0.0", "success")],
      [statusKey("group", "s2"), verdict("v1.2.0", "failure", "No stage runs it.")],
      [statusKey("group", "s3"), verdict("v1.10.0", "success")],
    ]);
    const flowOf = (overrides: Partial<GroupFlowInputs>) =>
      groupFlow(inputs({ tags, statuses, ...overrides }), RELEASER, NOW);

    expect(groupFlowStatusReads(inputs({ tags }))).toEqual([
      { repository: "appdev", sha: MAIN_SHA },
      { repository: "appdev", sha: PRODUCTION_SHA },
      { repository: "group", sha: "s3" },
      { repository: "group", sha: "s2" },
      { repository: "group", sha: "s1" },
    ]);
    expect(flowOf({}).releases).toMatchObject({
      state: "known",
      value: [
        {
          tag: "v1.10.0",
          row: {
            state: "known",
            value: { verdict: "approved", word: "Approved", rollBack: false },
          },
        },
        {
          tag: "v1.2.0",
          row: {
            state: "known",
            value: { verdict: "refused", line: "No stage runs it.", rollBack: false },
          },
        },
        {
          tag: "v1.0.0",
          row: {
            state: "known",
            value: { verdict: "approved", line: `appdev ${MAIN_SHA.slice(0, 7)}`, rollBack: true },
          },
        },
      ],
    });
    // A verdict still being read, or one that failed, holds its own row, never the history: it
    // never reads as "not judged".
    const oneHeld = new Map(statuses)
      .set(statusKey("group", "s2"), READING)
      .set(statusKey("group", "s1"), failed({ kind: "server", status: 502 }));
    expect(flowOf({ statuses: oneHeld }).releases).toMatchObject({
      state: "known",
      value: [
        { tag: "v1.10.0", row: { state: "known" } },
        { tag: "v1.2.0", row: { state: "reading" } },
        { tag: "v1.0.0", row: { state: "failed" } },
      ],
    });
    expect(flowOf({ tags: READING }).releases.state).toBe("reading");
  });

  it("only the newest releases are listed, and only their verdicts are read (D5)", () => {
    // A long-lived group: forty releases, one status read each if every one were judged.
    const made = 40;
    const tags = known(
      Array.from({ length: made }, (_, minor): GiteaTag => ({
        name: `v1.${String(minor)}.0`,
        commit: { sha: `s${String(minor)}` },
      })),
    );
    const newest = Array.from({ length: RELEASES_SHOWN }, (_, index) => made - 1 - index);
    expect(newest.length).toBeGreaterThan(0);
    expect(newest.length).toBeLessThan(made);

    expect(
      groupFlowStatusReads(inputs({ tags })).filter(({ repository }) => repository === "group"),
    ).toEqual(newest.map((minor) => ({ repository: "group", sha: `s${String(minor)}` })));
    const releases = groupFlow(inputs({ tags }), RELEASER, NOW).releases;
    expect(releases.state === "known" ? releases.value.map(({ tag }) => tag) : []).toEqual(
      newest.map((minor) => `v1.${String(minor)}.0`),
    );
  });

  it("the landed pull requests come from each repository's recent landings, in the org's order", () => {
    const landed = (number: number) =>
      pull(number, { state: "closed", merged: true, merge_commit_sha: `m${String(number)}` });
    const merged = new Map([
      ["appdev", known([landed(3)])],
      ["group", known([landed(2), landed(1)])],
    ]);

    expect(groupFlow(inputs({ merged }), RELEASER, NOW).merged).toMatchObject({
      state: "known",
      value: [
        { repository: "appdev", pull: { number: 3 } },
        { repository: "group", pull: { number: 2 } },
        { repository: "group", pull: { number: 1 } },
      ],
    });
    // One repository still being read holds the landings, never the pull requests.
    const reading = groupFlow(
      inputs({ merged: new Map(merged).set("group", READING) }),
      RELEASER,
      NOW,
    );
    expect(reading.merged.state).toBe("reading");
    expect(reading.pullRequests.state).toBe("known");
  });

  it("a declared stop's environment row names what each service runs and how its deploy went", () => {
    const runs = (sha: string, name?: string): SettledDeployment => ({
      kind: "running",
      activatedAt: null,
      version: deployedVersion(name === undefined ? sha : `${sha} ${name} ada`),
    });
    const success: ReadonlyArray<GiteaCommitStatus> = [
      { context: deployStatusContext("stage", "appdev"), state: "success" },
    ];
    const stops = new Map([
      ["p-stage", known([stopService("p-stage", "appdev", known(runs(MAIN_SHA)))])],
      ["p-prod", known([stopService("p-prod", "appdev", known(runs(PRODUCTION_SHA, "v1.0.0")))])],
    ]);
    const flowOf = (overrides: Partial<GroupFlowInputs>) =>
      groupFlow(inputs({ stops, ...overrides }), RELEASER, NOW);
    const statuses = new Map([
      [statusKey("appdev", MAIN_SHA), known(success)],
      [statusKey("appdev", PRODUCTION_SHA), known<ReadonlyArray<GiteaCommitStatus>>([])],
    ]);
    const environment = (overrides: Partial<GroupFlowInputs>, projectId: string) => {
      const stops = flowOf(overrides).stops;
      return stops.state === "known"
        ? stops.value.find((stop) => stop.projectId === projectId)?.environment
        : undefined;
    };

    expect(groupFlowStatusReads(inputs({ stops }))).toEqual([
      { repository: "appdev", sha: MAIN_SHA },
      { repository: "appdev", sha: PRODUCTION_SHA },
    ]);
    const stage = environment({ statuses }, "p-stage");
    expect(stage).toMatchObject({
      state: "known",
      value: {
        projectId: "p-stage",
        name: "harbor stage",
        tier: "stage",
        environment: "stage",
        services: [{ hostname: "appdev", repository: "appdev", statuses: success }],
      },
    });
    if (stage?.state !== "known") throw new Error("stage not known");
    const row = environmentRow(stage.value);
    expect(row).toMatchObject({ tone: "good", version: { sha: MAIN_SHA } });
    const production = environment({ statuses }, "p-prod");
    if (production?.state !== "known") throw new Error("production not known");
    expect(environmentRow(production.value).version).toMatchObject({
      name: "v1.0.0",
      sha: PRODUCTION_SHA,
      taggedBy: "ada",
    });

    // The build status still being read holds the row, never a neutral one.
    expect(environment({ statuses: new Map() }, "p-stage")?.state).toBe("unread");
  });
});
