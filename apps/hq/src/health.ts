/**
 * `GET /health`: what this instance is doing, for the platform's readiness check and for people.
 * 200 for `standby` and `active` — a healthy standby must pass, or a rolling deploy could never
 * cut over to an instance that waits for the old one's lock — 503 otherwise. A Core that is not
 * the official HQ (`official`, see `official.ts`) is such a standby. A Core that holds the lock
 * serving nothing says why (`reason`, `leader.ts` `hold`). `db` is a fresh `SELECT 1` on the pool,
 * reported, never judged.
 *
 * @module health
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { Leader, RETRY_AFTER } from "./leader.ts";
import { Official } from "./official.ts";

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
      const serving = state === "standby" || state === "active";
      return HttpServerResponse.jsonUnsafe(
        { state, ...(held === null ? {} : { reason: held }), official, db, epoch, build },
        serving ? { status: 200 } : { status: 503, headers: RETRY_AFTER },
      );
    }),
  );
