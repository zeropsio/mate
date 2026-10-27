// @effect-diagnostics nodeBuiltinImport:off -- the case recomputes the SHA-256 fingerprint.
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { makeGitCredentialFile } from "./ZeropsGitCredentialFile.ts";

/** A credential file in a fresh directory of its own, and what that directory holds. */
const fileIn = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "mate-git-credential-" });
  const at = path.join(root, "hq", "git-credential");
  const file = yield* makeGitCredentialFile(at);
  const listing = fs.readDirectory(path.dirname(at));
  return { fs, at, file, listing };
});

describe("ZeropsGitCredentialFile", () => {
  it.effect(
    "keeps HQ's Git credential in its file, readable by its own user only, written whole in one rename",
    () =>
      Effect.gen(function* () {
        const { fs, at, file, listing } = yield* fileIn;
        assert.isFalse(yield* file.held);
        yield* file.write("gc-1");
        yield* file.write("gc-2");
        assert.strictEqual(yield* fs.readFileString(at), "gc-2");
        assert.strictEqual((yield* fs.stat(at)).mode & 0o777, 0o600);
        assert.deepStrictEqual(yield* listing, ["git-credential"]);
        assert.isTrue(yield* file.held);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "removes the file when HQ revokes the credential, and a revoke with no file is no fault",
    () =>
      Effect.gen(function* () {
        const { file, listing } = yield* fileIn;
        yield* file.write(null);
        yield* file.write("gc-1");
        yield* file.write(null);
        assert.isFalse(yield* file.held);
        assert.deepStrictEqual(yield* listing, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "reports the fingerprint of the credential it holds, the digest of the credential's digest, and none while it holds none",
    () =>
      Effect.gen(function* () {
        const { file } = yield* fileIn;
        assert.isTrue(Option.isNone(yield* file.fingerprint));
        yield* file.write("ORG.secret-1");
        const digest = (value: string) =>
          NodeCrypto.createHash("sha256").update(value).digest("hex");
        assert.deepStrictEqual(
          yield* file.fingerprint,
          Option.some(digest(digest("ORG.secret-1"))),
        );
        yield* file.write("ORG.secret-2");
        assert.deepStrictEqual(
          yield* file.fingerprint,
          Option.some(digest(digest("ORG.secret-2"))),
        );
        yield* file.write(null);
        assert.isTrue(Option.isNone(yield* file.fingerprint));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
