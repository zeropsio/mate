import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { acquireTestPostgres } from "../../../../scripts/test-postgres.ts";

const lease = Effect.acquireRelease(Effect.promise(acquireTestPostgres), (owner) =>
  Effect.promise(owner.close),
);
it.live("freezes a closed database while another lease's DDL blocks the supervisor", () =>
  Effect.gen(function* () {
    const owner = yield* lease;
    const other = yield* lease;
    const template = yield* Effect.promise(owner.createDatabase);
    const catalogUrl = new URL(template);
    catalogUrl.pathname = "/postgres";
    const catalog = yield* PgConnection.make({ url: Redacted.make(catalogUrl.href) });
    yield* catalog.query("BEGIN");
    yield* Effect.scoped(
      Effect.gen(function* () {
        const source = yield* PgConnection.make({ url: Redacted.make(template) });
        yield* source.query("CREATE TABLE baseline (value text)");
        yield* Effect.forkDetach(source.query("SELECT pg_sleep(0.5)"));
        yield* Effect.sleep("50 millis");
      }),
    );
    // Hold unrelated CREATE DDL beyond the drain deadline, only after freeze's ALTER completes.
    const locking = yield* Effect.forkScoped(
      catalog.query(`DO $$ BEGIN
      WHILE (SELECT datallowconn FROM pg_database WHERE datname = '${new URL(template).pathname.slice(1)}') LOOP
        PERFORM pg_sleep(0.001);
      END LOOP;
      LOCK TABLE pg_database IN SHARE MODE;
    END $$`),
    );
    const freezing = yield* Effect.forkScoped(
      Effect.tryPromise(() => owner.freezeDatabase(template)),
    );
    yield* Fiber.join(locking);
    const creating = yield* Effect.forkScoped(Effect.promise(other.createDatabase));
    yield* catalog.query("SELECT pg_sleep(2.2)");
    yield* catalog.query("COMMIT");
    const result = yield* Fiber.await(freezing);
    yield* Fiber.join(creating);
    assert.equal(result._tag, "Success", String(result));
    const clone = yield* Effect.promise(() => owner.cloneDatabase(template));
    const copied = yield* PgConnection.make({ url: Redacted.make(clone) });
    assert.deepEqual((yield* copied.query("SELECT to_regclass('baseline')::text AS t")).rows, [
      { t: "baseline" },
    ]);
  }).pipe(Effect.scoped),
);
