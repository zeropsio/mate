// @effect-diagnostics nodeBuiltinImport:off -- CR11 recomputes the SHA-256 fingerprint.
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";

import { layerTest, ServerConfig } from "../../config.ts";
import { resolveZeropsEnvironment } from "../ZeropsEnvironment.ts";
import { makeGitCredentialFile } from "../ZeropsGitCredentialFile.ts";
import {
  extractApiKeyFromStore,
  make,
  requestWithMateKey,
  resolveMateKey,
  snapshotOnlyReader,
} from "../ZeropsMateKey.ts";
import {
  layer as observeCredentialLayer,
  makeObserveCredentialFile,
  ZeropsObserveCredentialFile,
} from "../ZeropsObserveCredentialFile.ts";

/** Hand-built so the fixture stays outside the repo's JSON.stringify ban. */
const storeDoc = (key: string): string => `{"ZCP_API_KEY":"${key}"}`;

/** A watch that never fires on its own. */
const noWatch = () => ({ dispose: () => {} });

// witness: apps/server/src/zerops/ZeropsMateKey.ts | if (input.lastGoodStoreKey !== undefined) { → if (input.lastGoodStoreKey === undefined) {
it("CR1: The Mate's own Zerops key is the env store's `ZCP_API_KEY` when the store carries one, the boot snapshot when it carries none, and when the store cannot be read the last key read from it, else the snapshot", () => {
  const fromStore = resolveMateKey({
    storeRead: Result.succeed("store-key"),
    lastGoodStoreKey: undefined,
    snapshot: "snapshot-key",
  });
  expect(fromStore.key).toBe("store-key");
  expect(fromStore.lastGoodStoreKey).toBe("store-key");

  const storeWithoutKey = resolveMateKey({
    storeRead: Result.succeed(undefined),
    lastGoodStoreKey: undefined,
    snapshot: "snapshot-key",
  });
  expect(storeWithoutKey.key).toBe("snapshot-key");

  const unreadableAfterGood = resolveMateKey({
    storeRead: Result.fail("read error"),
    lastGoodStoreKey: "last-good",
    snapshot: "snapshot-key",
  });
  expect(unreadableAfterGood.key).toBe("last-good");
  expect(unreadableAfterGood.lastGoodStoreKey).toBe("last-good");

  const unreadableNeverGood = resolveMateKey({
    storeRead: Result.fail("read error"),
    lastGoodStoreKey: undefined,
    snapshot: "snapshot-key",
  });
  expect(unreadableNeverGood.key).toBe("snapshot-key");
});

// witness: apps/server/src/zerops/ZeropsMateKey.ts | return trimmed.length > 0 ? trimmed : undefined; → return trimmed;
it("CR2: An env store whose `ZCP_API_KEY` is blank, not a string or missing, or which is not a flat object, carries no key, and a key's surrounding whitespace is not part of it", () => {
  for (const [doc, expected] of [
    [{ ZCP_API_KEY: "live-key" }, "live-key"],
    [{ ZCP_API_KEY: "  live-key  " }, "live-key"],
    [{ ZCP_API_KEY: "   " }, undefined],
    [{ OTHER: "x" }, undefined],
    [{ ZCP_API_KEY: 1 }, undefined],
    [[1, 2], undefined],
    [null, undefined],
    ["ZCP_API_KEY", undefined],
  ] as const) {
    expect(extractApiKeyFromStore(doc)).toBe(expected);
  }
});

// witness: apps/server/src/zerops/ZeropsMateKey.ts | if (cached !== undefined && cached.changes === changes) return cached; → if (cached !== undefined) return cached;
it.effect(
  "CR3: The Mate's key is read again when the env store changes, and never because time passed",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "mate-key-" });
      const storePath = path.join(dir, "env.json");
      yield* fs.writeFileString(storePath, storeDoc("old-key"));
      const watched: Array<{ readonly target: string; readonly onChange: () => void }> = [];
      const reader = yield* make({
        fs,
        snapshot: "snapshot-key",
        storePath,
        watch: (target, onChange) => {
          watched.push({ target, onChange });
          return { dispose: () => {} };
        },
      });
      expect(watched.map((watch) => watch.target)).toEqual([storePath]);
      expect(yield* reader.read).toBe("old-key");
      yield* fs.writeFileString(storePath, storeDoc("new-key"));
      yield* TestClock.adjust(Duration.hours(1));
      expect(yield* reader.read).toBe("old-key");
      watched[0]!.onChange();
      expect(yield* reader.read).toBe("new-key");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsMateKey.ts | if (response1.status !== 401 && response1.status !== 403) { → if (response1.status !== 403) {
it.effect(
  "CR4: An own-key request refused with 401 or 403 is sent once more with the key read again, and a key still refused is not tried a third time",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      for (const status of [401, 403]) {
        const okDir = yield* fs.makeTempDirectoryScoped({ prefix: `mate-key-retry-ok-${status}-` });
        const okStore = path.join(okDir, "env.json");
        yield* fs.writeFileString(okStore, storeDoc("old-key"));
        const okReader = yield* make({
          fs,
          snapshot: undefined,
          storePath: okStore,
          watch: noWatch,
        });
        const seen: Array<string> = [];
        const retried = yield* requestWithMateKey(okReader, (token) =>
          Effect.gen(function* () {
            seen.push(token);
            if (token === "old-key") {
              // The platform rotated the key between the first attempt leaving and its refusal arriving.
              yield* fs.writeFileString(okStore, storeDoc("new-key"));
              return { status };
            }
            return { status: 200 };
          }),
        );
        expect(seen).toEqual(["old-key", "new-key"]);
        expect(retried.token).toBe("new-key");
        expect(retried.response).toEqual({ status: 200 });

        const failDir = yield* fs.makeTempDirectoryScoped({
          prefix: `mate-key-retry-fail-${status}-`,
        });
        const failStore = path.join(failDir, "env.json");
        yield* fs.writeFileString(failStore, storeDoc("old-key"));
        const failReader = yield* make({
          fs,
          snapshot: undefined,
          storePath: failStore,
          watch: noWatch,
        });
        let calls = 0;
        const refused = yield* requestWithMateKey(failReader, (token) =>
          Effect.gen(function* () {
            calls++;
            if (token === "old-key") {
              yield* fs.writeFileString(failStore, storeDoc("new-key"));
            }
            return { status };
          }),
        );
        expect(calls).toBe(2);
        expect(refused.token).toBe("new-key");
        expect(refused.response).toEqual({ status });
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsMateKey.ts | if (token1 === undefined) return { token: undefined, response: undefined }; → if (token1 === "") return { token: undefined, response: undefined };
it.effect("CR5: With no key at all, no own-key request is sent", () =>
  Effect.gen(function* () {
    let calls = 0;
    const result = yield* requestWithMateKey(snapshotOnlyReader(undefined), (token) => {
      calls++;
      return Effect.succeed({ status: 200, token });
    });
    expect(result).toEqual({ token: undefined, response: undefined });
    expect(calls).toBe(0);
  }),
);

// witness: apps/server/src/zerops/ZeropsObserveCredentialFile.ts | yield* fs.chmod(staged, 0o600); → yield* fs.chmod(staged, 0o644);
it.effect(
  "CR6: The Observe credential is kept whole in a file only its user can read (0600), in a directory only its user can enter (0700), replaced in one rename that leaves no staged file",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "mate-observe-credential-" });
      const directory = path.join(root, ".zcp", "hq");
      const at = path.join(directory, "observe-credential");
      const file = yield* makeObserveCredentialFile(at);
      assert.isTrue(yield* file.write("zobs.org.first"));
      assert.isTrue(yield* file.write("zobs.org.second"));
      assert.strictEqual(yield* fs.readFileString(at), "zobs.org.second");
      assert.strictEqual((yield* fs.stat(at)).mode & 0o777, 0o600);
      assert.strictEqual((yield* fs.stat(directory)).mode & 0o777, 0o700);
      assert.deepStrictEqual(yield* fs.readDirectory(directory), ["observe-credential"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsObserveCredentialFile.ts | (credential === null ? fs.remove(at, { force: true }) : keep(credential)).pipe( → (credential === null ? fs.remove(at) : keep(credential)).pipe(
it.effect(
  "CR7: Revoking the Observe credential reports success once the file is gone, an absent file included, and a write or removal that fails reports failure and leaves what was there",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const revokedRoot = yield* fs.makeTempDirectoryScoped({ prefix: "mate-observe-credential-" });
      const revokedAt = path.join(revokedRoot, ".zcp", "hq", "observe-credential");
      const revoked = yield* makeObserveCredentialFile(revokedAt);
      assert.isTrue(yield* revoked.write(null));
      assert.isTrue(yield* revoked.write("zobs.org.first"));
      assert.isTrue(yield* revoked.write(null));
      assert.isFalse(yield* fs.exists(revokedAt));

      const occupiedRoot = yield* fs.makeTempDirectoryScoped({
        prefix: "mate-observe-credential-",
      });
      const occupiedDirectory = path.join(occupiedRoot, ".zcp", "hq");
      const occupiedAt = path.join(occupiedDirectory, "observe-credential");
      const occupied = yield* makeObserveCredentialFile(occupiedAt);
      yield* fs.makeDirectory(occupiedDirectory, { recursive: true });
      yield* fs.makeDirectory(occupiedAt);
      yield* fs.writeFileString(`${occupiedAt}/occupied`, "keep");
      assert.isFalse(yield* occupied.write("zobs.org.first"));
      assert.isFalse(yield* occupied.write(null));
      assert.strictEqual(yield* fs.readFileString(`${occupiedAt}/occupied`), "keep");
      assert.deepStrictEqual(yield* fs.readDirectory(occupiedDirectory), ["observe-credential"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsObserveCredentialFile.ts | const writes = yield* Semaphore.make(1); → const writes = yield* Semaphore.make(2);
it.effect(
  "CR8: A revocation that arrives while the Observe credential is being written waits for the write, so the credential ends removed",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "mate-observe-credential-" });
      const at = path.join(root, ".zcp", "hq", "observe-credential");
      const writing = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      // A removal of the credential that began during the held rename lands before it, as it
      // would have on disk: the case does not depend on which of the two I/O calls Node ends first.
      let removing = false;
      const removed = yield* Deferred.make<void>();
      const file = yield* makeObserveCredentialFile(at).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          remove: (target, options) =>
            target === at
              ? Effect.sync(() => {
                  removing = true;
                }).pipe(
                  Effect.andThen(fs.remove(target, options)),
                  Effect.ensuring(Deferred.succeed(removed, undefined)),
                )
              : fs.remove(target, options),
          rename: (from, to) =>
            Deferred.succeed(writing, undefined).pipe(
              Effect.andThen(Deferred.await(finish)),
              Effect.andThen(
                Effect.suspend(() => (removing ? Deferred.await(removed) : Effect.void)),
              ),
              Effect.andThen(fs.rename(from, to)),
            ),
        }),
      );
      const first = yield* file.write("zobs.org.first").pipe(Effect.forkChild);
      yield* Deferred.await(writing);
      // Started at once, so the revocation has arrived before the write is let finish.
      const revoke = yield* file.write(null).pipe(Effect.forkChild({ startImmediately: true }));
      yield* Deferred.succeed(finish, undefined);
      assert.isTrue(yield* Fiber.join(first));
      assert.isTrue(yield* Fiber.join(revoke));
      assert.isFalse(yield* fs.exists(at));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsObserveCredentialFile.ts | path.join(config.homeDir, ".zcp", "hq", "observe-credential"), → path.join(config.secretsDir, "observe-credential"),
it.effect(
  "CR9: Outside a Zerops container Observe delivery is refused, and inside one the credential goes to `.zcp/hq/observe-credential` under the Mate's home, never among the Mate's secrets",
  () =>
    Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const file = yield* ZeropsObserveCredentialFile;
        assert.isFalse(yield* file.write("zobs.org.first"));
        assert.isFalse(yield* file.write(null));
      }).pipe(
        Effect.provide(
          observeCredentialLayer.pipe(
            Layer.provide(layerTest("/tmp", { prefix: "observe-config-" })),
          ),
        ),
        Effect.scoped,
      );

      yield* Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const file = yield* ZeropsObserveCredentialFile;
        const home = path.join(config.homeDir, ".zcp", "hq", "observe-credential");
        assert.isTrue(yield* file.write("zobs.org.profile"));
        assert.isTrue(yield* fs.exists(home));
        assert.strictEqual(yield* fs.readFileString(home), "zobs.org.profile");
        assert.isFalse(yield* fs.exists(path.join(config.secretsDir, "observe-credential")));
      }).pipe(
        Effect.provide(
          observeCredentialLayer.pipe(
            Layer.provideMerge(
              Layer.effect(
                ServerConfig,
                Effect.gen(function* () {
                  const config = yield* ServerConfig;
                  return {
                    ...config,
                    zerops: resolveZeropsEnvironment({ projectId: "project", apiHost: undefined }),
                  };
                }),
              ).pipe(Layer.provide(layerTest("/tmp", { prefix: "observe-home-" }))),
            ),
          ),
        ),
        Effect.scoped,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsGitCredentialFile.ts | yield* fs.chmod(staged, OWNER_ONLY); → yield* fs.chmod(staged, 0o644);
it.effect(
  "CR10: HQ's Git credential is kept whole in a file only its user can read (0600), replaced in one rename that leaves no staged file, and HQ's revocation removes it, a revocation with no file being no fault",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const keptRoot = yield* fs.makeTempDirectoryScoped({ prefix: "mate-git-credential-" });
      const keptAt = path.join(keptRoot, "hq", "git-credential");
      const kept = yield* makeGitCredentialFile(keptAt);
      assert.isFalse(yield* kept.held);
      yield* kept.write("gc-1");
      yield* kept.write("gc-2");
      assert.strictEqual(yield* fs.readFileString(keptAt), "gc-2");
      assert.strictEqual((yield* fs.stat(keptAt)).mode & 0o777, 0o600);
      assert.deepStrictEqual(yield* fs.readDirectory(path.dirname(keptAt)), ["git-credential"]);
      assert.isTrue(yield* kept.held);

      const revokedRoot = yield* fs.makeTempDirectoryScoped({ prefix: "mate-git-credential-" });
      const revokedAt = path.join(revokedRoot, "hq", "git-credential");
      const revoked = yield* makeGitCredentialFile(revokedAt);
      yield* revoked.write(null);
      yield* revoked.write("gc-1");
      yield* revoked.write(null);
      assert.isFalse(yield* revoked.held);
      assert.deepStrictEqual(yield* fs.readDirectory(path.dirname(revokedAt)), []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// witness: apps/server/src/zerops/ZeropsGitCredentialFile.ts | export const fingerprintOf = (credential: string) => sha256(sha256(credential)); → export const fingerprintOf = (credential: string) => sha256(credential);
it.effect(
  "CR11: The Mate reports the fingerprint of the Git credential it holds as the SHA-256 of the credential's SHA-256, and none while it holds none",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "mate-git-credential-" });
      const file = yield* makeGitCredentialFile(path.join(root, "hq", "git-credential"));
      const digest = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");
      assert.isTrue(Option.isNone(yield* file.fingerprint));
      yield* file.write("ORG.secret-1");
      assert.deepStrictEqual(yield* file.fingerprint, Option.some(digest(digest("ORG.secret-1"))));
      yield* file.write("ORG.secret-2");
      assert.deepStrictEqual(yield* file.fingerprint, Option.some(digest(digest("ORG.secret-2"))));
      yield* file.write(null);
      assert.isTrue(Option.isNone(yield* file.fingerprint));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
