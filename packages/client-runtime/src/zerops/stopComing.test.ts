import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { Deployment } from "./flow/deployment.ts";
import { groupFlow } from "./groupFlow.ts";
import { deployedVersion, environmentRow } from "./groupRows.ts";
import type { HqDeploy } from "./hq/environments.ts";
import type { Shown } from "./knowledge/known.ts";
import {
  comingLine,
  COMING_UP_WINDOW_MS,
  firstDeploy,
  listedStopComing,
  stopComing,
  stopDeployed,
  stopServes,
  type FirstDeploy,
  type StopComing,
} from "./stopComing.ts";

const NOW = Date.parse("2026-09-30T18:00:00.000Z");
const ago = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(NOW - ms));

const app = (status: string) => ({ hostname: "app", status, runtime: true });
const db = (status: string) => ({ hostname: "db", status, runtime: false });

const base = {
  tier: "stage" as const,
  pending: false,
  projectStatus: "ACTIVE",
  createdAt: ago(60_000),
  nowMs: NOW,
  services: [db("ACTIVE"), app("ACTIVE")] as ReadonlyArray<ReturnType<typeof app>> | undefined,
  building: false,
  deployed: true as boolean | undefined,
  routes: 1,
  firstDeploy: undefined as FirstDeploy | undefined,
};

describe("stopComing — where a stage or a production coming up has got", () => {
  it.each([
    {
      case: "accepted, not listed yet",
      over: { pending: true },
      coming: { kind: "coming", step: "project" },
    },
    {
      case: "its project being made",
      over: { projectStatus: "CREATING" },
      coming: { kind: "coming", step: "project" },
    },
    {
      case: "its services unread",
      over: { services: undefined },
      coming: { kind: "coming", step: "project" },
    },
    {
      case: "the database not running yet",
      over: { services: [db("CREATING"), app("READY_TO_DEPLOY")], deployed: false },
      coming: { kind: "coming", step: "database" },
    },
    {
      case: "a build running",
      over: { services: [db("ACTIVE"), app("READY_TO_DEPLOY")], building: true, deployed: false },
      coming: { kind: "coming", step: "build" },
    },
    {
      case: "a stage's runtime waiting to be deployed: its first deploy, never a build",
      over: { services: [db("ACTIVE"), app("READY_TO_DEPLOY")], deployed: false },
      coming: { kind: "coming", step: "awaiting-deploy" },
    },
    {
      case: "running after a deploy, no address yet",
      over: { routes: 0 },
      coming: { kind: "coming", step: "address" },
    },
    {
      case: "running with no deploy and no address: its first deploy, never the address",
      over: { deployed: false, routes: 0 },
      coming: { kind: "coming", step: "awaiting-deploy" },
    },
    { case: "running at its address: up", over: {}, coming: undefined },
    {
      case: "a redeploy over a serving stage, its runtime upgrading: never coming up again",
      over: { services: [db("ACTIVE"), app("UPGRADING")], building: true },
      coming: undefined,
    },
    {
      case: "production's next release upgrading its runtime: the release's line, never coming up",
      over: {
        tier: "production" as const,
        services: [db("ACTIVE"), app("UPGRADING")],
        building: true,
      },
      coming: undefined,
    },
    {
      case: "serving while what runs there is unread (a reload): up, never a first deploy",
      over: { deployed: undefined },
      coming: undefined,
    },
    {
      case: "no address while what runs there is unread: the neutral wait, never on its way",
      over: {
        deployed: undefined,
        routes: 0,
        firstDeploy: { kind: "on-its-way" } as FirstDeploy,
      },
      coming: { kind: "coming", step: "awaiting-deploy" },
    },
    {
      case: "a first deploy that failed: the stage didn't come up",
      over: { deployed: false, routes: 0, firstDeploy: { kind: "failed" } as FirstDeploy },
      coming: { kind: "failed", reason: "its first deploy failed" },
    },
    {
      case: "a first deploy known not to have run, HQ deploying it: on its way",
      over: {
        deployed: false,
        routes: 0,
        firstDeploy: { kind: "on-its-way" } as FirstDeploy,
      },
      coming: { kind: "coming", step: "deploy-on-its-way" },
    },
    {
      case: "its first build failed",
      over: { services: [db("ACTIVE"), app("ACTION_FAILED")], deployed: false },
      coming: { kind: "failed", reason: "the app’s build failed" },
    },
    {
      case: "the database did not start",
      over: { services: [db("ACTION_FAILED"), app("READY_TO_DEPLOY")], deployed: false },
      coming: { kind: "failed", reason: "the db didn’t start" },
    },
    {
      case: "a later deploy failed: the pill's, not coming up",
      over: { services: [db("ACTIVE"), app("ACTION_FAILED")] },
      coming: undefined,
    },
    {
      case: "made long ago: the pill says what it lacks",
      over: { createdAt: ago(COMING_UP_WINDOW_MS), routes: 0 },
      coming: undefined,
    },
    {
      case: "when it was made unknown",
      over: { createdAt: undefined, routes: 0 },
      coming: undefined,
    },
    { case: "stopped", over: { projectStatus: "STOPPED" }, coming: undefined },
    {
      case: "production waiting for its first release",
      over: {
        tier: "production" as const,
        services: [db("ACTIVE"), app("READY_TO_DEPLOY")],
        deployed: false,
      },
      coming: undefined,
    },
    {
      case: "production running the import's no-code version: nothing released yet",
      over: { tier: "production" as const, deployed: false, routes: 0 },
      coming: undefined,
    },
    {
      case: "production's first release building",
      over: {
        tier: "production" as const,
        services: [db("ACTIVE"), app("READY_TO_DEPLOY")],
        building: true,
        deployed: false,
      },
      coming: { kind: "coming", step: "build" },
    },
  ])("$case", ({ over, coming }) => {
    expect(stopComing({ ...base, ...over })).toEqual(coming);
  });
});

describe("stopDeployed — whether a stop has run a deploy, from its flow stop", () => {
  it.each([
    { state: "checking", version: undefined, deployed: undefined },
    { state: "empty", version: undefined, deployed: false },
    { state: "deploying", version: undefined, deployed: undefined },
    { state: "deploying", version: "e014b0e", deployed: true },
    { state: "deployed", version: "e014b0e", deployed: true },
    { state: "failed", version: undefined, deployed: true },
  ] as const)("$state $version", ({ state, version, deployed }) => {
    expect(stopDeployed({ state, version })).toBe(deployed);
  });
});

describe("stopServes — only a stop that serves lands up", () => {
  it.each([
    { state: "deployed", version: "e014b0e", routes: 1, serves: true },
    { state: "deployed", version: "e014b0e", routes: 0, serves: false },
    { state: "empty", version: undefined, routes: 0, serves: false },
    { state: "checking", version: undefined, routes: 1, serves: false },
  ] as const)("$state with $routes routes", ({ state, version, routes, serves }) => {
    expect(stopServes({ stop: { state, version }, routes })).toBe(serves);
  });
});

describe("firstDeploy — where a stage's first deploy stands by HQ's records of it", () => {
  const record = (over: Partial<HqDeploy>): HqDeploy => ({
    sha: "e014b0e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d1",
    state: "pending",
    failure: null,
    message: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: ago(60_000),
    ...over,
  });
  it.each([
    { case: "HQ records none", deploys: [], first: { kind: "awaited" } },
    { case: "queued", deploys: [record({})], first: { kind: "on-its-way" } },
    {
      case: "deploying",
      deploys: [record({ state: "deploying" })],
      first: { kind: "on-its-way" },
    },
    {
      case: "queued a window ago and never moved: nothing promised any more",
      deploys: [record({ at: ago(COMING_UP_WINDOW_MS) })],
      first: { kind: "awaited" },
    },
    {
      case: "its build failed, however long ago: final",
      deploys: [record({ state: "failed", failure: "job", at: ago(COMING_UP_WINDOW_MS * 4) })],
      first: { kind: "failed" },
    },
    {
      case: "HQ refused it and asks again: nothing promised",
      deploys: [record({ state: "failed", failure: "refused" })],
      first: { kind: "awaited" },
    },
    {
      case: "one service's build failed, another queued: failed",
      deploys: [record({}), record({ state: "failed", failure: "job" })],
      first: { kind: "failed" },
    },
    {
      case: "live where nothing runs: nothing promised",
      deploys: [record({ state: "live" })],
      first: { kind: "awaited" },
    },
  ])("$case", ({ deploys, first }) => {
    expect(firstDeploy({ deploys, nowMs: NOW })).toEqual(first);
  });
});

describe("listedStopComing — a production, read the way the menu reads it", () => {
  // Karel's xyz (2026-10-02): a production no release reached, its runtimes up on the import's
  // no-code version, read "Production coming up · turning its address on" until its window ran out.
  const SHA = "7c41d9e0a2b35f6e8d1c0b9a4f3e2d1c0b9a8f7e";
  const known = (value: Deployment): Shown<Deployment> => ({
    state: "known",
    value,
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  });
  const live: HqDeploy = {
    sha: SHA,
    state: "live",
    failure: null,
    message: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: ago(30_000),
  };
  const comingOf = (deployment: Shown<Deployment> | undefined, released: boolean) => {
    const appVersionName = released ? `${SHA} v1.0.0 u-jan` : undefined;
    const flow = groupFlow({
      groupId: "g-xyz",
      mates: [],
      pullRequests: [],
      merged: [],
      stops: [
        {
          projectId: "p-xyz-prod",
          name: "xyz - production",
          tier: "production",
          row: environmentRow({
            projectId: "p-xyz-prod",
            name: "xyz - production",
            tier: "production",
            sources: "release",
            services: [
              {
                hostname: "app",
                ...(appVersionName === undefined ? {} : { appVersionName }),
                ...(released ? { deploy: { latest: live, live } } : {}),
              },
            ],
          }),
          deployment,
          route: undefined,
        },
      ],
      missing: [],
      release: {
        gate: { allowed: false, reason: "" },
        suggestion: "v1.0.0",
        waiting: 0,
        waitingAtLeast: false,
        untold: [],
      },
      mainHasCode: true,
      mainHead: undefined,
      productionAddable: false,
      pending: [],
    });
    if (!("stop" in flow.production)) throw new Error("the production is listed");
    return listedStopComing(
      "production",
      {
        stop: flow.production.stop,
        projectStatus: "ACTIVE",
        createdAt: ago(60_000),
        services: [db("ACTIVE"), app("ACTIVE")],
        building: false,
        routes: 0,
      },
      NOW,
    );
  };

  it.each([
    {
      case: "the platform knows it runs nothing: no line",
      deployment: known({ kind: "none" }),
      released: false,
      coming: undefined,
    },
    {
      case: "what it runs unread, and HQ records no deploy: no line",
      deployment: undefined,
      released: false,
      coming: undefined,
    },
    {
      case: "what it runs being read again: no line",
      deployment: { state: "reading", sinceMs: 0, attempt: 1 } as const,
      released: false,
      coming: undefined,
    },
    {
      case: "a release runs and its address is not on yet: the address step",
      deployment: known({
        kind: "running",
        activatedAt: null,
        version: deployedVersion(`${SHA} v1.0.0 u-jan`),
      }),
      released: true,
      coming: { kind: "coming", step: "address" },
    },
  ])("$case", ({ deployment, released, coming }) => {
    expect(comingOf(deployment, released)).toEqual(coming);
  });
});

describe("comingLine — the line an environment coming up says", () => {
  it.each<[string, StopComing & { kind: "coming" }, { fact: string; rest: string }]>([
    [
      "Stage",
      { kind: "coming", step: "project" },
      { fact: "Stage coming up", rest: "making the project" },
    ],
    [
      "Production",
      { kind: "coming", step: "app" },
      { fact: "Production coming up", rest: "adding the app" },
    ],
  ])("%s %j", (subject, coming, line) => {
    expect(comingLine(subject, coming)).toEqual(line);
  });
});
