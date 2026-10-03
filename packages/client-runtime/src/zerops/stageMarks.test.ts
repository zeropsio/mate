import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentServiceState } from "./groupRows.ts";
import {
  stageMarks,
  stageRead,
  stageStandings,
  type ServiceChanges,
  type StageMark,
  type StageStandings,
} from "./stageMarks.ts";
import type { HqDeploy } from "./hq/environments.ts";

/** HQ's record of a deploy in `state`. */
const deployRecord = (state: HqDeploy["state"]): HqDeploy => ({
  sha: "0000000000000000000000000000000000000000",
  state,
  failure: state === "failed" ? "job" : null,
  message: null,
  appVersionId: null,
  processId: null,
  requestedBy: null,
  at: "2026-10-02T10:00:00.000Z",
});

/** A full sha whose first character says which commit it is. */
const sha = (mark: string): string => mark.repeat(40);

const B = sha("b");
const C = sha("c");
const D = sha("d");

const change = (commit: string, subject = `Change ${commit.slice(0, 1)}`) => ({
  sha: commit,
  subject,
});

describe("stageMarks", () => {
  const contents: ReadonlyArray<ServiceChanges> = [
    { services: ["app"], commits: [change(D), change(C), change(B)] },
  ];
  const standing = (over: Partial<StageStandings> = {}): StageStandings => ({
    runs: new Map([["app", C]]),
    deploying: new Map(),
    failed: new Map(),
    ...over,
  });

  it.each<{
    readonly name: string;
    readonly contents?: ReadonlyArray<ServiceChanges>;
    readonly stage: StageStandings | undefined;
    readonly mainHeads?: ReadonlyMap<string, string>;
    readonly expected: Record<string, StageMark>;
  }>([
    // F25 (e2e, 2026-10-03): stages running main's head read "Stage runs 1 of 4 changes".
    {
      name: "the commit the stage runs is on stage, and every one listed before it",
      stage: standing(),
      expected: { [D]: "none", [C]: "on-stage", [B]: "on-stage" },
    },
    {
      name: "the commit the stage deploys now",
      stage: standing({ deploying: new Map([["app", D]]) }),
      expected: { [D]: "deploying-on-stage", [C]: "on-stage", [B]: "on-stage" },
    },
    {
      name: "the commit whose deploy failed on the stage, which still runs the one before",
      stage: standing({ failed: new Map([["app", D]]) }),
      expected: { [D]: "failed-on-stage", [C]: "on-stage", [B]: "on-stage" },
    },
    {
      name: "a stage running main's head runs every change, though main moved past the list",
      contents: [{ repository: "appdev", services: ["app"], commits: [change(D), change(C)] }],
      stage: standing({ runs: new Map([["app", sha("f")]]) }),
      mainHeads: new Map([["appdev", sha("f")]]),
      expected: { [D]: "on-stage", [C]: "on-stage" },
    },
    {
      name: "no main-following stage marks nothing",
      stage: undefined,
      expected: { [D]: "none", [C]: "none", [B]: "none" },
    },
    {
      name: "a stage commit nothing places marks nothing",
      stage: standing({ runs: new Map([["app", sha("e")]]) }),
      expected: { [D]: "none", [C]: "none", [B]: "none" },
    },
    {
      // A version name since 2026-09-30 spells the commit short: it is the listed one it begins.
      name: "a short sha places the stage as the listed commit it begins",
      stage: standing({
        runs: new Map([["app", C.slice(0, 7)]]),
        deploying: new Map([["app", D.slice(0, 7)]]),
      }),
      expected: { [D]: "deploying-on-stage", [C]: "on-stage", [B]: "on-stage" },
    },
    {
      name: "a short sha two listed commits begin places nothing",
      contents: [
        {
          services: ["app"],
          commits: [change(D), change(C), change(`${"c".repeat(7)}${"1".repeat(33)}`)],
        },
      ],
      stage: standing({ runs: new Map([["app", C.slice(0, 7)]]) }),
      expected: { [D]: "none", [C]: "none", [`${"c".repeat(7)}${"1".repeat(33)}`]: "none" },
    },
    {
      name: "a short sha nothing listed begins places nothing",
      stage: standing({ runs: new Map([["app", "eeeeeee"]]) }),
      expected: { [D]: "none", [C]: "none", [B]: "none" },
    },
    {
      name: "a dirty tree's token is no commit",
      stage: standing({ runs: new Map([["app", `${C.slice(0, 7)}-dirty`]]) }),
      expected: { [D]: "none", [C]: "none", [B]: "none" },
    },
    {
      name: "a shared commit is on stage only where every service runs it",
      contents: [
        { services: ["app"], commits: [change(D), change(C)] },
        { services: ["api"], commits: [change(D), change(C)] },
      ],
      stage: standing({
        runs: new Map([
          ["app", D],
          ["api", C],
        ]),
      }),
      expected: { [D]: "none", [C]: "on-stage" },
    },
    {
      name: "a failure on one service of a shared commit is the commit's",
      contents: [
        { services: ["app"], commits: [change(D), change(C)] },
        { services: ["api"], commits: [change(D), change(C)] },
      ],
      stage: standing({
        runs: new Map([
          ["app", C],
          ["api", D],
        ]),
        failed: new Map([["app", D]]),
      }),
      expected: { [D]: "failed-on-stage", [C]: "on-stage" },
    },
    {
      name: "one comparison several services take is on stage only where every one runs it",
      contents: [{ services: ["app", "api"], commits: [change(D), change(C)] }],
      stage: standing({
        runs: new Map([
          ["app", D],
          ["api", B],
        ]),
      }),
      expected: { [D]: "none", [C]: "none" },
    },
    {
      name: "a failure marks only the commit that failed",
      stage: standing({ runs: new Map([["app", B]]), failed: new Map([["app", C]]) }),
      expected: { [D]: "none", [C]: "failed-on-stage", [B]: "on-stage" },
    },
  ])("$name", ({ contents: listed, stage, mainHeads, expected }) => {
    const marks = stageMarks({
      contents: listed ?? contents,
      stage,
      ...(mainHeads === undefined ? {} : { mainHeads }),
    });
    expect(Object.fromEntries(marks)).toEqual(expected);
  });
});

// F25 (e2e, 2026-10-03): the owner read "Stage runs 1 of 4 changes" for C and the Developer, whose
// grant does not reach C's stage, "0 of 4". What the stage runs is HQ's, the same for everyone who
// sees the application.
describe("stageStandings", () => {
  const record = (state: HqDeploy["state"], commit: string): HqDeploy => ({
    ...deployRecord(state),
    sha: commit,
  });
  const service = (
    hostname: string,
    deploy: EnvironmentServiceState["deploy"],
    appVersionName?: string,
  ): EnvironmentServiceState => ({
    hostname,
    ...(appVersionName === undefined ? {} : { appVersionName }),
    ...(deploy === undefined ? {} : { deploy }),
  });

  it.each<{
    readonly name: string;
    readonly services: ReadonlyArray<EnvironmentServiceState>;
    readonly expected: StageStandings;
  }>([
    {
      name: "each service runs the commit HQ last put live there, whatever its version name says",
      services: [
        service("app", { latest: record("live", C), live: record("live", C) }, `${B} v1.2.0`),
        service("api", { latest: record("live", B), live: record("live", B) }),
      ],
      expected: {
        runs: new Map([
          ["app", C],
          ["api", B],
        ]),
        deploying: new Map(),
        failed: new Map(),
      },
    },
    {
      name: "a service HQ never put live runs nothing known, whatever the platform says",
      services: [service("app", undefined, C)],
      expected: { runs: new Map([["app", undefined]]), deploying: new Map(), failed: new Map() },
    },
    {
      name: "a deploy under way names the commit HQ puts on the service",
      services: [
        service("app", { latest: record("deploying", D), live: record("live", C) }),
        service("api", { latest: record("pending", D), live: null }),
      ],
      expected: {
        runs: new Map([
          ["app", C],
          ["api", undefined],
        ]),
        deploying: new Map([
          ["app", D],
          ["api", D],
        ]),
        failed: new Map(),
      },
    },
    {
      name: "a deploy that failed names its commit, the service still running the one before",
      services: [service("app", { latest: record("failed", D), live: record("live", C) })],
      expected: {
        runs: new Map([["app", C]]),
        deploying: new Map(),
        failed: new Map([["app", D]]),
      },
    },
  ])("$name", ({ services, expected }) => {
    expect(stageStandings({ services })).toEqual(expected);
  });
});

describe("stageRead", () => {
  it.each<{ readonly name: string; readonly runs: StageStandings["runs"]; readonly read: boolean }>(
    [
      {
        name: "a service whose commit is known",
        runs: new Map([
          ["app", C],
          ["api", undefined],
        ]),
        read: true,
      },
      // Nothing it runs is known — a stage the viewer may not read: it says nothing, never 0 of N.
      {
        name: "no service whose commit is known",
        runs: new Map([["app", undefined]]),
        read: false,
      },
      { name: "no service", runs: new Map(), read: false },
    ],
  )("$name", ({ runs, read }) => {
    expect(stageRead({ runs, deploying: new Map(), failed: new Map() })).toBe(read);
  });
});
