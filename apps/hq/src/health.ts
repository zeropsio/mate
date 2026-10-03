/**
 * `GET /health`: what this instance is doing, for the platform's readiness check and for people.
 * 200 for `standby` and `active` — a healthy standby must pass, or a rolling deploy could never
 * cut over to an instance that waits for the old one's lock — 503 otherwise. A Core that is not
 * the official HQ (`official`, see `official.ts`) is such a standby. A Core that holds the lock
 * serving nothing says why (`reason`, `leader.ts` `hold`). `git` is where git stands on this Core —
 * open, opening (leading, its takeover not through) or closed — and `quarantined` the repositories
 * it withholds until they converge, if any (`gitHost.ts`). `db` is a fresh `SELECT 1` on the pool,
 * `backup` the newest set's outcome (`backup.ts` `BackupStatus`), `loop` the event loop's delay and
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
import { GitHost } from "./gitHost.ts";
import { Leader, RETRY_AFTER } from "./leader.ts";
import { LoopWatch } from "./loopWatch.ts";
import { Official } from "./official.ts";
import { Recomputes } from "./recomputes.ts";

/** A stuck database must not hang the health check with it. */
const PROBE_TIMEOUT = Duration.seconds(2);

export const healthRoute = (build: string) =>
  HttpRouter.add(
    "GET",
    "/health",
    Effect.gen(function* () {
      const leader = yield* Leader;
      const { state, epoch } = yield* leader.status;
      const held = yield* leader.held;
      const { official } = yield* (yield* Official).status;
      const sql = yield* SqlClient.SqlClient;
      const db = yield* sql`SELECT 1`.pipe(
        Effect.timeout(PROBE_TIMEOUT),
        Effect.as("up"),
        Effect.orElseSucceed(() => "down"),
      );
      const git = yield* (yield* GitHost).status;
      const backup = yield* (yield* Backup).status;
      const loop = yield* (yield* LoopWatch).status;
      const recomputes = yield* (yield* Recomputes).lastMinute;
      const serving = state === "standby" || state === "active";
      return HttpServerResponse.jsonUnsafe(
        {
          state,
          ...(held === null ? {} : { reason: held }),
          official,
          db,
          git: git.git,
          ...(git.quarantined.length === 0 ? {} : { quarantined: git.quarantined }),
          backup,
          loop,
          recomputes,
          epoch,
          build,
        },
        serving ? { status: 200 } : { status: 503, headers: RETRY_AFTER },
      );
    }),
  );
