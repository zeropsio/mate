import {
  environmentRow,
  type GroupEnvironmentRowInput,
  type StageMark,
} from "@t3tools/client-runtime/zerops";
import type { Deployment } from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import { describe, expect, it } from "vite-plus/test";

import { sidebarStopReads, stopNameSaysOnlyRole } from "./SidebarZeropsTree.logic";

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
