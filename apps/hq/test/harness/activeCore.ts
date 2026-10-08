/**
 * A leading Core over a database of the test's temp cluster: the leader, its pool, and the
 * migrations of the tree, always the official HQ. Built in the test's scope.
 *
 * @module test/harness/activeCore
 */
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";

import { Leader, leaderLayer } from "../../src/leader.ts";
import { treeMigrations } from "../../src/migrationFiles.ts";
import { Official } from "../../src/official.ts";

export const activeCoreLayer = (url: string) => {
  const databaseUrl = Redacted.make(url);
  return leaderLayer({
    databaseUrl,
    migrations: treeMigrations(),
    heartbeat: Duration.millis(100),
    heartbeatTimeout: Duration.seconds(1),
    retryAfter: Duration.millis(100),
  }).pipe(
    Layer.provideMerge(PgClient.layer({ url: databaseUrl })),
    Layer.provide(
      Layer.succeed(Official, {
        status: Effect.succeed({ official: "ok" as const, allowed: true }),
        checked: Effect.succeed(true),
        nextCheck: Effect.never,
        lastOk: Effect.undefined,
        inherit: () => Effect.void,
      }),
    ),
  );
};

/** Waits until the leader leads; fails after ten seconds. */
export const untilActive = Effect.gen(function* () {
  const leader = yield* Leader;
  yield* leader.status.pipe(
    Effect.filterOrFail((status) => status.state === "active"),
    Effect.retry(Schedule.spaced(Duration.millis(50))),
    Effect.timeout(Duration.seconds(10)),
  );
});
