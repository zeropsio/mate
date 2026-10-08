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

it.effect(
  "only an owner's frozen database can be cloned and release drops templates and clones",
  () =>
    Effect.gen(function* () {
      const first = yield* lease;
      const second = yield* lease;
      const template = yield* Effect.promise(first.createDatabase);
      const adminUrl = yield* Effect.promise(second.createDatabase);
      const admin = yield* connection(adminUrl);
      const unfrozen = yield* Effect.tryPromise(() => first.cloneDatabase(template)).pipe(
        Effect.flip,
      );
      assert.include(String(unfrozen.cause), "not a frozen template owned by this lease");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const source = yield* connection(template);
          yield* source.query("CREATE TABLE baseline (value text)");
          yield* source.query("INSERT INTO baseline VALUES ('original')");
          const stillOpen = yield* Effect.tryPromise(() => first.freezeDatabase(template)).pipe(
            Effect.flip,
          );
          assert.include(
            String(stillOpen.cause),
            "Close database connections before freezing a template",
          );
          assert.deepEqual((yield* source.query("SELECT value FROM baseline")).rows, [
            { value: "original" },
          ]);
        }),
      );
      const foreignFreeze = yield* Effect.tryPromise(() => second.freezeDatabase(template)).pipe(
        Effect.flip,
      );
      assert.include(String(foreignFreeze.cause), "not owned by this lease");
      yield* Effect.promise(() => first.freezeDatabase(template));
      const frozen = yield* admin.query("SELECT datallowconn FROM pg_database WHERE datname = $1", [
        new URL(template).pathname.slice(1),
      ]);
      assert.deepEqual(frozen.rows, [{ datallowconn: false }]);
      const reconnect = yield* connection(template).pipe(Effect.exit);
      assert.equal(reconnect._tag, "Failure");
      const foreignClone = yield* Effect.tryPromise(() => second.cloneDatabase(template)).pipe(
        Effect.flip,
      );
      assert.include(String(foreignClone.cause), "not owned by this lease");
      const clone = yield* Effect.promise(() => first.cloneDatabase(template));
      const copied = yield* connection(clone);
      assert.deepEqual((yield* copied.query("SELECT value FROM baseline")).rows, [
        { value: "original" },
      ]);
      yield* Effect.promise(first.close);
      const remaining = yield* admin.query(
        "SELECT datname FROM pg_database WHERE datname = ANY($1::text[])",
        [[template, clone].map((url) => new URL(url).pathname.slice(1))],
      );
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
          new Promise<{ template: string; clone: string }>((resolve, reject) =>
            child.once("message", (message) =>
              typeof message === "object" &&
              message !== null &&
              "template" in message &&
              "clone" in message
                ? resolve(message as { template: string; clone: string })
                : reject(new Error("Invalid worker database")),
            ),
          ),
          exited.then(() => {
            throw new Error("Database worker exited before acquisition");
          }),
        ]),
      );
      assert.equal(new URL(ownedUrl.clone).port, new URL(survivorUrl).port);
      if (mode === "SIGKILL") child.kill("SIGKILL");
      else child.send("exit");
      yield* Effect.promise(() => exited);
      const next = yield* lease;
      yield* Effect.promise(next.createDatabase);
      const remaining = yield* admin.query(
        "SELECT datname FROM pg_database WHERE datname = ANY($1::text[])",
        [[ownedUrl.template, ownedUrl.clone].map((url) => new URL(url).pathname.slice(1))],
      );
      assert.deepEqual(remaining.rows, []);
    }).pipe(Effect.scoped),
);
