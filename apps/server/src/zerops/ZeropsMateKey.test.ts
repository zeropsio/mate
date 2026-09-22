import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as itEffect } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, it } from "vite-plus/test";

import {
  extractApiKeyFromStore,
  make,
  requestWithMateKey,
  resolveMateKey,
  snapshotOnlyReader,
} from "./ZeropsMateKey.ts";

/** Hand-built so the fixture stays outside the repo's JSON.stringify ban. */
const storeDoc = (key: string): string => `{"ZCP_API_KEY":"${key}"}`;

describe("extractApiKeyFromStore", () => {
  it.each([
    { name: "reads the field", doc: { ZCP_API_KEY: "live-key" }, expected: "live-key" },
    { name: "trims whitespace", doc: { ZCP_API_KEY: "  live-key  " }, expected: "live-key" },
    { name: "blank string reads as absent", doc: { ZCP_API_KEY: "   " }, expected: undefined },
    { name: "missing field", doc: { OTHER: "x" }, expected: undefined },
    { name: "non-string value", doc: { ZCP_API_KEY: 1 }, expected: undefined },
    { name: "an array is not a store", doc: [1, 2], expected: undefined },
    { name: "null is not a store", doc: null, expected: undefined },
    { name: "a bare string is not a store", doc: "ZCP_API_KEY", expected: undefined },
  ])("$name", ({ doc, expected }) => {
    expect(extractApiKeyFromStore(doc)).toBe(expected);
  });
});

describe("resolveMateKey", () => {
  it("prefers the live store over the boot snapshot", () => {
    const result = resolveMateKey({
      storeRead: Result.succeed("store-key"),
      lastGoodStoreKey: undefined,
      snapshot: "snapshot-key",
    });
    expect(result.key).toBe("store-key");
    expect(result.lastGoodStoreKey).toBe("store-key");
  });

  it("falls back to the boot snapshot when the store has no key", () => {
    const result = resolveMateKey({
      storeRead: Result.succeed(undefined),
      lastGoodStoreKey: undefined,
      snapshot: "snapshot-key",
    });
    expect(result.key).toBe("snapshot-key");
  });

  it("an unreadable store keeps the last good key", () => {
    const result = resolveMateKey({
      storeRead: Result.fail("read error"),
      lastGoodStoreKey: "last-good",
      snapshot: "snapshot-key",
    });
    expect(result.key).toBe("last-good");
    // The last-good marker itself is untouched by a failed read.
    expect(result.lastGoodStoreKey).toBe("last-good");
  });

  it("an unreadable store with no prior good key falls back to the snapshot", () => {
    const result = resolveMateKey({
      storeRead: Result.fail("read error"),
      lastGoodStoreKey: undefined,
      snapshot: "snapshot-key",
    });
    expect(result.key).toBe("snapshot-key");
  });
});

describe("snapshotOnlyReader", () => {
  itEffect.effect("read answers the snapshot and invalidate is a no-op", () =>
    Effect.gen(function* () {
      const reader = snapshotOnlyReader("snapshot-key");
      expect(yield* reader.read).toBe("snapshot-key");
      yield* reader.invalidate;
      expect(yield* reader.read).toBe("snapshot-key");
    }),
  );
});

describe("ZeropsMateKey.make", () => {
  const withStore = (env: string | undefined, snapshot: string | undefined) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-key-" });
      const storePath = path.join(dir, "env.json");
      if (env !== undefined) yield* fs.writeFileString(storePath, env);
      const reader = yield* make({ fs, snapshot, storePath, ttl: Duration.seconds(10) });
      return { reader, storePath, fs };
    });

  itEffect.layer(NodeServices.layer)("live store precedence", (it) => {
    it.effect("prefers the live store over the boot snapshot", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { reader } = yield* withStore(storeDoc("store-key"), "snapshot-key");
          expect(yield* reader.read).toBe("store-key");
        }),
      ),
    );

    it.effect("falls back to the boot snapshot when the store is missing", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { reader } = yield* withStore(undefined, "snapshot-key");
          expect(yield* reader.read).toBe("snapshot-key");
        }),
      ),
    );

    it.effect("an unreadable store keeps the last good key without a restart", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { reader, storePath, fs } = yield* withStore(storeDoc("store-key"), "snapshot-key");
          expect(yield* reader.read).toBe("store-key");
          // The store starts rotating: a rewrite mid-read leaves malformed
          // JSON on disk for an instant. The reader must not fall to the
          // (possibly stale-project) boot snapshot for that.
          yield* fs.writeFileString(storePath, "{not json");
          yield* reader.invalidate;
          expect(yield* reader.read).toBe("store-key");
        }),
      ),
    );

    it.effect("serves from cache within the TTL, re-resolves after invalidate", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { reader, storePath, fs } = yield* withStore(storeDoc("old-key"), "snapshot-key");
          expect(yield* reader.read).toBe("old-key");
          // Rotated on disk, but still within the cache TTL.
          yield* fs.writeFileString(storePath, storeDoc("new-key"));
          expect(yield* reader.read).toBe("old-key");
          yield* reader.invalidate;
          expect(yield* reader.read).toBe("new-key");
        }),
      ),
    );

    it.effect("re-resolves on its own once the TTL elapses", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { reader, storePath, fs } = yield* withStore(storeDoc("old-key"), "snapshot-key");
          expect(yield* reader.read).toBe("old-key");
          yield* fs.writeFileString(storePath, storeDoc("new-key"));
          yield* TestClock.adjust(Duration.seconds(11));
          expect(yield* reader.read).toBe("new-key");
        }),
      ),
    );
  });
});

describe("requestWithMateKey", () => {
  itEffect.effect("no key at all short-circuits without calling request", () =>
    Effect.gen(function* () {
      const reader = snapshotOnlyReader(undefined);
      let calls = 0;
      const result = yield* requestWithMateKey(reader, (token) => {
        calls++;
        return Effect.succeed({ status: 200, token });
      });
      expect(result).toEqual({ token: undefined, response: undefined });
      expect(calls).toBe(0);
    }),
  );

  itEffect.effect("a 200 is returned without a second attempt", () =>
    Effect.gen(function* () {
      const reader = snapshotOnlyReader("key-1");
      let calls = 0;
      const result = yield* requestWithMateKey(reader, (token) => {
        calls++;
        return Effect.succeed({ status: 200, token });
      });
      expect(result).toEqual({ token: "key-1", response: { status: 200, token: "key-1" } });
      expect(calls).toBe(1);
    }),
  );

  itEffect.layer(NodeServices.layer)("retry against a real store", (it) => {
    it.effect("retries once with the rotated key and succeeds", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-key-retry-ok-" });
          const storePath = path.join(dir, "env.json");
          yield* fs.writeFileString(storePath, storeDoc("old-key"));
          const reader = yield* make({ fs, snapshot: undefined, storePath });

          const seen: Array<string> = [];
          const requestOnce = (token: string) =>
            Effect.gen(function* () {
              seen.push(token);
              if (token === "old-key") {
                // The platform rotated the key between the first attempt
                // leaving and its 401 arriving back.
                yield* fs.writeFileString(storePath, storeDoc("new-key"));
                return { status: 401 };
              }
              return { status: 200 };
            });

          const result = yield* requestWithMateKey(reader, requestOnce);
          expect(seen).toEqual(["old-key", "new-key"]);
          expect(result.token).toBe("new-key");
          expect(result.response).toEqual({ status: 200 });
        }),
      ),
    );

    it.effect("never retries more than once even if the retry also fails", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-key-retry-fail-" });
          const storePath = path.join(dir, "env.json");
          yield* fs.writeFileString(storePath, storeDoc("old-key"));
          const reader = yield* make({ fs, snapshot: undefined, storePath });

          let calls = 0;
          const requestAlwaysFails = (token: string) =>
            Effect.gen(function* () {
              calls++;
              if (token === "old-key") {
                yield* fs.writeFileString(storePath, storeDoc("new-key"));
              }
              return { status: 401 };
            });

          const result = yield* requestWithMateKey(reader, requestAlwaysFails);
          expect(calls).toBe(2);
          expect(result.token).toBe("new-key");
          expect(result.response).toEqual({ status: 401 });
        }),
      ),
    );
  });
});
