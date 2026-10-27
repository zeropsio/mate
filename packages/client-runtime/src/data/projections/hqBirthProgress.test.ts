import { describe, expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";

import { HQ_BIRTH_START } from "../../zerops/hq/birth.ts";
import { linkKeys, type OperationReceipt } from "../model.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { hqBirthProgress, hqBirthRequestId } from "./hqBirthProgress.ts";

const ORG = "org";
const id = hqBirthRequestId(ORG, 1);
const receipt = (patch: Partial<OperationReceipt> = {}): OperationReceipt => ({
  requestId: id,
  operationId: id,
  executor: "zerops",
  affected: [],
  handles: ["hq-project"],
  acceptance: {
    kind: "accepted",
    result: {
      record: { ...HQ_BIRTH_START, step: "deploy", projectId: "hq-project" },
      failed: null,
    },
  },
  outcome: { kind: "pending" },
  ...patch,
});

describe("HQ birth progress from operation receipts", () => {
  it.each(["outage", "partial coverage", "refusal"])(
    "keeps progress during %s without declaring an outcome",
    (state) => {
      const store = makeAccountStore(AtomRegistry.make());
      store.dispatch({
        kind: "operation-recorded",
        requestId: id,
        intent: { kind: "hq-birth", orgId: ORG, zeropsApi: "https://api.example", again: false },
      });
      store.dispatch({ kind: "operation-receipt", receipt: receipt() });
      // No baseline means partial coverage; an outage and a refusal are distinct source faults.
      if (state !== "partial coverage")
        store.dispatch({
          kind: "stream",
          key: linkKeys.zerops(ORG),
          now: 0,
          event: {
            kind: "fault",
            jitter: 0,
            fault: {
              outcome: state === "refusal" ? "definitive-refusal" : "transient",
              message: "Source unavailable",
            },
          },
        });
      expect(hqBirthProgress.derive(readsOfState(store.state()), ORG)).toMatchObject({
        record: { step: "deploy" },
        running: true,
        failed: null,
      });
    },
  );

  it("retains a stopped receipt, and reads a manual continuation from its next operation", () => {
    const store = makeAccountStore(AtomRegistry.make());
    const intent = {
      kind: "hq-birth",
      orgId: ORG,
      zeropsApi: "https://api.example",
      again: false,
    } as const;
    store.dispatch({ kind: "operation-recorded", requestId: id, intent });
    const failed = {
      ok: false,
      step: "deploy",
      reason: "Insufficient credit",
      uncertain: false,
    } as const;
    store.dispatch({
      kind: "operation-receipt",
      receipt: receipt({
        acceptance: {
          kind: "accepted",
          result: { record: { ...HQ_BIRTH_START, step: "deploy" }, failed },
        },
        outcome: { kind: "failed", evidence: failed.reason },
      }),
    });
    expect(hqBirthProgress.derive(readsOfState(store.state()), ORG)).toMatchObject({
      attempt: 1,
      running: false,
      failed,
    });
    store.dispatch({
      kind: "operation-recorded",
      requestId: hqBirthRequestId(ORG, 2),
      intent: { ...intent, again: true },
    });
    expect(hqBirthProgress.derive(readsOfState(store.state()), ORG)).toMatchObject({
      attempt: 2,
      record: { step: "deploy" },
      running: true,
      failed: null,
    });
  });
});
