/**
 * Durable, Postgres-backed replacement for the Cloudflare APNs delivery
 * queue. A job is inserted here (state `queued`) before the publish request
 * that enqueued it is acknowledged — `enqueue` is the send-side seam
 * `ApnsDeliveryQueueSender.send` binds to. A worker loop (`ApnsDeliveryWorker.ts`)
 * leases the next due job with `SELECT ... FOR UPDATE SKIP LOCKED`, processes
 * it through the unchanged `ApnsDeliveries.processSignedJob`, and reports
 * success/failure back here.
 *
 * @module ApnsDeliveryJobStore
 */
import { and, asc, eq, isNotNull, lt, lte, sql as drizzleSql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { SignedApnsDeliveryJob } from "./apnsDeliveryJobs.ts";
import * as RelayDb from "../db.ts";
import { relayApnsDeliveryJobs, type RelayApnsDeliveryJobState } from "../persistence/schema.ts";

/** Attempts (including the first) before a job is dead-lettered. */
export const MAX_DELIVERY_ATTEMPTS = 5;
/** How long a lease protects a job from being picked up by another worker. */
export const LEASE_DURATION_MS = 60_000;
/** A `queued` job older than this without ever having been leased is dead. */
export const JOB_EXPIRY_MS = 24 * 60 * 60 * 1_000;

/**
 * Exponential backoff before a failed job becomes eligible again: 30s, 60s,
 * 120s, 240s — capped at 10 minutes so a long-failing device doesn't push its
 * retries out for hours.
 */
export function backoffDelayMs(attemptsSoFar: number): number {
  const uncapped = 30_000 * 2 ** Math.max(0, attemptsSoFar - 1);
  return Math.min(uncapped, 10 * 60 * 1_000);
}

/** Whether a job that has now failed `attempts` times should be dead-lettered. */
export function isDeadLetterAttempt(attempts: number): boolean {
  return attempts >= MAX_DELIVERY_ATTEMPTS;
}

export class ApnsDeliveryJobPersistError extends Schema.TaggedError<ApnsDeliveryJobPersistError>()(
  "ApnsDeliveryJobPersistError",
  {
    operation: Schema.Literals([
      "enqueue",
      "lease",
      "complete",
      "fail",
      "recover-expired-leases",
      "expire-stale",
    ]),
    jobId: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `APNs delivery job persistence failed during '${this.operation}'${this.jobId ? ` for job '${this.jobId}'` : ""}.`;
  }
}

export interface LeasedApnsDeliveryJob {
  readonly jobId: string;
  readonly payload: SignedApnsDeliveryJob;
  readonly attempts: number;
}

export class ApnsDeliveryJobs extends Context.Service<
  ApnsDeliveryJobs,
  {
    /** Inserts a job as `queued`, immediately available. Idempotent on `jobId`. */
    readonly enqueue: (
      job: SignedApnsDeliveryJob,
    ) => Effect.Effect<void, ApnsDeliveryJobPersistError>;
    /** Atomically claims the oldest due `queued` job, or `null` if none is due. */
    readonly leaseNext: Effect.Effect<LeasedApnsDeliveryJob | null, ApnsDeliveryJobPersistError>;
    readonly complete: (jobId: string) => Effect.Effect<void, ApnsDeliveryJobPersistError>;
    /** Records a failed attempt: retries with backoff, or dead-letters past `MAX_DELIVERY_ATTEMPTS`. */
    readonly fail: (input: {
      readonly jobId: string;
      readonly attemptsSoFar: number;
      readonly error: string;
    }) => Effect.Effect<void, ApnsDeliveryJobPersistError>;
    /** Resets leases past their `lease_until` back to `queued`; returns the count recovered. */
    readonly recoverExpiredLeases: Effect.Effect<number, ApnsDeliveryJobPersistError>;
    /** Dead-letters `queued` jobs older than {@link JOB_EXPIRY_MS}; returns the count expired. */
    readonly expireStale: Effect.Effect<number, ApnsDeliveryJobPersistError>;
  }
>()("t3code-relay/agentActivity/ApnsDeliveryJobStore/ApnsDeliveryJobs") {}

export const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;
  const transactions = yield* RelayDb.RelayTransactions;

  const enqueue: ApnsDeliveryJobs["Service"]["enqueue"] = Effect.fn(
    "relay.apns_delivery_jobs.enqueue",
  )(function* (job) {
    yield* Effect.annotateCurrentSpan({ "relay.delivery.job_id": job.payload.jobId });
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* db
      .insert(relayApnsDeliveryJobs)
      .values({
        jobId: job.payload.jobId,
        payloadJson: job,
        availableAt: now,
        leaseUntil: null,
        attempts: 0,
        state: "queued",
        lastError: null,
        createdAt: now,
        updatedAt: now,
      })
      // Dedupe: a job id already present (e.g. a caller retry) is a no-op —
      // the original enqueue already committed and will be delivered.
      .onConflictDoNothing({ target: relayApnsDeliveryJobs.jobId })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ApnsDeliveryJobPersistError({
              operation: "enqueue",
              jobId: job.payload.jobId,
              cause,
            }),
        ),
      );
  });

  const leaseNext: ApnsDeliveryJobs["Service"]["leaseNext"] = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const nowIso = DateTime.formatIso(now);
    const leaseUntilIso = DateTime.formatIso(
      DateTime.add(now, { milliseconds: LEASE_DURATION_MS }),
    );
    return yield* transactions
      .withTransaction(
        Effect.gen(function* () {
          const candidates = yield* db
            .select({
              jobId: relayApnsDeliveryJobs.jobId,
              payloadJson: relayApnsDeliveryJobs.payloadJson,
              attempts: relayApnsDeliveryJobs.attempts,
            })
            .from(relayApnsDeliveryJobs)
            .where(
              and(
                eq(relayApnsDeliveryJobs.state, "queued"),
                lte(relayApnsDeliveryJobs.availableAt, nowIso),
              ),
            )
            .orderBy(asc(relayApnsDeliveryJobs.availableAt))
            .limit(1)
            .for("update", { skipLocked: true });
          const candidate = candidates[0];
          if (!candidate) {
            return null;
          }
          yield* db
            .update(relayApnsDeliveryJobs)
            .set({ state: "leased", leaseUntil: leaseUntilIso, updatedAt: nowIso })
            .where(eq(relayApnsDeliveryJobs.jobId, candidate.jobId));
          return {
            jobId: candidate.jobId,
            payload: candidate.payloadJson,
            attempts: candidate.attempts,
          } satisfies LeasedApnsDeliveryJob;
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) => new ApnsDeliveryJobPersistError({ operation: "lease", jobId: null, cause }),
        ),
      );
  }).pipe(Effect.withSpan("relay.apns_delivery_jobs.lease_next"));

  const complete: ApnsDeliveryJobs["Service"]["complete"] = Effect.fn(
    "relay.apns_delivery_jobs.complete",
  )(function* (jobId) {
    yield* Effect.annotateCurrentSpan({ "relay.delivery.job_id": jobId });
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* db
      .update(relayApnsDeliveryJobs)
      .set({ state: "done", leaseUntil: null, updatedAt: now })
      .where(eq(relayApnsDeliveryJobs.jobId, jobId))
      .pipe(
        Effect.mapError(
          (cause) => new ApnsDeliveryJobPersistError({ operation: "complete", jobId, cause }),
        ),
      );
  });

  const fail: ApnsDeliveryJobs["Service"]["fail"] = Effect.fn("relay.apns_delivery_jobs.fail")(
    function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.delivery.job_id": input.jobId });
      const attempts = input.attemptsSoFar + 1;
      const now = yield* DateTime.now;
      const nowIso = DateTime.formatIso(now);
      const dead = isDeadLetterAttempt(attempts);
      const state: RelayApnsDeliveryJobState = dead ? "dead" : "queued";
      const availableAt = dead
        ? nowIso
        : DateTime.formatIso(DateTime.add(now, { milliseconds: backoffDelayMs(attempts) }));
      yield* db
        .update(relayApnsDeliveryJobs)
        .set({
          state,
          attempts,
          availableAt,
          leaseUntil: null,
          lastError: input.error,
          updatedAt: nowIso,
        })
        .where(eq(relayApnsDeliveryJobs.jobId, input.jobId))
        .pipe(
          Effect.mapError(
            (cause) =>
              new ApnsDeliveryJobPersistError({ operation: "fail", jobId: input.jobId, cause }),
          ),
        );
    },
  );

  const recoverExpiredLeases: ApnsDeliveryJobs["Service"]["recoverExpiredLeases"] = Effect.gen(
    function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      const recovered = yield* db
        .update(relayApnsDeliveryJobs)
        .set({ state: "queued", leaseUntil: null, updatedAt: now })
        .where(
          and(
            eq(relayApnsDeliveryJobs.state, "leased"),
            isNotNull(relayApnsDeliveryJobs.leaseUntil),
            lt(relayApnsDeliveryJobs.leaseUntil, now),
          ),
        )
        .returning({ jobId: relayApnsDeliveryJobs.jobId })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ApnsDeliveryJobPersistError({
                operation: "recover-expired-leases",
                jobId: null,
                cause,
              }),
          ),
        );
      return recovered.length;
    },
  ).pipe(Effect.withSpan("relay.apns_delivery_jobs.recover_expired_leases"));

  const expireStale: ApnsDeliveryJobs["Service"]["expireStale"] = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const nowIso = DateTime.formatIso(now);
    const cutoff = DateTime.formatIso(DateTime.subtract(now, { milliseconds: JOB_EXPIRY_MS }));
    const expired = yield* db
      .update(relayApnsDeliveryJobs)
      .set({
        state: "dead",
        leaseUntil: null,
        lastError: drizzleSql`coalesce(${relayApnsDeliveryJobs.lastError}, 'Job expired after 24 hours unclaimed.')`,
        updatedAt: nowIso,
      })
      .where(
        and(eq(relayApnsDeliveryJobs.state, "queued"), lt(relayApnsDeliveryJobs.createdAt, cutoff)),
      )
      .returning({ jobId: relayApnsDeliveryJobs.jobId })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ApnsDeliveryJobPersistError({ operation: "expire-stale", jobId: null, cause }),
        ),
      );
    return expired.length;
  }).pipe(Effect.withSpan("relay.apns_delivery_jobs.expire_stale"));

  return ApnsDeliveryJobs.of({
    enqueue,
    leaseNext,
    complete,
    fail,
    recoverExpiredLeases,
    expireStale,
  });
});

export const layer = Layer.effect(ApnsDeliveryJobs, make);
