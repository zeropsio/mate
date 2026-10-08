/**
 * EffectWorker: fibers over the outbox. Each claims a row, finds the handler for its kind, lets
 * the handler adopt prior evidence (a previous attempt that landed before a crash) before it acts,
 * and sends a terminal outcome back as `EffectSettled` through the owner's actor, which records it
 * in the same transaction as its consequences. The outcome is written to its row first, so a tell
 * that fails is told again (with backoff, and at boot) instead of leaving the row running. A
 * replay-safe handler's failure backs off and retries; past the attempt limit it fails for good.
 * A process-bound handler's failure is its outcome: it may have acted, so it is never tried again.
 * A fiber sleeps until the next row comes due or the actor rings.
 *
 * Boot reconcile runs before the worker starts: replay-safe rows are requeued, and every
 * conversation with process-bound work left behind, a live run or an open session is told
 * `Recovered`.
 *
 * @module engine/outbox/EffectWorker
 */
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import type { MateRestart, BootId, ConversationId, EffectOutcome } from "@t3tools/contracts";

import type { StepFailure } from "../ConversationActor.ts";
import { Conversations } from "../Conversations.ts";
import { effectSettledCommandId, recoveredCommandId } from "../domain/ids.ts";
import { EngineSignals } from "../EngineSignals.ts";
import type { EngineStoreError } from "../store/EngineStore.ts";
import { EffectOutbox, type EffectRow } from "./EffectOutbox.ts";

/** What a handler's attempt came to. */
export type HandlerResult =
  | { readonly _tag: "Done"; readonly outcome: EffectOutcome }
  | { readonly _tag: "Retry"; readonly reason: string };

export interface EffectHandler {
  readonly kind: string;
  /** Evidence the effect already happened; when found, the worker settles with it and never acts. */
  readonly adopt?: (row: EffectRow) => Effect.Effect<Option.Option<EffectOutcome>>;
  readonly run: (row: EffectRow) => Effect.Effect<HandlerResult>;
}

/** The handlers by effect kind. Provider handlers register here later; tests register their own. */
export class EffectHandlers extends Context.Service<
  EffectHandlers,
  ReadonlyMap<string, EffectHandler>
>()("t3/engine/outbox/EffectWorker/EffectHandlers") {}

export const handlersOf = (...handlers: ReadonlyArray<EffectHandler>) =>
  new Map(handlers.map((handler) => [handler.kind, handler]));

/** A recovery the boot could not tell is told again after `min(5 min, 1 s · 2^(n − 1))`. */
export const recoveryRetryMs = (attempt: number): number =>
  Math.min(5 * 60_000, 1_000 * 2 ** Math.max(0, attempt - 1));

export interface EffectWorkerOptions {
  readonly concurrency?: number;
  readonly maxAttempts?: number;
  /** The longest a fiber sleeps without a ring. */
  readonly pollMillis?: number;
}

const ENGINE = { kind: "engine" } as const;

export const makeEffectWorker = Effect.fn("makeEffectWorker")(function* (
  boot: BootId,
  options: EffectWorkerOptions = {},
) {
  const outbox = yield* EffectOutbox;
  const conversations = yield* Conversations;
  const handlers = yield* EffectHandlers;
  const signals = yield* EngineSignals;
  const maxAttempts = options.maxAttempts ?? 5;
  const pollMillis = options.pollMillis ?? 30_000;

  const attempt = (row: EffectRow): Effect.Effect<HandlerResult> => {
    const handler = handlers.get(row.kind);
    if (handler === undefined) {
      return Effect.succeed({
        _tag: "Done",
        outcome: { kind: "failed", reason: `no handler for ${row.kind}` },
      });
    }
    // A process-bound handler that failed may already have acted (a message may be out), so it is
    // never tried again: its failure is the outcome. A replay-safe one is retried.
    // An interruption (the server stopping) is no outcome: the next boot cuts or requeues it.
    const act = handler
      .run(row)
      .pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.failCause(cause as Cause.Cause<never>)
            : Effect.succeed<HandlerResult>(
                row.class === "process-bound"
                  ? { _tag: "Done", outcome: { kind: "failed", reason: String(cause) } }
                  : { _tag: "Retry", reason: String(cause) },
              ),
        ),
      );
    if (handler.adopt === undefined) return act;
    return handler.adopt(row).pipe(
      Effect.catchCause(() => Effect.succeed(Option.none<EffectOutcome>())),
      Effect.flatMap(
        Option.match({
          onNone: () => act,
          onSome: (outcome) => Effect.succeed<HandlerResult>({ _tag: "Done", outcome }),
        }),
      ),
    );
  };

  /** Tells the owner an outcome already written to its row; a failed tell is told again later. */
  const tell = Effect.fnUntraced(function* (row: EffectRow, outcome: EffectOutcome) {
    // A failed commit reloads the actor's state, so the same settle is retried as it is.
    const told = yield* Effect.exit(
      Effect.retry(
        conversations.tell({
          commandId: effectSettledCommandId(row.effectId),
          conversationId: row.conversationId,
          principal: ENGINE,
          command: { _tag: "EffectSettled", effectId: row.effectId, outcome },
        }),
        { times: 3 },
      ),
    );
    if (told._tag === "Failure") {
      yield* Effect.logWarning("engine effect outcome not recorded yet", told.cause);
      yield* outbox.settleLater(row, yield* Clock.currentTimeMillis);
      return;
    }
    // The owner no longer tracks it (a bug or a lost state): close the row so its lane moves on.
    if (told.value._tag === "Rejected") {
      yield* outbox.close(
        row.effectId,
        outcome.kind === "ok" ? "done" : outcome.kind === "cut" ? "cut" : "failed",
        `settle rejected: ${told.value.rejection.reason}`,
      );
    }
  });

  const settle = Effect.fnUntraced(function* (row: EffectRow, outcome: EffectOutcome) {
    yield* outbox.settling(row.effectId, outcome, yield* Clock.currentTimeMillis);
    yield* tell(row, outcome);
  });

  /** Tells one settling row again, if one is due; false when none was. */
  const sweepOnce = (now: number) =>
    Effect.gen(function* () {
      const due = yield* outbox.nextSettling(now);
      if (Option.isNone(due) || due.value.outcome === null) return false;
      yield* tell(due.value, due.value.outcome);
      return true;
    });

  /** Tells a settling row again or claims and processes one row; false when nothing was due. */
  const runOnce = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (yield* sweepOnce(now)) return true;
    const claimed = yield* outbox.claim(boot, now);
    if (Option.isNone(claimed)) return false;
    const row = claimed.value;
    const result = yield* Effect.uninterruptible(attempt(row));
    if (result._tag === "Retry") {
      if (row.attempt >= maxAttempts) {
        yield* settle(row, { kind: "failed", reason: result.reason });
      } else {
        yield* outbox.retry(row, yield* Clock.currentTimeMillis, result.reason);
      }
      return true;
    }
    yield* settle(row, result.outcome);
    return true;
  });

  const idle = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const next = yield* outbox.nextAvailableAt;
    const sleep = Option.match(next, {
      onNone: () => pollMillis,
      onSome: (at) => Math.max(0, Math.min(pollMillis, at - now)),
    });
    yield* Effect.raceFirst(Effect.sleep(sleep), signals.effects.wait);
  });

  const loop = Effect.gen(function* () {
    yield* signals.effects.arm;
    const worked = yield* runOnce;
    if (!worked) yield* idle;
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("engine effect worker step failed", cause).pipe(
        Effect.andThen(Effect.sleep(1_000)),
      ),
    ),
    Effect.forever,
  );

  /**
   * Boot: requeue replay-safe rows, tell each conversation the restart touched what it cut and
   * what never started (with the platform's words for the restart, when it has some), and close
   * those rows.
   */
  const reconcileAtBoot = (
    restartFor: (conversation: ConversationId) => Effect.Effect<MateRestart | undefined> = () =>
      Effect.succeed(undefined),
  ) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const requeued = yield* outbox.requeueReplaySafe(boot, now);
      // Outcomes decided before the restart are recorded before anything is cut.
      for (let told = 0; told < 10_000; told++) {
        if (!(yield* sweepOnce(Number.POSITIVE_INFINITY))) break;
      }
      const owners = yield* outbox.recoveryOwners(boot);
      const deferred: Array<Effect.Effect<void, StepFailure | EngineStoreError>> = [];
      for (const owner of owners) {
        // Its process-bound rows are cut first, so nothing of them runs while it waits.
        for (const effect of [...owner.cut, ...owner.unstarted]) {
          yield* outbox.close(effect, "cut", "the server restarted");
        }
        const restart = yield* restartFor(owner.conversationId);
        const recover = Effect.asVoid(
          conversations.tell({
            commandId: recoveredCommandId(boot, owner.conversationId),
            conversationId: owner.conversationId,
            principal: ENGINE,
            command: {
              _tag: "Recovered",
              bootId: boot,
              cutEffects: owner.cut,
              unstartedEffects: owner.unstarted,
              ...(restart === undefined ? {} : { restart }),
            },
          }),
        );
        // One conversation that cannot be told never stops the boot: it is told again later.
        const told = yield* Effect.exit(recover);
        if (told._tag === "Failure") {
          yield* Effect.logWarning("engine boot: a conversation could not be recovered yet", {
            conversation: owner.conversationId,
            cause: told.cause,
          });
          deferred.push(recover);
        }
      }
      return { requeued, recovered: owners.length - deferred.length, deferred };
    });

  /** Tells each deferred recovery again with backoff until it is taken; for the boot's scope. */
  const retryRecoveries = (
    deferred: ReadonlyArray<Effect.Effect<void, StepFailure | EngineStoreError>>,
  ) =>
    Effect.forEach(
      deferred,
      (recover) =>
        Effect.forkScoped(
          Effect.gen(function* () {
            for (let attempt = 1; ; attempt++) {
              yield* Effect.sleep(recoveryRetryMs(attempt));
              const told = yield* Effect.exit(recover);
              if (told._tag === "Success") return;
              if (attempt % 10 === 0) {
                yield* Effect.logWarning("engine: a conversation still cannot be recovered", {
                  attempt,
                  cause: told.cause,
                });
              }
            }
          }),
        ),
      { discard: true },
    );

  return {
    runOnce,
    reconcileAtBoot,
    retryRecoveries,
    /** Starts the fibers in the caller's scope. */
    start: Effect.forEach(
      Array.from({ length: options.concurrency ?? 4 }),
      () => Effect.forkScoped(loop),
      { discard: true },
    ) as Effect.Effect<void, never, Scope.Scope>,
  };
});
