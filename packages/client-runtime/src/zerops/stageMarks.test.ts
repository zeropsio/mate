import { describe, expect, it } from "vite-plus/test";

import type { Deployment } from "./flow/deployment.ts";
import type { EnvironmentServiceState } from "./groupRows.ts";
import { deployedVersion } from "./groupRows.ts";
import type { Shown } from "./knowledge/known.ts";
import {
  stageMarks,
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

const heads = (entries: Record<string, string>): ReadonlyMap<string, string> =>
  new Map(Object.entries(entries));

describe("stageMarks", () => {
  const contents: ReadonlyArray<ServiceChanges> = [
    { service: "app", commits: [change(D), change(C), change(B)] },
  ];
  const standing = (over: Partial<StageStandings> = {}): StageStandings => ({
    runs: new Map([["app", C]]),
    deploying: undefined,
    failed: new Set(),
    ...over,
  });

  it.each<{
    readonly name: string;
    readonly contents?: ReadonlyArray<ServiceChanges>;
    readonly mainHeads?: ReadonlyMap<string, string>;
    readonly stage: StageStandings | undefined;
    readonly expected: Record<string, StageMark>;
  }>([
    {
      name: "at or older than the stage's commit is on stage",
      stage: standing(),
      expected: { [D]: "none", [C]: "on-stage", [B]: "on-stage" },
    },
    {
      name: "the same in an oldest-first list",
      contents: [{ service: "app", commits: [change(B), change(C), change(D)] }],
      stage: standing(),
      expected: { [D]: "none", [C]: "on-stage", [B]: "on-stage" },
    },
    {
      name: "a stage at main's head has every change",
      stage: standing({ runs: new Map([["app", D]]) }),
      expected: { [D]: "on-stage", [C]: "on-stage", [B]: "on-stage" },
    },
    {
      name: "the commit the stage deploys now",
      stage: standing({ deploying: D }),
      expected: { [D]: "deploying-on-stage", [C]: "on-stage", [B]: "on-stage" },
    },
    {
      name: "the commit whose deploy failed on the stage",
      stage: standing({ failed: new Set(["app"]) }),
      expected: { [D]: "none", [C]: "failed-on-stage", [B]: "on-stage" },
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
      stage: standing({ runs: new Map([["app", C.slice(0, 7)]]), deploying: D.slice(0, 7) }),
      expected: { [D]: "deploying-on-stage", [C]: "on-stage", [B]: "on-stage" },
    },
    {
      name: "a short sha two listed commits begin places nothing",
      contents: [
        {
          service: "app",
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
      name: "a shared commit is on stage only where every service has it",
      contents: [
        { service: "app", commits: [change(D), change(C)] },
        { service: "api", commits: [change(D), change(C)] },
      ],
      mainHeads: heads({ app: D, api: D }),
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
        { service: "app", commits: [change(D), change(C)] },
        { service: "api", commits: [change(D), change(C)] },
      ],
      mainHeads: heads({ app: D, api: D }),
      stage: standing({
        runs: new Map([
          ["app", D],
          ["api", C],
        ]),
        failed: new Set(["app"]),
      }),
      expected: { [D]: "failed-on-stage", [C]: "on-stage" },
    },
    {
      name: "a failure marks only what the failed service runs",
      contents: [
        { service: "app", commits: [change(D), change(C)] },
        { service: "api", commits: [change(D), change(C)] },
      ],
      mainHeads: heads({ app: D, api: D }),
      stage: standing({
        runs: new Map([
          ["app", C],
          ["api", D],
        ]),
        failed: new Set(["app"]),
      }),
      expected: { [D]: "none", [C]: "failed-on-stage" },
    },
  ])("$name", ({ contents: listed, mainHeads, stage, expected }) => {
    const marks = stageMarks({
      contents: listed ?? contents,
      mainHeads: mainHeads ?? heads({ app: D }),
      stage,
    });
    expect(Object.fromEntries(marks)).toEqual(expected);
  });
});

describe("stageStandings", () => {
  const known = (value: Deployment): Shown<Deployment> => ({
    state: "known",
    value,
    asOf: { ordinal: 1, atMs: 0 },
    coverage: "complete",
    freshness: { kind: "live" },
  });
  const service = (
    hostname: string,
    appVersionName: string | undefined,
    status?: HqDeploy["state"],
  ): EnvironmentServiceState => ({
    hostname,
    appVersionName,
    ...(status === undefined ? {} : { deploy: { latest: deployRecord(status), live: null } }),
  });

  it.each<{
    readonly name: string;
    readonly services: ReadonlyArray<EnvironmentServiceState>;
    readonly deployment: Shown<Deployment> | undefined;
    readonly expected: StageStandings;
  }>([
    {
      name: "each service's whole commit from its version name",
      services: [service("app", `${C} v1.2.0 ada`, "live"), service("api", B)],
      deployment: known({ kind: "running", activatedAt: null, version: deployedVersion(C) }),
      expected: {
        runs: new Map([
          ["app", C],
          ["api", B],
        ]),
        deploying: undefined,
        failed: new Set(),
      },
    },
    {
      name: "a hand-made version name runs nothing known",
      services: [service("app", "hotfix-friday")],
      deployment: undefined,
      expected: {
        runs: new Map([["app", undefined]]),
        deploying: undefined,
        failed: new Set(),
      },
    },
    {
      name: "a build under way names the commit it deploys",
      services: [service("app", C)],
      deployment: known({ kind: "deploying", version: deployedVersion(D), previous: null }),
      expected: { runs: new Map([["app", C]]), deploying: D, failed: new Set() },
    },
    {
      name: "a failed deploy is the failed service's alone",
      services: [service("app", C, "live"), service("api", C, "failed")],
      deployment: undefined,
      expected: {
        runs: new Map([
          ["app", C],
          ["api", C],
        ]),
        deploying: undefined,
        failed: new Set(["api"]),
      },
    },
  ])("$name", ({ services, deployment, expected }) => {
    expect(stageStandings({ environment: { services }, deployment })).toEqual(expected);
  });
});
