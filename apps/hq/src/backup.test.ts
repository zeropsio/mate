// @effect-diagnostics nodeBuiltinImport:off -- the tests read what a set leaves on the volume.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { mateWithChange, rowsWhere } from "../test/harness/mates.ts";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { directoryStore } from "./backup.ts";
import { restoreSet } from "./restore.ts";

const temporaryDir = Effect.acquireRelease(
  Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-backup-test-"))),
  (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
);

describe("a backup set, taken", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("without a store, stays on the volume whole and restores from there", () =>
      Effect.gen(function* () {
        const a = yield* startCore(true, { storeless: true });
        yield* untilHealth(a.call, "active");
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
