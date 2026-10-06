import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { Deployment } from "./flow/deployment.ts";
import { groupFlow } from "./groupFlow.ts";
import { deployedVersion, environmentRow } from "./groupRows.ts";
import type { HqJob } from "./hq/environments.ts";
import type { Shown } from "./knowledge/known.ts";
import type { EnvironmentBirth } from "@t3tools/shared/hqDeploys";

import {
  comingLine,
  firstDeploy,
  firstDeployLine,
  firstDeployTone,
  listedStopComing,
  stopComing,
  stopDeployed,
  stopImport,
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
  /** HQ still bringing it up: the rollout its attach asked for has not ended. */
  birth: { ended: false } as { readonly ended: boolean } | null | undefined,
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
      case: "a reload: its services unread under an active project, never making the project",
      over: { services: undefined, deployed: undefined, routes: 0 },
      coming: undefined,
    },
    {
      case: "its project being deleted: never making the project",
      over: { projectStatus: "DELETING", routes: 0 },
      coming: undefined,
    },
    {
      case: "its project being made, whoever brought it up: making the project",
      over: { projectStatus: "CREATING", birth: null },
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
      case: "a first deploy known not to have run, held for a deploy key",
      over: {
        deployed: false,
        routes: 0,
        firstDeploy: { kind: "held" } as FirstDeploy,
      },
      coming: { kind: "coming", step: "awaiting-key" },
    },
    {
      case: "listed with no runtime yet (run 5, +696 s): adding the app, never the runner",
      over: {
        services: [],
        deployed: false,
        routes: 0,
        firstDeploy: { kind: "on-its-way" } as FirstDeploy,
      },
      coming: { kind: "coming", step: "app" },
    },
    {
      case: "its runtime being made, a first deploy failed on main: the import first",
      over: {
        services: [app("CREATING")],
        deployed: false,
        routes: 0,
        firstDeploy: { kind: "failed" } as FirstDeploy,
      },
      coming: { kind: "coming", step: "app" },
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
    // Coming up is its owners' word, never its age (H2): one HQ did not bring up, or whose birth
    // ended, shows what it lacks on its pill.
    {
      case: "one HQ did not bring up, its database stopped: never coming up",
      over: { birth: null, services: [db("STOPPED"), app("ACTIVE")], routes: 0 },
      coming: undefined,
    },
    {
      case: "one HQ did not bring up, nothing deployed: never coming up",
      over: {
        birth: null,
        services: [db("ACTIVE"), app("READY_TO_DEPLOY")],
        deployed: false,
        routes: 0,
      },
      coming: undefined,
    },
    {
      case: "one HQ did not bring up, no address: never coming up",
      over: { birth: null, routes: 0 },
      coming: undefined,
    },
    {
      case: "one whose birth HQ has not told: never coming up",
      over: { birth: undefined, routes: 0 },
      coming: undefined,
    },
    {
      case: "a birth that ended: stops coming up at once, whatever it lacks",
      over: { birth: { ended: true }, deployed: false, routes: 0 },
      coming: undefined,
    },
    {
      case: "a birth HQ still runs, however long ago it began: still coming up",
      over: { birth: { ended: false }, routes: 0 },
      coming: { kind: "coming", step: "address" },
    },
    {
      case: "a service being added to one HQ did not bring up: what the platform says it makes",
      over: { birth: null, services: [db("ACTIVE"), app("CREATING")], routes: 0 },
      coming: { kind: "coming", step: "app" },
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

describe("firstDeploy — where a stage's first deploy stands by HQ's jobs of it", () => {
  const job = (over: Partial<HqJob>): HqJob => ({
    id: "1",
    kind: "deploy",
    service: "app",
    sha: "e014b0e5d7a4c6f8e0b1d2a3c4f5e6d7a8b9c0d1",
    state: "queued",
    cause: "env_added",
    ref: null,
    reason: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: ago(60_000),
    endedAt: null,
    supersededBy: null,
    ...over,
  });
  const ended = (state: HqJob["state"], over: Partial<HqJob> = {}) =>
    job({ state, endedAt: ago(30_000), ...over });
  it.each([
    { case: "HQ has no job", deploys: [], first: { kind: "awaited" } },
    {
      case: "unresolved, naming the next actor and action",
      deploys: [
        job({
          state: "unresolved",
          evidence: {
            nextActor: "person",
            nextAction: "Inspect the original version in Zerops before asking Run again",
          },
        }),
      ],
      first: {
        kind: "unresolved",
        reason: "HQ lost track of this deploy. Check it in Zerops, or run it again.",
      },
    },
    { case: "queued", deploys: [job({})], first: { kind: "on-its-way" } },
    {
      case: "submitting",
      deploys: [job({ state: "submitting" })],
      first: { kind: "on-its-way" },
    },
    { case: "building", deploys: [job({ state: "building" })], first: { kind: "on-its-way" } },
    {
      case: "asked for long ago and not ended: HQ still follows it, so still on its way",
      deploys: [job({ state: "building", at: ago(60 * 60_000) })],
      first: { kind: "on-its-way" },
    },
    {
      case: "its build failed, however long ago: final",
      deploys: [ended("failed", { endedAt: ago(60 * 60_000) })],
      first: { kind: "failed" },
    },
    {
      case: "HQ refused it — Zerops did not answer, and nothing is tried twice: final",
      deploys: [ended("refused", { reason: "Zerops did not answer: timeout" })],
      first: { kind: "failed", reason: "Zerops did not answer: timeout" },
    },
    {
      case: "HQ skipped it, its commit carrying no zerops.yaml: nothing promised",
      deploys: [ended("skipped", { reason: "web has no zerops.yaml at e014b0e" })],
      first: { kind: "awaited" },
    },
    {
      case: "one service's build failed, another queued: failed",
      deploys: [job({}), ended("failed", { service: "api" })],
      first: { kind: "failed" },
    },
    {
      case: "live where nothing runs: nothing promised",
      deploys: [ended("live")],
      first: { kind: "awaited" },
    },
    {
      case: "superseded only: nothing promised",
      deploys: [ended("superseded", { supersededBy: "2" })],
      first: { kind: "awaited" },
    },
  ])("$case", ({ deploys, first }) => {
    expect(firstDeploy({ deploys, keyGap: false })).toEqual(first);
  });

  // HQ deploys nothing without a key that works: whatever it has queued waits for one.
  it.each([
    { case: "no job", deploys: [], first: { kind: "held" } },
    { case: "a job queued", deploys: [job({})], first: { kind: "held" } },
    {
      case: "refused for the key",
      deploys: [ended("refused", { reason: "stage has no deploy token yet" })],
      first: { kind: "held" },
    },
    {
      case: "its build failed before: still failed",
      deploys: [ended("failed")],
      first: { kind: "failed" },
    },
  ])("no deploy key that works, $case", ({ deploys, first }) => {
    expect(firstDeploy({ deploys, keyGap: true })).toEqual(first);
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
  const live: HqJob = {
    id: "1",
    kind: "deploy",
    service: "app",
    sha: SHA,
    state: "live",
    cause: "release",
    ref: "v1.0.0",
    reason: null,
    appVersionId: null,
    processId: null,
    requestedBy: null,
    at: ago(30_000),
    endedAt: ago(30_000),
    supersededBy: null,
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
            birth: { ended: false },
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
      release: {
        gate: { allowed: false, reason: "" },
        suggestion: "v1.0.0",
        waiting: 0,
        waitingAtLeast: false,
        untold: [],
      },
      mainHasCode: true,
      mainHead: undefined,
      pending: [],
    });
    if (!("stop" in flow.production)) throw new Error("the production is listed");
    return listedStopComing("production", {
      stop: flow.production.stop,
      projectStatus: "ACTIVE",
      services: [db("ACTIVE"), app("ACTIVE")],
      building: false,
      routes: 0,
    });
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
  it.each<[string, StopComing & { kind: "coming" }, { fact: string; rest: string | undefined }]>([
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
    // Held for a key, nothing comes up until somebody mints one: its own fact, never "coming up"
    // (restores 630d8f1bb's idea for HQ's key).
    [
      "Stage",
      { kind: "coming", step: "awaiting-key" },
      { fact: "Stage awaits a deploy key", rest: undefined },
    ],
    [
      "qa",
      { kind: "coming", step: "awaiting-key" },
      { fact: "qa awaits a deploy key", rest: undefined },
    ],
  ])("%s %j", (subject, coming, line) => {
    expect(comingLine(subject, coming)).toEqual(line);
  });
});

describe("stopImport — where an environment's own import has got, the one order both surfaces keep", () => {
  const made = { projectStatus: "ACTIVE", birth: { ended: false } as EnvironmentBirth | null };
  const cases = [
    { case: "its project being made", over: { projectStatus: "CREATING" }, step: "project" },
    { case: "a reload: its services unread", over: { services: undefined }, step: undefined },
    {
      case: "its project being made, its services not listed",
      over: { projectStatus: "CREATING", services: undefined },
      step: "project",
    },
    { case: "its project being deleted", over: { projectStatus: "DELETING" }, step: undefined },
    {
      case: "its project being made, HQ bringing up none",
      over: { projectStatus: "CREATING", birth: null },
      step: "project",
    },
    { case: "no runtime listed yet", over: { services: [] }, step: "app" },
    { case: "its runtime new", over: { services: [app("NEW")] }, step: "app" },
    { case: "its runtime being made", over: { services: [app("CREATING")] }, step: "app" },
    {
      case: "its database not running yet",
      over: { services: [db("CREATING"), app("NEW")] },
      step: "database",
    },
    {
      case: "made, nothing deployed",
      over: { services: [app("READY_TO_DEPLOY")] },
      step: undefined,
    },
    { case: "made, running", over: { services: [db("ACTIVE"), app("ACTIVE")] }, step: undefined },
    {
      case: "its database failed: not coming up any more",
      over: { services: [db("ACTION_FAILED"), app("NEW")] },
      step: undefined,
    },
    { case: "stopped", over: { projectStatus: "STOPPED", services: [] }, step: undefined },
    {
      case: "its runtime new, HQ bringing up none: what the platform says it makes",
      over: { birth: null, services: [app("NEW")] },
      step: "app",
    },
    {
      case: "no runtime listed, its birth ended: nothing said",
      over: { birth: { ended: true }, services: [] },
      step: undefined,
    },
    {
      case: "its database stopped, HQ bringing up none: never adding it",
      over: { birth: null, services: [db("STOPPED"), app("ACTIVE")] },
      step: undefined,
    },
  ] as const;

  it.each(cases)("$case", ({ over, step }) => {
    expect(stopImport({ ...made, services: [app("ACTIVE")], ...over })).toBe(step);
  });

  it.each(cases)("says what stopComing says of the import: $case", ({ over, step }) => {
    const coming = stopComing({
      ...base,
      deployed: false,
      routes: 0,
      firstDeploy: { kind: "on-its-way" },
      ...made,
      services: [app("ACTIVE")],
      ...over,
    });
    const said =
      coming?.kind === "coming" &&
      (coming.step === "project" || coming.step === "database" || coming.step === "app")
        ? coming.step
        : undefined;
    expect(said).toBe(step);
  });
});

it("does not turn an unresolved first deploy into awaiting-deploy forever", () => {
  const reason = "HQ lost track of this deploy. Check it in Zerops, or run it again.";
  const first = { kind: "unresolved", reason } as const;
  expect(firstDeployLine(first)).toBe(reason);
  expect(firstDeployTone(first)).toBe("off");
  expect(
    stopComing({
      tier: "stage",
      pending: false,
      projectStatus: "ACTIVE",
      birth: { ended: false },
      services: [{ hostname: "app", status: "READY_TO_DEPLOY", runtime: true }],
      building: false,
      deployed: false,
      routes: 0,
      firstDeploy: first,
    }),
  ).toBeUndefined();
});
