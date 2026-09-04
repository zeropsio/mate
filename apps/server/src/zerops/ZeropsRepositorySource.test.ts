import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";

import {
  MOUNT_TABLE_PATH,
  MountTableReadError,
  REPOSITORY_CACHE_TTL,
  makeZeropsRepositorySource,
  parseMountTable,
} from "./ZeropsRepositorySource.ts";

/**
 * `/proc/mounts` lines for `s3git1`, `s3git2` and `weatherdash`, measured on
 * `z3-eval` 2026-09-04 (ledger row in `verified.md`): one line per mounted dev
 * service, shape `<host>:/var/www /var/www/<host> fuse.sshfs
 * rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0`.
 */
const MEASURED_MOUNT_TABLE = [
  "s3git1:/var/www /var/www/s3git1 fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0",
  "s3git2:/var/www /var/www/s3git2 fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0",
  "weatherdash:/var/www /var/www/weatherdash fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0",
].join("\n");

/** A probe that always answers `mounted`. */
const alwaysMounted = (_path: string) => Effect.succeed(true);

describe("parseMountTable", () => {
  it("lists a repository per fuse.sshfs mount under /var/www", () => {
    assert.deepStrictEqual(parseMountTable(MEASURED_MOUNT_TABLE), [
      { host: "s3git1", mountPath: "/var/www/s3git1" },
      { host: "s3git2", mountPath: "/var/www/s3git2" },
      { host: "weatherdash", mountPath: "/var/www/weatherdash" },
    ]);
  });

  it("ignores non-sshfs mounts and mounts outside /var/www", () => {
    const table = [
      "overlay / overlay rw,relatime,lowerdir=/,upperdir=/upper 0 0",
      "proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0",
      "tmpfs /var/www/scratch tmpfs rw,relatime 0 0",
      "otherhost:/var/www /mnt/otherhost fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0",
      "kanbandev:/var/www /var/www/kanbandev fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0",
    ].join("\n");

    assert.deepStrictEqual(parseMountTable(table), [
      { host: "kanbandev", mountPath: "/var/www/kanbandev" },
    ]);
  });
});

describe("ZeropsRepositorySource", () => {
  it.effect("is disabled off Zerops and never reads the mount table", () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      const source = yield* makeZeropsRepositorySource({
        enabled: false,
        readMountTable: Ref.update(reads, (n) => n + 1).pipe(Effect.andThen(Effect.succeed(""))),
        probeMountpoint: alwaysMounted,
      });

      const result = yield* source.list;

      assert.strictEqual(result._tag, "disabled");
      assert.strictEqual(yield* Ref.get(reads), 0);
    }),
  );

  it.effect("drops a mount whose probe times out and keeps the others", () =>
    Effect.gen(function* () {
      const source = yield* makeZeropsRepositorySource({
        enabled: true,
        readMountTable: Effect.succeed(MEASURED_MOUNT_TABLE),
        // The bounded probe reports a timeout as `false`, never a failure.
        probeMountpoint: (path) => Effect.succeed(!path.endsWith("/s3git2")),
      });

      const result = yield* source.list;

      assert.strictEqual(result._tag, "available");
      if (result._tag === "available") {
        assert.deepStrictEqual(
          result.repositories.map((repository) => repository.host),
          ["s3git1", "weatherdash"],
        );
      }
    }),
  );

  it.effect(
    "reports unavailable when the mount table cannot be read and never empties the set on that path",
    () =>
      Effect.gen(function* () {
        const source = yield* makeZeropsRepositorySource({
          enabled: true,
          readMountTable: Effect.fail(
            new MountTableReadError({ path: MOUNT_TABLE_PATH, cause: "EACCES" }),
          ),
          probeMountpoint: alwaysMounted,
        });

        const result = yield* source.list;

        assert.strictEqual(result._tag, "unavailable");
        if (result._tag === "unavailable") {
          assert.include(result.reason, MOUNT_TABLE_PATH);
        }
      }),
  );

  it.effect("keeps the 30 s cache and refreshes at turn start", () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      const readMountTable = Ref.updateAndGet(reads, (n) => n + 1).pipe(
        Effect.map(() => MEASURED_MOUNT_TABLE),
      );
      const source = yield* makeZeropsRepositorySource({
        enabled: true,
        readMountTable,
        probeMountpoint: alwaysMounted,
      });

      yield* source.list;
      yield* TestClock.adjust(Duration.millis(Duration.toMillis(REPOSITORY_CACHE_TTL) - 1));
      yield* source.list;
      assert.strictEqual(yield* Ref.get(reads), 1, "still inside the TTL");

      yield* TestClock.adjust(Duration.millis(1));
      yield* source.list;
      assert.strictEqual(yield* Ref.get(reads), 2, "TTL elapsed");

      // A turn start calls `refresh`, which bypasses the cache unconditionally.
      yield* source.refresh;
      assert.strictEqual(yield* Ref.get(reads), 3);
    }),
  );
});
