/**
 * The one-writer rule. Of all running Core instances, the one holding a Postgres advisory lock on
 * a session of its own leads; every other instance is a standby and writes nothing.
 *
 * Only the official HQ competes (`official.ts`). A session: open a connection outside the pool
 * (the lock belongs to that session), wait while this HQ is not the official one, block in
 * `pg_advisory_lock`, raise the epoch and run the pending migrations, then lead. A heartbeat on the
 * lock connection keeps checking that this session still holds the epoch and that this HQ is still
 * the official one; any failure ends the session — the connection closes, the lock is released,
 * the instance is a standby again and tries anew.
 *
 * As it gives the lead up (`release`, a deploy's SIGTERM), the leader records its newest `ok` of
 * that verdict in `hq_leader`, and a waiting instance that Zerops has not answered yet takes it as
 * its own (`Official.inherit`): a deploy's new container leads within a heartbeat of the old one's
 * release, however slow Zerops is to answer it (F18). A leader that ends without releasing records
 * nothing, and the next waits for its own verdict.
 *
 * @module leader
 */
import { completionReceipt } from "@t3tools/shared/completionReceipt";
import * as PgConnection from "@effect/sql-pg/PgConnection";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { type Migration, migrate } from "./migrations.ts";
import { Official } from "./official.ts";

/**
 * `starting` until the first session reaches the database; `standby` while connected and not
 * leading; `active` while leading; `failed` when the database cannot be reached or a migration
 * failed — the latter holds until a session leads.
 */
export type CoreState = "starting" | "standby" | "active" | "failed";

export interface LeaderStatus {
  readonly state: CoreState;
  /** The epoch this instance leads under; null unless `active`. */
  readonly epoch: number | null;
}

/**
 * What every `503` HQ answers carries: it serves nothing now — a standby, a Zerops that did not
 * answer, a failure it cannot name — and the caller tries again in this many seconds.
 */
export const RETRY_AFTER = { "retry-after": "5" } as const;

/** A write refused: this instance does not lead, or another took the lead under a later epoch. */
export class NotLeader extends Schema.TaggedError<NotLeader>()("NotLeader", {
  reason: Schema.Literals(["standby", "fenced"]),
}) {}

export class Leader extends Context.Service<
  Leader,
  {
    readonly status: Effect.Effect<LeaderStatus>;
    /** An eligibility decision or session ended; does not acknowledge a pending lock acquisition. */
    readonly nextAttempt: Effect.Effect<void>;
    /** The contender loop has terminated, including cancellation on release. */
    readonly finished: Effect.Effect<void>;
    /** The status now, then each change of it: what runs only while this Core leads follows it. */
    readonly changes: Stream.Stream<LeaderStatus>;
    /**
     * Runs `effect` in a transaction that first takes the epoch row `FOR SHARE` and checks it is
     * still this instance's. The next holder's raise waits for every such transaction, and one
     * that starts after it sees the new epoch: no write of an old leader lands after a takeover.
     */
    /**
     * Gives the lead up for good, at once — its official `ok` recorded for the next Core, the
     * session's connection closed, the lock with it, and the next Core takes it — and stays a
     * standby. For shutdown (`core.ts`).
     */
    readonly release: Effect.Effect<void>;
    /**
     * Serves nothing from now on, yet keeps the lock, so no other Core leads either — `reason`
     * says why, in `/health` — until this Core stops: what its records and git disagree on, which
     * no Core may serve (`reconcile.ts`).
     */
    readonly hold: (reason: string) => Effect.Effect<void>;
    /** Why this Core holds the lock and serves nothing, if it does. */
    readonly held: Effect.Effect<string | null>;
    readonly write: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | NotLeader | SqlError, R>;
  }
>()("@t3tools/hq/leader") {}

export interface LeaderOptions {
  readonly databaseUrl: Redacted.Redacted;
  readonly migrations: ReadonlyArray<Migration>;
  /**
   * What the migrations leave for code, run after them under the lock before this Core leads: the
   * deploy tokens kept before they were sealed (`deployKeys.ts`). Its failure is a migration's.
   */
  readonly afterMigrations?: Effect.Effect<void, SqlError, SqlClient.SqlClient>;
  /** How often the lock connection and the official verdict are checked. */
  readonly heartbeat?: Duration.Duration;
  /** A heartbeat that takes longer ends the session: the connection is presumed gone. */
  readonly heartbeatTimeout?: Duration.Duration;
  /** The pause before an ended session tries again. */
  readonly retryAfter?: Duration.Duration;
}

/** The advisory lock's key ("MATE" in ASCII); every build uses it, so old and new exclude each other. */
export const LOCK_KEY = 1_296_254_021;

/**
 * The server drops a holder it cannot reach after 3 + 2 × 3 = 9 s instead of its two-hour default,
 * so a container that vanished without closing its socket frees the lock for the next one.
 */
const SESSION_SETTINGS = [
  "SET tcp_keepalives_idle = 3",
  "SET tcp_keepalives_interval = 2",
  "SET tcp_keepalives_count = 3",
] as const;

/**
 * The status, whether its `failed` is a migration's, which only leading clears, and why this Core
 * holds the lock serving nothing (`hold`), which nothing clears.
 */
interface Internal extends LeaderStatus {
  readonly migrationFailed: boolean;
  readonly held: string | null;
}

const STANDBY: Internal = { state: "standby", epoch: null, migrationFailed: false, held: null };
const MIGRATION_FAILED: Internal = {
  state: "failed",
  epoch: null,
  migrationFailed: true,
  held: null,
};

/** The database answered: a standby, unless a migration failed before or this Core is held. */
const reached = (current: Internal): Internal =>
  current.migrationFailed || current.held !== null ? current : STANDBY;

/** The database did not answer. */
const unreachable = (current: Internal): Internal =>
  current.migrationFailed || current.held !== null
    ? current
    : { state: "failed", epoch: null, migrationFailed: false, held: null };

/** A session ended: a standby again if it had reached the database and failed nothing on the way. */
const ended = (current: Internal): Internal => (current.state === "failed" ? current : STANDBY);

class Lost {
  readonly _tag = "Lost";
}

class NotOfficial {
  readonly _tag = "NotOfficial";
}

export const leaderLayer = (
  options: LeaderOptions,
): Layer.Layer<Leader, never, SqlClient.SqlClient | Official> =>
  Layer.effect(
    Leader,
    Effect.gen(function* () {
      const heartbeat = options.heartbeat ?? Duration.seconds(2);
      const heartbeatTimeout = options.heartbeatTimeout ?? Duration.seconds(5);
      const retryAfter = options.retryAfter ?? Duration.seconds(2);
      const official = yield* Official;
      const sql = yield* SqlClient.SqlClient;
      const allowed = Effect.map(official.status, (current) => current.allowed);
      const stillOfficial = Effect.flatMap(allowed, (ok) =>
        ok ? Effect.void : Effect.fail(new NotOfficial()),
      );
      const status = yield* SubscriptionRef.make<Internal>({
        state: "starting",
        epoch: null,
        migrationFailed: false,
        held: null,
      });

      /**
       * Waits for `effect` up to the heartbeat's timeout without interrupting it: interrupting a
       * statement on a connection that does not answer sends a cancel request over a second one
       * that does not answer either. The abandoned statement ends when the session closes.
       */
      const withinTimeout = <A, E>(effect: Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          const answer = yield* Deferred.make<A, E>();
          yield* Effect.forkDetach(
            Effect.flatMap(Effect.exit(effect), (exit) => Deferred.done(answer, exit)),
          );
          return yield* Deferred.await(answer).pipe(Effect.timeout(heartbeatTimeout));
        });

      /**
       * The ok the Core that led before recorded, taken by this one while Zerops has not answered
       * it (`official.ts` `inherit`). Before a leader recorded one — a first boot, a schema without
       * the columns yet — there is none.
       */
      const inheritRecorded = sql<{
        readonly at: number | null;
        readonly project: string | null;
      }>`
        SELECT (extract(epoch FROM official_ok_at) * 1000)::float8 AS at,
               official_ok_project AS project
        FROM hq_leader WHERE id = 1`.pipe(
        Effect.flatMap(([row]) =>
          row?.at === null || row?.at === undefined || row.project === null
            ? Effect.void
            : official.inherit({ at: Number(row.at), projectId: row.project }),
        ),
        Effect.ignore,
      );

      /**
       * The newest ok this Core holds, recorded under its epoch for the next Core as it gives the
       * lead up. Only then: any write moves the database a backup set compares (`backup.ts`), and
       * the takeover that follows raises the epoch anyway.
       */
      const recordOk = Effect.gen(function* () {
        const { state, epoch } = yield* SubscriptionRef.get(status);
        const ok = yield* official.lastOk;
        if (state !== "active" || epoch === null || ok === undefined) return;
        yield* sql`
          UPDATE hq_leader
          SET official_ok_at = to_timestamp(${ok.at / 1000}::float8),
              official_ok_project = ${ok.projectId}
          WHERE id = 1 AND epoch = ${epoch}`;
      }).pipe(Effect.catch((error) => Effect.logWarning("official ok not recorded", error)));

      const readEpoch = (connection: PgConnection.PgConnection, statement: string) =>
        connection
          .query(statement)
          .pipe(Effect.map((result) => Number(String(result.rows[0]?.["epoch"]))));

      const attempts = completionReceipt();
      const session = Effect.gen(function* () {
        const connection = yield* PgConnection.make({
          url: options.databaseUrl,
          applicationName: "hq-leader",
        }).pipe(Effect.tapError(() => SubscriptionRef.update(status, unreachable)));
        yield* Effect.forEach(SESSION_SETTINGS, (statement) => connection.query(statement), {
          discard: true,
        });
        yield* SubscriptionRef.update(status, reached);
        yield* Effect.andThen(inheritRecorded, allowed).pipe(
          Effect.tap((ok) => (ok ? Effect.void : attempts.complete)),
          Effect.repeat({ schedule: Schedule.spaced(heartbeat), until: (ok) => ok }),
        );
        yield* connection.query(`SELECT pg_advisory_lock(${String(LOCK_KEY)})`);
        // The verdict may have changed while this session waited behind another holder, and the
        // holder may have recorded a newer ok as it let go.
        yield* inheritRecorded;
        yield* stillOfficial;

        // With the schema there the epoch moves first; the first boot has no table to raise yet.
        const raise = readEpoch(
          connection,
          "UPDATE hq_leader SET epoch = epoch + 1, acquired_at = now() WHERE id = 1 RETURNING epoch",
        );
        const runMigrations = migrate(options.migrations).pipe(
          Effect.andThen(options.afterMigrations ?? Effect.void),
          Effect.tapError(() => SubscriptionRef.set(status, MIGRATION_FAILED)),
        );
        const schemaThere = yield* connection
          .query("SELECT to_regclass('hq_leader') IS NOT NULL AS present")
          .pipe(Effect.map((result) => result.rows[0]?.["present"] === true));
        const epoch = schemaThere
          ? yield* Effect.tap(raise, () => runMigrations)
          : yield* Effect.andThen(runMigrations, raise);
        yield* SubscriptionRef.set(status, {
          state: "active",
          epoch,
          migrationFailed: false,
          held: null,
        });

        const check = withinTimeout(
          readEpoch(connection, "SELECT epoch FROM hq_leader WHERE id = 1"),
        );
        return yield* Effect.andThen(
          Effect.sleep(heartbeat),
          Effect.flatMap(check, (current): Effect.Effect<void, Lost | NotOfficial> =>
            current === epoch ? stillOfficial : Effect.fail(new Lost()),
          ),
        ).pipe(Effect.forever);
      }).pipe(
        Effect.scoped,
        Effect.catch((error) =>
          SubscriptionRef.update(status, ended).pipe(
            Effect.andThen(Effect.logWarning("leader session ended", error)),
          ),
        ),
        Effect.catchDefect((defect) =>
          SubscriptionRef.update(status, ended).pipe(
            Effect.andThen(Effect.logError("leader session crashed", defect)),
          ),
        ),
      );

      const loop = yield* Effect.forkScoped(
        Effect.forever(
          Effect.andThen(
            session.pipe(Effect.ensuring(attempts.complete)),
            Effect.sleep(retryAfter),
          ),
        ),
      );
      return Leader.of({
        nextAttempt: Effect.suspend(attempts.next),
        finished: Fiber.await(loop).pipe(Effect.asVoid),
        status: Effect.map(SubscriptionRef.get(status), ({ state, epoch }) => ({ state, epoch })),
        changes: SubscriptionRef.changes(status).pipe(
          Stream.map(({ state, epoch }): LeaderStatus => ({ state, epoch })),
          Stream.changesWith((a, b) => a.state === b.state && a.epoch === b.epoch),
        ),
        release: Effect.andThen(
          recordOk,
          Effect.andThen(Fiber.interrupt(loop), SubscriptionRef.set(status, STANDBY)),
        ),
        hold: (reason) =>
          SubscriptionRef.set(status, {
            state: "failed",
            epoch: null,
            migrationFailed: false,
            held: reason,
          }),
        held: Effect.map(SubscriptionRef.get(status), (current) => current.held),
        write: (effect) =>
          Effect.gen(function* () {
            const { state, epoch } = yield* SubscriptionRef.get(status);
            if (state !== "active" || epoch === null) {
              return yield* new NotLeader({ reason: "standby" });
            }
            return yield* sql.withTransaction(
              Effect.gen(function* () {
                const [row] = yield* sql<{ readonly epoch: string }>`
                  SELECT epoch FROM hq_leader WHERE id = 1 FOR SHARE`;
                if (Number(row?.epoch) !== epoch) return yield* new NotLeader({ reason: "fenced" });
                return yield* effect;
              }),
            );
          }),
      });
    }),
  );
