// @effect-diagnostics nodeBuiltinImport:off -- the tests read what a set leaves on the volume.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";

import { mateWithChange, rowsWhere } from "../test/harness/mates.ts";
import { type Call, sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { PgDumpOlder, directoryStore } from "./backup.ts";
import { restoreSet } from "./restore.ts";

const temporaryDir = Effect.acquireRelease(
  Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-backup-test-"))),
  (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
);

/** Until `core` leads with git open, its takeover done. */
const leading = (core: Effect.Success<ReturnType<typeof startCore>>) =>
  Effect.andThen(
    untilHealth(core.call, "active"),
    Stream.runHead(Stream.filter(core.gitHost.recorded, (tick) => tick > 0)),
  );

/** What `/health` says of backup. */
const backupHealth = (call: Call) =>
  Effect.map(call("GET", "/health"), (response) => [
    response.status,
    (response.body as { readonly backup: unknown }).backup,
  ]);

describe("a backup set, taken", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("is refused with a pg_dump older than the database, both versions named", () =>
      Effect.gen(function* () {
        const pgDump = NodePath.join(yield* temporaryDir, "pg_dump");
        // It tells its version and refuses anything else: no dump is begun.
        NodeFS.writeFileSync(
          pgDump,
          '#!/bin/sh\n[ "$1" = --version ] && echo "pg_dump (PostgreSQL) 9.6.24" && exit 0\nexit 3\n',
          { mode: 0o755 },
        );
        const a = yield* startCore(true, { pgDump });
        yield* leading(a);
        assert.deepStrictEqual(yield* backupHealth(a.call), [200, { state: "pending" }]);

        const refused = yield* Effect.flip(a.backup.take);
        const [server] = yield* rowsWhere(
          a.url,
          "SELECT current_setting('server_version_num')::int / 10000 AS major",
          () => true,
        );
        assert.deepStrictEqual(
          refused,
          new PgDumpOlder({ pgDump: 9, server: server?.["major"] as number }),
        );
        assert.deepStrictEqual(yield* backupHealth(a.call), [
          200,
          { state: "failed", reason: "pg_dump_older", pgDump: 9, server: server?.["major"] },
        ]);
        assert.deepStrictEqual(NodeFS.readdirSync(a.stagingDir), []);
        assert.deepStrictEqual(NodeFS.readdirSync(a.storeDir), []);
      }),
    );

    it.effect("is taken again only once the database has moved", () =>
      Effect.gen(function* () {
        const a = yield* startCore(true);
        yield* leading(a);
        const sets = NodePath.join(a.storeDir, "sets");
        const first = yield* a.backup.take;
        assert.strictEqual((yield* a.backup.take).id, first.id);
        assert.deepStrictEqual(NodeFS.readdirSync(sets), [first.id]);

        yield* sessionFor(a.call, "door-owner");
        const next = yield* a.backup.take;
        assert.deepStrictEqual(NodeFS.readdirSync(sets).sort(), [first.id, next.id]);
        assert.deepStrictEqual(yield* backupHealth(a.call), [200, { state: "ok", set: next.id }]);
      }),
    );

    it.effect("that fails leaves the newest whole set staged, and nothing of itself", () =>
      Effect.gen(function* () {
        const a = yield* startCore(true);
        yield* leading(a);
        const kept = yield* a.backup.take;
        assert.deepStrictEqual(yield* backupHealth(a.call), [200, { state: "ok", set: kept.id }]);

        // The database moves on; the store then refuses every new file.
        yield* sessionFor(a.call, "door-owner");
        const sets = NodePath.join(a.storeDir, "sets");
        NodeFS.chmodSync(sets, 0o500);
        const refused = yield* Effect.flip(a.backup.take).pipe(
          Effect.ensuring(Effect.sync(() => NodeFS.chmodSync(sets, 0o700))),
        );
        assert.deepStrictEqual(
          [refused._tag, refused._tag === "BackupError" && refused.reason],
          ["BackupError", "store"],
        );
        assert.deepStrictEqual(yield* backupHealth(a.call), [
          200,
          { state: "failed", reason: "store" },
        ]);
        assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(a.stagingDir, "sets")), [kept.id]);
        assert.deepStrictEqual(NodeFS.readdirSync(sets), [kept.id]);
      }),
    );

    it.effect("without a store, stays on the volume whole and restores from there", () =>
      Effect.gen(function* () {
        const a = yield* startCore(true, { storeless: true });
        yield* leading(a);
        const owner = yield* sessionFor(a.call, "door-owner");
        yield* mateWithChange(a.call, a.fake, owner);
        const manifest = yield* a.backup.take;
        yield* a.stop;
        assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(a.stagingDir, "sets")), [
          manifest.id,
        ]);

        const url = yield* (yield* TempPostgres).createDatabase;
        yield* restoreSet(directoryStore(a.stagingDir), manifest.id, {
          databaseUrl: Redacted.make(url),
          gitRoot: yield* temporaryDir,
          workDir: yield* temporaryDir,
        });
        assert.deepStrictEqual(yield* rowsWhere(url, "SELECT number FROM hq_change", () => true), [
          { number: 1 },
        ]);
      }),
    );
  });
});
