/**
 * The one-writer rule. Of all running Core instances, the one holding a Postgres advisory lock on
 * a session of its own leads; every other instance is a standby and writes nothing.
 *
 * A session: open a connection outside the pool (the lock belongs to that session), block in
 * `pg_advisory_lock`, raise the epoch and run the pending migrations, then lead. A heartbeat on the
 * lock connection keeps checking that this session still holds the epoch; any failure ends the
 * session — the connection closes, the lock is released, the instance is a standby again and
 * tries anew.
 *
 * @module leader
 */
import * as PgConnection from "@effect/sql-pg/PgConnection";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { type Migration, migrate } from "./migrations.ts";

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

export class Leader extends Context.Service<
  Leader,
  { readonly status: Effect.Effect<LeaderStatus> }
>()("@t3tools/hq/leader") {}

export interface LeaderOptions {
  readonly databaseUrl: Redacted.Redacted;
  readonly migrations: ReadonlyArray<Migration>;
  /** How often the lock connection is checked while this instance leads. */
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

/** The status, and whether its `failed` is a migration's, which only leading clears. */
interface Internal extends LeaderStatus {
  readonly migrationFailed: boolean;
}

const STANDBY: Internal = { state: "standby", epoch: null, migrationFailed: false };
const MIGRATION_FAILED: Internal = { state: "failed", epoch: null, migrationFailed: true };

/** The database answered: a standby, unless a migration failed before. */
const reached = (current: Internal): Internal => (current.migrationFailed ? current : STANDBY);

/** The database did not answer. */
const unreachable = (current: Internal): Internal =>
  current.migrationFailed ? current : { state: "failed", epoch: null, migrationFailed: false };

/** A session ended: a standby again if it had reached the database and failed nothing on the way. */
const ended = (current: Internal): Internal => (current.state === "failed" ? current : STANDBY);

class Lost {
  readonly _tag = "Lost";
}

export const leaderLayer = (
  options: LeaderOptions,
): Layer.Layer<Leader, never, SqlClient.SqlClient> =>
  Layer.effect(
    Leader,
    Effect.gen(function* () {
      const heartbeat = options.heartbeat ?? Duration.seconds(2);
      const heartbeatTimeout = options.heartbeatTimeout ?? Duration.seconds(5);
      const retryAfter = options.retryAfter ?? Duration.seconds(2);
      const status = yield* Ref.make<Internal>({
        state: "starting",
        epoch: null,
        migrationFailed: false,
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

      const readEpoch = (connection: PgConnection.PgConnection, statement: string) =>
        connection
          .query(statement)
          .pipe(Effect.map((result) => Number(String(result.rows[0]?.["epoch"]))));

      const session = Effect.gen(function* () {
        const connection = yield* PgConnection.make({
          url: options.databaseUrl,
          applicationName: "hq-leader",
        }).pipe(Effect.tapError(() => Ref.update(status, unreachable)));
        yield* Effect.forEach(SESSION_SETTINGS, (statement) => connection.query(statement), {
          discard: true,
        });
        yield* Ref.update(status, reached);
        yield* connection.query(`SELECT pg_advisory_lock(${String(LOCK_KEY)})`);

        // With the schema there the epoch moves first; the first boot has no table to raise yet.
        const raise = readEpoch(
          connection,
          "UPDATE hq_leader SET epoch = epoch + 1, acquired_at = now() WHERE id = 1 RETURNING epoch",
        );
        const runMigrations = migrate(options.migrations).pipe(
          Effect.tapError(() => Ref.set(status, MIGRATION_FAILED)),
        );
        const schemaThere = yield* connection
          .query("SELECT to_regclass('hq_leader') IS NOT NULL AS present")
          .pipe(Effect.map((result) => result.rows[0]?.["present"] === true));
        const epoch = schemaThere
          ? yield* Effect.tap(raise, () => runMigrations)
          : yield* Effect.andThen(runMigrations, raise);
        yield* Ref.set(status, { state: "active", epoch, migrationFailed: false });

        const check = withinTimeout(
          readEpoch(connection, "SELECT epoch FROM hq_leader WHERE id = 1"),
        );
        return yield* Effect.andThen(
          Effect.sleep(heartbeat),
          Effect.flatMap(check, (current) =>
            current === epoch ? Effect.void : Effect.fail(new Lost()),
          ),
        ).pipe(Effect.forever);
      }).pipe(
        Effect.scoped,
        Effect.catch((error) =>
          Ref.update(status, ended).pipe(
            Effect.andThen(Effect.logWarning("leader session ended", error)),
          ),
        ),
        Effect.catchDefect((defect) =>
          Ref.update(status, ended).pipe(
            Effect.andThen(Effect.logError("leader session crashed", defect)),
          ),
        ),
      );

      yield* Effect.forkScoped(Effect.forever(Effect.andThen(session, Effect.sleep(retryAfter))));
      return Leader.of({
        status: Effect.map(Ref.get(status), ({ state, epoch }) => ({ state, epoch })),
      });
    }),
  );
