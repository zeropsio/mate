/**
 * A step that waits on its operation: submits the intent, then resolves with the owner's result
 * once the operation is done — or stops with what ended it, in the words the owner or its facts
 * gave. A stop where the write may have landed (its answer lost, its end no longer followed) is the
 * client's own uncertain failure, so the step is never asked again blindly. No clock decides it.
 *
 * @module data/operations/runToEnd
 */
import * as Effect from "effect/Effect";
import type { AtomRegistry } from "effect/unstable/reactivity";

import { ZeropsApiError } from "../../zerops/api.ts";
import type { OperationIntent, OperationResults } from "../model.ts";
import { operationResult } from "../model.ts";
import { operationEnd, operationStop, type OperationEnd } from "../projections/operationEnd.ts";
import type { AccountStore } from "../store.ts";
import type { Operations } from "./coordinator.ts";

type ResultOf<Kind extends string> = Kind extends keyof OperationResults
  ? OperationResults[Kind]
  : undefined;

export type RunToEnd = <Intent extends OperationIntent>(
  intent: Intent,
  options: {
    /** The organization whose link observes the operation's end. */
    readonly orgId: string;
    /** What the step says where its end can no longer be followed. */
    readonly unobserved: string;
    /** The id it is recorded under, where the caller finds it again by it (a creation's step). */
    readonly requestId?: string;
    /** Told the owner's result once it accepted, before its end: what it made already exists. */
    readonly accepted?: (result: ResultOf<Intent["kind"]>) => void;
  },
) => Promise<ResultOf<Intent["kind"]>>;

const uncertain = (message: string) => new ZeropsApiError(message, "uncertain");

export function runToEnd(input: {
  readonly operations: Operations;
  readonly store: AccountStore;
  readonly registry: AtomRegistry.AtomRegistry;
}): RunToEnd {
  const { store, registry } = input;
  const until = (requestId: string, orgId: string) =>
    new Promise<NonNullable<OperationEnd>>((resolve) => {
      let cancel: () => void = () => {};
      cancel = registry.subscribe(
        store.data.project(operationEnd, { requestId, orgId }),
        (end) => {
          if (end === null) return;
          resolve(end);
          cancel();
        },
        { immediate: true },
      );
    });
  const resultOf = (requestId: string, kind: string) =>
    operationResult(
      store.state().operations.get(requestId),
      kind as keyof OperationResults & string,
    ) as never;
  return async (intent, { orgId, unobserved, accepted, requestId: named }) => {
    const requestId = await Effect.runPromise(input.operations.submit(intent, named));
    if (store.state().operations.get(requestId)?.receipt?.acceptance.kind === "accepted")
      accepted?.(resultOf(requestId, intent.kind));
    const end = await until(requestId, orgId);
    const stop = operationStop(end, store.state().operations.get(requestId));
    if (stop === null) return resultOf(requestId, intent.kind);
    const message = stop.reason ?? unobserved;
    throw stop.uncertain ? uncertain(message) : new Error(message);
  };
}
