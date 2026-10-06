import { describe, expect, it } from "vite-plus/test";

import { service } from "../data/__fixtures__/index.ts";
import {
  deployedVersion,
  type DeployedVersion,
  type EnvironmentServiceState,
} from "../groupRows.ts";
import type { Shown } from "../knowledge/known.ts";
import type { ZeropsPublicRoute, ZeropsRouteOffer } from "../publicRoutes.ts";
import type { FlowReleaseRow } from "../release.ts";
import {
  CHECKING_WHAT_RUNS,
  NOTHING_DEPLOYED,
  stopView,
  type Deployment,
  type StopService,
  type StopView,
} from "./deployment.ts";
import {
  driftOf,
  earlierReleasesLabel,
  jobOf,
  notInZerops,
  openStopLabel,
  serviceRows,
  stopCardTitle,
  stopFailedDeploy,
  stopKeyGap,
  stopMetaLine,
  stopVerdict,
  type StopFailedDeploy,
  type StopFailure,
  type StopServiceRow,
  type StopVerdict,
} from "./stopDetail.ts";
import { jobInFlight, type HqJob } from "../hq/environments.ts";

/** HQ's job of a deploy in `state`. */
const deployRecord = (state: HqJob["state"], over: Partial<HqJob> = {}): HqJob => ({
  id: "1",
  kind: "deploy",
  service: "api",
  sha: "0000000000000000000000000000000000000000",
  state,
  cause: "merge",
  ref: null,
  reason: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
  at: "2026-10-02T10:00:00.000Z",
  endedAt: jobInFlight({ state }) ? null : "2026-10-02T10:04:00.000Z",
  supersededBy: null,
  ...over,
});

const V13: DeployedVersion = {
  name: "v0.1.13",
  commit: "3f9c1b2",
  sha: "3f9c1b2000000000000000000000000000000000",
  taggedBy: undefined,
  label: "v0.1.13",
};

const view = (overrides: Partial<StopView>): StopView => ({
  tone: "good",
  word: "Deployed",
  line: "v0.1.13",
  version: V13,
  activatedAt: null,
  afterMs: 0,
  ...overrides,
});

const LIVE = view({});
const PENDING = view({ tone: "pending", word: "Deploying…" });
const EMPTY = view({
  tone: "neutral",
  word: NOTHING_DEPLOYED,
  line: NOTHING_DEPLOYED,
  version: undefined,
});
const CHECKING = view({
  tone: "neutral",
  word: CHECKING_WHAT_RUNS,
  line: CHECKING_WHAT_RUNS,
  version: undefined,
});

type VerdictInput = Parameters<typeof stopVerdict>[0];

const BASE: VerdictInput = {
  tier: "production",
  view: LIVE,
  releasing: undefined,
  failed: undefined,
  waiting: 0,
  waitingAtLeast: false,
  untold: [],
  release: { offered: false, tag: undefined, reason: undefined },
  releasedAge: undefined,
  since: undefined,
  atMainHead: false,
  keyGap: undefined,
};

const FAILED: StopFailure = {
  label: "v0.1.14",
  service: "nextstore",
  sha: undefined,
  running: { label: "v0.1.13", since: undefined },
  redeploy: { service: "nextstore", sha: "9c41d2e000000000000000000000000000000000", after: "7" },
  message: undefined,
  mayRunAgain: true,
};

describe("stopVerdict", () => {
  it.each<{ name: string; input: Partial<VerdictInput>; expected: StopVerdict }>([
    {
      name: "production releasing wins over a deploy in flight",
      input: { view: PENDING, releasing: "v0.1.14" },
      expected: { tone: "busy", text: "Releasing v0.1.14…", detail: undefined, verb: null },
    },
    {
      name: "a stage never reads as releasing",
      input: { tier: "stage", view: PENDING, releasing: "v0.1.14" },
      expected: { tone: "busy", text: "Deploying…", detail: undefined, verb: null },
    },
    {
      name: "a deploy in flight",
      input: { view: PENDING, failed: FAILED },
      expected: { tone: "busy", text: "Deploying…", detail: undefined, verb: null },
    },
    {
      name: "failed with what still runs, asked again by one who may",
      input: { failed: FAILED },
      expected: {
        tone: "failed",
        text: "The deploy of v0.1.14 failed on nextstore.",
        detail: "v0.1.13 still runs",
        verb: { kind: "run-again" },
      },
    },
    {
      name: "failed with what still runs and how long it has",
      input: { failed: { ...FAILED, running: { label: "v0.1.13", since: "6m ago" } } },
      expected: {
        tone: "failed",
        text: "The deploy of v0.1.14 failed on nextstore.",
        detail: "v0.1.13 still runs · 6m ago",
        verb: { kind: "run-again" },
      },
    },
    {
      // The migration holds a service it brought where it does not run its target (T13): HQ's
      // final failed record says what runs and what Run brings, so it is the detail.
      name: "held at migration, in HQ's words, run by one who may",
      input: {
        tier: "stage",
        failed: {
          ...FAILED,
          label: "9c41d2e",
          message: "Held at migration: nextstore runs 47ae139; Run brings it to 9c41d2e.",
        },
      },
      expected: {
        tone: "failed",
        text: "The deploy of 9c41d2e failed on nextstore.",
        detail: "Held at migration: nextstore runs 47ae139; Run brings it to 9c41d2e.",
        verb: { kind: "run-again" },
      },
    },
    {
      // HQ refuses every deploy with it, so its failures follow from it and are not said.
      name: "a deploy key that no longer works, over the deploy it failed",
      input: {
        tier: "stage",
        failed: FAILED,
        keyGap: { kind: "invalid", project: "Shop - stage" },
      },
      expected: {
        tone: "failed",
        text: "Its deploy key no longer works.",
        detail:
          "Someone with Full access to the Shop - stage project in Zerops mints a new one here.",
        verb: null,
      },
    },
    {
      name: "no deploy key yet, over the deploy it failed",
      input: {
        tier: "production",
        failed: FAILED,
        keyGap: { kind: "missing", project: "Shop - production" },
      },
      expected: {
        tone: "failed",
        text: "It has no deploy key yet.",
        detail:
          "Someone with Full access to the Shop - production project in Zerops mints one here.",
        verb: null,
      },
    },
    {
      name: "failed with nothing known to run, for one who may not ask it again",
      input: { failed: { ...FAILED, running: undefined, mayRunAgain: false } },
      expected: {
        tone: "failed",
        text: "The deploy of v0.1.14 failed on nextstore.",
        detail: undefined,
        verb: null,
      },
    },
    {
      name: "production with nothing deployed",
      input: { view: EMPTY },
      expected: { tone: "off", text: "Nothing deployed yet.", detail: undefined, verb: null },
    },
    {
      name: "production with nothing deployed and changes merged offers its first release",
      input: {
        view: EMPTY,
        waiting: 3,
        release: { offered: true, tag: "v0.1.0", reason: undefined },
      },
      expected: {
        tone: "off",
        text: "Nothing deployed yet.",
        detail: undefined,
        verb: { kind: "release", tag: "v0.1.0" },
      },
    },
    {
      name: "a stage with nothing deployed says what deploys there",
      input: { tier: "stage", view: EMPTY },
      expected: {
        tone: "off",
        text: "Nothing deployed yet.",
        detail: "The next merge to main deploys here.",
        verb: null,
      },
    },
    {
      name: "a stage whose first deploy failed says so, as its cell does",
      input: { tier: "stage", view: EMPTY, firstDeploy: { kind: "failed" } },
      expected: { tone: "failed", text: "First deploy failed.", detail: undefined, verb: null },
    },
    {
      // Only for one HQ's rule lets keep the key (or not known yet): one it does not is told who
      // mints it, by the key's own verdict above.
      name: "a stage HQ holds for a deploy key says so, and where it is finished",
      input: { tier: "stage", view: EMPTY, firstDeploy: { kind: "held" } },
      expected: {
        tone: "off",
        text: "Stage awaits a deploy key.",
        detail: "Finish setting it up from its project's menu on the Projects page.",
        verb: null,
      },
    },
    {
      name: "a stage whose first deploy is on its way says so",
      input: { tier: "stage", view: EMPTY, firstDeploy: { kind: "on-its-way" } },
      expected: { tone: "busy", text: "First deploy on its way.", detail: undefined, verb: null },
    },
    {
      name: "a stage whose first deploy failed on main's head says why, where the job said",
      input: {
        tier: "stage",
        view: EMPTY,
        firstDeploy: { kind: "failed", reason: "the build step exited with 1" },
      },
      expected: {
        tone: "failed",
        text: "First deploy failed.",
        detail: "the build step exited with 1",
        verb: null,
      },
    },
    {
      name: "a stage whose first deploy failed with no words for why says only that",
      input: { tier: "stage", view: EMPTY, firstDeploy: { kind: "failed" } },
      expected: { tone: "failed", text: "First deploy failed.", detail: undefined, verb: null },
    },
    {
      name: "a stage being set up says so, never Checking, nor that a merge deploys it",
      input: { tier: "stage", view: CHECKING, firstDeploy: { kind: "setting-up", step: "app" } },
      expected: { tone: "busy", text: "Setting up a stage…", detail: undefined, verb: null },
    },
    {
      name: "a stage being set up, nothing deployed there yet: setting up",
      input: { tier: "stage", view: EMPTY, firstDeploy: { kind: "setting-up", step: "project" } },
      expected: { tone: "busy", text: "Setting up a stage…", detail: undefined, verb: null },
    },
    {
      name: "still checking",
      input: { view: CHECKING, waiting: 3 },
      expected: { tone: "off", text: CHECKING_WHAT_RUNS, detail: undefined, verb: null },
    },
    {
      name: "production behind with the release offered",
      input: { waiting: 3, release: { offered: true, tag: "v0.1.14", reason: undefined } },
      expected: {
        tone: "busy",
        text: "3 changes waiting for production.",
        detail: "Production runs v0.1.13",
        verb: { kind: "release", tag: "v0.1.14" },
      },
    },
    {
      name: "production behind by more than HQ counts",
      input: {
        waiting: 10000,
        waitingAtLeast: true,
        release: { offered: true, tag: "v0.1.14", reason: undefined },
      },
      expected: {
        tone: "busy",
        text: "10000+ changes waiting for production.",
        detail: "Production runs v0.1.13",
        verb: { kind: "release", tag: "v0.1.14" },
      },
    },
    {
      // What production runs on a service cannot be told: nothing is known to be live, and the
      // release is offered — never "already runs what is merged".
      name: "production none of whose services can be told, nothing counted",
      input: { untold: ["api"], release: { offered: true, tag: "v0.1.14", reason: undefined } },
      expected: {
        tone: "busy",
        text: "Can't tell what api runs.",
        detail: "Production runs v0.1.13",
        verb: { kind: "release", tag: "v0.1.14" },
      },
    },
    {
      name: "production with two services that cannot be told",
      input: {
        untold: ["api", "web"],
        release: { offered: true, tag: "v0.1.14", reason: undefined },
      },
      expected: {
        tone: "busy",
        text: "Can't tell what api and web run.",
        detail: "Production runs v0.1.13",
        verb: { kind: "release", tag: "v0.1.14" },
      },
    },
    {
      name: "production behind, one of its services untold beside the count",
      input: {
        waiting: 3,
        untold: ["web"],
        release: { offered: true, tag: "v0.1.14", reason: undefined },
      },
      expected: {
        tone: "busy",
        text: "3 changes waiting for production.",
        detail: "Production runs v0.1.13",
        verb: { kind: "release", tag: "v0.1.14" },
      },
    },
    {
      name: "production one change behind, release not offered",
      input: { waiting: 1, release: { offered: false, tag: "v0.1.14", reason: undefined } },
      expected: {
        tone: "busy",
        text: "1 change waiting for production.",
        detail: "Production runs v0.1.13",
        verb: null,
      },
    },
    {
      name: "production behind, offered but no tag known",
      input: { waiting: 2, release: { offered: true, tag: undefined, reason: undefined } },
      expected: {
        tone: "busy",
        text: "2 changes waiting for production.",
        detail: "Production runs v0.1.13",
        verb: null,
      },
    },
    {
      name: "production whose release is not offered says why, not what main has",
      input: {
        release: {
          offered: false,
          tag: "v0.1.14",
          reason: "Releases move to HQ next; none is offered until then.",
        },
      },
      expected: {
        tone: "ok",
        text: "Releases move to HQ next; none is offered until then.",
        detail: "v0.1.13",
        verb: null,
      },
    },
    {
      name: "production live with the release age",
      input: { releasedAge: "1h ago" },
      expected: {
        tone: "ok",
        text: "Production already runs what is merged.",
        detail: "v0.1.13 · released 1h ago",
        verb: null,
      },
    },
    {
      name: "production live without an age",
      input: {},
      expected: {
        tone: "ok",
        text: "Production already runs what is merged.",
        detail: "v0.1.13",
        verb: null,
      },
    },
    {
      name: "a stage at main's head, with its commit and how long it has run",
      input: { tier: "stage", atMainHead: true, waiting: 2, since: "16h ago" },
      expected: {
        tone: "ok",
        text: "Stage runs the head of main.",
        detail: "3f9c1b2 · 16h ago",
        verb: null,
      },
    },
    {
      name: "a stage at main's head, how long not known",
      input: { tier: "stage", atMainHead: true },
      expected: { tone: "ok", text: "Stage runs the head of main.", detail: "3f9c1b2", verb: null },
    },
    {
      name: "a stage behind main's head",
      input: { tier: "stage", since: "2h ago" },
      expected: {
        tone: "ok",
        text: "Stage runs v0.1.13.",
        detail: "3f9c1b2 · 2h ago",
        verb: null,
      },
    },
    {
      name: "a stage at main's head named by its commit says the commit it runs",
      input: {
        tier: "stage",
        atMainHead: true,
        view: view({ version: { ...V13, name: undefined, label: "3f9c1b2" } }),
        since: "18h ago",
      },
      expected: {
        tone: "ok",
        text: "Stage runs the head of main.",
        detail: "3f9c1b2 · 18h ago",
        verb: null,
      },
    },
    {
      name: "a stage behind main's head named by its commit does not say the commit twice",
      input: {
        tier: "stage",
        view: view({ version: { ...V13, name: undefined, label: "3f9c1b2" } }),
        since: "2h ago",
      },
      expected: { tone: "ok", text: "Stage runs 3f9c1b2.", detail: "2h ago", verb: null },
    },
  ])("$name", ({ input, expected }) => {
    expect(stopVerdict({ ...BASE, ...input })).toEqual(expected);
  });
});

describe("stopKeyGap", () => {
  it.each([
    { name: "a key that works", keyHeld: true, keyInvalid: false, mayKeep: false, kind: undefined },
    {
      name: "a broken key, to anyone",
      keyHeld: true,
      keyInvalid: true,
      mayKeep: true,
      kind: "invalid",
    },
    {
      name: "no key, to one who may not mint",
      keyHeld: false,
      keyInvalid: false,
      mayKeep: false,
      kind: "missing",
    },
    // One who may mint is offered the mint itself, and told nothing here.
    {
      name: "no key, to one who may mint",
      keyHeld: false,
      keyInvalid: false,
      mayKeep: true,
      kind: undefined,
    },
    {
      name: "no key, while who may mint is not known",
      keyHeld: false,
      keyInvalid: false,
      mayKeep: undefined,
      kind: undefined,
    },
  ] as const)("$name", ({ keyHeld, keyInvalid, mayKeep, kind }) => {
    expect(stopKeyGap({ keyHeld, keyInvalid, mayKeep, project: "Shop - stage" })).toEqual(
      kind === undefined ? undefined : { kind, project: "Shop - stage" },
    );
  });
});

describe("stopMetaLine", () => {
  it.each<{ tier: "production" | "stage"; source: string; services: number; expected: string }>([
    {
      tier: "production",
      source: "release",
      services: 2,
      expected: "Moves on release · 2 services",
    },
    {
      tier: "production",
      source: "release",
      services: 1,
      expected: "Moves on release · 1 service",
    },
    { tier: "production", source: "release", services: 0, expected: "Moves on release" },
    { tier: "stage", source: "main", services: 1, expected: "Follows main · 1 service" },
    { tier: "stage", source: "a + b", services: 2, expected: "Follows a + b · 2 services" },
    { tier: "stage", source: "—", services: 0, expected: "Nothing yet" },
    { tier: "stage", source: "", services: 3, expected: "Nothing yet · 3 services" },
  ])("$tier from $source with $services services", ({ expected, ...input }) => {
    expect(stopMetaLine(input)).toBe(expected);
  });
});

describe("stopCardTitle", () => {
  it.each<{
    group: Parameters<typeof stopCardTitle>[0];
    count: number | undefined;
    atLeast?: boolean;
    expected: string;
  }>([
    { group: "waiting", count: 3, expected: "Waiting for release · 3" },
    // HQ stopped counting, as the verdict above it says.
    { group: "waiting", count: 10000, atLeast: true, expected: "Waiting for release · 10000+" },
    { group: "services", count: 2, expected: "Services · 2" },
    { group: "releases", count: 12, expected: "Releases · 12" },
    { group: "deploys", count: 0, expected: "Deploys · 0" },
    { group: "deploys", count: undefined, expected: "Deploys" },
  ])("$group with $count", ({ group, count, atLeast, expected }) => {
    expect(stopCardTitle(group, count, atLeast)).toBe(expected);
  });
});

describe("openStopLabel", () => {
  it.each([
    { tier: "production" as const, expected: "Open production" },
    { tier: "stage" as const, expected: "Open stage" },
  ])("$tier", ({ tier, expected }) => {
    expect(openStopLabel(tier)).toBe(expected);
  });
});

describe("earlierReleasesLabel", () => {
  it.each([
    { count: 1, expected: "Show 1 earlier release" },
    { count: 9, expected: "Show 9 earlier releases" },
  ])("$count", ({ count, expected }) => {
    expect(earlierReleasesLabel(count)).toBe(expected);
  });
});

const SHA_API = "3f9c1b2000000000000000000000000000000000";
const SHA_WEB = "a1b2c3d000000000000000000000000000000000";
const SHA_DOCS = "9e8d7c6000000000000000000000000000000000";

const knownDeployment = (value: Deployment): Shown<Deployment> => ({
  state: "known",
  value,
  asOf: { ordinal: 3, atMs: 30 },
  coverage: "complete",
  freshness: { kind: "live" },
});

const platformService = (hostname: string, deployment: Deployment): StopService => ({
  service: service(`id-${hostname}`),
  hostname,
  deployment: knownDeployment(deployment),
});

const PLATFORM: Shown<ReadonlyArray<StopService>> = {
  state: "known",
  value: [
    platformService("api", {
      kind: "running",
      activatedAt: "2026-09-25T10:00:00Z",
      version: deployedVersion(`${SHA_API} v0.1.13 gitea`),
    }),
    platformService("web", {
      kind: "deploying",
      version: deployedVersion(SHA_WEB),
      previous: null,
    }),
    platformService("worker", {
      kind: "running",
      activatedAt: null,
      version: deployedVersion("v0.2.0"),
    }),
  ],
  asOf: { ordinal: 3, atMs: 30 },
  coverage: "complete",
  freshness: { kind: "live" },
};

const STAGE_SERVICES: ReadonlyArray<EnvironmentServiceState> = [
  {
    hostname: "web",
    repository: "web",
    appVersionName: SHA_WEB,
  },
  {
    hostname: "api",
    repository: "api",
    appVersionName: `${SHA_API} v0.1.13 gitea`,
    deploy: { latest: deployRecord("live"), live: deployRecord("live") },
  },
  { hostname: "docs", repository: "docs", appVersionName: `${SHA_DOCS} v0.1.9 gitea` },
];

const route = (hostname: string): ZeropsPublicRoute => ({
  service: hostname,
  port: 80,
  url: `https://${hostname}.example.app`,
  host: `${hostname}.example.app`,
});
const ROUTES = [route("api"), route("worker")];
const OFFERS: ReadonlyArray<ZeropsRouteOffer> = [
  { service: "docs", serviceId: "id-docs", port: 3000 },
];

const rowsOf = (platform: Shown<ReadonlyArray<StopService>>) =>
  serviceRows({
    environment: "production",
    services: STAGE_SERVICES,
    platform,
    mainHead: undefined,
    routes: ROUTES,
    offers: OFFERS,
    nowMs: 100_000,
    age: (iso) => `since ${iso}`,
  });

describe("serviceRows", () => {
  it("lists the code services — those a tier builds from a repository — sorted", () => {
    expect(rowsOf(PLATFORM).map((row) => row.hostname)).toEqual(["api", "docs", "web"]);
  });

  it("carries a service's newest deploy HQ records as failed, its commit and HQ's words", () => {
    const rows = serviceRows({
      environment: "stage",
      services: [
        {
          hostname: "api",
          repository: "api",
          appVersionName: SHA_API,
          deploy: {
            latest: deployRecord("failed", { id: "4", sha: SHA_DOCS, reason: "No zerops.yaml." }),
            live: null,
          },
        },
        {
          hostname: "web",
          repository: "web",
          appVersionName: SHA_WEB,
          deploy: { latest: deployRecord("live"), live: deployRecord("live") },
        },
      ],
      platform: PLATFORM,
      mainHead: undefined,
      routes: [],
      offers: [],
      nowMs: 100_000,
      age: (iso) => iso,
    });
    expect(rows.map(({ hostname, failed }) => [hostname, failed])).toEqual([
      ["api", { jobId: "4", sha: SHA_DOCS, message: "No zerops.yaml." }],
      ["web", undefined],
    ]);
  });

  it.each([
    { name: "a service the platform lists and no tier builds", hostname: "worker" },
    { name: "a service no tier builds, though its version is read", hostname: "db" },
  ])("leaves out $name", ({ hostname }) => {
    const rows = serviceRows({
      environment: "production",
      services: [...STAGE_SERVICES, { hostname: "db", appVersionName: "v1" }],
      platform: PLATFORM,
      mainHead: undefined,
      routes: ROUTES,
      offers: OFFERS,
      nowMs: 100_000,
      age: (iso) => iso,
    });
    expect(rows.map((row) => row.hostname)).not.toContain(hostname);
  });

  it.each<StopServiceRow>([
    {
      hostname: "api",
      repository: "api",
      sha: SHA_API,
      commit: "3f9c1b2",
      line: "deployed with v0.1.13",
      tone: "good",
      word: "Deployed",
      status: "Deployed · since 2026-09-25T10:00:00Z",
      runs: { label: "v0.1.13", since: "since 2026-09-25T10:00:00Z" },
      routes: [route("api")],
      offers: [],
      failed: undefined,
      job: undefined,
      drift: undefined,
    },
    {
      hostname: "docs",
      repository: "docs",
      sha: SHA_DOCS,
      commit: "9e8d7c6",
      line: "deployed with v0.1.9",
      tone: "neutral",
      word: "Deployed",
      status: "Deployed",
      runs: { label: "v0.1.9", since: undefined },
      routes: [],
      offers: [OFFERS[0]!],
      failed: undefined,
      job: undefined,
      drift: undefined,
    },
    {
      hostname: "web",
      repository: "web",
      sha: undefined,
      commit: undefined,
      line: undefined,
      tone: "pending",
      word: "Deploying…",
      status: "Deploying…",
      runs: undefined,
      routes: [],
      offers: [],
      failed: undefined,
      job: undefined,
      drift: undefined,
    },
  ])("$hostname", (expected) => {
    expect(rowsOf(PLATFORM).find((row) => row.hostname === expected.hostname)).toEqual(expected);
  });

  it.each<{
    name: string;
    appVersionName: string | undefined;
    previous: Extract<Deployment, { kind: "deploying" }>["previous"];
    expected: Pick<StopServiceRow, "sha" | "commit" | "line" | "status" | "runs">;
  }>([
    {
      name: "keeps what ran before, not the build, while a build of a named release runs",
      appVersionName: SHA_WEB,
      previous: {
        kind: "running",
        activatedAt: "2026-09-25T08:00:00Z",
        version: deployedVersion(`${SHA_DOCS} v0.1.12 gitea`),
      },
      expected: {
        sha: SHA_DOCS,
        commit: "9e8d7c6",
        line: "deployed with v0.1.12",
        status: "Deploying…",
        runs: { label: "v0.1.12", since: "since 2026-09-25T08:00:00Z" },
      },
    },
    {
      name: "keeps what ran before while the build names nothing",
      appVersionName: undefined,
      previous: {
        kind: "running",
        activatedAt: null,
        version: deployedVersion(SHA_DOCS),
      },
      expected: {
        sha: SHA_DOCS,
        commit: "9e8d7c6",
        line: undefined,
        status: "Deploying…",
        runs: { label: "9e8d7c6", since: undefined },
      },
    },
    {
      name: "for the first time runs nothing yet",
      appVersionName: SHA_WEB,
      previous: { kind: "none" },
      expected: {
        sha: undefined,
        commit: undefined,
        line: undefined,
        status: "Deploying…",
        runs: undefined,
      },
    },
    {
      name: "names no commit, never the build's, while nothing states what ran before",
      appVersionName: SHA_WEB,
      previous: null,
      expected: {
        sha: undefined,
        commit: undefined,
        line: undefined,
        status: "Deploying…",
        runs: undefined,
      },
    },
  ])("a service deploying $name", ({ appVersionName, previous, expected }) => {
    const [row] = serviceRows({
      environment: "production",
      services: [{ hostname: "web", repository: "web", appVersionName }],
      platform: {
        ...PLATFORM,
        value: [
          platformService("web", {
            kind: "deploying",
            version: deployedVersion(appVersionName),
            previous,
          }),
        ],
      },
      mainHead: undefined,
      routes: [],
      offers: [],
      nowMs: 100_000,
      age: (iso) => `since ${iso}`,
    });
    expect({
      sha: row?.sha,
      commit: row?.commit,
      line: row?.line,
      status: row?.status,
      runs: row?.runs,
    }).toEqual(expected);
  });

  it.each<{ name: string; appVersionName: string; mainHead: string | undefined; line?: string }>([
    { name: "at main's head", appVersionName: SHA_WEB, mainHead: SHA_WEB, line: "head of main" },
    { name: "behind main's head", appVersionName: SHA_WEB, mainHead: SHA_API },
    { name: "while main's head is not read", appVersionName: SHA_WEB, mainHead: undefined },
    {
      name: "at main's head, named by the branch and the short sha",
      appVersionName: `main ${SHA_WEB.slice(0, 7)}`,
      mainHead: SHA_WEB,
      line: "head of main",
    },
    {
      name: "behind main's head, named by the branch and the short sha",
      appVersionName: `main ${SHA_API.slice(0, 7)}`,
      mainHead: SHA_WEB,
    },
    {
      name: "at main's head, released under the tag and the short sha",
      appVersionName: `v0.1.14 ${SHA_WEB.slice(0, 7)}`,
      mainHead: SHA_WEB,
      line: "deployed with v0.1.14",
    },
    {
      name: "at main's head, deployed with a name",
      appVersionName: `${SHA_WEB} v0.1.14 gitea`,
      mainHead: SHA_WEB,
      line: "deployed with v0.1.14",
    },
  ])("says under a stage's commit $name", ({ appVersionName, mainHead, line }) => {
    const [row] = serviceRows({
      environment: "stage",
      services: [{ hostname: "web", repository: "web", appVersionName }],
      platform: { state: "unread", waitingFor: null },
      mainHead,
      routes: [],
      offers: [],
      nowMs: 100_000,
      age: (iso) => iso,
    });
    expect(row?.line).toBe(line);
  });

  it.each([
    { name: "before main's head is read", mainHead: undefined },
    { name: "at main's head", mainHead: SHA_WEB },
  ])("keys a stage service's commit by its name's own spelling $name", ({ mainHead }) => {
    const [row] = serviceRows({
      environment: "stage",
      services: [
        { hostname: "web", repository: "web", appVersionName: `main ${SHA_WEB.slice(0, 7)}` },
      ],
      platform: { state: "unread", waitingFor: null },
      mainHead,
      routes: [],
      offers: [],
      nowMs: 100_000,
      age: (iso) => iso,
    });
    expect(row?.sha).toBe(SHA_WEB.slice(0, 7));
  });

  it("says no state for a service that runs nothing, whose commit's place already says so", () => {
    const [row] = serviceRows({
      environment: "stage",
      services: [{ hostname: "web", repository: "web" }],
      platform: { ...PLATFORM, value: [platformService("web", { kind: "none" })] },
      mainHead: undefined,
      routes: [],
      offers: [],
      nowMs: 100_000,
      age: (iso) => iso,
    });
    expect({ commit: row?.commit, word: row?.word, status: row?.status }).toEqual({
      commit: undefined,
      word: NOTHING_DEPLOYED,
      status: undefined,
    });
  });

  it("says a stage's first deploy where a service runs nothing, as the stage's cell does", () => {
    const [row] = serviceRows({
      environment: "stage",
      services: [{ hostname: "web", repository: "web" }],
      platform: { ...PLATFORM, value: [platformService("web", { kind: "none" })] },
      mainHead: undefined,
      routes: [],
      offers: [],
      nowMs: 100_000,
      age: (iso) => iso,
      firstDeploy: { kind: "on-its-way" },
    });
    expect({ word: row?.word, status: row?.status }).toEqual({
      word: "First deploy on its way",
      status: undefined,
    });
  });

  it.each<{ hostname: string; tone: StopServiceRow["tone"]; status: string }>([
    { hostname: "api", tone: "good", status: "Deployed" },
    { hostname: "web", tone: "neutral", status: "Deployed" },
  ])(
    "reads $hostname from the flow alone while the platform is unread",
    ({ hostname, ...expected }) => {
      const row = rowsOf({ state: "unread", waitingFor: null }).find(
        (entry) => entry.hostname === hostname,
      );
      expect({ tone: row?.tone, status: row?.status }).toEqual(expected);
    },
  );

  it("carries a platform read that failed to each service, never reading it as none", () => {
    const failed: Shown<ReadonlyArray<StopService>> = {
      state: "failed",
      failure: { kind: "server", status: 503 },
      atMs: 0,
      attempt: 2,
      retryAtMs: 104_000,
    };
    const [row] = serviceRows({
      environment: "production",
      services: [{ hostname: "queue", repository: "queue" }],
      platform: failed,
      mainHead: undefined,
      routes: [],
      offers: [],
      nowMs: 100_000,
      age: (iso) => iso,
    });
    const expected = stopView({ deployment: failed, row: undefined, nowMs: 100_000 }).word;
    expect(expected).not.toBe(CHECKING_WHAT_RUNS);
    expect(row?.word).toBe(expected);
  });
});

describe("jobOf — a service's newest job, said where it is not live", () => {
  const SHA = "5c3ea18b00000000000000000000000000000000";
  const age = (iso: string) => `at ${iso}`;
  it.each<{ name: string; job: HqJob | undefined; expected: ReturnType<typeof jobOf> }>([
    { name: "no job", job: undefined, expected: undefined },
    {
      name: "unresolved remains visible after the deploy answer closes",
      job: deployRecord("unresolved", {
        sha: SHA,
        evidence: {
          nextActor: "person",
          nextAction: "Inspect the original version in Zerops before asking Run again",
        },
      }),
      expected: {
        state: "unresolved",
        line: "5c3ea18: HQ could not follow this deploy to its end. A person acts next: Inspect the original version in Zerops before asking Run again",
        reason: undefined,
        redeploy: { service: "api", sha: SHA, after: "1" },
      },
    },
    {
      name: "pending with no observed build",
      job: deployRecord("submitting", {
        sha: SHA,
        evidence: {
          phase: "waiting-for-build",
          nextActor: "person",
          nextAction: "Inspect the original version in Zerops; Run again if no build started",
        },
      }),
      expected: {
        state: "submitting",
        line: "5c3ea18: Waiting for Zerops to start the build. A person acts next: Inspect the original version in Zerops; Run again if no build started",
        reason: undefined,
        redeploy: { service: "api", sha: SHA, after: "1" },
      },
    },
    { name: "live", job: deployRecord("live", { sha: SHA }), expected: undefined },
    {
      name: "superseded",
      job: deployRecord("superseded", { sha: SHA, supersededBy: "2" }),
      expected: undefined,
    },
    {
      name: "a delta, which deploys no commit",
      job: deployRecord("building", { kind: "delta", service: null, sha: null }),
      expected: undefined,
    },
    {
      name: "queued",
      job: deployRecord("queued", { sha: SHA }),
      expected: { state: "queued", line: "5c3ea18 queued", reason: undefined },
    },
    {
      name: "submitting",
      job: deployRecord("submitting", { sha: SHA }),
      expected: { state: "submitting", line: "Submitting 5c3ea18", reason: undefined },
    },
    {
      name: "building",
      job: deployRecord("building", { sha: SHA, processId: "pr-1" }),
      expected: { state: "building", line: "Building 5c3ea18", reason: undefined },
    },
    {
      name: "its build failed: when it ended, and why",
      job: deployRecord("failed", { sha: SHA, reason: "No zerops.yaml." }),
      expected: {
        state: "failed",
        line: "5c3ea18 failed at 2026-10-02T10:04:00.000Z",
        reason: "No zerops.yaml.",
      },
    },
    {
      name: "HQ refused it: when it ended, and why",
      job: deployRecord("refused", { sha: SHA, reason: "Zerops did not answer: timeout" }),
      expected: {
        state: "refused",
        line: "HQ refused 5c3ea18 at 2026-10-02T10:04:00.000Z",
        reason: "Zerops did not answer: timeout",
      },
    },
    {
      name: "HQ skipped it: when, and why",
      job: deployRecord("skipped", { sha: SHA, reason: "web has no zerops.yaml at 5c3ea18" }),
      expected: {
        state: "skipped",
        line: "HQ skipped 5c3ea18 at 2026-10-02T10:04:00.000Z",
        reason: "web has no zerops.yaml at 5c3ea18",
      },
    },
    {
      name: "ended with blank words: no reason",
      job: deployRecord("refused", { sha: SHA, reason: "  " }),
      expected: {
        state: "refused",
        line: "HQ refused 5c3ea18 at 2026-10-02T10:04:00.000Z",
        reason: undefined,
      },
    },
  ])("$name", ({ job, expected }) => {
    expect(jobOf(job, age)).toEqual(expected);
  });
});

// The deploy-jobs design: HQ never overwrites a version it did not make; the person decides.
describe("driftOf — a service running a version HQ did not deploy", () => {
  const LIVE_SHA = "3f9c1b2000000000000000000000000000000000";
  const live = deployRecord("live", { id: "5", sha: LIVE_SHA, appVersionId: "av-hq" });
  const state = (over: Partial<EnvironmentServiceState> = {}): EnvironmentServiceState => ({
    hostname: "app",
    serviceId: "svc-app",
    appVersionName: "hotfix by hand",
    activeVersionId: "av-hand",
    deploy: { latest: live, live },
    ...over,
  });
  it.each<{ name: string; state: EnvironmentServiceState; expected: ReturnType<typeof driftOf> }>([
    {
      name: "another version than HQ's live one: drift, with HQ's commit to deploy again",
      state: state(),
      expected: {
        line: "app runs “hotfix by hand”, which HQ did not deploy",
        redeploy: { service: "app", sha: LIVE_SHA, after: "5" },
        zerops: "https://app.zerops.io/service-stack/svc-app",
      },
    },
    {
      name: "a version that names nothing",
      state: state({ appVersionName: undefined }),
      expected: {
        line: "app runs a version HQ did not deploy",
        redeploy: { service: "app", sha: LIVE_SHA, after: "5" },
        zerops: "https://app.zerops.io/service-stack/svc-app",
      },
    },
    {
      name: "a newer job ended without running, asked again after it",
      state: state({
        deploy: { latest: deployRecord("failed", { id: "6", sha: LIVE_SHA }), live },
      }),
      expected: {
        line: "app runs “hotfix by hand”, which HQ did not deploy",
        redeploy: { service: "app", sha: LIVE_SHA, after: "6" },
        zerops: "https://app.zerops.io/service-stack/svc-app",
      },
    },
    {
      // HQ asks again only a service's newest job: a live one an older job, nothing is offered.
      name: "a newer job of another commit ended without running: said, nothing to ask again",
      state: state({
        deploy: {
          latest: deployRecord("refused", { id: "6", sha: "9".repeat(40) }),
          live,
        },
      }),
      expected: {
        line: "app runs “hotfix by hand”, which HQ did not deploy",
        redeploy: undefined,
        zerops: "https://app.zerops.io/service-stack/svc-app",
      },
    },
    {
      name: "a version named by a whole commit, said by its short one",
      state: state({ appVersionName: "c".repeat(40) }),
      expected: {
        line: "app runs “ccccccc”, which HQ did not deploy",
        redeploy: { service: "app", sha: LIVE_SHA, after: "5" },
        zerops: "https://app.zerops.io/service-stack/svc-app",
      },
    },
    {
      name: "the service's id not known: no link",
      state: state({ serviceId: undefined }),
      expected: {
        line: "app runs “hotfix by hand”, which HQ did not deploy",
        redeploy: { service: "app", sha: LIVE_SHA, after: "5" },
        zerops: undefined,
      },
    },
    { name: "HQ's own version", state: state({ activeVersionId: "av-hq" }), expected: undefined },
    {
      name: "an unresolved HQ deploy's version may be what runs",
      state: state({
        activeVersionId: "av-unresolved",
        deploy: { latest: deployRecord("unresolved", { appVersionId: "av-unresolved" }), live },
      }),
      expected: undefined,
    },
    {
      name: "an unresolved HQ deploy names another version: drift still applies",
      state: state({
        deploy: {
          latest: deployRecord("unresolved", {
            id: "6",
            sha: LIVE_SHA,
            appVersionId: "av-unresolved",
          }),
          live,
        },
      }),
      expected: {
        line: "app runs “hotfix by hand”, which HQ did not deploy",
        redeploy: { service: "app", sha: LIVE_SHA, after: "6" },
        zerops: "https://app.zerops.io/service-stack/svc-app",
      },
    },
    {
      name: "what runs not read",
      state: state({ activeVersionId: undefined }),
      expected: undefined,
    },
    { name: "nothing runs", state: state({ activeVersionId: null }), expected: undefined },
    {
      name: "a job of HQ's under way",
      state: state({
        deploy: { latest: deployRecord("building", { id: "6", sha: LIVE_SHA }), live },
      }),
      expected: undefined,
    },
    {
      name: "HQ put nothing live",
      state: state({ deploy: { latest: deployRecord("failed"), live: null } }),
      expected: undefined,
    },
    {
      name: "HQ's live job names no version (before H6)",
      state: state({
        deploy: { latest: { ...live, appVersionId: null }, live: { ...live, appVersionId: null } },
      }),
      expected: undefined,
    },
  ])("$name", ({ state: service, expected }) => {
    expect(driftOf(service)).toEqual(expected);
  });

  it("stands on the service's row, with its newest job", () => {
    const failed = deployRecord("failed", { id: "6", sha: LIVE_SHA, reason: "No zerops.yaml." });
    const [row] = serviceRows({
      environment: "stage",
      services: [{ ...state({ deploy: { latest: failed, live } }), repository: "app" }],
      platform: { state: "unread", waitingFor: null },
      mainHead: undefined,
      routes: [],
      offers: [],
      nowMs: 100_000,
      age: (iso) => `at ${iso}`,
    });
    expect({ job: row?.job, drift: row?.drift?.redeploy }).toEqual({
      job: {
        state: "failed",
        line: "3f9c1b2 failed at 2026-10-02T10:04:00.000Z",
        reason: "No zerops.yaml.",
      },
      drift: { service: "app", sha: LIVE_SHA, after: "6" },
    });
  });
});

// Audit D2: a service its tier declares and the project lacks — a person deleted it, or a delta
// did not import it — is said, for a person to add; HQ never adds it by itself.
describe("notInZerops — what the recipe declares and the project lacks", () => {
  it.each<{
    readonly name: string;
    readonly recipeServices: ReadonlyArray<string> | undefined;
    readonly platform: Shown<ReadonlyArray<StopService>>;
    readonly missing: ReadonlyArray<string>;
  }>([
    { name: "all there", recipeServices: ["api", "web"], platform: PLATFORM, missing: [] },
    {
      name: "a declared database the project lacks",
      recipeServices: ["api", "db", "web"],
      platform: PLATFORM,
      missing: ["db"],
    },
    { name: "the recipe not read", recipeServices: undefined, platform: PLATFORM, missing: [] },
    {
      name: "what the project holds not read",
      recipeServices: ["api", "db"],
      platform: { state: "unread", waitingFor: null },
      missing: [],
    },
  ])("$name", ({ recipeServices, platform, missing }) => {
    expect(notInZerops({ recipeServices, platform })).toEqual(missing);
  });
});

describe("stopFailedDeploy", () => {
  const SHA_N13 = "47ae139000000000000000000000000000000000";
  const SHA_N14 = "9c41d2e000000000000000000000000000000000";
  const serviceRow = (hostname: string, over: Partial<StopServiceRow> = {}): StopServiceRow => ({
    hostname,
    repository: hostname,
    sha: SHA_N13,
    commit: "47ae139",
    line: undefined,
    tone: "good",
    word: "Deployed",
    status: "Deployed",
    runs: { label: "v0.1.13", since: "6m ago" },
    routes: [],
    offers: [],
    failed: undefined,
    job: undefined,
    drift: undefined,
    ...over,
  });
  const releaseRow = (tag: string, over: Partial<FlowReleaseRow> = {}): FlowReleaseRow => ({
    tag,
    verdict: "approved",
    detail: undefined,
    line: "",
    entries: [],
    taggedAt: "2026-09-25T07:00:00Z",
    standing: undefined,
    word: "Approved",
    rollBack: false,
    failedEntry: undefined,
    ...over,
  });
  const FAILED_14 = releaseRow("v0.1.14", {
    standing: "deploy-failed",
    word: "Deploy failed",
    failedEntry: { service: "nextstore", commit: SHA_N14 },
  });
  const LIVE_13 = releaseRow("v0.1.13", { standing: "live", word: "Live" });

  it.each<{
    name: string;
    tier: "production" | "stage";
    rows: ReadonlyArray<StopServiceRow>;
    releases: ReadonlyArray<FlowReleaseRow>;
    expected: StopFailedDeploy | undefined;
  }>([
    {
      name: "ProdFailed: v0.1.14 failed on nextstore, which still runs v0.1.13",
      tier: "production",
      rows: [serviceRow("medusa"), serviceRow("nextstore")],
      releases: [FAILED_14, LIVE_13],
      expected: {
        label: "v0.1.14",
        service: "nextstore",
        sha: SHA_N14,
        running: { label: "v0.1.13", since: "6m ago" },
        redeploy: undefined,
        message: undefined,
      },
    },
    {
      name: "a failed release HQ records as the service's newest failed deploy is asked again",
      tier: "production",
      rows: [
        serviceRow("nextstore", {
          tone: "bad",
          failed: { jobId: "7", sha: SHA_N14, message: undefined },
        }),
      ],
      releases: [FAILED_14, LIVE_13],
      expected: {
        label: "v0.1.14",
        service: "nextstore",
        sha: SHA_N14,
        running: { label: "v0.1.13", since: "6m ago" },
        redeploy: { service: "nextstore", sha: SHA_N14, after: "7" },
        message: undefined,
      },
    },
    {
      name: "a release that failed before the live one is history",
      tier: "production",
      rows: [serviceRow("nextstore")],
      releases: [releaseRow("v0.1.15", { standing: "live", word: "Live" }), FAILED_14],
      expected: undefined,
    },
    {
      name: "a production whose newest deploy failed, with no release that did",
      tier: "production",
      rows: [
        serviceRow("nextstore", {
          tone: "bad",
          failed: { jobId: "7", sha: SHA_N14, message: undefined },
        }),
      ],
      releases: [LIVE_13],
      expected: {
        label: "9c41d2e",
        service: "nextstore",
        sha: SHA_N14,
        running: { label: "v0.1.13", since: "6m ago" },
        redeploy: { service: "nextstore", sha: SHA_N14, after: "7" },
        message: undefined,
      },
    },
    {
      name: "a stage reads its services, never the releases, and names what still runs",
      tier: "stage",
      rows: [
        serviceRow("api", {
          tone: "bad",
          failed: { jobId: "7", sha: SHA_N14, message: undefined },
          runs: { label: "47ae139", since: undefined },
        }),
      ],
      releases: [FAILED_14],
      expected: {
        label: "9c41d2e",
        service: "api",
        sha: SHA_N14,
        running: { label: "47ae139", since: undefined },
        redeploy: { service: "api", sha: SHA_N14, after: "7" },
        message: undefined,
      },
    },
    {
      name: "a service whose failed commit is what it runs names nothing else as running",
      tier: "stage",
      rows: [
        serviceRow("api", {
          tone: "bad",
          failed: { jobId: "7", sha: SHA_N13, message: undefined },
        }),
      ],
      releases: [],
      expected: {
        label: "47ae139",
        service: "api",
        sha: SHA_N13,
        running: undefined,
        redeploy: { service: "api", sha: SHA_N13, after: "7" },
        message: undefined,
      },
    },
    {
      name: "a service the migration holds carries HQ's words for it, and is run again",
      tier: "production",
      rows: [
        serviceRow("nextstore", {
          tone: "bad",
          failed: {
            jobId: "7",
            sha: SHA_N14,
            message: "Held at migration: nextstore runs 47ae139; Run brings it to 9c41d2e.",
          },
        }),
      ],
      releases: [FAILED_14, LIVE_13],
      expected: {
        label: "v0.1.14",
        service: "nextstore",
        sha: SHA_N14,
        running: { label: "v0.1.13", since: "6m ago" },
        redeploy: { service: "nextstore", sha: SHA_N14, after: "7" },
        message: "Held at migration: nextstore runs 47ae139; Run brings it to 9c41d2e.",
      },
    },
    {
      name: "nothing failed",
      tier: "production",
      rows: [serviceRow("nextstore")],
      releases: [LIVE_13],
      expected: undefined,
    },
  ])("$name", ({ tier, rows, releases, expected }) => {
    expect(stopFailedDeploy({ tier, rows, releases })).toEqual(expected);
  });
});

describe("serviceRows — durable deploy log handles", () => {
  it.each(["building", "failed", "live"] as const)("keeps %s deploy inspectable", (state) => {
    const latest = deployRecord(state, { id: "7", processId: "p7", appVersionId: "v7" });
    const [row] = serviceRows({
      environment: "stage",
      services: [
        {
          hostname: "api",
          repository: "api",
          deploy: { latest, live: state === "live" ? latest : null },
        },
      ],
      platform: { state: "unread", waitingFor: null },
      mainHead: undefined,
      routes: [],
      offers: [],
      nowMs: 0,
      age: () => "now",
    });
    expect(row?.deployLog).toEqual({ jobId: "7", processId: "p7", appVersionId: "v7" });
  });
});
