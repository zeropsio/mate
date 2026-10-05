import { describe, expect, it } from "vite-plus/test";

import {
  attentionOf,
  liveHq,
  liveMate,
  liveZerops,
  ORG,
  streamEvent,
} from "../__fixtures__/account.ts";
import { linkKeys, emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { menuRow, type RowKey } from "./navigation.ts";
import { projectsScope } from "../families/project.ts";
import { runningScope } from "../families/process.ts";
import { navigationScope } from "../families/placement.ts";

function account(...inputs: ReadonlyArray<ReadonlyArray<AccountInput>>): AccountState {
  return inputs.flat().reduce((state, input) => reduceAccount(state, input).state, emptyAccount);
}

const row = (state: AccountState, key: RowKey) =>
  menuRow.derive(readsOfState(state), { orgId: ORG, row: key });

const shop = { kind: "app", appId: "shop" } as const;

const zerops = liveZerops({
  projects: [
    { id: "m1", name: "shop-mate" },
    { id: "s1", name: "shop-stage" },
  ],
  running: [{ id: "deploy-1", projectId: "s1" }],
});
const hq = liveHq({
  placements: [
    { projectId: "m1", appId: "shop", role: "mate" },
    { projectId: "s1", appId: "shop", role: "stage" },
  ],
  attention: [{ projectId: "m1", value: attentionOf({ working: 1 }), producer: "up" }],
});

describe("menuRow", () => {
  it("joins Zerops identity, HQ placement, running work and attention into a live row", () => {
    expect(row(account(zerops, hq), shop)).toEqual({
      title: { kind: "ready", value: "App shop", fresh: true },
      running: { kind: "ready", value: true, fresh: true },
      projects: [
        {
          projectId: "m1",
          name: { kind: "ready", value: "shop-mate", fresh: true },
          role: "mate",
          running: false,
          attention: { kind: "ready", value: attentionOf({ working: 1 }), fresh: true },
        },
        {
          projectId: "s1",
          name: { kind: "ready", value: "shop-stage", fresh: true },
          role: "stage",
          running: true,
          attention: null,
        },
      ],
      status: { display: "live", lagging: [] },
    });
  });

  it.each<{
    readonly name: string;
    readonly inputs: ReadonlyArray<ReadonlyArray<AccountInput>>;
    readonly key: RowKey;
    readonly expected: Partial<ReturnType<typeof row>>;
    readonly display: string;
  }>([
    {
      name: "a member Zerops lists before its row: its name is not said yet",
      inputs: [
        zerops,
        hq,
        [
          {
            kind: "membership",
            scope: projectsScope(ORG),
            generation: 1,
            delta: { add: ["p-new"], remove: [] },
          },
        ],
      ],
      key: { kind: "project", projectId: "p-new" },
      expected: { title: { kind: "pending" } },
      display: "partial",
    },
    {
      name: "HQ down while Zerops and the open Mate run: placement held, identity and attention live",
      inputs: [
        zerops,
        hq,
        liveMate("m1", attentionOf({ working: 2 }), 3),
        [
          streamEvent(linkKeys.hq(ORG), {
            kind: "fault",
            jitter: 0,
            fault: { outcome: "transient", message: "HQ's stream broke." },
          }),
          streamEvent(navigationScope(ORG), { kind: "parent-lost" }),
        ],
      ],
      key: shop,
      expected: {
        title: { kind: "ready", value: "App shop", fresh: false },
        projects: [
          {
            projectId: "m1",
            name: { kind: "ready", value: "shop-mate", fresh: true },
            role: "mate",
            running: false,
            attention: { kind: "ready", value: attentionOf({ working: 2 }), fresh: true },
          },
          {
            projectId: "s1",
            name: { kind: "ready", value: "shop-stage", fresh: true },
            role: "stage",
            running: true,
            attention: null,
          },
        ],
        status: {
          display: "catching-up",
          lagging: [{ input: navigationScope(ORG), phase: "stale" }],
        },
      },
      display: "catching-up",
    },
    {
      name: "HQ not answered yet: the project is a row of its own, unplaced",
      inputs: [zerops],
      key: { kind: "project", projectId: "m1" },
      expected: {
        title: { kind: "ready", value: "shop-mate", fresh: true },
        projects: [
          {
            projectId: "m1",
            name: { kind: "ready", value: "shop-mate", fresh: true },
            role: null,
            running: false,
            attention: null,
          },
        ],
      },
      display: "catching-up",
    },
    {
      name: "access to a project denied: its name is withheld, not deleted",
      inputs: [zerops, hq, [{ kind: "access", family: "project", id: "s1", access: "denied" }]],
      key: shop,
      expected: {
        projects: [
          expect.objectContaining({ projectId: "m1" }),
          expect.objectContaining({ projectId: "s1", name: { kind: "withheld" } }),
        ],
      },
      display: "partial",
    },
    {
      name: "relayed attention whose Mate is cut off from HQ is not live",
      inputs: [
        zerops,
        liveHq({
          placements: [{ projectId: "m1", appId: "shop" }],
          attention: [{ projectId: "m1", value: attentionOf({ waiting: 1 }), producer: "down" }],
        }),
      ],
      key: shop,
      expected: {
        projects: [
          expect.objectContaining({
            attention: { kind: "ready", value: attentionOf({ waiting: 1 }), fresh: false },
          }),
        ],
        status: { display: "catching-up", lagging: [{ input: "producer", projectId: "m1" }] },
      },
      display: "catching-up",
    },
    {
      name: "running work before its scope's first baseline is not said, never false",
      inputs: [
        liveZerops({ projects: [{ id: "m1", name: "shop-mate" }] }).filter(
          (input) =>
            !("scope" in input && input.scope === runningScope(ORG)) &&
            !("key" in input && input.key === runningScope(ORG)),
        ),
      ],
      key: { kind: "project", projectId: "m1" },
      expected: { running: { kind: "pending" } },
      display: "catching-up",
    },
  ])("$name → $display", ({ inputs, key, expected, display }) => {
    const derived = row(account(...inputs), key);
    expect(derived).toMatchObject(expected);
    expect(derived.status.display).toBe(display);
  });
});
