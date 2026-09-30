import { describe, expect, it } from "vite-plus/test";

import {
  COMING_UP_WINDOW_MS,
  headingLanding,
  headingLine,
  stopComing,
  type HeadingLineInput,
  type StopComing,
} from "./SidebarHeadingLine.logic";
import type { ProductionChip } from "./SidebarProductionChip.logic";

const NOW = Date.parse("2026-09-30T18:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("stopComing — where a stage or a production coming up has got", () => {
  const app = (status: string) => ({ hostname: "app", status, runtime: true });
  const db = (status: string) => ({ hostname: "db", status, runtime: false });
  const base = {
    tier: "stage" as const,
    pending: false,
    projectStatus: "ACTIVE",
    createdAt: ago(60_000),
    nowMs: NOW,
    services: [db("ACTIVE"), app("ACTIVE")],
    building: false,
    deployed: true,
    routes: 1,
  };
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
      case: "a stage's runtime not running yet: its first build is on its way",
      over: { services: [db("ACTIVE"), app("READY_TO_DEPLOY")], deployed: false },
      coming: { kind: "coming", step: "build" },
    },
    {
      case: "running, no address yet",
      over: { routes: 0 },
      coming: { kind: "coming", step: "address" },
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

const chip = (
  state: ProductionChip["state"],
  facts: Partial<ProductionChip> = {},
): ProductionChip => ({
  label: "prod",
  state,
  ...facts,
});

const input = (over: Partial<HeadingLineInput> = {}): HeadingLineInput => ({
  production: {
    projectId: "prod",
    chip: chip("ok", { version: "v2.3.0" }),
    coming: undefined,
    failure: undefined,
  },
  stages: [],
  waiting: 0,
  allOnStage: false,
  ...over,
});
const prod = (
  production: Partial<NonNullable<HeadingLineInput["production"]>>,
): Partial<HeadingLineInput> => ({
  production: {
    projectId: "prod",
    chip: undefined,
    coming: undefined,
    failure: undefined,
    ...production,
  },
});
const stage = (coming: StopComing | undefined, projectId = "stage") => ({
  projectId,
  name: projectId,
  coming,
});

/** The line as its words, its tone, its spinner and its door. */
const said = (over: Partial<HeadingLineInput>, landing?: Parameters<typeof headingLine>[1]) => {
  const line = headingLine(input(over), landing);
  return line === undefined
    ? null
    : [
        line.rest === undefined ? line.fact : `${line.fact} · ${line.rest}`,
        line.tone,
        line.spinner ? "spinner" : "",
        line.verb?.kind ?? "",
      ];
};

describe("headingLine — the heading's second line, the board's D′ ladder", () => {
  it.each([
    { case: "1 healthy, nothing waits", over: {}, line: null },
    {
      case: "2 changes merged, not released",
      over: { production: input().production, waiting: 3 },
      line: ["3 changes not released · since v2.3.0", "ink", "", "review"],
    },
    {
      case: "2 on a project whose stage runs them",
      over: { waiting: 3, allOnStage: true },
      line: ["3 changes not released · all on stage", "ink", "", "review"],
    },
    {
      case: "2 one change",
      over: { waiting: 1, allOnStage: true },
      line: ["1 change not released · all on stage", "ink", "", "review"],
    },
    {
      case: "3 releasing",
      over: prod({ chip: chip("releasing", { version: "v2.3.0", next: "v2.4.0" }) }),
      line: ["Releasing v2.4.0…", "ink", "spinner", "review"],
    },
    {
      case: "5 a release that didn't go out",
      over: {
        ...prod({
          chip: chip("failed", { version: "v2.3.0" }),
          failure: {
            tag: "v2.4.0",
            kind: "deploy-failed",
            at: undefined,
            error: undefined,
            service: "app",
          },
        }),
        waiting: 3,
      },
      line: ["v2.4.0 didn’t go out · app’s deploy failed", "amber", "", "review"],
    },
    {
      case: "5 a refused release",
      over: prod({
        chip: chip("failed"),
        failure: { tag: "v2.4.0", kind: "refused", at: undefined, error: "no", service: undefined },
      }),
      line: ["v2.4.0 didn’t go out · the broker refused it", "amber", "", "review"],
    },
    {
      case: "6 down: the pill's alone",
      over: prod({ chip: chip("down", { version: "v2.3.0" }) }),
      line: null,
    },
    { case: "7 stopped: the pill's alone", over: prod({ chip: chip("stopped") }), line: null },
    {
      case: "8 production coming up",
      over: prod({ chip: chip("creating"), coming: { kind: "coming", step: "database" } }),
      line: ["Production coming up · adding the database", "ink", "", ""],
    },
    {
      case: "9 nothing released yet, 3 changes merged",
      over: { ...prod({ chip: chip("empty") }), waiting: 3 },
      line: ["3 changes not released · nothing is live yet", "ink", "", "review"],
    },
    {
      case: "14 a stage coming up",
      over: { production: undefined, stages: [stage({ kind: "coming", step: "build" })] },
      line: ["Stage coming up · building the app", "ink", "", ""],
    },
    {
      case: "15 a stage that didn't come up",
      over: {
        production: undefined,
        stages: [stage({ kind: "failed", reason: "the app’s build failed" })],
      },
      line: ["Stage didn’t come up · the app’s build failed", "amber", "", "details"],
    },
    {
      case: "16 a stage coming up while changes wait: the stage takes the line",
      over: { waiting: 3, stages: [stage({ kind: "coming", step: "build" })] },
      line: ["Stage coming up · building the app", "ink", "", ""],
    },
    {
      case: "several stages name the one coming up",
      over: {
        production: undefined,
        stages: [stage(undefined, "qa"), stage({ kind: "coming", step: "address" }, "demo")],
      },
      line: ["demo coming up · turning its address on", "ink", "", ""],
    },
    {
      case: "trouble before a stage coming up",
      over: {
        ...prod({ chip: chip("failed"), failure: undefined }),
        stages: [stage({ kind: "coming", step: "build" })],
      },
      line: ["The release didn’t go out · its deploy failed", "amber", "", "review"],
    },
    {
      case: "production unread: nothing claimed",
      over: { ...prod({ chip: undefined }), waiting: 3 },
      line: null,
    },
    {
      case: "no production: nothing to release to",
      over: { production: undefined, waiting: 3 },
      line: null,
    },
  ])("$case", ({ over, line }) => {
    expect(said(over)).toEqual(line);
  });

  it.each([
    {
      case: "4 a release just live",
      landing: { kind: "live" as const, version: "v2.4.0" },
      line: ["v2.4.0 is live · just now", "ok", "", ""],
    },
    {
      case: "14 a stage just up",
      landing: { kind: "up" as const, name: "Stage" },
      line: ["Stage is up · just now", "ok", "", ""],
    },
  ])("$case", ({ landing, line }) => {
    expect(said({ waiting: 0 }, landing)).toEqual(line);
  });
});

describe("headingLanding — what this tab watched land", () => {
  const releasing = input(prod({ chip: chip("releasing", { version: "v2.3.0", next: "v2.4.0" }) }));
  const live = input(prod({ chip: chip("ok", { version: "v2.4.0" }) }));
  const comingProd = input(
    prod({ chip: chip("creating"), coming: { kind: "coming", step: "build" } }),
  );
  const firstLive = input(prod({ chip: chip("ok", { version: "v0.1.0" }) }));
  const emptyProd = input(prod({ chip: chip("empty") }));
  const stageComing = input({ stages: [stage({ kind: "coming", step: "address" })] });
  const stageUp = input({ stages: [stage(undefined)] });
  const stageFailed = input({ stages: [stage({ kind: "failed", reason: "x" })] });
  it.each([
    {
      case: "a release on its way, now served",
      before: releasing,
      after: live,
      landing: { kind: "live", version: "v2.4.0" },
    },
    {
      case: "production's first build, now served",
      before: comingProd,
      after: firstLive,
      landing: { kind: "live", version: "v0.1.0" },
    },
    {
      case: "production up with nothing released: no landing",
      before: comingProd,
      after: emptyProd,
      landing: undefined,
    },
    {
      case: "a stage coming up, now up",
      before: stageComing,
      after: stageUp,
      landing: { kind: "up", name: "Stage" },
    },
    {
      case: "a stage coming up that failed: no landing",
      before: stageComing,
      after: stageFailed,
      landing: undefined,
    },
    {
      case: "a first reading: nothing was watched",
      before: undefined,
      after: live,
      landing: undefined,
    },
    { case: "healthy to healthy", before: live, after: live, landing: undefined },
  ])("$case", ({ before, after, landing }) => {
    expect(headingLanding(before, after)).toEqual(landing);
  });
});
