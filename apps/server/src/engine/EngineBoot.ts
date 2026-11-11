/**
 * EngineBoot: the engine's start, in order, in two steps.
 *
 * The boot reads and rewrites this Mate's records; nothing of it acts outside the state directory:
 *
 * 1. A new boot id; the platform's restart evidence, read once.
 * 2. Every owner's record is read as this version folds it, so a snapshot of another state version
 *    is rewritten now (`EngineStore.load`): a record this version cannot read is found at boot.
 * 3. Replay-safe work another boot was running goes back to its queue (an admission, an import).
 * 4. Every conversation the restart touched — process-bound work left behind, a live run, a
 *    session still open — is told `Recovered`, with typed platform restart evidence: what was
 *    cut is recorded, a live run ends cut by the restart, its continuation is armed when its guards
 *    pass (no newer person message, no Stop, no archive, no maintenance turn), and every open
 *    session is closed, since its process died with the server. `Recovered` only commits events
 *    and outbox rows and arms wakes: the effects and wakes it leaves run once the engine opens.
 *
 * Each page of events a load folds is one unit of the boot receipt's progress (`EngineStore.load`),
 * so the reads keep it moving however many records there are. A record that cannot be read or told
 * is, in a strict boot (one an update's commit waits on), the boot's failure: the update is then
 * rolled back onto the state it copied. Otherwise it is logged, and a conversation that cannot be
 * told is retried on its own with backoff once the engine opens; its cut work is closed first, so
 * none of it runs meanwhile.
 *
 * The opening acts outward and cannot fail: the pump drains the subscription its layer made, the
 * scheduler fires what came due, the worker takes the outbox, deferred recoveries are retried.
 *
 * An idle session is the engine's own to close: a run that
 * ends with nothing queued arms a `session-idle` wake, and its close keeps a session whose
 * background work still lives.
 *
 * @module engine/EngineBoot
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import { ConversationId, RunId, type BootId } from "@t3tools/contracts";

import { Conversations } from "./Conversations.ts";
import { tailOf } from "./domain/state.ts";
import { makeEffectWorker, type EffectWorkerOptions } from "./outbox/EffectWorker.ts";
import { RestartEvidence } from "./ports.ts";
import { EngineStoreError } from "./store/EngineStore.ts";
import { TurnPump } from "./pump/TurnPump.ts";
import { makeWakeScheduler } from "./wakes/WakeScheduler.ts";

export interface BootReport {
  readonly bootId: BootId;
  /** Owner records read at boot. */
  readonly read: number;
  /** Replay-safe effects put back in their queues. */
  readonly requeued: number;
  /** Conversations told `Recovered`. */
  readonly recovered: number;
  /** Conversations that could not be told yet: each is retried on its own. */
  readonly deferred: number;
}

export interface EngineBootOptions {
  readonly worker?: EffectWorkerOptions;
  /** A record that cannot be read or told fails the boot instead of waiting for a retry. */
  readonly strict?: boolean;
}

/** The booted engine: what its boot did, and its opening, run in the engine's scope. */
export interface BootedEngine {
  readonly report: BootReport;
  readonly open: Effect.Effect<void, never, Scope.Scope>;
}

export const bootEngine = (bootId: BootId, options: EngineBootOptions = {}) =>
  Effect.gen(function* () {
    const pump = yield* TurnPump;
    const conversations = yield* Conversations;
    const restart = yield* RestartEvidence;
    const sql = yield* SqlClient.SqlClient;
    const facts = yield* restart.read;
    const bootAt = yield* Clock.currentTimeMillis;
    const worker = yield* makeEffectWorker(bootId, options.worker);
    const scheduler = yield* makeWakeScheduler();
    // The conversation's last commit is its last sign of life before the restart.
    const restartFor = (conversation: ConversationId) =>
      sql<{ readonly updated_at: number }>`
        SELECT updated_at FROM engine_conversation WHERE conversation_id = ${conversation}
      `.pipe(
        Effect.map((rows) =>
          restart.explain(facts, { lastActivityAt: rows[0]?.updated_at ?? bootAt, bootAt }),
        ),
        Effect.orElseSucceed(() => undefined),
      );
    // The end of a long answer the restart cut, from its whole text: its body holds 16 KiB.
    const lastWordsFor = (conversation: ConversationId) =>
      sql<{ readonly run_id: string | null; readonly detail: string | null }>`
        SELECT i.run_id, d.body AS detail FROM engine_item i
        LEFT JOIN engine_item_detail d ON d.item_id = i.item_id
        WHERE i.conversation_id = ${conversation} AND i.kind = 'note'
          AND json_extract(i.by_json, '$.kind') = 'mate'
        ORDER BY i.opened_seq DESC LIMIT 1
      `.pipe(
        Effect.map((rows) => {
          const row = rows[0];
          return row?.run_id == null || row.detail === null
            ? undefined
            : { runId: RunId.make(row.run_id), tail: tailOf(row.detail) };
        }),
        Effect.orElseSucceed(() => undefined),
      );
    const owners = yield* sql<{ readonly conversation_id: string }>`
      SELECT conversation_id FROM engine_conversation ORDER BY conversation_id
    `.pipe(Effect.mapError((cause) => new EngineStoreError({ operation: "boot", cause })));
    for (const row of owners) {
      const owner = ConversationId.make(row.conversation_id);
      const read = yield* Effect.exit(conversations.read(owner));
      if (read._tag === "Failure") {
        if (options.strict === true) return yield* Effect.failCause(read.cause);
        yield* Effect.logWarning("engine boot: a record could not be read", {
          conversation: owner,
          cause: read.cause,
        });
      }
    }
    const { deferred, ...reconciled } = yield* worker.reconcileAtBoot(restartFor, lastWordsFor);
    if (options.strict === true && deferred.length > 0) {
      return yield* new EngineStoreError({
        operation: "boot",
        cause: new Error(`${deferred.length} conversation(s) could not be recovered`),
      });
    }
    const report = {
      bootId,
      read: owners.length,
      ...reconciled,
      deferred: deferred.length,
    } satisfies BootReport;
    const open = Effect.gen(function* () {
      yield* pump.start;
      yield* scheduler.start;
      yield* worker.start;
      // A conversation that could not be recovered is told again on its own; the engine runs.
      yield* worker.retryRecoveries(deferred);
    });
    return { report, open } satisfies BootedEngine;
  });
