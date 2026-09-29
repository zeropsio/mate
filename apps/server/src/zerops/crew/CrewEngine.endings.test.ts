// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { CrewThreadDirectory, CrewToolHost } from "./crewSeams.ts";

import { spiEvent, withCrewEngine, type CrewWorld } from "./testing/crewEngineFixture.ts";
import {
  applied,
  command,
  dispatchedOf,
  firstTurn,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";

/** The crewmate's current conversation. */
const currentThread = Effect.map(
  snapshotWhere((current) => current.crewmates[0]!.currentThreadId !== null),
  (snapshot) => snapshot.crewmates[0]!.currentThreadId!,
);

const endsWith = (world: CrewWorld, thread: ThreadId, terminalReason: string) =>
  world.publish(
    spiEvent("turn.completed", thread, {
      state: terminalReason === "completed" ? "completed" : "failed",
      terminalReason,
    }),
  );

/** The person's next message runs a turn in the crewmate's current conversation. */
const nextTurn = (world: CrewWorld, stints: number) =>
  Effect.gen(function* () {
    yield* snapshotWhere((current) => current.crewmates[0]!.stints.length === stints);
    yield* command({ _tag: "message", handle: "backend", text: "Go on", attachments: [] });
    const thread = (yield* dispatchedOf(world, "thread.turn.start")).at(-1)!.threadId;
    yield* world.publish(spiEvent("turn.started", thread, {}));
    return thread;
  });

describe("CrewEngine endings", () => {
  it.live(
    "a conversation that outgrows its context rotates at once; the third time the task stops",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const first = yield* firstTurn(world, () => undefined);
          yield* endsWith(world, first, "prompt_too_long");
          const second = yield* nextTurn(world, 2);
          yield* endsWith(world, second, "rapid_refill_breaker");
          const third = yield* nextTurn(world, 3);
          yield* endsWith(world, third, "prompt_too_long");
          const parked = yield* snapshotWhere(
            (current) => current.board.tasks[0]?.state === "parked",
          );
          assert.deepStrictEqual(
            {
              stints: parked.crewmates[0]!.stints.map((stint) => [stint.state, stint.reason]),
              reason: parked.board.tasks[0]!.reason,
            },
            {
              stints: [
                ["retired", null],
                ["retired", "A fresh conversation: the last one grew too long"],
                ["open", "A fresh conversation: the last one grew too long"],
              ],
              reason: "its conversation outgrew its context too often",
            },
          );
        }),
      ),
  );

  it.live(
    "a turn the provider broke off queues its task again once; the second time it stops",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          yield* endsWith(world, thread, "api_error");
          const again = yield* snapshotWhere(
            (current) =>
              current.board.tasks[0]?.state === "working" && current.board.tasks[0]?.attempts === 2,
          );
          const principal = (yield* Ref.get(world.admitted)).at(-1)?.principal;
          yield* world.publish(spiEvent("turn.started", thread, {}));
          yield* endsWith(world, thread, "model_error");
          const parked = yield* snapshotWhere(
            (current) => current.board.tasks[0]?.state === "parked",
          );
          assert.deepStrictEqual(
            [again.board.tasks[0]!.attempts, principal, parked.board.tasks[0]!.reason],
            [2, { kind: "crew", startedBy: "user-karel" }, "its turn broke off twice"],
          );
        }),
      ),
  );

  it.live("in a run, a new conversation after an overflow carries the task on at once", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* command({
          _tag: "start",
          budgetUsd: "unlimited",
          timeLimitHours: "unlimited",
          stopAtUsagePercent: null,
          landing: "person",
          devGrant: false,
          leadMayStart: false,
        });
        const first = yield* firstTurn(world, () => undefined);
        yield* endsWith(world, first, "prompt_too_long");
        yield* snapshotWhere((current) => current.crewmates[0]!.stints.length === 2);
        const second = yield* currentThread;
        const carried = (yield* dispatchedOf(world, "thread.turn.start")).findLast(
          (turn) => turn.threadId === second,
        );
        assert.deepStrictEqual(carried?.message.text.split("\n").slice(1, 3), [
          "#1 Change a.txt · continues",
          "A fresh conversation: the last one grew too long",
        ]);
      }),
    ),
  );

  it.live("a rotation a turn's start makes counts toward the attempt's two", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const first = yield* firstTurn(world, () => undefined);
        yield* endsWith(world, first, "prompt_too_long");
        yield* snapshotWhere((current) => current.crewmates[0]!.stints.length === 2);
        const second = yield* currentThread;
        const transcript = NodePath.join(world.workspace, "second.jsonl");
        NodeFS.writeFileSync(transcript, "{}\n");
        const member = Option.getOrThrow(yield* (yield* CrewThreadDirectory).memberFor(second));
        yield* (yield* CrewToolHost).sessionStart(member, {
          source: "startup",
          sessionId: "session-2",
          transcriptPath: transcript,
        });
        yield* snapshotWhere((current) => current.crewmates[0]!.stints[1]?.state === "active");
        NodeFS.rmSync(transcript);
        const third = yield* nextTurn(world, 2);
        yield* endsWith(world, third, "prompt_too_long");
        const parked = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "parked",
        );
        assert.deepStrictEqual(
          [parked.crewmates[0]!.stints.map((stint) => stint.reason), parked.board.tasks[0]!.reason],
          [
            [
              null,
              "A fresh conversation: the last one grew too long",
              "A fresh conversation: the last one couldn't be resumed",
            ],
            "its conversation outgrew its context too often",
          ],
        );
      }),
    ),
  );
});
