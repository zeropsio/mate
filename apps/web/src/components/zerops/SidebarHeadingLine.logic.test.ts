import { describe, expect, it } from "vite-plus/test";

import type { StopComing } from "@t3tools/client-runtime/zerops";

import {
  headingLanding,
  headingLine,
  headingMark,
  type HeadingLineInput,
} from "./SidebarHeadingLine.logic";
import type { ProductionChip } from "./SidebarProductionChip.logic";

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
  waitingAtLeast: false,
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
const stage = (
  coming: StopComing | undefined,
  projectId = "stage",
  serves = coming === undefined,
) => ({
  projectId,
  name: projectId,
  coming,
  serves,
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
      case: "2 more than HQ counts",
      over: { waiting: 10000, waitingAtLeast: true },
      line: ["10000+ changes not released · since v2.3.0", "ink", "", "review"],
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
      line: ["v2.4.0 didn’t go out · HQ refused it", "amber", "", "review"],
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
      case: "14 a stage whose first deploy waits for the group's runner says why",
      over: {
        production: undefined,
        stages: [stage({ kind: "coming", step: "runner", why: "not-started" })],
      },
      line: ["Stage awaits the runner · it hasn’t started", "ink", "", ""],
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
  const stageWaiting = input({ stages: [stage({ kind: "coming", step: "deploy-on-its-way" })] });
  const windowOver = input({ stages: [stage(undefined, "stage", false)] });
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
      case: "a stage whose window ended, serving nothing: never up",
      before: stageWaiting,
      after: windowOver,
      landing: undefined,
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

describe("headingMark — a folded heading's release mark", () => {
  it.each([
    { case: "healthy, nothing waits", over: {}, landing: undefined, mark: undefined },
    {
      case: "changes waiting",
      over: { waiting: 3 },
      landing: undefined,
      mark: { kind: "waiting", count: 3, atLeast: false },
    },
    {
      case: "more changes waiting than HQ counts",
      over: { waiting: 10000, waitingAtLeast: true },
      landing: undefined,
      mark: { kind: "waiting", count: 10000, atLeast: true },
    },
    {
      case: "nothing released yet, changes waiting",
      over: { ...prod({ chip: chip("empty") }), waiting: 3 },
      landing: undefined,
      mark: { kind: "waiting", count: 3, atLeast: false },
    },
    {
      case: "releasing",
      over: prod({ chip: chip("releasing", { next: "v2.4.0" }) }),
      landing: undefined,
      mark: { kind: "releasing", version: "v2.4.0" },
    },
    {
      case: "just live",
      over: {},
      landing: { kind: "live" as const, version: "v2.4.0" },
      mark: { kind: "live" },
    },
    {
      case: "a release that didn't go out",
      over: prod({ chip: chip("failed") }),
      landing: undefined,
      mark: { kind: "failed" },
    },
    {
      case: "down: the pill's",
      over: prod({ chip: chip("down") }),
      landing: undefined,
      mark: undefined,
    },
    {
      case: "a stage coming up while changes wait: the mark stays the release's",
      over: { waiting: 3, stages: [stage({ kind: "coming", step: "build" })] },
      landing: undefined,
      mark: { kind: "waiting", count: 3, atLeast: false },
    },
    {
      case: "no production",
      over: { production: undefined, waiting: 3 },
      landing: undefined,
      mark: undefined,
    },
  ])("$case", ({ over, landing, mark }) => {
    expect(headingMark(input(over), landing)).toEqual(mark);
  });
});
