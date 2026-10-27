import { describe, expect, it } from "@effect/vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as RelayDb from "../db.ts";
import { relayApnsDeliveryJobs } from "../persistence/schema.ts";
import * as ApnsDeliveryJobStore from "./ApnsDeliveryJobStore.ts";
import type { SignedApnsDeliveryJob } from "./apnsDeliveryJobs.ts";

const signedJob: SignedApnsDeliveryJob = {
  algorithm: "hmac-sha256",
  payload: {
    version: 1,
    jobId: "job-1",
    kind: "push_notification",
    target: { userId: "user-1", deviceId: "device-1", token: "push-token" },
    aggregate: null,
    notification: {
      title: "Thread",
      body: "Input: Project",
      environmentId: "env-1",
      threadId: "thread-1",
      deepLink: "/threads/env-1/thread-1",
    },
    createdAt: "1970-01-01T00:00:00.000Z",
    expiresAt: "1970-01-01T00:10:00.000Z",
  },
  signature: "signature",
};

function layerWithDb(
  db: RelayDb.RelayDb["Service"],
  transactions?: RelayDb.RelayTransactions["Service"],
) {
  return ApnsDeliveryJobStore.layer.pipe(
    Layer.provide(Layer.succeed(RelayDb.RelayDb, db)),
    Layer.provide(
      Layer.succeed(
        RelayDb.RelayTransactions,
        transactions ?? { withTransaction: (effect) => effect },
      ),
    ),
  );
}

describe("ApnsDeliveryJobStore backoff/dead-letter policy", () => {
  it("grows exponentially and caps at 10 minutes", () => {
    expect(ApnsDeliveryJobStore.backoffDelayMs(1)).toBe(30_000);
    expect(ApnsDeliveryJobStore.backoffDelayMs(2)).toBe(60_000);
    expect(ApnsDeliveryJobStore.backoffDelayMs(3)).toBe(120_000);
    expect(ApnsDeliveryJobStore.backoffDelayMs(4)).toBe(240_000);
    expect(ApnsDeliveryJobStore.backoffDelayMs(5)).toBe(480_000);
    expect(ApnsDeliveryJobStore.backoffDelayMs(6)).toBe(600_000);
    expect(ApnsDeliveryJobStore.backoffDelayMs(20)).toBe(600_000);
  });

  it("dead-letters once attempts reach the maximum", () => {
    expect(ApnsDeliveryJobStore.isDeadLetterAttempt(1)).toBe(false);
    expect(ApnsDeliveryJobStore.isDeadLetterAttempt(4)).toBe(false);
    expect(ApnsDeliveryJobStore.isDeadLetterAttempt(5)).toBe(true);
    expect(ApnsDeliveryJobStore.isDeadLetterAttempt(6)).toBe(true);
  });
});

describe("ApnsDeliveryJobStore.enqueue", () => {
  it.effect("dedupes on jobId via onConflictDoNothing, without failing on a repeat", () => {
    const calls: Array<string> = [];
    let insertedValues: Record<string, unknown> | null = null;
    let conflictTarget: unknown = null;
    const fakeDb = {
      insert: (table: unknown) => {
        expect(table).toBe(relayApnsDeliveryJobs);
        calls.push("insert");
        return {
          values: (values: Record<string, unknown>) => {
            insertedValues = values;
            calls.push("insert.values");
            return {
              onConflictDoNothing: (options: { readonly target: unknown }) => {
                conflictTarget = options.target;
                calls.push("insert.onConflictDoNothing");
                return Effect.void;
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const store = yield* ApnsDeliveryJobStore.ApnsDeliveryJobs;
      yield* store.enqueue(signedJob);

      expect(calls).toEqual(["insert", "insert.values", "insert.onConflictDoNothing"]);
      expect(insertedValues).toMatchObject({
        jobId: "job-1",
        state: "queued",
        attempts: 0,
        leaseUntil: null,
      });
      expect(conflictTarget).toBe(relayApnsDeliveryJobs.jobId);
    }).pipe(Effect.provide(layerWithDb(fakeDb)));
  });
});

describe("ApnsDeliveryJobStore.leaseNext", () => {
  it.effect("returns null and never updates when no job is due", () => {
    const updateCalled: Array<unknown> = [];
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayApnsDeliveryJobs);
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  for: () => Effect.succeed([]),
                }),
              }),
            }),
          };
        },
      }),
      update: () => {
        updateCalled.push("update");
        return Effect.die("update should not be called when no job is due");
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const store = yield* ApnsDeliveryJobStore.ApnsDeliveryJobs;
      const leased = yield* store.leaseNext;
      expect(leased).toBeNull();
      expect(updateCalled).toHaveLength(0);
    }).pipe(Effect.provide(layerWithDb(fakeDb)));
  });

  it.effect("atomically claims the due job: marks it leased and returns its payload", () => {
    const setValues: Array<Record<string, unknown>> = [];
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayApnsDeliveryJobs);
          return {
            where: () => ({
              orderBy: () => ({
                limit: () => ({
                  for: (mode: string, options: { readonly skipLocked: boolean }) => {
                    expect(mode).toBe("update");
                    expect(options.skipLocked).toBe(true);
                    return Effect.succeed([
                      { jobId: "job-1", payloadJson: signedJob, attempts: 2 },
                    ]);
                  },
                }),
              }),
            }),
          };
        },
      }),
      update: (table: unknown) => {
        expect(table).toBe(relayApnsDeliveryJobs);
        return {
          set: (values: Record<string, unknown>) => {
            setValues.push(values);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return Effect.void;
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const store = yield* ApnsDeliveryJobStore.ApnsDeliveryJobs;
      const leased = yield* store.leaseNext;

      expect(leased).toEqual({ jobId: "job-1", payload: signedJob, attempts: 2 });
      expect(setValues).toHaveLength(1);
      expect(setValues[0]?.state).toBe("leased");
      expect(typeof setValues[0]?.leaseUntil).toBe("string");
      expect(whereConditions).toHaveLength(1);
    }).pipe(Effect.provide(layerWithDb(fakeDb)));
  });

  it.effect("leases inside RelayTransactions.withTransaction, not a bare query", () => {
    let transactionEntered = false;
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => ({
                for: () => Effect.succeed([]),
              }),
            }),
          }),
        }),
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const store = yield* ApnsDeliveryJobStore.ApnsDeliveryJobs;
      yield* store.leaseNext;
      expect(transactionEntered).toBe(true);
    }).pipe(
      Effect.provide(
        layerWithDb(fakeDb, {
          withTransaction: (effect) => {
            transactionEntered = true;
            return effect;
          },
        }),
      ),
    );
  });
});

describe("ApnsDeliveryJobStore.complete", () => {
  it.effect("marks the job done and clears its lease", () => {
    const setValues: Array<Record<string, unknown>> = [];
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayApnsDeliveryJobs);
        return {
          set: (values: Record<string, unknown>) => {
            setValues.push(values);
            return { where: () => Effect.void };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const store = yield* ApnsDeliveryJobStore.ApnsDeliveryJobs;
      yield* store.complete("job-1");
      expect(setValues).toEqual([
        { state: "done", leaseUntil: null, updatedAt: expect.any(String) },
      ]);
    }).pipe(Effect.provide(layerWithDb(fakeDb)));
  });
});

describe("ApnsDeliveryJobStore.fail", () => {
  it.effect("retries with exponential backoff below the attempt ceiling", () =>
    Effect.gen(function* () {
      const setValues: Array<Record<string, unknown>> = [];
      const fakeDb = {
        update: () => ({
          set: (values: Record<string, unknown>) => {
            setValues.push(values);
            return { where: () => Effect.void };
          },
        }),
      } as unknown as RelayDb.RelayDb["Service"];

      yield* Effect.gen(function* () {
        const store = yield* ApnsDeliveryJobStore.ApnsDeliveryJobs;
        yield* store.fail({ jobId: "job-1", attemptsSoFar: 1, error: "APNs 500" });
      }).pipe(Effect.provide(layerWithDb(fakeDb)));

      expect(setValues).toHaveLength(1);
      expect(setValues[0]).toMatchObject({
        state: "queued",
        attempts: 2,
        leaseUntil: null,
        lastError: "APNs 500",
      });
      // attempt 2 backs off 60s from epoch (TestClock starts at 1970-01-01T00:00:00Z).
      expect(setValues[0]?.availableAt).toBe("1970-01-01T00:01:00.000Z");
    }),
  );

  it.effect("dead-letters once attempts reach the maximum", () =>
    Effect.gen(function* () {
      const setValues: Array<Record<string, unknown>> = [];
      const fakeDb = {
        update: () => ({
          set: (values: Record<string, unknown>) => {
            setValues.push(values);
            return { where: () => Effect.void };
          },
        }),
      } as unknown as RelayDb.RelayDb["Service"];

      yield* Effect.gen(function* () {
        const store = yield* ApnsDeliveryJobStore.ApnsDeliveryJobs;
        yield* store.fail({ jobId: "job-1", attemptsSoFar: 4, error: "APNs 500" });
      }).pipe(Effect.provide(layerWithDb(fakeDb)));

      expect(setValues).toHaveLength(1);
      expect(setValues[0]).toMatchObject({ state: "dead", attempts: 5, lastError: "APNs 500" });
    }),
  );
});

describe("ApnsDeliveryJobStore.recoverExpiredLeases", () => {
  it.effect("requeues leases past their lease_until (fake clock)", () =>
    Effect.gen(function* () {
      // Advance past LEASE_DURATION_MS so a lease taken "now" would already
      // have expired by the time recovery runs.
      yield* TestClock.adjust(Duration.millis(ApnsDeliveryJobStore.LEASE_DURATION_MS + 1_000));
      const now = yield* DateTime.now;

      let capturedCondition: unknown = null;
      let setValues: Record<string, unknown> | null = null;
      const fakeDb = {
        update: (table: unknown) => {
          expect(table).toBe(relayApnsDeliveryJobs);
          return {
            set: (values: Record<string, unknown>) => {
              setValues = values;
              return {
                where: (condition: unknown) => {
                  capturedCondition = condition;
                  return {
                    returning: () => Effect.succeed([{ jobId: "job-1" }, { jobId: "job-2" }]),
                  };
                },
              };
            },
          };
        },
      } as unknown as RelayDb.RelayDb["Service"];

      const recovered = yield* Effect.gen(function* () {
        const store = yield* ApnsDeliveryJobStore.ApnsDeliveryJobs;
        return yield* store.recoverExpiredLeases;
      }).pipe(Effect.provide(layerWithDb(fakeDb)));

      expect(recovered).toBe(2);
      expect(setValues).toMatchObject({ state: "queued", leaseUntil: null });
      expect(capturedCondition).toBeDefined();

      const query = new PgDialect().sqlToQuery(capturedCondition as never);
      expect(query.sql).toContain('"relay_apns_delivery_jobs"."state" = $1');
      expect(query.sql).toContain('"relay_apns_delivery_jobs"."lease_until" is not null');
      expect(query.sql).toContain('"relay_apns_delivery_jobs"."lease_until" < $2');
      expect(query.params).toEqual(["leased", DateTime.formatIso(now)]);
    }),
  );
});

describe("ApnsDeliveryJobStore.expireStale", () => {
  it.effect("dead-letters queued jobs older than 24 hours", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust(Duration.millis(ApnsDeliveryJobStore.JOB_EXPIRY_MS + 1_000));

      let capturedCondition: unknown = null;
      const fakeDb = {
        update: (table: unknown) => {
          expect(table).toBe(relayApnsDeliveryJobs);
          return {
            set: () => ({
              where: (condition: unknown) => {
                capturedCondition = condition;
                return { returning: () => Effect.succeed([{ jobId: "job-1" }]) };
              },
            }),
          };
        },
      } as unknown as RelayDb.RelayDb["Service"];

      const expired = yield* Effect.gen(function* () {
        const store = yield* ApnsDeliveryJobStore.ApnsDeliveryJobs;
        return yield* store.expireStale;
      }).pipe(Effect.provide(layerWithDb(fakeDb)));

      expect(expired).toBe(1);
      const query = new PgDialect().sqlToQuery(capturedCondition as never);
      expect(query.sql).toContain('"relay_apns_delivery_jobs"."state" = $1');
      expect(query.sql).toContain('"relay_apns_delivery_jobs"."created_at" < $2');
      expect(query.params[0]).toBe("queued");
    }),
  );
});
