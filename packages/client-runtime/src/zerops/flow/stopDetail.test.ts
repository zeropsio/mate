import { describe, expect, it } from "vite-plus/test";

import { service } from "../data/__fixtures__/index.ts";
import {
  deployedVersion,
  type DeployedVersion,
  type EnvironmentServiceState,
} from "../groupRows.ts";
import type { Shown } from "../knowledge/known.ts";
import type { ZeropsPublicRoute, ZeropsRouteOffer } from "../publicRoutes.ts";
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
  serviceRows,
  stopMetaLine,
  stopVerdict,
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
  atMainHead: false,
};

const FAILED = { label: "v0.1.14", service: "nextstore", running: "v0.1.13", jobKnown: true };

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
      name: "a stage at main's head",
      input: { tier: "stage", atMainHead: true, waiting: 2 },
      expected: { tone: "ok", text: "Stage runs the head of main.", detail: undefined, verb: null },
    },
    {
      name: "a stage behind main's head",
      input: { tier: "stage" },
      expected: { tone: "ok", text: "Stage runs v0.1.13.", detail: undefined, verb: null },
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
  it("joins both sides by hostname, sorted", () => {
    expect(rowsOf(PLATFORM).map((row) => row.hostname)).toEqual(["api", "docs", "web", "worker"]);
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
      routes: [],
      offers: [OFFERS[0]!],
    },
    {
      hostname: "web",
      repository: "web",
      sha: SHA_WEB,
      commit: "a1b2c3d",
      line: undefined,
      tone: "pending",
      word: "Deploying…",
      status: "Deploying…",
      routes: [],
      offers: [],
    },
    {
      hostname: "worker",
      repository: undefined,
      sha: undefined,
      commit: undefined,
      line: undefined,
      tone: "neutral",
      word: "Deployed",
      status: "Deployed",
      routes: [route("worker")],
      offers: [],
    },
  ])("$hostname", (expected) => {
    expect(rowsOf(PLATFORM).find((row) => row.hostname === expected.hostname)).toEqual(expected);
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
