import { describe, expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/reactivity";
import { linkKeys, type OperationReceipt } from "../model.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { mateRegistration, registrationRequestId } from "./mateRegistration.ts";

const key = { orgId: "org", projectId: "mate" };
const id = registrationRequestId(key, 1);
const intent = {
  kind: "create-mate-record",
  orgId: key.orgId,
  mate: { projectId: key.projectId, face: "", standUp: false },
} as const;
const refused: OperationReceipt = {
  requestId: id,
  operationId: id,
  executor: "hq",
  affected: [],
  handles: [],
  acceptance: { kind: "refused", reason: "Its grant timed out." },
  outcome: { kind: "pending" },
};

describe("Mate registration receipt", () => {
  it.each(["outage", "partial coverage", "refusal"])(
    "retains why registration stopped through %s after its press is forgotten",
    (phase) => {
      const store = makeAccountStore(AtomRegistry.make());
      store.dispatch({ kind: "operation-recorded", requestId: id, intent });
      store.dispatch({ kind: "operation-receipt", receipt: refused });
      // No baseline means partial coverage; an outage and a refusal are distinct source faults.
      if (phase !== "partial coverage")
        store.dispatch({
          kind: "stream",
          key: linkKeys.hq(key.orgId),
          now: 0,
          event: {
            kind: "fault",
            jitter: 0,
            fault: {
              outcome: phase === "refusal" ? "definitive-refusal" : "transient",
              message: "Source unavailable",
            },
          },
        });
      expect(mateRegistration.derive(readsOfState(store.state()), key)).toEqual({
        attempt: 1,
        state: "unfinished",
        reason: "Its grant timed out.",
      });
    },
  );

  it("a successful Finish setup replaces the refusal without deleting its receipt", () => {
    const store = makeAccountStore(AtomRegistry.make());
    store.dispatch({ kind: "operation-recorded", requestId: id, intent });
    store.dispatch({ kind: "operation-receipt", receipt: refused });
    const next = registrationRequestId(key, 2);
    store.dispatch({ kind: "operation-recorded", requestId: next, intent });
    store.dispatch({
      kind: "operation-receipt",
      receipt: {
        ...refused,
        requestId: next,
        acceptance: { kind: "accepted" },
        outcome: { kind: "succeeded", evidence: "HQ registered it." },
      },
    });
    expect(mateRegistration.derive(readsOfState(store.state()), key)).toEqual({
      attempt: 2,
      state: "done",
    });
    expect(store.state().operations.get(id)?.receipt).toEqual(refused);
  });
});
