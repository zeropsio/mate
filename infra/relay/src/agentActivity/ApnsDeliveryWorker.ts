/**
 * The relay's background work, replacing two Cloudflare-native primitives:
 *
 * - The queue consumer (`Cloudflare.Queues.consumeQueueMessages`) becomes
 *   {@link workerLoop} — one polling fiber per process that leases jobs from
 *   `ApnsDeliveryJobs` and hands them to the unchanged
 *   `ApnsDeliveries.processSignedJob`.
 * - The every-5-minutes cron becomes {@link prunerLoop} — a plain interval in
 *   the same process, pruning expired DPoP nonces, terminal agent-activity
 *   rows, expired job leases, and stale queued jobs.
 *
 * @module ApnsDeliveryWorker
 */
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import * as AgentActivityRows from "./AgentActivityRows.ts";
import * as ApnsDeliveries from "./ApnsDeliveries.ts";
import * as ApnsDeliveryJobs from "./ApnsDeliveryJobStore.ts";
import * as DpopProofs from "../auth/DpopProofs.ts";

/** How long an idle worker sleeps before checking for the next due job again. */
export const WORKER_IDLE_POLL_INTERVAL = Duration.seconds(2);
export const PRUNER_INTERVAL = Duration.minutes(5);

const processLeasedJob = Effect.fn("relay.apns_delivery_worker.process_job")(function* (input: {
  readonly jobId: string;
  readonly payload: unknown;
  readonly attempts: number;
}) {
  const jobs = yield* ApnsDeliveryJobs.ApnsDeliveryJobs;
  const deliveries = yield* ApnsDeliveries.ApnsDeliveries;
  yield* Effect.annotateCurrentSpan({ "relay.delivery.job_id": input.jobId });
  yield* deliveries.processSignedJob(input.payload).pipe(
    Effect.matchEffect({
      onSuccess: () => jobs.complete(input.jobId),
      onFailure: (error) =>
        Effect.logWarning("apns delivery job failed", {
          jobId: input.jobId,
          attempts: input.attempts,
          errorTag: (error as { readonly _tag?: string })._tag ?? "Unknown",
        }).pipe(
          Effect.andThen(
            jobs.fail({
              jobId: input.jobId,
              attemptsSoFar: input.attempts,
              error: error instanceof Error ? error.message : JSON.stringify(error),
            }),
          ),
        ),
    }),
  );
});

/**
 * One fiber, run forever: lease the next due job and process it, or sleep
 * briefly when the queue is empty. Run one of these per process — with N
 * replicas that is N workers racing `SELECT ... FOR UPDATE SKIP LOCKED`,
 * which is exactly what keeps them from double-delivering the same job.
 */
export const workerLoop = Effect.gen(function* () {
  const jobs = yield* ApnsDeliveryJobs.ApnsDeliveryJobs;
  return yield* Effect.forever(
    Effect.gen(function* () {
      const leased = yield* jobs.leaseNext.pipe(
        Effect.catchTags({
          ApnsDeliveryJobPersistError: (error) =>
            Effect.logError("apns delivery job lease failed", { error }).pipe(Effect.as(null)),
        }),
      );
      if (leased === null) {
        yield* Effect.sleep(WORKER_IDLE_POLL_INTERVAL);
        return;
      }
      yield* processLeasedJob(leased);
    }),
  );
}).pipe(Effect.withSpan("relay.apns_delivery_worker.loop"));

const prunerTick = Effect.gen(function* () {
  const dpopProofs = yield* DpopProofs.DpopProofReplay;
  const activityRows = yield* AgentActivityRows.AgentActivityRows;
  const jobs = yield* ApnsDeliveryJobs.ApnsDeliveryJobs;
  const now = yield* DateTime.now;
  yield* dpopProofs.pruneExpired;
  // Terminal thread rows are kept briefly so finished agents show as
  // Done/Failed in the Live Activity; sweep them once they age out.
  yield* activityRows.pruneTerminal({
    updatedBefore: DateTime.formatIso(DateTime.subtract(now, { minutes: 30 })),
  });
  yield* jobs.recoverExpiredLeases;
  yield* jobs.expireStale;
}).pipe(
  Effect.withSpan("relay.cron.prune_expired_state"),
  Effect.catchCause((cause) => Effect.logError("relay pruner tick failed", { cause })),
);

/** Runs {@link prunerTick} immediately, then every {@link PRUNER_INTERVAL}. */
export const prunerLoop = prunerTick.pipe(Effect.repeat(Schedule.spaced(PRUNER_INTERVAL)));
