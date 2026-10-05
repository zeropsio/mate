import { describe, expect, it } from "@effect/vitest";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { linkKeys, type AccountState, type OperationRecord } from "../model.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { operationEnd } from "./operationEnd.ts";

const INTENT = { kind: "delete-project", orgId: ORG, projectId: "p1" } as const;

function stateWith(record: Partial<OperationRecord> | null, linkEvent?: "pause"): AccountState {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  if (linkEvent === "pause")
    store.dispatch({
      kind: "stream",
      key: linkKeys.zerops(ORG),
      event: { kind: "demand", demanded: false },
      now: 0,
    });
  const state = store.state();
  if (record === null) return state;
  const operations = new Map(state.operations).set("r1", {
    requestId: "r1",
    intent: INTENT,
    submission: "answered",
    receipt: null,
    handles: [],
    before: null,
    unresolved: null,
    ...record,
  } as OperationRecord);
  return { ...state, operations };
}

const accepted = {
  requestId: "r1",
  operationId: "proc-del",
  executor: "zerops",
  affected: [],
  handles: ["proc-del"],
  acceptance: { kind: "accepted" },
  outcome: { kind: "pending" },
} as const;

describe("operationEnd", () => {
  it.each([
    ["nothing recorded yet", null, undefined, null],
    ["accepted, its link live", { receipt: accepted }, undefined, null],
    [
      "accepted, its link no longer observed",
      { receipt: accepted },
      "pause" as const,
      { stage: "unobserved" },
    ],
    [
      "refused",
      { receipt: { ...accepted, acceptance: { kind: "refused", reason: "No." } } },
      undefined,
      { stage: "refused", reason: "No." },
    ],
    ["not taken", { submission: "unsent" }, undefined, { stage: "unsent", next: "send-again" }],
    [
      "its answer lost, its owner not askable",
      { submission: "uncertain-unasked" },
      undefined,
      { stage: "uncertain", next: "ask-owner-again" },
    ],
    [
      "unresolved by its owner",
      { submission: "uncertain-unasked", unresolved: { nextActor: "person" } },
      "pause" as const,
      { stage: "unresolved", operationId: null, nextActor: "person" },
    ],
  ] as const)("%s", (_label, record, link, end) => {
    expect(
      operationEnd.derive(readsOfState(stateWith(record, link)), { requestId: "r1", orgId: ORG }),
    ).toEqual(end);
  });
});
