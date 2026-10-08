import { describe, expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";

import { ORG } from "../__fixtures__/account.ts";
import { linkKeys, type AccountState, type OperationRecord } from "../model.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { operationWait } from "./operationWait.ts";

const COMMENT = {
  kind: "change-comment",
  orgId: ORG,
  link: { appId: "shop", repo: "web", number: 7 },
  body: "Ship it",
  authorUserId: "u1",
} as const;
const LIVE: ReadonlyArray<StreamEvent> = [
  { kind: "demand", demanded: true },
  { kind: "attempt" },
  { kind: "handshake" },
  { kind: "baseline-committed" },
];
const BROKE: StreamEvent = {
  kind: "fault",
  fault: { outcome: "transient", message: "HQ's stream broke." },
  jitter: 0,
};

function waiting(hq: ReadonlyArray<StreamEvent>, settled = false): AccountState {
  const store = makeAccountStore(AtomRegistry.make());
  for (const event of hq) store.dispatch({ kind: "stream", key: linkKeys.hq(ORG), event, now: 0 });
  const state = store.state();
  const operations = new Map(state.operations).set("r1", {
    requestId: "r1",
    intent: COMMENT,
    submission: "answered",
    receipt: {
      requestId: "r1",
      operationId: "c1",
      executor: "hq",
      affected: [],
      handles: ["c1"],
      acceptance: { kind: "accepted" },
      outcome: settled ? { kind: "succeeded", evidence: "HQ holds it." } : { kind: "pending" },
    },
    handles: ["c1"],
    before: [],
    unresolved: null,
  } as OperationRecord);
  return { ...state, operations };
}

describe("operationWait", () => {
  it.each([
    { name: "HQ live", state: waiting(LIVE), wait: { kind: "waiting", reconnecting: false } },
    {
      name: "HQ reconnecting",
      state: waiting([...LIVE, BROKE]),
      wait: { kind: "waiting", reconnecting: true },
    },
    { name: "ended", state: waiting(LIVE, true), wait: { kind: "ended" } },
    {
      name: "HQ no longer followed",
      state: waiting([...LIVE, { kind: "demand", demanded: false }]),
      wait: { kind: "ended" },
    },
  ])("$name", ({ state, wait }) => {
    expect(operationWait.derive(readsOfState(state), { requestId: "r1", orgId: ORG })).toEqual(
      wait,
    );
  });

  it("is over for an operation the account holds no record of", () => {
    expect(
      operationWait.derive(readsOfState(waiting(LIVE)), { requestId: "r9", orgId: ORG }),
    ).toEqual({ kind: "ended" });
  });
});
