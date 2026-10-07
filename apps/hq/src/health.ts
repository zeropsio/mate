/**
 * `GET /health`: what this instance is doing, for the platform's readiness check and for people.
 * A rolling deploy retires the Core that runs once the new one answers 200 (`zerops.yml`), so 200
 * means it may (H5a): an active Core once its git is open; a standby while its database answers
 * and either no Core holds the lock — nothing runs to retire, as at HQ's birth, which deploys Core
 * before its anchor — or it could lead itself, the official HQ by its own verdict (`official.ts`).
 * A standby that could not, beside a Core that leads, answers 503: the deploy waits, and the old
 * Core serves on until the new one could lead or the deploy fails. 503 otherwise. A Core that holds the lock
 * serving nothing says why (`reason`, `leader.ts` `hold`). `git` is where git stands on this Core —
 * open, opening (leading, its takeover not through) or closed — and `quarantined` the repositories
 * it withholds until they converge, if any (`gitHost.ts`). `db` is a fresh `SELECT 1` on the pool,
 * `backup` the newest set's outcome (`backup.ts` `BackupStatus`), `keys` where HQ's key for its
 * deploy tokens stands (`deployKeys.ts` `KeysStatus`), `loop` the event loop's delay and
 * its newest stall (`loopWatch.ts`), and `recomputes` the structure sockets' views computed in the
 * last minute (`recomputes.ts`): all reported, never judged.
 *
 * @module health
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { Backup } from "./backup.ts";
import { DeployKeys } from "./deployKeys.ts";
import { GitHost } from "./gitHost.ts";
import { LOCK_KEY, Leader, RETRY_AFTER } from "./leader.ts";
import { LoopWatch } from "./loopWatch.ts";
import { Official } from "./official.ts";
import { Recomputes } from "./recomputes.ts";

/** A stuck database must not hang the health check with it. */
const PROBE_TIMEOUT = Duration.seconds(2);

/**
 * How this Core's parts stand beside its database: the repositories git withholds, the newest
 * backup set, and its key for deploy tokens — what `/health` reports, and HQ's structure stream
 * says again whenever it changes (`stream.ts`).
 */
export const healthParts = Effect.gen(function* () {
  const git = yield* (yield* GitHost).status;
  const backup = yield* (yield* Backup).status;
  const deployKeys = yield* DeployKeys;
  // A database that does not answer says nothing of the tokens: the key as the env gives it.
  const keys = yield* deployKeys.status.pipe(
    Effect.timeout(PROBE_TIMEOUT),
    Effect.orElseSucceed(() => deployKeys.state),
  );
  return {
    git: git.git,
    ...(git.quarantined.length === 0 ? {} : { quarantined: git.quarantined }),
    backup,
    keys,
  };
});

export const healthRoute = (build: string) =>
  HttpRouter.add(
    "GET",
    "/health",
    Effect.gen(function* () {
      const leader = yield* Leader;
      const { state, epoch } = yield* leader.status;
      const held = yield* leader.held;
      const { official, allowed } = yield* (yield* Official).status;
      const sql = yield* SqlClient.SqlClient;
      const db = yield* sql`SELECT 1`.pipe(
        Effect.timeout(PROBE_TIMEOUT),
        Effect.as("up"),
        Effect.orElseSucceed(() => "down"),
      );
      const { git: gitState, ...parts } = yield* healthParts;
      const loop = yield* (yield* LoopWatch).status;
      const recomputes = yield* (yield* Recomputes).lastMinute;
      // Another Core holds the lock: the one a deploy would retire. Not known counts as held.
      const lockHeld = sql<{ readonly held: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND locktype = 'advisory' AND classid = 0 AND objid::bigint = ${LOCK_KEY}
            AND objsubid = 1 AND granted
        ) AS held`.pipe(
        Effect.timeout(PROBE_TIMEOUT),
        Effect.map((rows) => rows[0]?.held !== false),
        Effect.orElseSucceed(() => true),
      );
      const ready =
        state === "active"
          ? gitState === "open"
          : state === "standby" && db === "up" && (allowed || !(yield* lockHeld));
      return HttpServerResponse.jsonUnsafe(
        {
          state,
          ...(held === null ? {} : { reason: held }),
          official,
          db,
          git: gitState,
          ...parts,
          loop,
          recomputes,
          epoch,
          build,
        },
        ready ? { status: 200 } : { status: 503, headers: RETRY_AFTER },
      );
    }),
  );
