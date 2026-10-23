import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { layerTest as serverConfigTest } from "../config.ts";
import { ZeropsRepositorySource } from "../zerops/ZeropsRepositorySource.ts";
import { sweepCheckpointRefs } from "./checkpointRefsSweep.ts";
import * as VcsProcess from "./VcsProcess.ts";

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const vcs = yield* VcsProcess.VcsProcess;
    const output = yield* vcs.run({ operation: "test.git", command: "git", args, cwd });
    return output.stdout.trim();
  });

const refsOf = (cwd: string) =>
  Effect.map(git(cwd, ["for-each-ref", "--format=%(refname)"]), (out) =>
    out.split("\n").filter((ref) => ref.length > 0),
  );

const SNAPSHOT_REFS = [
  "refs/t3/checkpoints/dGhyZWFkLTE/turn/0",
  "refs/t3/checkpoints/dGhyZWFkLTE/turn/1",
  "refs/t3/checkpoints/dGhyZWFkLTI/turn/1",
];

/** A source listing `repositories`, each named after its folder. */
const sourceOf = (repositories: ReadonlyArray<{ mountPath: string; kind?: "lease" }>) =>
  Layer.succeed(
    ZeropsRepositorySource,
    ZeropsRepositorySource.of({
      list: Effect.succeed({
        _tag: "available",
        repositories: repositories.map((repository) => ({
          ...repository,
          host: repository.mountPath.split("/").at(-1)!,
          remotePath: "/var/www",
        })),
      }),
      refresh: Effect.die("not read"),
      known: Effect.succeed([]),
      remember: () => Effect.void,
    }),
  );

/** A service checkout with the capture's snapshot refs of two conversations beside its own refs. */
const checkoutWithSnapshots = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "checkpoint-refs-sweep-" });
  yield* git(cwd, ["init", "--initial-branch=main"]);
  yield* git(cwd, ["config", "user.email", "test@test.com"]);
  yield* git(cwd, ["config", "user.name", "Test"]);
  yield* git(cwd, ["commit", "--allow-empty", "-m", "initial"]);
  const head = yield* git(cwd, ["rev-parse", "HEAD"]);
  for (const ref of [...SNAPSHOT_REFS, "refs/heads/crew/backend"]) {
    yield* git(cwd, ["update-ref", ref, head]);
  }
  return cwd;
});

it.effect(
  "a start deletes the snapshot refs the removed workspace capture left in a Mate's checkouts, and nothing else",
  () =>
    Effect.gen(function* () {
      const apidev = yield* checkoutWithSnapshots;
      const appdev = yield* checkoutWithSnapshots;
      const source = sourceOf([{ mountPath: apidev }, { mountPath: appdev }]);

      yield* sweepCheckpointRefs.pipe(
        Effect.provide(Layer.merge(source, serverConfigTest("/nowhere", { prefix: "sweep" }))),
      );

      for (const cwd of [apidev, appdev]) {
        assert.deepStrictEqual(yield* refsOf(cwd), ["refs/heads/crew/backend", "refs/heads/main"]);
      }
    }).pipe(
      Effect.scoped,
      Effect.provide(VcsProcess.layer.pipe(Layer.provideMerge(NodeServices.layer))),
    ),
);

it.effect("a start never sweeps the refs of a pool container a thread's agent leased", () =>
  Effect.gen(function* () {
    const appdev = yield* checkoutWithSnapshots;
    const webpool = yield* checkoutWithSnapshots;
    const before = yield* refsOf(webpool);

    yield* sweepCheckpointRefs.pipe(
      Effect.provide(
        Layer.merge(
          sourceOf([{ mountPath: appdev }, { mountPath: webpool, kind: "lease" }]),
          serverConfigTest("/nowhere", { prefix: "sweep" }),
        ),
      ),
    );

    assert.deepStrictEqual(yield* refsOf(appdev), ["refs/heads/crew/backend", "refs/heads/main"]);
    assert.deepStrictEqual(yield* refsOf(webpool), before);
    assert.includeMembers(before, SNAPSHOT_REFS);
  }).pipe(
    Effect.scoped,
    Effect.provide(VcsProcess.layer.pipe(Layer.provideMerge(NodeServices.layer))),
  ),
);
