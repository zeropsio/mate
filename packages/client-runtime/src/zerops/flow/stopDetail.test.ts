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
  earlierReleasesLabel,
  openStopLabel,
  serviceBuildToggleLabel,
  serviceRows,
  stopCardTitle,
  stopFailedDeploy,
  stopMetaLine,
  stopVerdict,
  type StopFailedDeploy,
  type StopFailure,
  type StopServiceRow,
  type StopVerdict,
} from "./stopDetail.ts";

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
  release: { offered: false, tag: undefined },
  releasedAge: undefined,
  since: undefined,
  atMainHead: false,
};

const FAILED: StopFailure = {
  label: "v0.1.14",
  service: "nextstore",
  sha: undefined,
  running: { label: "v0.1.13", since: undefined },
  jobKnown: true,
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
      name: "failed with what still runs and the job known",
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
      name: "failed with nothing known to run and no job",
      input: { failed: { ...FAILED, running: undefined, jobKnown: false } },
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
      input: { view: EMPTY, waiting: 3, release: { offered: true, tag: "v0.1.0" } },
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
      name: "still checking",
      input: { view: CHECKING, waiting: 3 },
      expected: { tone: "off", text: CHECKING_WHAT_RUNS, detail: undefined, verb: null },
    },
    {
      name: "production behind with the release offered",
      input: { waiting: 3, release: { offered: true, tag: "v0.1.14" } },
      expected: {
        tone: "busy",
        text: "3 changes not live.",
        detail: "Production runs v0.1.13",
        verb: { kind: "release", tag: "v0.1.14" },
      },
    },
    {
      name: "production one change behind, release not offered",
      input: { waiting: 1, release: { offered: false, tag: "v0.1.14" } },
      expected: {
        tone: "busy",
        text: "1 change not live.",
        detail: "Production runs v0.1.13",
        verb: null,
      },
    },
    {
      name: "production behind, offered but no tag known",
      input: { waiting: 2, release: { offered: true, tag: undefined } },
      expected: {
        tone: "busy",
        text: "2 changes not live.",
        detail: "Production runs v0.1.13",
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
    expected: string;
  }>([
    { group: "waiting", count: 3, expected: "Waiting for release · 3" },
    { group: "services", count: 2, expected: "Services · 2" },
    { group: "releases", count: 12, expected: "Releases · 12" },
    { group: "deploys", count: 0, expected: "Deploys · 0" },
    { group: "deploys", count: undefined, expected: "Deploys" },
  ])("$group with $count", ({ group, count, expected }) => {
    expect(stopCardTitle(group, count)).toBe(expected);
  });
});

describe("serviceBuildToggleLabel", () => {
  it.each([
    { open: false, expected: "Show how api was deployed" },
    { open: true, expected: "Hide how api was deployed" },
  ])("open: $open", ({ open, expected }) => {
    expect(serviceBuildToggleLabel("api", open)).toBe(expected);
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

const GITEA: ReadonlyArray<EnvironmentServiceState> = [
  {
    hostname: "web",
    repository: "web",
    appVersionName: SHA_WEB,
  },
  {
    hostname: "api",
    repository: "api",
    appVersionName: `${SHA_API} v0.1.13 gitea`,
    statuses: [{ context: "mate/deploy/production/api", state: "success" }],
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
    services: GITEA,
    platform,
    routes: ROUTES,
    offers: OFFERS,
    nowMs: 100_000,
    age: (iso) => `since ${iso}`,
  });

describe("serviceRows", () => {
  it("lists the code services — those a tier builds from a repository — sorted", () => {
    expect(rowsOf(PLATFORM).map((row) => row.hostname)).toEqual(["api", "docs", "web"]);
  });

  it.each([
    { name: "a service the platform lists and no tier builds", hostname: "worker" },
    { name: "a service no tier builds, though its version is read", hostname: "db" },
  ])("leaves out $name", ({ hostname }) => {
    const rows = serviceRows({
      environment: "production",
      services: [...GITEA, { hostname: "db", appVersionName: "v1" }],
      platform: PLATFORM,
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

  it("says no state for a service that runs nothing, whose commit's place already says so", () => {
    const [row] = serviceRows({
      environment: "stage",
      services: [{ hostname: "web", repository: "web" }],
      platform: { ...PLATFORM, value: [platformService("web", { kind: "none" })] },
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

  it.each<{ hostname: string; tone: StopServiceRow["tone"]; status: string }>([
    { hostname: "api", tone: "good", status: "Deployed" },
    { hostname: "web", tone: "neutral", status: "Deployed" },
  ])(
    "reads $hostname from Gitea alone while the platform is unread",
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
    ...over,
  });
  const releaseRow = (tag: string, over: Partial<FlowReleaseRow> = {}): FlowReleaseRow => ({
    tag,
    verdict: "approved",
    detail: undefined,
    line: "",
    entries: [],
    taggedAt: undefined,
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
      name: "a production whose running commit's deploy failed, with no release that did",
      tier: "production",
      rows: [serviceRow("nextstore", { tone: "bad" })],
      releases: [LIVE_13],
      expected: { label: "v0.1.13", service: "nextstore", sha: SHA_N13, running: undefined },
    },
    {
      name: "a stage reads its services, never the releases",
      tier: "stage",
      rows: [serviceRow("api", { tone: "bad", runs: { label: "b21d904", since: undefined } })],
      releases: [FAILED_14],
      expected: { label: "b21d904", service: "api", sha: SHA_N13, running: undefined },
    },
    {
      name: "a failed service naming no version names no deploy",
      tier: "stage",
      rows: [serviceRow("api", { tone: "bad", runs: undefined, commit: undefined })],
      releases: [],
      expected: undefined,
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
