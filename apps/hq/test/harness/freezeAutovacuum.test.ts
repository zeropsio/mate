// @effect-diagnostics nodeBuiltinImport:off -- isolated real-process autovacuum during a freeze.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { vi } from "vite-plus/test";
import * as PgConnection from "@effect/sql-pg/PgConnection";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

// Autovacuum enters databases that refuse connections, and the clone's CREATE DATABASE stops it.
it.live("freezes and clones a closed database while autovacuum is still analyzing it", () =>
  Effect.gen(function* () {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pg-autovacuum-"));
    const bin = NodePath.join(home, "bin");
    NodeFS.mkdirSync(bin);
    const realBin = NodeChildProcess.execFileSync("pg_config", ["--bindir"], {
      encoding: "utf8",
    }).trim();
    for (const command of ["initdb", "postgres", "psql"])
      NodeFS.symlinkSync(NodePath.join(realBin, command), NodePath.join(bin, command));
    // A one-second naptime lets autovacuum reach the new database within the test.
    NodeFS.writeFileSync(
      NodePath.join(bin, "pg_ctl"),
      `#!/bin/sh\nexec "${NodePath.join(realBin, "pg_ctl")}" "$@" -o "-c autovacuum_naptime=1"\n`,
      { mode: 0o700 },
    );
    vi.stubEnv("MATE_TEST_PG_HOME", home);
    vi.stubEnv("MATE_PG_BIN", bin);
    vi.resetModules();
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        vi.unstubAllEnvs();
        NodeFS.rmSync(home, { recursive: true, force: true });
      }),
    );
    const { acquireTestPostgres } = yield* Effect.promise(
      () => import("../../../../scripts/test-postgres.ts"),
    );
    const owner = yield* Effect.acquireRelease(Effect.promise(acquireTestPostgres), (owner) =>
      Effect.promise(owner.close),
    );
    const template = yield* Effect.promise(owner.createDatabase);
    const name = new URL(template).pathname.slice(1);
    yield* Effect.scoped(
      Effect.gen(function* () {
        const source = yield* PgConnection.make({ url: Redacted.make(template) });
        // Analyzing this table pauses after every page, keeping the worker past the drain bound.
        yield* source.query(`CREATE TABLE baseline (value text) WITH (
          autovacuum_analyze_threshold = 0, autovacuum_analyze_scale_factor = 0,
          autovacuum_vacuum_cost_delay = 100, autovacuum_vacuum_cost_limit = 1)`);
        yield* source.query(
          "INSERT INTO baseline SELECT repeat('x', 100) FROM generate_series(1, 2000)",
        );
      }),
    );
    const catalogUrl = new URL(template);
    catalogUrl.pathname = "/postgres";
    const catalog = yield* PgConnection.make({ url: Redacted.make(catalogUrl.href) });
    // PostgreSQL emits no event when autovacuum enters a database; sample it on the server.
    yield* catalog.query(`DO $$ DECLARE deadline timestamptz := clock_timestamp() + interval '30 seconds';
      BEGIN LOOP
        PERFORM pg_stat_clear_snapshot();
        EXIT WHEN EXISTS (SELECT FROM pg_stat_activity WHERE datname = '${name}'
          AND backend_type = 'autovacuum worker' AND query LIKE '%ANALYZE public.baseline%');
        IF clock_timestamp() >= deadline THEN
          RAISE EXCEPTION 'autovacuum never analyzed the template';
        END IF;
        PERFORM pg_sleep(0.025);
      END LOOP; END $$`);
    const freeze = yield* Effect.tryPromise(() => owner.freezeDatabase(template)).pipe(Effect.exit);
    assert.equal(freeze._tag, "Success", String(freeze));
    const clone = yield* Effect.promise(() => owner.cloneDatabase(template));
    const copied = yield* PgConnection.make({ url: Redacted.make(clone) });
    assert.deepEqual((yield* copied.query("SELECT count(*)::int AS n FROM baseline")).rows, [
      { n: 2000 },
    ]);
  }).pipe(Effect.scoped),
);
