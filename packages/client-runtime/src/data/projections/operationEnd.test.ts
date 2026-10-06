import { describe, expect, it } from "@effect/vitest";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { linkKeys, type AccountState, type OperationRecord } from "../model.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { operationEnd } from "./operationEnd.ts";
import { detailScopeOf } from "../demand.ts";
import type { StreamEvent } from "../streamMachine.ts";

const INTENT = { kind: "delete-project", orgId: ORG, projectId: "p1" } as const;
/** A write HQ executes, its answer lost and adopted: its end is read in HQ's navigation. */
const BIND = {
  kind: "bind-birth",
  orgId: ORG,
  hq: { projectId: "hq", address: "https://hq.test" },
  appId: "app-1",
  birthId: "b1",
  projectId: "p1",
} as const;

function stateWith(
  record: Partial<OperationRecord> | null,
  linkEvent?: "pause" | "history-refused" | "pause-hq",
): AccountState {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  const hqEvents: ReadonlyArray<StreamEvent> = [
    { kind: "demand", demanded: true },
    { kind: "handshake" },
    ...(linkEvent === "pause-hq" ? [{ kind: "demand", demanded: false } as const] : []),
  ];
  for (const event of hqEvents)
    store.dispatch({ kind: "stream", key: linkKeys.hq(ORG), event, now: 0 });
  if (linkEvent === "pause")
    store.dispatch({
      kind: "stream",
      key: linkKeys.zerops(ORG),
      event: { kind: "demand", demanded: false },
      now: 0,
    });
  if (linkEvent === "history-refused") {
    // The project is gone: its history's read answers 404 and refuses that detail alone.
    const key = detailScopeOf(ORG, { family: "process", listing: "history", ownerId: "p1" });
    for (const event of [
      { kind: "demand", demanded: true },
      { kind: "attempt" },
      { kind: "fault", fault: { outcome: "definitive-refusal", message: "HTTP 404" }, jitter: 0 },
    ] as const)
      store.dispatch({ kind: "stream", key, event, now: 0 });
  }
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
      "accepted, its project's history refused while its link is live",
      { receipt: accepted },
      "history-refused" as const,
      { stage: "unobserved" },
    ],
    [
      "refused",
      { receipt: { ...accepted, acceptance: { kind: "refused", reason: "No." } } },
      undefined,
      { stage: "refused", reason: "No." },
    ],
    [
      "accepted by HQ, Zerops's link no longer observed: HQ's link still says its end",
      { intent: BIND, receipt: { ...accepted, executor: "hq" } },
      "pause" as const,
      null,
    ],
    [
      "accepted by HQ, HQ's link no longer observed",
      { intent: BIND, receipt: { ...accepted, executor: "hq" } },
      "pause-hq" as const,
      { stage: "unobserved" },
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
