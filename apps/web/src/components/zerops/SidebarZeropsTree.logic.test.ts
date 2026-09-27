import {
  environmentRow,
  type GroupEnvironmentRowInput,
  type StageMark,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { describe, expect, it } from "vite-plus/test";

import {
  formatWorkingTime,
  isQuietMate,
  QUIET_AFTER_MS,
  sidebarMateKey,
  sidebarStopReads,
  stopNameSaysOnlyRole,
} from "./SidebarZeropsTree.logic";

/** A full sha whose first character says which commit it is. */
const sha = (mark: string): string => mark.repeat(40);
const A = sha("a");
const B = sha("b");
const C = sha("c");

/** One environment running `runs` on its one service, `app`. */
const input = (
  projectId: string,
  tier: "stage" | "production",
  runs: string | undefined,
  sources: GroupEnvironmentRowInput["sources"] = tier === "production" ? "release" : ["main"],
): GroupEnvironmentRowInput => ({
  projectId,
  name: tier,
  tier,
  sources,
  environment: tier,
  services: [{ hostname: "app", repository: "app", appVersionName: runs }],
});

/** `main` at C, production at A: B and C wait, newest first. */
const CONTENTS = [
  {
    service: "app",
    commits: [
      { sha: C, subject: "Cart badge" },
      { sha: B, subject: "Search box" },
    ],
  },
];

const reads = (
  inputs: ReadonlyArray<GroupEnvironmentRowInput>,
  deployments: ReadonlyMap<string, Shown<Deployment>> = new Map(),
) =>
  sidebarStopReads({
    flow: {
      environmentInputs: inputs,
      environments: inputs.map((entry) => environmentRow(entry)),
      mainHeads: new Map([["app", C]]),
      release: { contents: CONTENTS },
    },
    deployments,
  });

describe("sidebarStopReads", () => {
  it.each<{
    readonly name: string;
    readonly inputs: ReadonlyArray<GroupEnvironmentRowInput>;
    readonly expected: Record<string, number | undefined>;
  }>([
    {
      name: "production is behind by everything main has that it does not run",
      inputs: [input("prod", "production", A)],
      expected: { prod: 2 },
    },
    {
      name: "a stage at main's head is in sync, production still behind",
      inputs: [input("stage", "stage", C), input("prod", "production", A)],
      expected: { stage: 0, prod: 2 },
    },
    {
      name: "a stage inside the list is behind by the newer changes",
      inputs: [input("stage", "stage", B), input("prod", "production", A)],
      expected: { stage: 1, prod: 2 },
    },
    {
      name: "a stage fed by a branch has no distance",
      inputs: [input("stage", "stage", B, ["feat/cart"]), input("prod", "production", A)],
      expected: { stage: undefined, prod: 2 },
    },
    {
      name: "a stage running something nothing places has no distance",
      inputs: [input("stage", "stage", undefined), input("prod", "production", A)],
      expected: { stage: undefined, prod: 2 },
    },
  ])("measures each stop against main: $name", ({ inputs, expected }) => {
    const { distances } = reads(inputs);
    const counts = Object.fromEntries(
      inputs.map((entry) => [entry.projectId, distances.get(entry.projectId)?.count]),
    );
    expect(counts).toEqual(expected);
  });

  it.each<{
    readonly name: string;
    readonly inputs: ReadonlyArray<GroupEnvironmentRowInput>;
    readonly deployments?: ReadonlyMap<string, Shown<Deployment>>;
    readonly expected: Record<string, StageMark>;
  }>([
    {
      name: "no stage says nothing about any change",
      inputs: [input("prod", "production", A)],
      expected: { [B]: "none", [C]: "none" },
    },
    {
      name: "a stage at main's head has run every change",
      inputs: [input("stage", "stage", C), input("prod", "production", A)],
      expected: { [B]: "on-stage", [C]: "on-stage" },
    },
    {
      name: "a stage at the older change has run only that one",
      inputs: [input("stage", "stage", B), input("prod", "production", A)],
      expected: { [B]: "on-stage", [C]: "none" },
    },
    {
      name: "a branch-fed stage is not the one production's changes are measured on",
      inputs: [
        input("feature", "stage", C, ["feat/cart"]),
        input("stage", "stage", B),
        input("prod", "production", A),
      ],
      expected: { [B]: "on-stage", [C]: "none" },
    },
    {
      name: "a build running on the stage marks the change it deploys",
      inputs: [input("stage", "stage", B), input("prod", "production", A)],
      deployments: new Map([
        [
          "stage",
          {
            state: "known",
            value: {
              kind: "deploying",
              version: {
                name: undefined,
                commit: C.slice(0, 7),
                sha: C,
                taggedBy: undefined,
                label: C.slice(0, 7),
              },
              previous: null,
            },
            asOf: { ordinal: 1, atMs: 0 },
            coverage: "complete",
            freshness: { kind: "live" },
          },
        ],
      ]),
      expected: { [B]: "on-stage", [C]: "deploying-on-stage" },
    },
  ])("marks where production's changes stand on the stage: $name", (row) => {
    const { stageMarks } = reads(row.inputs, row.deployments);
    expect(Object.fromEntries(stageMarks)).toEqual(row.expected);
  });
});

describe("stopNameSaysOnlyRole", () => {
  it.each<{ readonly tag: string | null; readonly name: string; readonly expected: boolean }>([
    { tag: "prod", name: "production", expected: true },
    { tag: "prod", name: "Prod", expected: true },
    { tag: "stage", name: " stage ", expected: true },
    // More than the role: the name tells two stages apart, or says where.
    { tag: "stage", name: "stage 2", expected: false },
    { tag: "stage", name: "qa", expected: false },
    { tag: "prod", name: "production-eu", expected: false },
    { tag: "prod", name: "eu-west", expected: false },
    { tag: null, name: "stage", expected: false },
  ])("$name as $tag: $expected", ({ tag, name, expected }) => {
    expect(stopNameSaysOnlyRole(tag, name)).toBe(expected);
  });
});

describe("formatWorkingTime — how long a Mate has been at it", () => {
  it.each([
    { ms: 0, label: "0:00" },
    { ms: 7_000, label: "0:07" },
    { ms: 192_000, label: "3:12" },
    { ms: 3_599_000, label: "59:59" },
    { ms: 3_840_000, label: "1h 04m" },
    { ms: 37_800_000, label: "10h 30m" },
    // A clock skewed ahead of the server never reads as a negative time.
    { ms: -5_000, label: "0:00" },
  ])("reads $ms ms as $label", ({ ms, label }) => {
    expect(formatWorkingTime(ms)).toBe(label);
  });
});

describe("isQuietMate — a Mate untouched for a week folds away", () => {
  const now = Date.parse("2026-09-27T12:00:00.000Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const WEEK = QUIET_AFTER_MS;
  it.each([
    {
      case: "resting a week and a minute",
      face: "idle",
      at: ago(WEEK + 60_000),
      unread: false,
      active: false,
      quiet: true,
    },
    {
      case: "resting six days",
      face: "idle",
      at: ago(WEEK - 86_400_000),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "done a fortnight ago, seen since",
      face: "done",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: true,
    },
    {
      case: "done a fortnight ago, never looked at",
      face: "done",
      at: ago(2 * WEEK),
      unread: true,
      active: false,
      quiet: false,
    },
    {
      case: "waiting on somebody",
      face: "needs",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "working",
      face: "working",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "paused at a limit",
      face: "sleep",
      at: ago(2 * WEEK),
      unread: false,
      active: false,
      quiet: false,
    },
    {
      case: "the one whose conversation is open",
      face: "idle",
      at: ago(2 * WEEK),
      unread: false,
      active: true,
      quiet: false,
    },
  ] as const)("is quiet: $case → $quiet", ({ face, at, unread, active, quiet }) => {
    expect(isQuietMate({ face, at, unread }, now, active)).toBe(quiet);
  });

  it("never folds a Mate nobody can date", () => {
    expect(isQuietMate(undefined, now, false)).toBe(false);
  });
});

describe("sidebarMateKey — the list's own keys on a Mate's row", () => {
  it.each([
    { key: "j", action: "next" },
    { key: "ArrowDown", action: undefined },
    { key: "k", action: "previous" },
    { key: "x", action: "stop" },
    { key: "X", action: "stop" },
    { key: "e", action: "unread" },
    { key: "E", action: "unread" },
    { key: "q", action: undefined },
  ] as const)("reads $key as $action", ({ key, action }) => {
    expect(sidebarMateKey({ key, modified: false })).toBe(action);
  });

  it("leaves every key with a modifier to whoever bound it", () => {
    expect(sidebarMateKey({ key: "j", modified: true })).toBeUndefined();
  });
});
