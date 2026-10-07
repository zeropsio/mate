import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { TempPostgres, tempPostgresLayer } from "./tempPostgres.ts";

it.effect("independent test files use isolated databases on the same host server", () =>
  Effect.gen(function* () {
    const first = yield* (yield* TempPostgres).createDatabase;
    yield* Effect.gen(function* () {
      const second = yield* (yield* TempPostgres).createDatabase;
      assert.notEqual(first, second);
      assert.equal(new URL(first).port, new URL(second).port);
    }).pipe(Effect.provide(Layer.fresh(tempPostgresLayer)));
  }).pipe(Effect.provide(Layer.fresh(tempPostgresLayer))),
);
