import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

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
});
