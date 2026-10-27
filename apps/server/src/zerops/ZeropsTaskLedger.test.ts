import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";

import * as ServerConfig from "../config.ts";
import * as ZeropsTaskLedgerModule from "./ZeropsTaskLedger.ts";
import { ZeropsTaskLedger } from "./ZeropsTaskLedger.ts";

/** A server's ledger, its state kept under `baseDir`. */
const withLedger = <A, E>(body: Effect.Effect<A, E, ZeropsTaskLedger>, baseDir: string) =>
  body.pipe(
    Effect.provide(
      ZeropsTaskLedgerModule.layer.pipe(
        Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

describe("what an automated Mate keeps of its tasks", () => {
  it.effect("a task's stop, limits and spending outlive the Mate's restart", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "task-ledger-" });
      yield* withLedger(
        Effect.gen(function* () {
          const ledger = yield* ZeropsTaskLedger;
          yield* ledger.update("task-1", (entry) => ({
            ...entry,
            limits: { minutes: 30, costUsd: 5 },
            runMs: { "task-task-1/r/1": 120_000 },
            costNano: "2500000000",
            turns: ["ses_1/turn-1"],
          }));
          yield* ledger.update("task-1", (entry) => ({
            ...entry,
            stopped: "The issue was closed.",
          }));
        }),
        baseDir,
      );
      const kept = yield* withLedger(
        Effect.gen(function* () {
          return yield* (yield* ZeropsTaskLedger).entry("task-1");
        }),
        baseDir,
      );
      assert.deepStrictEqual(kept, {
        limits: { minutes: 30, costUsd: 5 },
        runMs: { "task-task-1/r/1": 120_000 },
        costNano: "2500000000",
        turns: ["ses_1/turn-1"],
        stopped: "The issue was closed.",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("a write the Mate could not finish never leaves its ledger half written", () =>
    Effect.gen(function* () {
      const real = yield* FileSystem.FileSystem;
      const baseDir = yield* real.makeTempDirectoryScoped({ prefix: "task-ledger-" });
      const crash = { now: false };
      // A disk that dies halfway through a write: half the words land, then the write fails.
      const died = (path: string) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "Unknown",
            module: "FileSystem",
            method: "write",
            pathOrDescriptor: path,
          }),
        );
      const dying = Layer.succeed(FileSystem.FileSystem, {
        ...real,
        writeFileString: (path, data, options) =>
          crash.now
            ? real
                .writeFileString(path, data.slice(0, Math.floor(data.length / 2)), options)
                .pipe(Effect.andThen(died(path)))
            : real.writeFileString(path, data, options),
        open: (path, options) =>
          Effect.map(real.open(path, options), (file) => {
            const writeAll = (buffer: Uint8Array) =>
              crash.now
                ? file
                    .writeAll(buffer.subarray(0, Math.floor(buffer.length / 2)))
                    .pipe(Effect.andThen(died(path)))
                : file.writeAll(buffer);
            return new Proxy(file, {
              get: (target, key) => (key === "writeAll" ? writeAll : Reflect.get(target, key)),
            });
          }),
      });
      yield* Effect.gen(function* () {
        const ledger = yield* ZeropsTaskLedger;
        yield* ledger.update("task-1", (entry) => ({ ...entry, stopped: "The issue was closed." }));
        crash.now = true;
        yield* ledger.update("task-2", (entry) => ({ ...entry, costNano: "1000000000" }));
      }).pipe(
        Effect.provide(
          ZeropsTaskLedgerModule.layer.pipe(
            Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
            Layer.provide(dying),
            Layer.provide(NodeServices.layer),
          ),
        ),
      );
      const kept = yield* withLedger(
        Effect.gen(function* () {
          return yield* (yield* ZeropsTaskLedger).entry("task-1");
        }),
        baseDir,
      );
      assert.strictEqual(kept?.stopped, "The issue was closed.");
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
