import { describe, expect, it } from "vite-plus/test";

import {
  emptyAccount,
  type AccountState,
  type OperationIntent,
  type OperationReceipt,
} from "../model.ts";
import { reduceAccount } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { flowAnswer } from "./flowAnswer.ts";

const DEPLOYS = { jobs: [], note: null };
const RELEASE = {
  kind: "release",
  orgId: "org",
  appId: "shop",
  tag: "v1.0.1",
  groupHead: "b".repeat(40),
  entries: [],
} as const;

const recorded = (intent: OperationIntent) =>
  reduceAccount(emptyAccount, { kind: "operation-recorded", requestId: "r1", intent }).state;
const answered = (state: AccountState, acceptance: OperationReceipt["acceptance"]) =>
  reduceAccount(state, {
    kind: "operation-receipt",
    receipt: {
      requestId: "r1",
      operationId: "v1.0.1",
      executor: "hq",
      affected: [],
      handles: ["v1.0.1"],
      acceptance,
      outcome: { kind: "pending" },
    },
  }).state;

const of = (state: AccountState) => flowAnswer.derive(readsOfState(state), "r1");

describe("flowAnswer", () => {
  it.each([
    { name: "no such operation", state: emptyAccount, answer: null },
    { name: "not answered yet", state: recorded(RELEASE), answer: null },
    {
      name: "a release HQ made",
      state: answered(recorded(RELEASE), {
        kind: "accepted",
        result: { tag: "v1.0.1", deploys: DEPLOYS },
      }),
      answer: { tag: "v1.0.1", deploys: DEPLOYS },
    },
    {
      name: "a release adopted after a lost answer",
      state: answered(recorded(RELEASE), { kind: "accepted" }),
      answer: { tag: "v1.0.1", deploys: undefined },
    },
    {
      name: "a release HQ refused",
      state: answered(recorded(RELEASE), { kind: "refused", reason: "No." }),
      answer: null,
    },
  ])("reads $name", ({ state, answer }) => {
    expect(of(state)).toEqual(answer);
  });
});
