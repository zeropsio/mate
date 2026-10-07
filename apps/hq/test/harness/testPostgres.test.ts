// @effect-diagnostics nodeBuiltinImport:off -- process-owned database isolation.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { acquireTestPostgres } from "../../../../scripts/test-postgres.ts";

const lease = Effect.acquireRelease(Effect.promise(acquireTestPostgres), (owner) =>
  Effect.promise(owner.close),
);
const connection = (url: string) => PgConnection.make({ url: Redacted.make(url) });

it.effect("isolates databases while sharing one PostgreSQL server and drops released owners", () =>
  Effect.gen(function* () {
    const first = yield* lease;
    const second = yield* lease;
    const firstUrl = yield* Effect.promise(first.createDatabase);
    const secondUrl = yield* Effect.promise(second.createDatabase);
    assert.notEqual(firstUrl, secondUrl);
    assert.equal(new URL(firstUrl).port, new URL(secondUrl).port);
    const a = yield* connection(firstUrl);
    const b = yield* connection(secondUrl);
    yield* a.query("CREATE TABLE private_fact (value text)");
    const absent = yield* b.query("SELECT to_regclass('private_fact') AS table_name");
    assert.deepEqual(absent.rows, [{ table_name: null }]);
    yield* Effect.promise(first.close);
    const released = yield* Effect.tryPromise(first.createDatabase).pipe(Effect.flip);
    assert.equal(String(released.cause), "Error: PostgreSQL owner is released");
    const remaining = yield* b.query("SELECT datname FROM pg_database WHERE datname = $1", [
      new URL(firstUrl).pathname.slice(1),
    ]);
    assert.deepEqual(remaining.rows, []);
  }).pipe(Effect.scoped),
);

it.effect.each(["SIGKILL", "exit"] as const)(
  "reclaims a worker database after %s before the next owner's work",
  (mode) =>
    Effect.gen(function* () {
      const survivor = yield* lease;
      const survivorUrl = yield* Effect.promise(survivor.createDatabase);
      const admin = yield* connection(survivorUrl);
      const child = NodeChildProcess.spawn(
        process.execPath,
        [NodePath.join(import.meta.dirname, "testPostgresWorker.ts")],
        { stdio: ["pipe", "ignore", "inherit", "ipc"] },
      );
      const exited = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", () => resolve());
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => child.kill("SIGKILL")));
      const ownedUrl = yield* Effect.promise(() =>
        Promise.race([
          new Promise<string>((resolve, reject) =>
            child.once("message", (message) =>
              typeof message === "string"
                ? resolve(message)
                : reject(new Error("Invalid worker database")),
            ),
          ),
          exited.then(() => {
            throw new Error("Database worker exited before acquisition");
          }),
        ]),
      );
      assert.equal(new URL(ownedUrl).port, new URL(survivorUrl).port);
      if (mode === "SIGKILL") child.kill("SIGKILL");
      else child.send("exit");
      yield* Effect.promise(() => exited);
      const next = yield* lease;
      yield* Effect.promise(next.createDatabase);
      const remaining = yield* admin.query("SELECT datname FROM pg_database WHERE datname = $1", [
        new URL(ownedUrl).pathname.slice(1),
      ]);
      assert.deepEqual(remaining.rows, []);
    }).pipe(Effect.scoped),
);
