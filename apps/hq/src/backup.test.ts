// @effect-diagnostics nodeBuiltinImport:off -- the tests read what a set leaves on the volume.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";

import { mateWithChange, rowsWhere } from "../test/harness/mates.ts";
import { type Call, sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import {
  PgDumpOlder,
  type Room,
  type StoredSet,
  directoryStore,
  retained,
  roomFor,
} from "./backup.ts";
import { restoreSet } from "./restore.ts";

const temporaryDir = Effect.acquireRelease(
  Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-backup-test-"))),
  (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
);

/** Until `core` leads with git open, its takeover done. */
const leading = (core: Effect.Success<ReturnType<typeof startCore>>) =>
  Effect.andThen(
    untilHealth(core.call, "active"),
    core.gitHost.git.pipe(
      Effect.retry(Schedule.spaced(Duration.millis(50))),
      Effect.timeout(Duration.seconds(10)),
    ),
  );

/** The bytes of every file under `dir`. */
const bytesOf = (dir: string): number =>
  NodeFS.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const path = NodePath.join(dir, entry.name);
    return sum + (entry.isDirectory() ? bytesOf(path) : NodeFS.statSync(path).size);
  }, 0);

/** Whole sets of `bytes` dump each in the store `storeDir`, taken the given months ago; their ids. */
const storedBefore = (storeDir: string, monthsAgo: ReadonlyArray<number>, bytes: number) =>
  Effect.map(DateTime.now, (now) =>
    monthsAgo.map((months) => {
      const id = DateTime.formatIso(DateTime.subtract(now, { months })).replace(/[-:]/gu, "");
      const dir = NodePath.join(storeDir, "sets", id);
      NodeFS.mkdirSync(dir, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(dir, "db.dump"), new Uint8Array(bytes));
      NodeFS.writeFileSync(NodePath.join(dir, "manifest.json"), "{}");
      return id;
    }),
  );

/** The sets in the store `storeDir`, once it holds one. */
const untilSets = (storeDir: string) =>
  Effect.sync(() =>
    NodeFS.existsSync(NodePath.join(storeDir, "sets"))
      ? NodeFS.readdirSync(NodePath.join(storeDir, "sets"))
      : [],
  ).pipe(
    Effect.filterOrFail((sets) => sets.length > 0),
    Effect.retry(Schedule.spaced(Duration.millis(50))),
    Effect.timeout(Duration.seconds(10)),
  );

/** What `/health` says of backup. */
const backupHealth = (call: Call) =>
  Effect.map(call("GET", "/health"), (response) => [
    response.status,
    (response.body as { readonly backup: unknown }).backup,
  ]);

const NOW = DateTime.makeUnsafe("2026-10-02T12:00:00.000Z");

describe("the sets kept", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly ids: ReadonlyArray<string>;
    readonly kept: ReadonlyArray<string>;
  }> = [
    { name: "none of none", ids: [], kept: [] },
    {
      name: "for a day, the newest of each hour",
      ids: ["20261002T100000.000Z", "20261002T110500.000Z", "20261002T115000.000Z"],
      kept: ["20261002T100000.000Z", "20261002T115000.000Z"],
    },
    {
      name: "for 14 days, the newest of each day",
      ids: ["20260930T080000.000Z", "20260930T200000.000Z", "20261001T090000.000Z"],
      kept: ["20260930T200000.000Z", "20261001T090000.000Z"],
    },
    {
      name: "for 6 months, the newest of each month",
      ids: [
        "20260801T000000.000Z",
        "20260815T000000.000Z",
        "20260910T000000.000Z",
        "20260912T000000.000Z",
      ],
      kept: ["20260815T000000.000Z", "20260912T000000.000Z"],
    },
    {
      name: "past that, the newest alone",
      ids: ["20260101T000000.000Z", "20260301T000000.000Z"],
      kept: ["20260301T000000.000Z"],
    },
  ];
  for (const { name, ids, kept } of cases) {
    it(name, () => {
      assert.deepStrictEqual([...retained(ids, NOW)].sort(), kept);
    });
  }
});

describe("the room a set makes in its store", () => {
  const set = (id: string, bytes: number, whole = true): StoredSet => ({ id, bytes, whole });
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly stored: ReadonlyArray<StoredSet>;
    readonly incoming: number;
    readonly limit: number;
    readonly room: Room;
  }> = [
    {
      name: "under the limit, the incomplete and the expired go",
      stored: [
        set("20260101T000000.000Z", 10),
        set("20261002T100000.000Z", 10),
        set("20261002T103000.000Z", 5, false),
      ],
      incoming: 10,
      limit: 100,
      room: {
        remove: ["20261002T103000.000Z", "20260101T000000.000Z"],
        fits: true,
        cut: false,
        used: 10,
      },
    },
    {
      name: "over it, kept sets go oldest first, never the newest whole one",
      stored: [
        set("20260815T000000.000Z", 40),
        set("20260912T000000.000Z", 40),
        set("20261001T090000.000Z", 40),
      ],
      incoming: 40,
      limit: 100,
      room: {
        remove: ["20260815T000000.000Z", "20260912T000000.000Z"],
        fits: true,
        cut: true,
        used: 40,
      },
    },
    {
      name: "when nothing makes room, the kept sets stay",
      stored: [
        set("20260101T000000.000Z", 10),
        set("20260815T000000.000Z", 40),
        set("20261001T090000.000Z", 40),
      ],
      incoming: 70,
      limit: 100,
      room: { remove: ["20260101T000000.000Z"], fits: false, cut: false, used: 80 },
    },
  ];
  for (const { name, stored, incoming, limit, room } of cases) {
    it(name, () => {
      assert.deepStrictEqual(
        roomFor(stored, { id: "20261002T115000.000Z", bytes: incoming }, limit, NOW),
        room,
      );
    });
  }
});

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
        assert.notStrictEqual(next.id, first.id);
        // The newer of one hour is the one kept.
        assert.deepStrictEqual(NodeFS.readdirSync(sets), [next.id]);
        assert.deepStrictEqual(yield* backupHealth(a.call), [200, { state: "ok", set: next.id }]);
      }),
    );

    it.effect("makes room in a full store, the oldest kept set first, and tells it", () =>
      Effect.gen(function* () {
        // 100 000 bytes, and two sets of the months before, each kept as its month's newest.
        const a = yield* startCore(true, { quotaGb: 0.0001 });
        const [older, old] = yield* storedBefore(a.storeDir, [3, 2], 40_000);
        yield* leading(a);
        const manifest = yield* a.backup.take;
        assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(a.storeDir, "sets")).sort(), [
          old,
          manifest.id,
        ]);
        assert.notStrictEqual(older, manifest.id);
        assert.deepStrictEqual(yield* backupHealth(a.call), [
          200,
          {
            state: "degraded",
            set: manifest.id,
            usedBytes: bytesOf(NodePath.join(a.storeDir, "sets", old ?? "")),
            neededBytes: bytesOf(NodePath.join(a.storeDir, "sets", manifest.id)),
            quotaBytes: 100_000,
          },
        ]);
      }),
    );

    it.effect("is refused when nothing makes room, every kept set staying", () =>
      Effect.gen(function* () {
        const a = yield* startCore(true, { quotaGb: 0.00005 });
        const [kept] = yield* storedBefore(a.storeDir, [2], 40_000);
        yield* leading(a);
        const refused = yield* Effect.flip(a.backup.take);
        assert.strictEqual(refused._tag, "BucketFull");
        const [status, backup] = yield* backupHealth(a.call);
        const { neededBytes, ...rest } = backup as { readonly neededBytes: number };
        assert.deepStrictEqual(
          [status, rest],
          [
            200,
            {
              state: "failed",
              reason: "quota",
              usedBytes: bytesOf(NodePath.join(a.storeDir, "sets", kept ?? "")),
              quotaBytes: 50_000,
            },
          ],
        );
        assert.isAbove(neededBytes, 0);
        assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(a.storeDir, "sets")), [kept]);
        assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(a.stagingDir, "sets")), []);
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

    it.effect("asked for twice at once, is taken once", () =>
      Effect.gen(function* () {
        const a = yield* startCore(true);
        yield* leading(a);
        const [one, two] = yield* Effect.all([a.backup.take, a.backup.take], {
          concurrency: 2,
        });
        assert.strictEqual(two?.id, one?.id);
        assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(a.storeDir, "sets")), [one?.id]);
      }),
    );

    it.effect("is taken by the leading Core on its own, at once when none is staged", () =>
      Effect.gen(function* () {
        const hourly = { backupEvery: Duration.hours(1), backupCheck: Duration.millis(100) };
        const a = yield* startCore(true, hourly);
        yield* leading(a);
        const b = yield* startCore(true, { ...hourly, url: a.url });
        yield* untilHealth(b.call, "standby");
        const [set] = yield* untilSets(a.storeDir);
        assert.deepStrictEqual(yield* backupHealth(a.call), [200, { state: "ok", set }]);
        // The standby takes none.
        yield* Effect.sleep("500 millis");
        assert.deepStrictEqual(NodeFS.readdirSync(b.storeDir), []);
        assert.deepStrictEqual(NodeFS.readdirSync(b.stagingDir), []);
      }),
    );

    it.effect("is due an hour after the newest staged set, which a restart still tells", () =>
      Effect.gen(function* () {
        const a = yield* startCore(true);
        yield* leading(a);
        const kept = yield* a.backup.take;
        yield* a.stop;
        // The next Core's takeover moves the database: a set taken now would be a new one.
        const b = yield* startCore(true, {
          url: a.url,
          gitRoot: a.gitRoot,
          storeDir: a.storeDir,
          stagingDir: a.stagingDir,
          backupEvery: Duration.hours(1),
          backupCheck: Duration.millis(100),
        });
        yield* leading(b);
        assert.deepStrictEqual(yield* backupHealth(b.call), [200, { state: "ok", set: kept.id }]);
        yield* Effect.sleep("500 millis");
        assert.deepStrictEqual(NodeFS.readdirSync(NodePath.join(b.storeDir, "sets")), [kept.id]);
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
