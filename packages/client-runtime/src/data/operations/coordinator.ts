/**
 * Submitting an operation to its owner (HANDOFF §4.6): the intent and its request id are recorded
 * before the request leaves; the owner's receipt goes through the store's one reducer. A lost answer
 * is never sent again blindly: the owner is asked by the original id first, and only an owner that
 * holds no such request is sent it again — under the same id, which the owner applies once.
 *
 * @module data/operations/coordinator
 */
import * as Effect from "effect/Effect";

import type { OperationIntent, OperationReceipt } from "../model.ts";
import type { AccountStore } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";

/** The owner's answer was lost on the way: it may or may not have taken the request. */
export interface UncertainAcceptance {
  readonly outcome: "uncertain-acceptance";
  readonly message: string;
}

/** The operation's owner: it applies a request id once, and answers for it later by that id. */
export interface OperationExecutor {
  readonly submit: (
    requestId: string,
    intent: OperationIntent,
  ) => Effect.Effect<OperationReceipt, StreamFault | UncertainAcceptance>;
  /** The receipt the owner holds for this request id; `null` when it never took it. */
  readonly lookup: (requestId: string) => Effect.Effect<OperationReceipt | null, StreamFault>;
}

export interface Operations {
  /** Records, sends and reconciles one intent; answers with its request id. */
  readonly submit: (intent: OperationIntent) => Effect.Effect<string>;
  /** Picks up a request this account sent before — after a restart — by its original id. */
  readonly resume: (requestId: string, intent: OperationIntent) => Effect.Effect<void>;
}

export function makeOperations(options: {
  readonly store: AccountStore;
  readonly executor: OperationExecutor;
  readonly makeId: () => string;
}): Operations {
  const { store, executor } = options;

  const send = (requestId: string, intent: OperationIntent, resend: boolean): Effect.Effect<void> =>
    Effect.matchEffect(executor.submit(requestId, intent), {
      onSuccess: (receipt) =>
        Effect.sync(() => store.dispatch({ kind: "operation-receipt", receipt })),
      onFailure: (fault) => {
        if (fault.outcome === "uncertain-acceptance") {
          store.dispatch({ kind: "operation-uncertain", requestId });
          return reconcile(requestId, intent, resend);
        }
        if (fault.outcome === "definitive-refusal" || fault.outcome === "authoritative-denial")
          return Effect.sync(() =>
            store.dispatch({
              kind: "operation-receipt",
              receipt: {
                requestId,
                operationId: requestId,
                executor: "hq",
                affected: [],
                acceptance: { kind: "refused", reason: fault.message },
                outcome: { kind: "pending" },
              },
            }),
          );
        // Not taken, and safe to send again under the same id when the person asks.
        return Effect.void;
      },
    });

  /** Asks the owner by the original id; sends again, once, only to an owner that holds none. */
  const reconcile = (requestId: string, intent: OperationIntent, resend: boolean) =>
    Effect.matchEffect(executor.lookup(requestId), {
      onSuccess: (receipt) => {
        if (receipt !== null)
          return Effect.sync(() => store.dispatch({ kind: "operation-receipt", receipt }));
        store.dispatch({ kind: "operation-absent", requestId });
        return resend ? send(requestId, intent, false) : Effect.void;
      },
      // The owner could not be asked: the operation stays visibly uncertain.
      onFailure: () => Effect.void,
    });

  return {
    submit: (intent) =>
      Effect.gen(function* () {
        const requestId = options.makeId();
        store.dispatch({ kind: "operation-recorded", requestId, intent });
        yield* send(requestId, intent, true);
        return requestId;
      }),
    resume: (requestId, intent) =>
      Effect.gen(function* () {
        store.dispatch({ kind: "operation-recorded", requestId, intent });
        yield* reconcile(requestId, intent, true);
      }),
  };
}
