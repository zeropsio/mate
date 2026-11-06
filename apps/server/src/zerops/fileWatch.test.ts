// @effect-diagnostics nodeBuiltinImport:off
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import { afterAll, beforeAll } from "vite-plus/test";

import { type FileWatch, type WatchDirectory, watchFiles } from "./fileWatch.ts";

/** Directory watches whose events the test fires: the live ones by directory. */
const firedWatch = (onArm: (dir: string) => void = () => undefined) => {
  const live = new Map<string, (event: string, name: string | null) => void>();
  const watch: WatchDirectory = (dir, listener) => {
    onArm(dir);
    live.set(dir, listener);
    const watcher = Object.assign(new NodeEvents.EventEmitter(), {
      close: () => {
        if (live.get(dir) === listener) live.delete(dir);
      },
    });
    return watcher as unknown as NodeFS.FSWatcher;
  };
  const fire = (dir: string, name: string) => Effect.sync(() => live.get(dir)?.("rename", name));
  return { watch, live, fire };
};

/** Whether a wait on `watch` resumes now, without anything more happening. */
const wakes = (watch: FileWatch) =>
  Effect.gen(function* () {
    const waiting = yield* watch.next.pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;
    const woke = waiting.pollUnsafe() !== undefined;
    yield* Fiber.interrupt(waiting);
    return woke;
  });

it.layer(NodeServices.layer)("fileWatch", (it) => {
  let dir: string;
  beforeAll(() => {
    dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mate-file-watch-"));
  });
  afterAll(() => {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });

  it.effect("a file's change wakes its watch, a change of another file beside it does not", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fired = firedWatch();
        const watch = yield* watchFiles([`${dir}/status.json`], fired.watch);

        yield* fired.fire(dir, "status.json.tmp");
        assert.isFalse(yield* wakes(watch), "another file's change");
        yield* fired.fire(dir, "status.json");
        yield* fired.fire(dir, "status.json");
        assert.isTrue(yield* wakes(watch), "its change");
        assert.isFalse(yield* wakes(watch), "two changes before a wait wake it once");
      }),
    ),
  );

  it.effect("a file in directories not made yet is watched for as they appear", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fired = firedWatch();
        const watch = yield* watchFiles([`${dir}/.agent-browser/default.stream`], fired.watch);
        assert.deepStrictEqual([...fired.live.keys()], [dir]);

        yield* fired.fire(dir, "other");
        assert.isFalse(yield* wakes(watch), "another directory appeared");
        yield* fs.makeDirectory(`${dir}/.agent-browser`);
        yield* fired.fire(dir, ".agent-browser");
        assert.deepStrictEqual([...fired.live.keys()], [`${dir}/.agent-browser`]);
        assert.isTrue(yield* wakes(watch), "its directory appeared");
        yield* fired.fire(`${dir}/.agent-browser`, "default.stream");
        assert.isTrue(yield* wakes(watch), "it was written");
      }),
    ),
  );

  it.effect("a directory made while its parent's watch arms moves the watch into it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // `a` appears after the watch looked for it and before its parent's watch armed.
        const fired = firedWatch((armed) => {
          if (armed === dir) NodeFS.mkdirSync(`${dir}/a`, { recursive: true });
        });
        const watch = yield* watchFiles([`${dir}/a/file`], fired.watch);
        assert.deepStrictEqual([...fired.live.keys()], [`${dir}/a`]);
        assert.isTrue(yield* wakes(watch));
      }),
    ),
  );

  it.effect("a watch whose directory went watches for it to come back", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(`${dir}/mac`);
        const fired = firedWatch();
        const watch = yield* watchFiles([`${dir}/mac/view.json`], fired.watch);
        yield* fs.remove(`${dir}/mac`, { recursive: true });
        yield* fired.fire(`${dir}/mac`, "mac");
        assert.deepStrictEqual([...fired.live.keys()], [dir]);
        assert.isTrue(yield* wakes(watch));
      }),
    ),
  );
});
