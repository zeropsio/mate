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

/** `GET /health` for a leader in `status`, over a pool on `databaseUrl`. */
const getHealth = (status: LeaderStatus, databaseUrl: string) =>
  Effect.gen(function* () {
    const handler = yield* HttpRouter.toHttpEffect(healthRoute("b1"));
    const response = yield* handler.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(new Request("http://hq.test/health")),
      ),
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Leader, { status: Effect.succeed(status) }),
          PgClient.layer({ url: Redacted.make(databaseUrl), connectTimeout: Duration.seconds(1) }),
        ),
      ),
    );
    const body: unknown = yield* Effect.promise(() => HttpServerResponse.toWeb(response).json());
    return { status: response.status, body };
  }).pipe(Effect.scoped);

const cases: ReadonlyArray<{
  readonly leader: LeaderStatus;
  readonly database: "up" | "down";
  readonly status: number;
}> = [
  { leader: { state: "active", epoch: 3 }, database: "up", status: 200 },
  { leader: { state: "standby", epoch: null }, database: "up", status: 200 },
  { leader: { state: "starting", epoch: null }, database: "up", status: 503 },
  { leader: { state: "failed", epoch: null }, database: "down", status: 503 },
];

describe("GET /health", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    for (const { leader, database, status } of cases) {
      it.effect(`answers ${String(status)} for ${leader.state} with the database ${database}`, () =>
        Effect.gen(function* () {
          const postgres = yield* TempPostgres;
          const url = database === "up" ? yield* postgres.createDatabase : yield* postgres.deadUrl;
          const response = yield* getHealth(leader, url);
          assert.strictEqual(response.status, status);
          assert.deepStrictEqual(response.body, {
            state: leader.state,
            db: database,
            epoch: leader.epoch,
            build: "b1",
          });
        }),
      );
    }
  });
});
