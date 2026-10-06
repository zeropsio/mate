/**
 * One account's operations with Zerops as the only owner, for a Zerops kind's tests: the kind's
 * own executor answers, request ids count up from `r1`, and progress is read as a screen reads it.
 */
import { AtomRegistry } from "effect/unstable/reactivity";

import type { OperationIntent } from "../model.ts";
import type { AccountInput } from "../reducer.ts";
// Before the coordinator: the progress projection loads the kinds' registry first.
import { operationProgress } from "../projections/operation.ts";
import { makeOperations, type OperationExecutor } from "../operations/coordinator.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";

export function accountOf(inputs: ReadonlyArray<AccountInput>): AccountStore {
  const store = makeAccountStore(AtomRegistry.make());
  inputs.forEach(store.dispatch);
  return store;
}

/** Zerops answering with one kind's executor: every intent the test submits is of that kind. */
export function zeropsOperations<Intent extends OperationIntent>(
  store: AccountStore,
  submit: (requestId: string, intent: Intent) => ReturnType<OperationExecutor["submit"]>,
) {
  let next = 0;
  return makeOperations({
    store,
    executors: { zerops: { submit: (requestId, intent) => submit(requestId, intent as Intent) } },
    makeId: () => `r${(next += 1)}`,
  });
}

export const progressOf = (store: AccountStore, requestId = "r1") =>
  operationProgress.derive(readsOfState(store.state()), requestId);
