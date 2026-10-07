/**
 * EffectWorker: fibers over the outbox. Each claims a row, finds the handler for its kind, lets
 * the handler adopt prior evidence (a previous attempt that landed before a crash) before it acts,
 * and sends a terminal outcome back as `EffectSettled` through the owner's actor, which records it
 * in the same transaction as its consequences. A retryable failure backs off; past the attempt
 * limit it fails for good. A fiber sleeps until the next row comes due or the actor rings.
 *
 * Boot reconcile runs before the worker starts: replay-safe rows are requeued, and every owner
 * with cut process-bound work or a live run is told `Recovered`.
 *
 * @module engine/outbox/EffectWorker
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import type { BootId, EffectOutcome } from "@t3tools/contracts";

import { Conversations } from "../Conversations.ts";
import { effectSettledCommandId, recoveredCommandId } from "../domain/ids.ts";
import { EngineSignals } from "../EngineSignals.ts";
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
    const act = handler
      .run(row)
      .pipe(
        Effect.catchCause((cause) =>
          Effect.succeed<HandlerResult>({ _tag: "Retry", reason: String(cause) }),
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

  const settle = Effect.fnUntraced(function* (row: EffectRow, outcome: EffectOutcome) {
    // A failed commit reloads the actor's state, so the same settle is retried as it is.
    const result = yield* Effect.retry(
      conversations.tell({
        commandId: effectSettledCommandId(row.effectId),
        conversationId: row.conversationId,
        principal: ENGINE,
        command: { _tag: "EffectSettled", effectId: row.effectId, outcome },
      }),
      { times: 3 },
    );
    // The owner no longer tracks it (a bug or a lost state): close the row so its lane moves on.
    if (result._tag === "Rejected") {
      yield* outbox.close(
        row.effectId,
        outcome.kind === "ok" ? "done" : outcome.kind,
        `settle rejected: ${result.rejection.reason}`,
      );
    }
  });

  /** Claims and processes one row; false when none was due. */
  const runOnce = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
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

  /** Boot: requeue replay-safe rows, tell each owner what was cut, close whatever stayed open. */
  const reconcileAtBoot = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const requeued = yield* outbox.requeueReplaySafe(boot, now);
    const owners = yield* outbox.recoveryOwners(boot);
    for (const owner of owners) {
      yield* conversations.tell({
        commandId: recoveredCommandId(boot, owner.conversationId),
        conversationId: owner.conversationId,
        principal: ENGINE,
        command: { _tag: "Recovered", bootId: boot, cutEffects: owner.cut },
      });
      for (const effect of owner.cut) {
        yield* outbox.close(effect, "cut", "the server restarted");
      }
    }
    return { requeued, recovered: owners.length };
  });

  return {
    runOnce,
    reconcileAtBoot,
    /** Starts the fibers in the caller's scope. */
    start: Effect.forEach(
      Array.from({ length: options.concurrency ?? 4 }),
      () => Effect.forkScoped(loop),
      { discard: true },
    ) as Effect.Effect<void, never, Scope.Scope>,
  };
});
