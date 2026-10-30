import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { layerTest, ServerConfig } from "../config.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import {
  layer,
  makeObserveCredentialFile,
  ZeropsObserveCredentialFile,
} from "./ZeropsObserveCredentialFile.ts";

const fileIn = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "mate-observe-credential-" });
  const directory = path.join(root, ".zcp", "hq");
  const at = path.join(directory, "observe-credential");
  const file = yield* makeObserveCredentialFile(at);
  return { fs, directory, at, file };
});

describe("ZeropsObserveCredentialFile", () => {
  it.effect("keeps the complete Observe credential in an owner-only file and directory", () =>
    Effect.gen(function* () {
      const { fs, directory, at, file } = yield* fileIn;
      assert.isTrue(yield* file.write("zobs.org.first"));
      assert.isTrue(yield* file.write("zobs.org.second"));
      assert.strictEqual(yield* fs.readFileString(at), "zobs.org.second");
      assert.strictEqual((yield* fs.stat(at)).mode & 0o777, 0o600);
      assert.strictEqual((yield* fs.stat(directory)).mode & 0o777, 0o700);
      assert.deepStrictEqual(yield* fs.readDirectory(directory), ["observe-credential"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reports revocation only after removing the Observe credential, including an absent file",
    () =>
      Effect.gen(function* () {
        const { fs, at, file } = yield* fileIn;
        assert.isTrue(yield* file.write(null));
        assert.isTrue(yield* file.write("zobs.org.first"));
        assert.isTrue(yield* file.write(null));
        assert.isFalse(yield* fs.exists(at));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a failed write or removal as unsuccessful", () =>
    Effect.gen(function* () {
      const { fs, directory, at, file } = yield* fileIn;
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* fs.makeDirectory(at);
      yield* fs.writeFileString(`${at}/occupied`, "keep");
      assert.isFalse(yield* file.write("zobs.org.first"));
      assert.isFalse(yield* file.write(null));
      assert.strictEqual(yield* fs.readFileString(`${at}/occupied`), "keep");
      assert.deepStrictEqual(yield* fs.readDirectory(directory), ["observe-credential"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("serializes complete replacements before revocation", () =>
    Effect.gen(function* () {
      const { fs, at } = yield* fileIn;
      const writing = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const file = yield* makeObserveCredentialFile(at).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          rename: (from, to) =>
            Deferred.succeed(writing, undefined).pipe(
              Effect.andThen(Deferred.await(finish)),
              Effect.andThen(fs.rename(from, to)),
            ),
        }),
      );
      const first = yield* file.write("zobs.org.first").pipe(Effect.forkChild);
      yield* Deferred.await(writing);
      const revoke = yield* file.write(null).pipe(Effect.forkChild);
      yield* Deferred.succeed(finish, undefined);
      assert.isTrue(yield* Fiber.join(first));
      assert.isTrue(yield* Fiber.join(revoke));
      assert.isFalse(yield* fs.exists(at));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses Observe delivery outside a Zerops container", () =>
    Effect.gen(function* () {
      const file = yield* ZeropsObserveCredentialFile;
      assert.isFalse(yield* file.write("zobs.org.first"));
      assert.isFalse(yield* file.write(null));
    }).pipe(
      Effect.provide(layer.pipe(Layer.provide(layerTest("/tmp", { prefix: "observe-config-" })))),
      Effect.scoped,
      Effect.provide(NodeServices.layer),
    ),
  );

  it.effect(
    "writes the container's Observe credential under its configured HOME rather than Mate secrets",
    () =>
      Effect.gen(function* () {
        const config = yield* ServerConfig;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const file = yield* ZeropsObserveCredentialFile;
        assert.isTrue(yield* file.write("zobs.org.profile"));
        assert.strictEqual(
          yield* fs.readFileString(path.join(config.homeDir, ".zcp", "hq", "observe-credential")),
          "zobs.org.profile",
        );
        assert.isFalse(yield* fs.exists(path.join(config.secretsDir, "observe-credential")));
      }).pipe(
        Effect.provide(
          layer.pipe(
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
        Effect.provide(NodeServices.layer),
      ),
  );
});
