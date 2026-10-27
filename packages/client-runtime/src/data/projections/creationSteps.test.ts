import { describe, expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import {
  linkKeys,
  type OperationIntent,
  type OperationReceipt,
  type OperationRecord,
} from "../model.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import type { HqStructure } from "../../zerops/hq/client.ts";
import {
  creationSteps,
  creationStepId,
  creationsSteps,
  type CreationRead,
} from "./creationSteps.ts";

const APP: OperationIntent = { kind: "create-app", orgId: ORG, name: "Garden" };
const BIRTH: OperationIntent = { kind: "record-birth", orgId: ORG, appId: "app-1", face: "tint" };
const PROJECT: OperationIntent = {
  kind: "create-project",
  orgId: ORG,
  name: "Garden - Nova",
  tagList: [],
};

const receipt = (
  requestId: string,
  patch: Partial<OperationReceipt> & Pick<OperationReceipt, "executor">,
): OperationReceipt => ({
  requestId,
  operationId: requestId,
  affected: [],
  handles: [],
  acceptance: { kind: "accepted" },
  outcome: { kind: "pending" },
  ...patch,
});

interface Hq {
  readonly apps?: HqStructure["apps"];
  readonly paused?: boolean;
}

/** Operations recorded under a creation's step ids, and HQ's navigation as it reads now. */
function read(
  records: ReadonlyArray<Partial<OperationRecord> & Pick<OperationRecord, "requestId" | "intent">>,
  hq: Hq = {},
) {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    structure: { apps: [...(hq.apps ?? [])], ungrouped: [] } as never,
  });
  // HQ's link observes nothing more: nothing it would show can end a write there.
  if (hq.paused === true)
    store.dispatch({
      kind: "stream",
      key: linkKeys.hq(ORG),
      event: { kind: "demand", demanded: false },
      now: 0,
    });
  const state = store.state();
  const operations = new Map(state.operations);
  for (const record of records)
    operations.set(record.requestId, {
      submission: "answered",
      receipt: null,
      handles: [],
      before: null,
      unresolved: null,
      ...record,
    } as OperationRecord);
  return creationSteps.derive(readsOfState({ ...state, operations }), {
    orgId: ORG,
    creationId: "c1",
  });
}

const garden = {
  id: "app-1",
  name: "Garden",
  projects: [],
  births: [],
  environments: [],
} as unknown as HqStructure["apps"][number];
const appMade = {
  requestId: "c1:app",
  intent: APP,
  receipt: receipt("c1:app", {
    executor: "hq",
    handles: ["app-1"],
    acceptance: { kind: "accepted", result: { appId: "app-1" } },
  }),
};
const NOT_SENT = { state: "not-sent", attempt: 0 } as const;

describe("creationSteps", () => {
  it.each<
    [
      string,
      ReadonlyArray<Partial<OperationRecord> & Pick<OperationRecord, "requestId" | "intent">>,
      Hq,
      Partial<CreationRead>,
    ]
  >([
    [
      "nothing sent yet",
      [],
      {},
      {
        steps: { app: NOT_SENT, birth: NOT_SENT, project: NOT_SENT },
        appId: null,
        birthId: null,
        projectId: null,
      },
    ],
    [
      "its application accepted, HQ's navigation not showing it yet",
      [appMade],
      {},
      { steps: { app: { state: "running", attempt: 1 }, birth: NOT_SENT, project: NOT_SENT } },
    ],
    [
      "its application reflected in HQ's navigation",
      [appMade],
      { apps: [garden] },
      {
        steps: { app: { state: "done", attempt: 1 }, birth: NOT_SENT, project: NOT_SENT },
        appId: "app-1",
      },
    ],
    [
      "its application accepted, HQ's link down before it showed",
      [appMade],
      { paused: true },
      {
        steps: {
          app: { state: "stopped", attempt: 1, kind: "create-app", reason: null, uncertain: true },
          birth: NOT_SENT,
          project: NOT_SENT,
        },
      },
    ],
    [
      "its birth refused",
      [
        appMade,
        {
          requestId: "c1:birth",
          intent: BIRTH,
          receipt: receipt("c1:birth", {
            executor: "hq",
            acceptance: { kind: "refused", reason: "HQ said no." },
          }),
        },
      ],
      { apps: [garden] },
      {
        steps: {
          app: { state: "done", attempt: 1 },
          birth: {
            state: "stopped",
            attempt: 1,
            kind: "record-birth",
            reason: "HQ said no.",
            uncertain: false,
          },
          project: NOT_SENT,
        },
        birthId: null,
      },
    ],
    [
      "its project's answer lost, Zerops not askable",
      [
        {
          requestId: "c1:project",
          intent: PROJECT,
          submission: "uncertain-unasked",
          uncertainBecause: "The answer was lost.",
        },
      ],
      {},
      {
        steps: {
          app: NOT_SENT,
          birth: NOT_SENT,
          project: {
            state: "stopped",
            attempt: 1,
            kind: "create-project",
            reason: "The answer was lost.",
            uncertain: true,
          },
        },
      },
    ],
    [
      "its project unresolved by Zerops",
      [
        {
          requestId: "c1:project",
          intent: PROJECT,
          submission: "uncertain-unasked",
          unresolved: { nextActor: "person", nextAction: "Look in the projects." },
        },
      ],
      {},
      {
        steps: {
          app: NOT_SENT,
          birth: NOT_SENT,
          project: {
            state: "stopped",
            attempt: 1,
            kind: "create-project",
            reason: "Look in the projects.",
            uncertain: true,
          },
        },
      },
    ],
    [
      "its project not taken",
      [
        {
          requestId: "c1:project",
          intent: PROJECT,
          submission: "unsent",
          unsentBecause: "Too many projects.",
        },
      ],
      {},
      {
        steps: {
          app: NOT_SENT,
          birth: NOT_SENT,
          project: {
            state: "stopped",
            attempt: 1,
            kind: "create-project",
            reason: "Too many projects.",
            uncertain: false,
          },
        },
      },
    ],
    [
      "its project tried again after a refusal: the newest attempt is read",
      [
        {
          requestId: "c1:project",
          intent: PROJECT,
          receipt: receipt("c1:project", {
            executor: "zerops",
            acceptance: { kind: "refused", reason: "No." },
          }),
        },
        {
          requestId: creationStepId("c1", "project", 2),
          intent: PROJECT,
          submission: "recorded",
        },
      ],
      {},
      { steps: { app: NOT_SENT, birth: NOT_SENT, project: { state: "running", attempt: 2 } } },
    ],
    [
      "its project taken by Zerops: its id is known before its creation ends",
      [
        {
          requestId: "c1:project",
          intent: PROJECT,
          receipt: receipt("c1:project", {
            executor: "zerops",
            handles: ["p-1"],
            acceptance: { kind: "accepted", result: { projectId: "p-1" } },
          }),
        },
      ],
      {},
      {
        steps: { app: NOT_SENT, birth: NOT_SENT, project: { state: "running", attempt: 1 } },
        projectId: "p-1",
      },
    ],
  ])("%s", (_label, records, hq, expected) => {
    expect(read(records, hq)).toMatchObject(expected);
  });
});

describe("creationsSteps", () => {
  it("reads each creation the tab holds, in its order", () => {
    const store = makeAccountStore(AtomRegistry.make());
    liveZerops({ running: [] }).forEach(store.dispatch);
    const state = store.state();
    const operations = new Map(state.operations).set("c2:app", {
      requestId: "c2:app",
      intent: APP,
      submission: "recorded",
      receipt: null,
      handles: [],
      before: null,
      unresolved: null,
    });
    const reads = creationsSteps.derive(readsOfState({ ...state, operations }), [
      { orgId: ORG, creationId: "c1" },
      { orgId: ORG, creationId: "c2" },
    ]);
    expect(reads.map((read) => read.steps.app.state)).toEqual(["not-sent", "running"]);
  });
});
