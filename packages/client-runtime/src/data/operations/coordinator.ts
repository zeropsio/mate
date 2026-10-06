/**
 * Submitting an operation to its owner: the intent and its request id are recorded
 * before the request leaves; the owner's receipt goes through the store's one reducer. A lost answer
 * is never sent again blindly: the owner is asked by the original id first, and only an owner that
 * holds no such request is sent it again — under the same id, which the owner applies once.
 *
 * @module data/operations/coordinator
 */
import * as Effect from "effect/Effect";

import type {
  Authority,
  OperationIntent,
  OperationReceipt,
  OperationRecord,
  Unobservable,
} from "../model.ts";
import { readsOfState, type AccountStore, type ProjectionReads } from "../store.ts";
import type { StreamFault } from "../streamMachine.ts";
import type { RegisteredOperationKind } from "./kind.ts";
import { OPERATION_KINDS, operationKind } from "./kinds.ts";

/**
 * The owner can no longer observe the operation — who must act, the named next action, the handles
 * it got as far as — the one way an operation becomes unresolved. A lookup may answer it, and so
 * may `submit` itself (a stop ran, its end is out of sight: the start is never sent blindly).
 */
export interface OwnerUnobservable {
  readonly unobservable: Unobservable & { readonly handles?: ReadonlyArray<string> };
}

/** What an owner answers when asked: its receipt; `null` for none; or that it cannot observe it. */
export type OwnerAnswer = OperationReceipt | null | OwnerUnobservable;

/** The owner's answer was lost on the way: it may or may not have taken the request. */
export interface UncertainAcceptance {
  readonly outcome: "uncertain-acceptance";
  readonly message: string;
}

/**
 * The operation's owner. A lost answer is resolved by what the owner can be asked: by the request
 * id where it keeps one (HQ), by an external handle where one is known (a Zerops process), or else
 * by the intended effect in the owner's facts (the kind's `effectHandles`) — never by sending again.
 */
export interface OperationExecutor {
  readonly submit: (
    requestId: string,
    intent: OperationIntent,
  ) => Effect.Effect<OperationReceipt | OwnerUnobservable, StreamFault | UncertainAcceptance>;
  /** The receipt the owner holds for this request id; `null` when it never took it. */
  readonly lookup?: (requestId: string) => Effect.Effect<OwnerAnswer, StreamFault>;
  /** The receipt behind an external handle; `null` when the owner holds none for it. */
  readonly lookupHandle?: (handle: string) => Effect.Effect<OwnerAnswer, StreamFault>;
}

export interface Operations {
  /**
   * Records, sends and reconciles one intent; answers with its request id — the one its caller
   * names (a creation's step, found again by it), else a new one.
   */
  readonly submit: (intent: OperationIntent, requestId?: string) => Effect.Effect<string>;
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
  const kindOf = (intent: OperationIntent) =>
    operationKind(options.kinds ?? OPERATION_KINDS, intent);
  const executorOf = (intent: OperationIntent) => {
    const owner = kindOf(intent).executor;
    const executor = options.executors[owner];
    if (executor === undefined) throw new Error(`No executor for ${owner} is wired.`);
    return { owner, executor };
  };

  const send = (requestId: string, intent: OperationIntent, resend: boolean): Effect.Effect<void> =>
    Effect.matchEffect(executorOf(intent).executor.submit(requestId, intent), {
      onSuccess: (answer) => admit(answer, requestId),
      onFailure: (fault) => {
        if (fault.outcome === "uncertain-acceptance") {
          store.dispatch({ kind: "operation-uncertain", requestId, reason: fault.message });
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
        return Effect.sync(() =>
          store.dispatch({ kind: "operation-unsent", requestId, reason: fault.message }),
        );
      },
    });

  /** Whether an operation has ended — by its owner's receipt, or by its owner's facts. */
  const ended = (read: ProjectionReads, record: OperationRecord) =>
    record.receipt !== null &&
    (record.receipt.outcome.kind !== "pending" ||
      (kindOf(record.intent).settledBy?.(read, record.intent, record.receipt) ?? null) !== null);

  /**
   * The one effect handle in the owner's facts that can only be this operation's: absent when it
   * was sent, held by no other operation still under way. None, or more than one, adopts nothing.
   */
  const adoptable = (requestId: string, intent: OperationIntent): string | null => {
    const state = store.state();
    const read = readsOfState(state);
    const before = state.operations.get(requestId)?.before;
    const effectHandles = kindOf(intent).effectHandles;
    if (before === null || before === undefined || effectHandles === undefined) return null;
    // An ended operation holds its handles no more: a later one may show the same target.
    const claimed = new Set<string>();
    for (const [other, record] of state.operations)
      if (other !== requestId && !ended(read, record))
        for (const handle of record.handles) claimed.add(handle);
    const candidates = effectHandles(read, intent).filter(
      (handle) => !before.includes(handle) && !claimed.has(handle),
    );
    return candidates.length === 1 ? candidates[0]! : null;
  };

  /** Files the owner's answer under this account's request id, whatever id the owner knows. */
  const admit = (answer: OwnerAnswer, requestId: string) =>
    Effect.sync(() =>
      store.dispatch(
        answer === null
          ? { kind: "operation-lookup-failed", requestId }
          : "unobservable" in answer
            ? {
                kind: "operation-exhausted",
                requestId,
                unobservable: {
                  nextActor: answer.unobservable.nextActor,
                  ...(answer.unobservable.nextAction === undefined
                    ? {}
                    : { nextAction: answer.unobservable.nextAction }),
                  ...(answer.unobservable.reason === undefined
                    ? {}
                    : { reason: answer.unobservable.reason }),
                },
                ...(answer.unobservable.handles === undefined
                  ? {}
                  : { handles: answer.unobservable.handles }),
              }
            : { kind: "operation-receipt", receipt: { ...answer, requestId } },
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
  ): Effect.Effect<void> => {
    const { owner, executor } = executorOf(intent);
    // Every ask goes by the handles the record holds first, whoever learned them.
    const handle = store.state().operations.get(requestId)?.handles[0];
    if (handle !== undefined && executor.lookupHandle !== undefined)
      return Effect.matchEffect(executor.lookupHandle(handle), {
        onSuccess: (receipt) => admit(receipt, requestId),
        onFailure: () => admit(null, requestId),
      });
    if (executor.lookup === undefined) {
      const adopted = adoptable(requestId, intent);
      const resultOf = kindOf(intent).adoptedResult;
      return admit(
        adopted === null
          ? null
          : {
              requestId,
              operationId: adopted,
              executor: owner,
              affected: [],
              handles: [adopted],
              acceptance: {
                kind: "accepted",
                ...(resultOf === undefined ? {} : { result: resultOf(adopted) }),
              },
              outcome: { kind: "pending" },
            },
        requestId,
      );
    }
    return Effect.matchEffect(executor.lookup(requestId), {
      onSuccess: (answer) => {
        if (answer !== null) return admit(answer, requestId);
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
    submit: (intent, named) =>
      Effect.gen(function* () {
        const requestId = named ?? options.makeId();
        const effectHandles = kindOf(intent).effectHandles;
        store.dispatch({
          kind: "operation-recorded",
          requestId,
          intent,
          // What the owner's facts show before the send is never this operation's own effect.
          ...(effectHandles === undefined
            ? {}
            : { before: effectHandles(readsOfState(store.state()), intent) }),
        });
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
        store.dispatch({
          kind: "operation-recorded",
          requestId,
          intent,
          ...(handles === undefined ? {} : { handles }),
        });
        yield* reconcile(requestId, intent, true);
      }),
  };
}
