// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { spiEvent, withCrewEngine, type CrewWorld } from "./testing/crewEngineFixture.ts";
import {
  applied,
  command,
  dispatchedOf,
  firstTurn,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";

const endsWith = (world: CrewWorld, thread: ThreadId, terminalReason: string) =>
  world.publish(
    spiEvent("turn.completed", thread, {
      state: terminalReason === "completed" ? "completed" : "failed",
      terminalReason,
    }),
  );

describe("CrewEngine endings", () => {
  for (const terminalReason of ["api_error", "model_error", "turn_setup_failed"]) {
    it.live(`${terminalReason} ends visibly without another turn or committing dirty work`, () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const copy = NodePath.join(world.root, ".crew/backend");
          const thread = yield* firstTurn(world, () =>
            NodeFS.writeFileSync(NodePath.join(copy, "dirty.txt"), "keep this work\n"),
          );
          const turns = (yield* dispatchedOf(world, "thread.turn.start")).length;
          yield* endsWith(world, thread, terminalReason);
          const stopped = yield* snapshotWhere(
            (frame) =>
              frame.attention.some((need) => need.kind === "interrupted") &&
              frame.crewmates[0]?.lane?.dirty === true,
          );
          const operation = stopped.attention.find(
            (need) => need.kind === "interrupted",
          )!.operation!;
          assert.strictEqual(operation.status, "interrupted");
          assert.strictEqual(stopped.board.tasks[0]!.attempts, 1);
          assert.strictEqual(stopped.crewmates[0]!.lane?.dirty, true);
          assert.strictEqual((yield* dispatchedOf(world, "thread.turn.start")).length, turns);
          yield* command({
            _tag: "operationContinue",
            handle: "backend",
            operationId: operation.id,
          });
          assert.strictEqual((yield* dispatchedOf(world, "thread.turn.start")).length, turns + 1);
        }),
      ),
    );
  }

  for (const terminalReason of ["prompt_too_long", "rapid_refill_breaker"]) {
    it.live(`${terminalReason} waits for Continue before rotating its conversation`, () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            NodeFS.writeFileSync(
              NodePath.join(world.root, ".crew/backend/dirty.txt"),
              "keep overflow edits\n",
            ),
          );
          yield* endsWith(world, thread, terminalReason);
          const stopped = yield* snapshotWhere(
            (frame) =>
              frame.attention.some((need) => need.kind === "interrupted") &&
              frame.crewmates[0]?.lane?.dirty === true,
          );
          assert.strictEqual(stopped.crewmates[0]!.lane?.dirty, true);
          assert.strictEqual(stopped.crewmates[0]!.stints.length, 1);
          assert.strictEqual((yield* dispatchedOf(world, "thread.turn.start")).length, 1);
          const operation = stopped.attention.find(
            (need) => need.kind === "interrupted",
          )!.operation!;
          yield* command({
            _tag: "operationContinue",
            handle: "backend",
            operationId: operation.id,
          });
          const continued = yield* snapshotWhere(
            (frame) => frame.crewmates[0]!.stints.length === 2,
          );
          assert.strictEqual(
            continued.crewmates[0]!.stints[1]!.reason,
            "A fresh conversation: the last one grew too long",
          );
          assert.strictEqual((yield* dispatchedOf(world, "thread.turn.start")).length, 2);
        }),
      ),
    );
  }
});
