// @effect-diagnostics nodeBuiltinImport:off -- isolated real-process drain delivery barrier.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { vi } from "vite-plus/test";
import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";

it.live("freezes a closed database while another lease's DDL blocks the supervisor", () =>
  Effect.gen(function* () {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-drain-"));
    const bin = NodePath.join(home, "bin");
    NodeFS.mkdirSync(bin);
    const realBin = NodeChildProcess.execFileSync("pg_config", ["--bindir"], {
      encoding: "utf8",
    }).trim();
    for (const command of ["initdb", "pg_ctl", "postgres"])
      NodeFS.symlinkSync(NodePath.join(realBin, command), NodePath.join(bin, command));
    NodeFS.writeFileSync(
      NodePath.join(bin, "psql"),
      '#!/bin/sh\nexec "$MATE_TEST_NODE" "$MATE_TEST_DRAIN_FIXTURE" "$@"\n',
      { mode: 0o700 },
    );
    let deliver: (() => void) | undefined;
    let sampled: string | undefined;
    let cleanup: () => Promise<void>;
    const sampledReply = new Promise<void>((resolve) => {
      const server = NodeNet.createServer((socket) => {
        socket.once("data", (data: Buffer) => {
          if (sampled !== undefined) {
            socket.end("continue");
            return;
          }
          sampled = data.toString();
          deliver = () => socket.end("continue");
          resolve();
        });
      });
      server.listen(NodePath.join(home, "control.sock"));
      // Registered before the leases so the supervisor and its psql children leave first.
      cleanup = () => new Promise<void>((done) => server.close(() => done()));
    });
    vi.stubEnv("MATE_TEST_PG_HOME", home);
    vi.stubEnv("MATE_PG_BIN", bin);
    vi.stubEnv("MATE_TEST_NODE", process.execPath);
    vi.stubEnv("MATE_TEST_REAL_PSQL", NodePath.join(realBin, "psql"));
    vi.stubEnv(
      "MATE_TEST_DRAIN_FIXTURE",
      NodePath.resolve("../../scripts/fixtures/test-postgres-drain.ts"),
    );
    vi.stubEnv("MATE_TEST_DRAIN_CONTROL", NodePath.join(home, "control.sock"));
    vi.resetModules();
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        deliver?.();
        await cleanup();
        vi.unstubAllEnvs();
        NodeFS.rmSync(home, { recursive: true, force: true });
      }),
    );
    const { acquireTestPostgres } = yield* Effect.promise(
      () => import("../../../../scripts/test-postgres.ts"),
    );
    const lease = Effect.acquireRelease(Effect.promise(acquireTestPostgres), (owner) =>
      Effect.promise(owner.close),
    );
    const owner = yield* lease;
    const other = yield* lease;
    yield* Effect.addFinalizer(() => Effect.sync(() => deliver?.()));
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
    yield* Effect.promise(() => sampledReply);
    const creating = yield* Effect.forkScoped(Effect.promise(other.createDatabase));
    yield* catalog.query("SELECT pg_sleep(2.2)");
    yield* catalog.query("COMMIT");
    // The sampled connection has exited before its reply reaches the supervisor.
    const remaining = yield* catalog.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1",
      [new URL(template).pathname.slice(1)],
    );
    assert.deepEqual(remaining.rows, [{ n: 0 }]);
    deliver!();
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
