import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { healthRoute } from "./health.ts";
import { Leader, type LeaderStatus } from "./leader.ts";
import { Official, type OfficialStatus } from "./official.ts";

/** `GET /health` for a leader in `status` and the official verdict, over a pool on `databaseUrl`. */
const getHealth = (
  status: LeaderStatus,
  official: OfficialStatus["official"],
  databaseUrl: string,
) =>
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(healthRoute("b1"));
    const response = yield* handler.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request("http://hq.test/health")),
      ),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Leader, {
            status: Effect.succeed(status),
            write: () => Effect.die("no writes"),
          }),
          Layer.succeed(Official, {
            status: Effect.succeed({ official, allowed: official === "ok" }),
          }),
          PgClient.layer({ url: Redacted.make(databaseUrl), connectTimeout: Duration.seconds(1) }),
        ),
      ),
    );
    const body: unknown = yield* Effect.promise(() => HttpServerResponse.toWeb(response).json());
    return { status: response.status, body };
  }).pipe(Effect.scoped);

const cases: ReadonlyArray<{
  readonly leader: LeaderStatus;
  readonly official: OfficialStatus["official"];
  readonly database: "up" | "down";
  readonly status: number;
}> = [
  { leader: { state: "active", epoch: 3 }, official: "ok", database: "up", status: 200 },
  // A Core that is not the official HQ is a healthy standby: its deploy must pass.
  {
    leader: { state: "standby", epoch: null },
    official: "anchor_missing",
    database: "up",
    status: 200,
  },
  {
    leader: { state: "standby", epoch: null },
    official: "credentials_wrong",
    database: "up",
    status: 200,
  },
  { leader: { state: "starting", epoch: null }, official: "unknown", database: "up", status: 503 },
  {
    leader: { state: "failed", epoch: null },
    official: "anchor_elsewhere",
    database: "down",
    status: 503,
  },
];

describe("GET /health", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const { leader, official, database, status } of cases) {
      it.effect(
        `answers ${String(status)} for ${leader.state}, ${official}, the database ${database}`,
        () =>
          Effect.gen(function* () {
            const postgres = yield* TempPostgres;
            const url =
              database === "up" ? yield* postgres.createDatabase : yield* postgres.deadUrl;
            const response = yield* getHealth(leader, official, url);
            assert.strictEqual(response.status, status);
            assert.deepStrictEqual(response.body, {
              state: leader.state,
              official,
              db: database,
              epoch: leader.epoch,
              build: "b1",
            });
          }),
      );
    }
  });
});
