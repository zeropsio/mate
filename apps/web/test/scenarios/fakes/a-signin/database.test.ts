// @effect-diagnostics nodeBuiltinImport:off -- verify disposable Postgres fault controls.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { TempPostgres, tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { sessionDatabase } from "./database.ts";

describe("A: disposable session database fault driver", () => {
  it("rejects nonlocal databases before running a command", () => {
    expect(() => sessionDatabase("postgres://postgres@example.test/live", "fixture")).toThrow(
      "localhost",
    );
    expect(() => sessionDatabase("https://127.0.0.1/live", "fixture")).toThrow("localhost");
  });

  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("outage restores session rows; expiry preserves the fixture owner's session", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const config = NodeChildProcess.spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
        const bin =
          process.env.MATE_PG_BIN ??
          (config.status === 0 ? config.stdout.trim() : "/opt/homebrew/bin");
        const read = (query: string) =>
          NodeChildProcess.spawnSync(
            NodePath.join(bin, "psql"),
            [url, "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query],
            { encoding: "utf8", timeout: 10_000 },
          );
        const fixtureHash = NodeCrypto.createHash("sha256").update("fixture").digest("hex");
        expect(
          read(
            `CREATE TABLE hq_session (token_hash text, expires_at timestamptz, revoked_at timestamptz); INSERT INTO hq_session VALUES ('${fixtureHash}', now() + interval '12 hours', NULL), ('browser', now() + interval '12 hours', NULL)`,
          ).status,
        ).toBe(0);
        const fault = sessionDatabase(url, "fixture");
        yield* Effect.promise(() => fault.unavailable());
        try {
          expect(read("SELECT count(*) FROM hq_session").status).not.toBe(0);
          yield* Effect.promise(() => fault.sawSessionRead());
        } finally {
          yield* Effect.promise(() => fault.returns());
        }
        expect(read("SELECT count(*) FROM hq_session").stdout.trim()).toBe("2");
        yield* Effect.promise(() => fault.expires());
        expect(
          read("SELECT token_hash FROM hq_session WHERE expires_at > now()").stdout.trim(),
        ).toBe(fixtureHash);
      }),
    );
  });
});
