import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  comingLine,
  COMING_UP_WINDOW_MS,
  firstDeploy,
  firstDeployLine,
  groupRunner,
  RUNNER_BUILD_MS,
  runnerHostname,
  stopComing,
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
  deployed: true,
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

describe("a stage coming up, replayed as run 4 measured it (Larder - stage)", () => {
  const SLUG = "larder";
  const RUNNER = runnerHostname(SLUG);
  /** The runner's status, and how long ago the broker imported it. */
  type Runner = readonly [status: string, ageMs: number] | undefined;
  /** The Gitea project's services, as the account holds them. */
  const gitea = (runner: Runner) => [
    { name: "web", status: "ACTIVE" },
    { name: "broker", status: "ACTIVE" },
    ...(runner === undefined ? [] : [{ name: RUNNER, status: runner[0], created: ago(runner[1]) }]),
  ];
  const stageAt = (over: Partial<typeof base>, runner: Runner, declared: boolean) => {
    const first = firstDeploy({
      declared,
      mainHasCode: true,
      runner: groupRunner({ slug: SLUG, services: gitea(runner), nowMs: NOW }),
    });
    const coming = stopComing({ ...base, ...over, firstDeploy: first });
    return {
      line:
        coming?.kind === "coming"
          ? Object.values(comingLine("Stage", coming)).join(" · ")
          : (coming?.reason ?? null),
      cell: over.deployed === false ? (firstDeployLine(first) ?? "Nothing deployed yet") : null,
    };
  };
  const fresh = { deployed: false, routes: 0 };
  /** Imported at +1020 s; its build failed at +1087 s, which no service field shows. */
  const first = (atS: number): Runner => ["READY_TO_DEPLOY", (atS - 1020) * 1000];
  const ACTIVE: Runner = ["ACTIVE", 10 * 60_000];
  it.each([
    {
      at: "+1060 s project.create",
      over: { ...fresh, projectStatus: "CREATING", services: undefined },
      runner: first(1060),
      declared: false,
      line: "Stage coming up · making the project",
      cell: "Nothing deployed yet",
    },
    {
      at: "+1090 s the db and app services created",
      over: { ...fresh, services: [db("CREATING"), app("NEW")] },
      runner: first(1090),
      declared: false,
      line: "Stage coming up · adding the database",
      cell: "Nothing deployed yet",
    },
    {
      at: "+1103 s the import's stack.deploy app with no code",
      over: { ...fresh, services: [db("ACTIVE"), app("CREATING")] },
      runner: first(1103),
      declared: false,
      line: "Stage coming up · adding the app",
      cell: "Nothing deployed yet",
    },
    {
      at: "+1115 s services ACTIVE, no deploy, routes 0, nothing asked yet",
      over: fresh,
      runner: first(1115),
      declared: false,
      line: "Stage coming up · waiting for its first deploy",
      cell: "Nothing deployed yet",
    },
    {
      at: "+1121 s a deploy asked for, the runner young: its build may still run",
      over: fresh,
      runner: first(1121),
      declared: true,
      line: "Stage awaits the runner · it’s being built",
      cell: "Waiting for the runner · it’s being built",
    },
    {
      at: "+1262 s the runner never deployed past any good build: its build failed",
      over: fresh,
      runner: first(1262),
      declared: true,
      line: "Stage awaits the runner · it’s being rebuilt",
      cell: "Waiting for the runner · it’s being rebuilt",
    },
    {
      at: "+1268 s the runner deleted to be replaced",
      over: fresh,
      runner: undefined,
      declared: true,
      line: "Stage awaits the runner · it isn’t there",
      cell: "Waiting for the runner · it isn’t there",
    },
    {
      at: "+1270 s the runner replaced, building",
      over: fresh,
      runner: ["READY_TO_DEPLOY", 0] as Runner,
      declared: true,
      line: "Stage awaits the runner · it’s being built",
      cell: "Waiting for the runner · it’s being built",
    },
    {
      at: "+1389 s the runner ACTIVE",
      over: fresh,
      runner: ACTIVE,
      declared: true,
      line: "Stage coming up · its first deploy is on its way",
      cell: "First deploy on its way",
    },
    {
      at: "+1407 s the stage's first build running",
      over: { ...fresh, building: true },
      runner: ACTIVE,
      declared: true,
      line: "Stage coming up · building the app",
      cell: "First deploy on its way",
    },
    {
      at: "+1446 s the build deploying, the app upgrading",
      over: { ...fresh, building: true, services: [db("ACTIVE"), app("UPGRADING")] },
      runner: ACTIVE,
      declared: true,
      line: "Stage coming up · building the app",
      cell: "First deploy on its way",
    },
    {
      at: "the build finished, routes 0",
      over: { deployed: true, routes: 0 },
      runner: ACTIVE,
      declared: true,
      line: "Stage coming up · turning its address on",
      cell: null,
    },
    {
      at: "+1481 s routes 1: up",
      over: { deployed: true, routes: 1 },
      runner: ACTIVE,
      declared: true,
      line: null,
      cell: null,
    },
  ])("$at", ({ over, runner, declared, line, cell }) => {
    expect(stageAt(over, runner, declared)).toEqual({ line, cell });
  });

  it("never says the address before a deploy ran", () => {
    const runners: ReadonlyArray<Runner> = [
      first(1121),
      first(1400),
      ["ACTION_FAILED", 0],
      ["STOPPED", 0],
      ACTIVE,
      undefined,
    ];
    for (const runner of runners) {
      for (const declared of [false, true]) {
        expect(stageAt(fresh, runner, declared).line).not.toContain("turning its address on");
      }
    }
  });
});

describe("groupRunner — the group's runner, from the Gitea project's services as held", () => {
  it("is named runner + the slug without dashes, cut to 25 characters", () => {
    expect(runnerHostname("larder")).toBe("runnerlarder");
    expect(runnerHostname("north-pantry")).toBe("runnernorthpantry");
    expect(runnerHostname("a-very-long-group-slug-name")).toBe("runneraverylonggroupslugn");
  });

  const MINUTE = 60_000;
  it.each([
    { status: "ACTIVE", ageMs: MINUTE, runner: { kind: "able" } },
    { status: "UPGRADING", ageMs: MINUTE, runner: { kind: "able" } },
    { status: "CREATING", ageMs: 0, runner: { kind: "unable", why: "building" } },
    { status: "READY_TO_DEPLOY", ageMs: MINUTE, runner: { kind: "unable", why: "building" } },
    { status: "READY_TO_DEPLOY", ageMs: undefined, runner: { kind: "unable", why: "building" } },
    {
      status: "READY_TO_DEPLOY",
      ageMs: RUNNER_BUILD_MS,
      runner: { kind: "unable", why: "failed" },
    },
    { status: "ACTION_FAILED", ageMs: MINUTE, runner: { kind: "unable", why: "failed" } },
    { status: "STOPPED", ageMs: MINUTE, runner: { kind: "unable", why: "waking" } },
    { status: "STOPPING", ageMs: MINUTE, runner: { kind: "unable", why: "waking" } },
    { status: "STARTING", ageMs: MINUTE, runner: { kind: "unable", why: "waking" } },
    { status: "DELETING", ageMs: MINUTE, runner: { kind: "unable", why: "missing" } },
    { status: "SOMETHING_NEW", ageMs: MINUTE, runner: undefined },
  ])("$status, imported $ageMs ms ago", ({ status, ageMs, runner }) => {
    const created = ageMs === undefined ? {} : { created: ago(ageMs) };
    expect(
      groupRunner({
        slug: "larder",
        services: [{ name: "runnerlarder", status, ...created }],
        nowMs: NOW,
      }),
    ).toEqual(runner);
  });

  it("is missing where the Gitea project's services hold none, unknown where they are unread", () => {
    expect(
      groupRunner({ slug: "larder", services: [{ name: "web", status: "ACTIVE" }], nowMs: NOW }),
    ).toEqual({ kind: "unable", why: "missing" });
    expect(groupRunner({ slug: "larder", services: undefined, nowMs: NOW })).toBeUndefined();
  });
});

describe("firstDeploy — where a stage's first deploy stands while it runs nothing", () => {
  const broken = { kind: "unable", why: "failed" } as const;
  it.each([
    {
      case: "not declared",
      input: { declared: false, mainHasCode: true, runner: broken },
      first: { kind: "awaited" },
    },
    {
      case: "main empty",
      input: { declared: true, mainHasCode: false, runner: broken },
      first: { kind: "awaited" },
    },
    {
      case: "main unread",
      input: { declared: true, mainHasCode: undefined, runner: undefined },
      first: { kind: "awaited" },
    },
    {
      case: "asked for, the runner able",
      input: { declared: true, mainHasCode: true, runner: { kind: "able" } as const },
      first: { kind: "on-its-way" },
    },
    {
      case: "asked for, the runner unknown",
      input: { declared: true, mainHasCode: true, runner: undefined },
      first: { kind: "on-its-way" },
    },
    {
      case: "asked for, the runner broken",
      input: { declared: true, mainHasCode: true, runner: broken },
      first: { kind: "runner", why: "failed" },
    },
  ])("$case", ({ input, first }) => {
    expect(firstDeploy(input)).toEqual(first);
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
