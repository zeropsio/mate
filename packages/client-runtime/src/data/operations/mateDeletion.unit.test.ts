import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import type { OperationReceipt } from "../model.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { mateKeyRetirementAllowed } from "./mateDeletion.ts";

const PREPARE = {
  kind: "prepare-mate-deletion",
  orgId: ORG,
  hqProjectId: "hq",
  projectId: "p1",
} as const;
const COMPLETE = {
  ...PREPARE,
  kind: "complete-mate-deletion",
  preparedRequestId: "prepare",
  completion: "exact-completion",
} as const;
const RETIRE = {
  kind: "retire-mate-key",
  orgId: ORG,
  projectId: "p1",
  tokenId: "key-1",
  preparedRequestId: "prepare",
  completionRequestId: "complete",
} as const;

function account() {
  const store = makeAccountStore(AtomRegistry.make());
  liveZerops({ running: [] }).forEach(store.dispatch);
  seedHqNavigation(store, ORG, {
    mates: { p1: { presence: { online: false, since: "2026-10-07", overview: "stored" } } },
  });
  return store;
}

// witness: packages/client-runtime/src/data/operations/mateDeletion.ts | key.keyTokenId === intent.tokenId && →
it("OP54: A Mate's key is retired only for the exact key, project, account and completed deletion it was prepared with", () => {
  const store = account();
  const receipt = (requestId: string): OperationReceipt => ({
    requestId,
    operationId: "p1",
    executor: "hq",
    affected: [],
    handles: ["p1"],
    acceptance: { kind: "accepted" },
    outcome: { kind: "succeeded", evidence: "HQ answered" },
  });
  store.dispatch({ kind: "operation-recorded", requestId: "prepare", intent: PREPARE });
  store.dispatch({
    kind: "operation-receipt",
    receipt: {
      ...receipt("prepare"),
      acceptance: {
        kind: "accepted",
        result: { keyTokenId: "key-1", completion: "exact-completion" },
      },
    },
  });
  store.dispatch({ kind: "operation-recorded", requestId: "complete", intent: COMPLETE });
  store.dispatch({ kind: "operation-receipt", receipt: receipt("complete") });
  const read = readsOfState(store.state());
  expect(mateKeyRetirementAllowed(read, RETIRE)).toBe(true);
  for (const patch of [
    { tokenId: "other-key" },
    { projectId: "p2" },
    { orgId: "other-account" },
    { completionRequestId: "unproved" },
  ])
    expect(mateKeyRetirementAllowed(read, { ...RETIRE, ...patch })).toBe(false);
});
