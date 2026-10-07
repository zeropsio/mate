/**
 * EngineBoot: the engine's start, in order.
 *
 * 1. A new boot id; the platform's restart evidence, read once.
 * 2. Replay-safe work another boot was running goes back to its queue (a capture, a release).
 * 3. Every conversation the restart touched — process-bound work left behind, a live run, a
 *    session still open — is told `Recovered`, with the restart in the platform's words: what was
 *    cut is recorded, a live run ends cut by the restart, its continuation is armed when its guards
 *    pass (no newer person message, no Stop, no archive, no maintenance turn), and every open
 *    session is closed, since its process died with the server.
 * 4. Then the pump drains the subscription its layer made, the scheduler fires what came due, and
 *    the worker takes the outbox.
 *
 * An idle session is the engine's own to close (V1's reaper is parked in mate mode): a run that
 * ends with nothing queued arms a `session-idle` wake, and its close keeps a session whose
 * background work still lives.
 *
 * @module engine/EngineBoot
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { BootId, ConversationId } from "@t3tools/contracts";

import { makeEffectWorker, type EffectWorkerOptions } from "./outbox/EffectWorker.ts";
import { RestartEvidence } from "./ports.ts";
import { TurnPump } from "./pump/TurnPump.ts";
import { makeWakeScheduler } from "./wakes/WakeScheduler.ts";

export interface BootReport {
  readonly bootId: BootId;
  /** Replay-safe effects put back in their queues. */
  readonly requeued: number;
  /** Conversations told `Recovered`. */
  readonly recovered: number;
}

export const bootEngine = (
  bootId: BootId,
  options: { readonly worker?: EffectWorkerOptions } = {},
) =>
  Effect.gen(function* () {
    const pump = yield* TurnPump;
    const restart = yield* RestartEvidence;
    const sql = yield* SqlClient.SqlClient;
    const facts = yield* restart.read;
    const bootAt = yield* Clock.currentTimeMillis;
    const worker = yield* makeEffectWorker(bootId, options.worker);
    const scheduler = yield* makeWakeScheduler();
    // The conversation's last commit is its last sign of life before the restart.
    const wordsFor = (conversation: ConversationId) =>
      sql<{ readonly updated_at: number }>`
        SELECT updated_at FROM engine_conversation WHERE conversation_id = ${conversation}
      `.pipe(
        Effect.map((rows) =>
          restart.explain(facts, { lastActivityAt: rows[0]?.updated_at ?? bootAt, bootAt }),
        ),
        Effect.orElseSucceed(() => undefined),
      );
    const reconciled = yield* worker.reconcileAtBoot(wordsFor);
    yield* pump.start;
    yield* scheduler.start;
    yield* worker.start;
    return { bootId, ...reconciled } satisfies BootReport;
  });
