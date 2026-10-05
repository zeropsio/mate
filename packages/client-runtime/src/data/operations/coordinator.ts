/**
 * Submitting an operation to its owner (HANDOFF §4.6): the intent and its request id are recorded
 * before the request leaves; the owner's receipt goes through the store's one reducer. A lost answer
 * is never sent again blindly: the owner is asked by the original id first, and only an owner that
 * holds no such request is sent it again — under the same id, which the owner applies once.
 *
 * @module data/operations/coordinator
 */
import * as Effect from "effect/Effect";

import type { Authority, OperationIntent, OperationReceipt } from "../model.ts";
import { readsOfState, type AccountStore } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import type { RegisteredOperationKind } from "./kind.ts";
import { OPERATION_KINDS, operationKind } from "./kinds.ts";

/** The owner's answer was lost on the way: it may or may not have taken the request. */
export interface UncertainAcceptance {
  readonly outcome: "uncertain-acceptance";
  readonly message: string;
}

/**
 * The operation's owner. A lost answer is resolved by what the owner can be asked: by the request
 * id where it keeps one (HQ), by an external handle where one is known (a Zerops process), or else
 * by the intended effect in the owner's facts (the kind's `acceptedBy`) — never by sending again.
 */
export interface OperationExecutor {
  readonly submit: (
    requestId: string,
    intent: OperationIntent,
  ) => Effect.Effect<OperationReceipt, StreamFault | UncertainAcceptance>;
  /** The receipt the owner holds for this request id; `null` when it never took it. */
  readonly lookup?: (requestId: string) => Effect.Effect<OperationReceipt | null, StreamFault>;
  /** The receipt behind an external handle; `null` when the owner holds none for it. */
  readonly lookupHandle?: (handle: string) => Effect.Effect<OperationReceipt | null, StreamFault>;
}

export interface Operations {
  /** Records, sends and reconciles one intent; answers with its request id. */
  readonly submit: (intent: OperationIntent) => Effect.Effect<string>;
  /**
   * The person's try-now: an unsent request is sent again, an uncertain one asked after — both
   * under the original id. Anything else is left as it stands.
   */
  readonly retry: (requestId: string) => Effect.Effect<void>;
  /**
   * Picks up a request this account sent before — after a restart — by its original id, or by the
   * external handles it was accepted with where they are known.
   */
  readonly resume: (
    requestId: string,
    intent: OperationIntent,
    handles?: ReadonlyArray<string>,
  ) => Effect.Effect<void>;
}

export function makeOperations(options: {
  readonly store: AccountStore;
  /** Each owner's executor; an intent goes to the one its kind names. */
  readonly executors: Partial<Readonly<Record<Authority, OperationExecutor>>>;
  /** The operation kinds it submits; the account's registry unless a test brings its own. */
  readonly kinds?: ReadonlyArray<RegisteredOperationKind>;
  readonly makeId: () => string;
}): Operations {
  const { store } = options;
  const executorOf = (intent: OperationIntent) => {
    const owner = operationKind(options.kinds ?? OPERATION_KINDS, intent).executor;
    const executor = options.executors[owner];
    if (executor === undefined) throw new Error(`No executor for ${owner} is wired.`);
    return { owner, executor };
  };

  const send = (requestId: string, intent: OperationIntent, resend: boolean): Effect.Effect<void> =>
    Effect.matchEffect(executorOf(intent).executor.submit(requestId, intent), {
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
                executor: executorOf(intent).owner,
                affected: [],
                handles: [],
                acceptance: { kind: "refused", reason: fault.message },
                outcome: { kind: "pending" },
              },
            }),
          );
        // Not taken: shown as unsent, sent again under the same id when the person asks.
        return Effect.sync(() => store.dispatch({ kind: "operation-unsent", requestId }));
      },
    });

  /** Files the owner's answer under this account's request id, whatever id the owner knows. */
  const admit = (receipt: OperationReceipt | null, requestId: string) =>
    Effect.sync(() =>
      store.dispatch(
        receipt === null
          ? { kind: "operation-lookup-failed", requestId }
          : { kind: "operation-receipt", receipt: { ...receipt, requestId } },
      ),
    );

  /**
   * Resolves a lost answer. By a known handle; else by the request id, sending again — once, under
   * that id — only to an owner that holds none; else by the intended effect in the owner's facts.
   * What none of these settles stays uncertain, with asking again as the person's next step.
   */
  const reconcile = (
    requestId: string,
    intent: OperationIntent,
    resend: boolean,
    handles: ReadonlyArray<string> = [],
  ): Effect.Effect<void> => {
    const { owner, executor } = executorOf(intent);
    const handle = handles[0];
    if (handle !== undefined && executor.lookupHandle !== undefined)
      return Effect.matchEffect(executor.lookupHandle(handle), {
        onSuccess: (receipt) => admit(receipt, requestId),
        onFailure: () => admit(null, requestId),
      });
    if (executor.lookup === undefined) {
      const effect = operationKind(options.kinds ?? OPERATION_KINDS, intent).acceptedBy?.(
        readsOfState(store.state()),
        intent,
      );
      return admit(
        effect === null || effect === undefined
          ? null
          : {
              requestId,
              operationId: effect.operationId,
              executor: owner,
              affected: [],
              handles: effect.handles,
              acceptance: { kind: "accepted" },
              outcome: { kind: "pending" },
            },
        requestId,
      );
    }
    return Effect.matchEffect(executor.lookup(requestId), {
      onSuccess: (receipt) => {
        if (receipt !== null)
          return Effect.sync(() => store.dispatch({ kind: "operation-receipt", receipt }));
        // Never taken: sent again now, once; after that it waits, unsent, for the person.
        if (!resend)
          return Effect.sync(() => store.dispatch({ kind: "operation-unsent", requestId }));
        store.dispatch({ kind: "operation-absent", requestId });
        return send(requestId, intent, false);
      },
      // The owner could not be asked: uncertain, with asking again as the next step.
      onFailure: () => admit(null, requestId),
    });
  };

  return {
    submit: (intent) =>
      Effect.gen(function* () {
        const requestId = options.makeId();
        store.dispatch({ kind: "operation-recorded", requestId, intent });
        yield* send(requestId, intent, true);
        return requestId;
      }),
    retry: (requestId) =>
      Effect.suspend(() => {
        const record = store.state().operations.get(requestId);
        if (record === undefined || record.receipt !== null) return Effect.void;
        if (record.submission === "unsent") return send(requestId, record.intent, true);
        if (record.submission === "uncertain-unasked")
          return reconcile(requestId, record.intent, true);
        return Effect.void;
      }),
    resume: (requestId, intent, handles) =>
      Effect.gen(function* () {
        store.dispatch({ kind: "operation-recorded", requestId, intent });
        yield* reconcile(requestId, intent, true, handles);
      }),
  };
}
