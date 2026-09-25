import { describe, expect, it } from "vite-plus/test";

import type { Deployment } from "./flow/deployment.ts";
import type { EnvironmentServiceState } from "./groupRows.ts";
import { deployedVersion } from "./groupRows.ts";
import type { Shown } from "./knowledge/known.ts";
import {
  productionDistance,
  stopRowLine,
  type StopRowLine,
  stageDistance,
  stageMarks,
  stageStandings,
  type ServiceChanges,
  type StageMark,
  type StageStandings,
} from "./stopDistance.ts";

/** A full sha whose first character says which commit it is. */
const sha = (mark: string): string => mark.repeat(40);

const A = sha("a");
const B = sha("b");
const C = sha("c");
const D = sha("d");

const change = (commit: string, subject = `Change ${commit.slice(0, 1)}`) => ({
  sha: commit,
  subject,
});

const heads = (entries: Record<string, string>): ReadonlyMap<string, string> =>
  new Map(Object.entries(entries));

describe("productionDistance", () => {
  it.each<{
    readonly name: string;
    readonly contents: ReadonlyArray<ServiceChanges> | undefined;
    readonly mainHeads: ReadonlyMap<string, string> | undefined;
    readonly expected: ReadonlyArray<string> | undefined;
  }>([
    {
      name: "unread contents are unknown",
      contents: undefined,
      mainHeads: undefined,
      expected: undefined,
    },
    { name: "nothing waiting is in sync", contents: [], mainHeads: heads({}), expected: [] },
    {
      name: "newest-first list stays newest first",
      contents: [{ service: "app", commits: [change(C), change(B), change(A)] }],
      mainHeads: heads({ app: C }),
      expected: [C, B, A],
    },
    {
      name: "oldest-first list is turned by where main's head sits",
      contents: [{ service: "app", commits: [change(A), change(B), change(C)] }],
      mainHeads: heads({ app: C }),
      expected: [C, B, A],
    },
    {
      name: "a commit two services carry counts once",
      contents: [
        { service: "app", commits: [change(B), change(A)] },
        { service: "api", commits: [change(C), change(B), change(A)] },
      ],
      mainHeads: heads({ app: B, api: C }),
      expected: [B, A, C],
    },
    {
      name: "without main's head the list keeps the read's order",
      contents: [{ service: "app", commits: [change(A), change(D)] }],
      mainHeads: undefined,
      expected: [A, D],
    },
  ])("$name", ({ contents, mainHeads, expected }) => {
    const distance = productionDistance({ contents, mainHeads });
    expect(distance?.changes.map((entry) => entry.sha)).toEqual(expected);
    expect(distance?.count).toBe(expected?.length);
  });
});

describe("stageDistance", () => {
  const contents: ReadonlyArray<ServiceChanges> = [
    { service: "app", commits: [change(D), change(C), change(B)] },
  ];
  const base = {
    source: "main" as string | undefined,
    stage: new Map<string, string | undefined>([["app", C]]),
    mainHeads: heads({ app: D }) as ReadonlyMap<string, string> | undefined,
    production: heads({ app: A }),
    contents: contents as ReadonlyArray<ServiceChanges> | undefined,
  };

  it.each<{
    readonly name: string;
    readonly over: Partial<typeof base>;
    readonly expected: ReadonlyArray<string> | undefined;
  }>([
    { name: "inside the list: the changes newer than the stage's", over: {}, expected: [D] },
    {
      name: "inside an oldest-first list: the same changes",
      over: { contents: [{ service: "app", commits: [change(B), change(C), change(D)] }] },
      expected: [D],
    },
    { name: "at main's head: in sync", over: { stage: new Map([["app", D]]) }, expected: [] },
    {
      name: "at main's head with nothing waiting on production",
      over: { stage: new Map([["app", D]]), contents: [] },
      expected: [],
    },
    {
      name: "at production's commit: the whole list",
      over: { stage: new Map([["app", A]]) },
      expected: [D, C, B],
    },
    {
      name: "a commit neither list nor head names is unknown",
      over: { stage: new Map([["app", sha("e")]]) },
      expected: undefined,
    },
    {
      name: "a short sha of the stage's commit is never equal",
      over: { stage: new Map([["app", C.slice(0, 7)]]) },
      expected: undefined,
    },
    {
      name: "upper-case hex is the same commit",
      over: { stage: new Map([["app", C.toUpperCase()]]) },
      expected: [D],
    },
    {
      name: "a stage fed by a branch has no distance",
      over: { source: "feat/cart" },
      expected: undefined,
    },
    {
      name: "a stage fed by several branches has no distance",
      over: { source: "feat/x + main" },
      expected: undefined,
    },
    {
      name: "an undeclared source has no distance",
      over: { source: undefined },
      expected: undefined,
    },
    {
      name: "a service running nothing known is unknown",
      over: { stage: new Map([["app", undefined]]) },
      expected: undefined,
    },
    {
      name: "a stage with no services is unknown",
      over: { stage: new Map() },
      expected: undefined,
    },
    { name: "main's heads unread is unknown", over: { mainHeads: undefined }, expected: undefined },
    {
      name: "a service main's head was not read for is unknown",
      over: { mainHeads: heads({ api: D }) },
      expected: undefined,
    },
    { name: "contents unread is unknown", over: { contents: undefined }, expected: undefined },
    {
      name: "a list main's head is not in cannot be placed",
      over: { contents: [{ service: "app", commits: [change(C), change(B)] }] },
      expected: undefined,
    },
    {
      name: "at production's commit with the list missing is unknown",
      over: { stage: new Map([["app", A]]), contents: [] },
      expected: undefined,
    },
    {
      name: "services add up, a shared commit once",
      over: {
        stage: new Map([
          ["app", C],
          ["api", A],
        ]),
        mainHeads: heads({ app: D, api: D }),
        production: heads({ app: A, api: A }),
        contents: [
          { service: "app", commits: [change(D), change(C), change(B)] },
          { service: "api", commits: [change(D), change(C), change(B)] },
        ],
      },
      expected: [D, C, B],
    },
    {
      name: "one unknown service makes the whole stage unknown",
      over: {
        stage: new Map([
          ["app", C],
          ["api", sha("e")],
        ]),
        mainHeads: heads({ app: D, api: D }),
        contents: [
          { service: "app", commits: [change(D), change(C)] },
          { service: "api", commits: [change(D)] },
        ],
      },
      expected: undefined,
    },
  ])("$name", ({ over, expected }) => {
    const distance = stageDistance({ ...base, ...over });
    expect(distance?.changes.map((entry) => entry.sha)).toEqual(expected);
    expect(distance?.count).toBe(expected?.length);
  });
});

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
      name: "a short sha never places the stage",
      stage: standing({ runs: new Map([["app", C.slice(0, 7)]]), deploying: D.slice(0, 7) }),
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
    status?: "success" | "failure" | "pending",
  ): EnvironmentServiceState => ({
    hostname,
    appVersionName,
    ...(status === undefined
      ? {}
      : { statuses: [{ context: `mate/deploy/stage/${hostname}`, state: status }] }),
  });

  it.each<{
    readonly name: string;
    readonly services: ReadonlyArray<EnvironmentServiceState>;
    readonly deployment: Shown<Deployment> | undefined;
    readonly expected: StageStandings;
  }>([
    {
      name: "each service's whole commit from its version name",
      services: [service("app", `${C} v1.2.0 ada`, "success"), service("api", B)],
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
      services: [service("app", C, "success"), service("api", C, "failure")],
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
    expect(stageStandings({ environment: { environment: "stage", services }, deployment })).toEqual(
      expected,
    );
  });
});

describe("stopRowLine", () => {
  const behind = { count: 2, changes: [change(D, "Checkout in one step (#4)"), change(B, " ")] };
  const opened = {
    count: 2,
    changes: [
      { sha: D, title: "Checkout in one step (#4)" },
      { sha: B, title: "bbbbbbb" },
    ],
  };
  const stop = (
    state: "checking" | "empty" | "deploying" | "deployed" | "failed",
    /** `null` for a stop nothing names. */
    appVersionName: string | null = C,
    source = "main",
  ) => ({
    state,
    version: appVersionName === null ? undefined : deployedVersion(appVersionName),
    source,
  });

  it.each<{
    readonly name: string;
    readonly input: Parameters<typeof stopRowLine>[0];
    readonly expected: StopRowLine;
  }>([
    {
      name: "in sync and healthy: only what it runs",
      input: {
        tier: "stage",
        stop: stop("deployed"),
        releasing: undefined,
        distance: { count: 0, changes: [] },
      },
      expected: { word: undefined, runs: "ccccccc", distance: undefined },
    },
    {
      name: "behind: what it runs and the distance, by each commit's subject",
      input: { tier: "stage", stop: stop("deployed"), releasing: undefined, distance: behind },
      expected: { word: undefined, runs: "ccccccc", distance: opened },
    },
    {
      name: "unknown distance shows none",
      input: { tier: "stage", stop: stop("deployed"), releasing: undefined, distance: undefined },
      expected: { word: undefined, runs: "ccccccc", distance: undefined },
    },
    {
      name: "a tag names a stage's run as it names production's",
      input: {
        tier: "stage",
        stop: stop("deployed", `${C} v1.2.0 ada`),
        releasing: undefined,
        distance: undefined,
      },
      expected: { word: undefined, runs: "v1.2.0", distance: undefined },
    },
    {
      name: "a tag names production's run",
      input: {
        tier: "production",
        stop: stop("deployed", `${A} v1.2.0 ada`, "release"),
        releasing: undefined,
        distance: behind,
      },
      expected: { word: undefined, runs: "v1.2.0", distance: opened },
    },
    {
      name: "a branch-fed stage says its source first",
      input: {
        tier: "stage",
        stop: stop("deployed", C, "feat/cart"),
        releasing: undefined,
        distance: undefined,
      },
      expected: { word: undefined, runs: "feat/cart · ccccccc", distance: undefined },
    },
    {
      name: "a branch-fed stage has no distance, whatever it is given",
      input: {
        tier: "stage",
        stop: stop("deployed", C, "feat/cart"),
        releasing: undefined,
        distance: behind,
      },
      expected: { word: undefined, runs: "feat/cart · ccccccc", distance: undefined },
    },
    {
      name: "a stage declaring no branch says no source",
      input: {
        tier: "stage",
        stop: stop("deployed", C, "—"),
        releasing: undefined,
        distance: undefined,
      },
      expected: { word: undefined, runs: "ccccccc", distance: undefined },
    },
    {
      name: "failed: the word first, the distance hidden",
      input: { tier: "stage", stop: stop("failed"), releasing: undefined, distance: behind },
      expected: {
        word: { kind: "failed", text: "Failed on" },
        runs: "ccccccc",
        distance: undefined,
      },
    },
    {
      name: "failed with nothing named",
      input: {
        tier: "production",
        stop: stop("failed", null, "release"),
        releasing: undefined,
        distance: behind,
      },
      expected: { word: { kind: "failed", text: "Failed" }, runs: undefined, distance: undefined },
    },
    {
      name: "failed wins over a release on its way",
      input: {
        tier: "production",
        stop: stop("failed", A, "release"),
        releasing: "v1.3.0",
        distance: behind,
      },
      expected: {
        word: { kind: "failed", text: "Failed on" },
        runs: "aaaaaaa",
        distance: undefined,
      },
    },
    {
      name: "a release on its way",
      input: {
        tier: "production",
        stop: stop("deploying", A, "release"),
        releasing: "v1.3.0",
        distance: behind,
      },
      expected: {
        word: { kind: "releasing", text: "Releasing v1.3.0…" },
        runs: undefined,
        distance: undefined,
      },
    },
    {
      name: "a deploy names what it builds",
      input: { tier: "stage", stop: stop("deploying", D), releasing: undefined, distance: behind },
      expected: {
        word: { kind: "deploying", text: "Deploying ddddddd" },
        runs: undefined,
        distance: undefined,
      },
    },
    {
      name: "a deploy of nothing named",
      input: {
        tier: "production",
        stop: stop("deploying", null, "release"),
        releasing: undefined,
        distance: behind,
      },
      expected: {
        word: { kind: "deploying", text: "Deploying…" },
        runs: undefined,
        distance: undefined,
      },
    },
    {
      name: "a stage running nothing keeps its distance",
      input: { tier: "stage", stop: stop("empty", null), releasing: undefined, distance: behind },
      expected: {
        word: { kind: "empty", text: "Nothing deployed yet" },
        runs: undefined,
        distance: opened,
      },
    },
    {
      name: "a production running nothing keeps its distance",
      input: {
        tier: "production",
        stop: stop("empty", null, "release"),
        releasing: undefined,
        distance: behind,
      },
      expected: {
        word: { kind: "empty", text: "Nothing deployed yet" },
        runs: undefined,
        distance: opened,
      },
    },
    {
      name: "checking hides the distance",
      input: {
        tier: "production",
        stop: stop("checking", null, "release"),
        releasing: undefined,
        distance: behind,
      },
      expected: {
        word: { kind: "checking", text: "Checking what runs here…" },
        runs: undefined,
        distance: undefined,
      },
    },
  ])("$name", ({ input, expected }) => {
    expect(stopRowLine(input)).toEqual(expected);
  });
});
