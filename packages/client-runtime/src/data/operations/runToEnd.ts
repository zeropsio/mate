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
import { operationEnd, type OperationEnd } from "../projections/operationEnd.ts";
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
  return async (intent, { orgId, unobserved, accepted }) => {
    const requestId = await Effect.runPromise(input.operations.submit(intent));
    if (store.state().operations.get(requestId)?.receipt?.acceptance.kind === "accepted")
      accepted?.(resultOf(requestId, intent.kind));
    const end = await until(requestId, orgId);
    const record = store.state().operations.get(requestId);
    const said = record?.unsentBecause ?? record?.uncertainBecause ?? unobserved;
    switch (end.stage) {
      case "done":
        if (end.outcome === "succeeded") return resultOf(requestId, intent.kind);
        throw new Error(end.reason ?? `Zerops reported it ${end.outcome}.`);
      case "refused":
        throw new Error(end.reason);
      case "unsent":
        throw new Error(said);
      case "unresolved":
        throw uncertain(end.nextAction ?? `${end.nextActor} must act next.`);
      default:
        // Its answer lost, or its end out of sight: it may have landed.
        throw uncertain(end.stage === "uncertain" ? said : unobserved);
    }
  };
}
