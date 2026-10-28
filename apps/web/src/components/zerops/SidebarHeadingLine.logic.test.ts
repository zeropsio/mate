import { HqEnvironmentId } from "@t3tools/contracts";
import { gitDeliveryOf } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import type { StopComing } from "@t3tools/client-runtime/zerops";

import { headingLanding, headingLine, type HeadingLineInput } from "./SidebarHeadingLine.logic";
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
    building: false,
  },
  stages: [],
  ...over,
});
const prod = (
  production: Partial<NonNullable<HeadingLineInput["production"]>>,
): Partial<HeadingLineInput> => ({
  production: {
    projectId: "prod",
    chip: undefined,
    coming: undefined,
    building: false,
    ...production,
  },
});
const stage = (
  coming: StopComing | undefined,
  projectId = "stage",
  serves = coming === undefined,
  building = false,
) => ({
  projectId,
  name: projectId,
  coming,
  serves,
  building,
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
      case: "14 a stage coming up",
      over: { production: undefined, stages: [stage({ kind: "coming", step: "build" })] },
      line: ["Stage coming up · building the app", "ink", "", ""],
    },
    {
      case: "14 a stage whose first deploy HQ has under way",
      over: {
        production: undefined,
        stages: [stage({ kind: "coming", step: "deploy-on-its-way" })],
      },
      line: ["Stage coming up · first deploy on its way", "ink", "", ""],
    },
    {
      // Its own fact, never coming up, and Details to the stage's page, where the key is minted or
      // who mints it is named (restores 630d8f1bb's idea for HQ's key).
      case: "14 a stage HQ holds for a deploy key",
      over: { production: undefined, stages: [stage({ kind: "coming", step: "awaiting-key" })] },
      line: ["Stage awaits a deploy key", "ink", "", "details"],
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
      case: "several stages name the one coming up",
      over: {
        production: undefined,
        stages: [stage(undefined, "qa"), stage({ kind: "coming", step: "address" }, "demo")],
      },
      line: ["Demo coming up · turning its address on", "ink", "", ""],
    },
    {
      case: "production unread: nothing claimed",
      over: prod({ chip: undefined }),
      line: null,
    },
    {
      case: "no production: nothing to release to",
      over: { production: undefined },
      line: null,
    },
  ])("$case", ({ over, line }) => {
    expect(said(over)).toEqual(line);
  });

  it.each([
    {
      case: "a build or deploy runs on the stage",
      over: { stages: [stage(undefined, "stage", true, true)] },
      line: ["Stage is deploying…", "ink", "spinner", ""],
    },
    {
      case: "one of several stages deploys: it is named",
      over: { stages: [stage(undefined, "qa"), stage(undefined, "demo", true, true)] },
      line: ["Demo is deploying…", "ink", "spinner", ""],
    },
    {
      case: "production deploys with no release on its way",
      over: prod({ chip: chip("ok", { version: "v2.3.0" }), building: true }),
      line: ["Production is deploying…", "ink", "spinner", ""],
    },
    {
      case: "a stage coming up names its step, not its build",
      over: { stages: [stage({ kind: "coming", step: "build" }, "stage", false, true)] },
      line: ["Stage coming up · building the app", "ink", "", ""],
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
    expect(said({}, landing)).toEqual(line);
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

it("mixed Git and Zerops headings retain the Zerops failure and never announce a Git push as live", () => {
  const git = gitDeliveryOf({
    id: HqEnvironmentId.make("git-stage"),
    target: { kind: "git", branch: "main", delivery: "direct" },
    tier: "stage",
    jobs: [],
    release: null,
  })!;
  const mixed = input({
    production: {
      projectId: "prod",
      chip: chip("ok"),
      building: false,
      coming: { kind: "failed", reason: "Build refused" },
    },
    stages: [{ ...stage(undefined, "git"), git }],
  });
  expect(headingLine(mixed, undefined)?.fact).toBe("Production didn’t come up");
  const onlyGit = input({
    production: {
      projectId: "git",
      chip: chip("ok", { git, version: "v2" }),
      git,
      building: false,
      coming: undefined,
    },
  });
  expect(headingLine(onlyGit, undefined)?.fact).toBe(git.line);
  expect(headingLine(onlyGit, undefined)?.tone).not.toBe("ok");
  expect(headingLanding(input(prod({ chip: chip("releasing") })), onlyGit)).toBeUndefined();
});
