import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  comingLine,
  COMING_UP_WINDOW_MS,
  firstDeploy,
  groupRunner,
  runnerHostname,
  stopComing,
  stopDeployed,
  stopImport,
  stopServes,
  type FirstDeploy,
  type GroupRunner,
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
      case: "no address while what runs there is unread: the neutral wait, never the runner",
      over: {
        deployed: undefined,
        routes: 0,
        firstDeploy: { kind: "runner", why: "waking" } as FirstDeploy,
      },
      coming: { kind: "coming", step: "awaiting-deploy" },
    },
    {
      case: "a first deploy that failed: the stage didn't come up",
      over: { deployed: false, routes: 0, firstDeploy: { kind: "failed" } as FirstDeploy },
      coming: { kind: "failed", reason: "its first deploy failed" },
    },
    {
      case: "a first deploy known not to have run: the runner holding it",
      over: {
        deployed: false,
        routes: 0,
        firstDeploy: { kind: "runner", why: "waking" } as FirstDeploy,
      },
      coming: { kind: "coming", step: "runner", why: "waking" },
    },
    {
      case: "listed with no runtime yet (run 5, +696 s): adding the app, never the runner",
      over: {
        services: [],
        deployed: false,
        routes: 0,
        firstDeploy: { kind: "runner", why: "not-started" } as FirstDeploy,
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

describe("groupRunner — the group's runner, from the Gitea project's services as held", () => {
  it("is named runner + the slug without dashes, cut to 25 characters", () => {
    expect(runnerHostname("brine")).toBe("runnerbrine");
    expect(runnerHostname("north-pantry")).toBe("runnernorthpantry");
    expect(runnerHostname("a-very-long-group-slug-name")).toBe("runneraverylonggroupslugn");
  });

  // Only what the client sees: a READY_TO_DEPLOY runner may be building or have failed its
  // build, and which broker an org runs — one that rebuilds it or not — is not the app's to know.
  it.each([
    { status: "ACTIVE", runner: { kind: "able" } },
    { status: "UPGRADING", runner: { kind: "able" } },
    { status: "NEW", runner: { kind: "unable", why: "building" } },
    { status: "CREATING", runner: { kind: "unable", why: "building" } },
    { status: "READY_TO_DEPLOY", runner: { kind: "unable", why: "not-started" } },
    { status: "ACTION_FAILED", runner: { kind: "unable", why: "not-started" } },
    { status: "STOPPED", runner: { kind: "unable", why: "waking" } },
    { status: "STOPPING", runner: { kind: "unable", why: "waking" } },
    { status: "STARTING", runner: { kind: "unable", why: "waking" } },
    { status: "DELETING", runner: { kind: "unable", why: "missing" } },
    { status: "SOMETHING_NEW", runner: undefined },
  ])("$status", ({ status, runner }) => {
    expect(groupRunner({ slug: "brine", services: [{ name: "runnerbrine", status }] })).toEqual(
      runner,
    );
  });

  it("is missing where the Gitea project's services hold none, unknown where they are unread", () => {
    expect(groupRunner({ slug: "brine", services: [{ name: "web", status: "ACTIVE" }] })).toEqual({
      kind: "unable",
      why: "missing",
    });
    expect(groupRunner({ slug: "brine", services: undefined })).toBeUndefined();
  });
});

describe("firstDeploy — where a stage's first deploy stands while it runs nothing", () => {
  const stuck = { kind: "unable", why: "not-started" } as const;
  const able = { kind: "able" } as const;
  const asked = {
    declared: true,
    mainHasCode: true,
    runner: undefined as GroupRunner | undefined,
    askedAt: ago(60_000),
    nowMs: NOW,
  };
  it.each([
    { case: "not declared", over: { declared: false, runner: stuck }, first: { kind: "awaited" } },
    { case: "main empty", over: { mainHasCode: false, runner: stuck }, first: { kind: "awaited" } },
    {
      case: "main unread",
      over: { mainHasCode: undefined, runner: able },
      first: { kind: "awaited" },
    },
    { case: "asked for, the runner able", over: { runner: able }, first: { kind: "on-its-way" } },
    {
      case: "asked for, the runner unknown: the neutral wait, never on its way",
      over: { runner: undefined },
      first: { kind: "awaited" },
    },
    {
      case: "asked for, the runner not started",
      over: { runner: stuck },
      first: { kind: "runner", why: "not-started" },
    },
    {
      case: "asked for a window ago, the runner able: not on its way any more",
      over: { runner: able, askedAt: ago(COMING_UP_WINDOW_MS) },
      first: { kind: "awaited" },
    },
    {
      case: "asked for when unknown: never on its way",
      over: { runner: able, askedAt: undefined },
      first: { kind: "awaited" },
    },
    {
      case: "a runner not started, asked a window ago: nothing promised any more",
      over: { runner: stuck, askedAt: ago(COMING_UP_WINDOW_MS * 4) },
      first: { kind: "awaited" },
    },
    {
      case: "a stopped runner, asked a window ago: no job queued that would wake it",
      over: {
        runner: { kind: "unable", why: "waking" } as const,
        askedAt: ago(COMING_UP_WINDOW_MS),
      },
      first: { kind: "awaited" },
    },
    {
      case: "a runner not there, its ask unknown: nothing promised",
      over: { runner: { kind: "unable", why: "missing" } as const, askedAt: undefined },
      first: { kind: "awaited" },
    },
  ])("$case", ({ over, first }) => {
    expect(firstDeploy({ ...asked, ...over })).toEqual(first);
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
    [
      "demo",
      { kind: "coming", step: "runner", why: "waking" },
      { fact: "demo awaits the runner", rest: "it’s waking up" },
    ],
  ])("%s %j", (subject, coming, line) => {
    expect(comingLine(subject, coming)).toEqual(line);
  });
});

describe("stopImport — where an environment's own import has got, the one order both surfaces keep", () => {
  const made = { projectStatus: "ACTIVE", createdAt: ago(60_000), nowMs: NOW };
  const cases = [
    { case: "its project being made", over: { projectStatus: "CREATING" }, step: "project" },
    { case: "its services unread", over: { services: undefined }, step: "project" },
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
      case: "made a window ago",
      over: { createdAt: ago(COMING_UP_WINDOW_MS), services: [app("NEW")] },
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
      firstDeploy: { kind: "runner", why: "waking" },
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
