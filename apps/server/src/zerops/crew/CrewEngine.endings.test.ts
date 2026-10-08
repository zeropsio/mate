// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  AS_CREW,
  applied,
  crewJourney,
  firstTurn,
  lastAdmitted,
  turnsSent,
  type CrewChat,
  type CrewWorld,
  itV1,
} from "./testing/crewWorld.ts";

/** The crewmate's current conversation. */
const currentChat = (world: CrewWorld) =>
  Effect.map(
    world.snapshotWhere((current) => current.crewmates[0]!.currentThreadId !== null),
    (snapshot) => snapshot.crewmates[0]!.currentThreadId!,
  );

const endsWith = (world: CrewWorld, chat: CrewChat, reason: string) =>
  world.turnEnds(chat, { state: reason === "completed" ? "completed" : "failed", reason });

/** The person's next message runs a turn in the crewmate's current conversation. */
const nextTurn = (world: CrewWorld, stints: number) =>
  Effect.gen(function* () {
    yield* world.sessionsWhere("backend", (sessions) => sessions.count === stints);
    yield* world.press({ _tag: "message", handle: "backend", text: "Go on", attachments: [] });
    const chat = (yield* turnsSent(world)).at(-1)!.chat;
    yield* world.turnStarts(chat);
    return chat;
  });

describe("CrewEngine endings", () => {
  it.live(
    "a conversation that outgrows its context rotates at once; the third time the task stops",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const first = yield* firstTurn(world, () => undefined);
          yield* endsWith(world, first, "prompt_too_long");
          const second = yield* nextTurn(world, 2);
          yield* endsWith(world, second, "rapid_refill_breaker");
          const third = yield* nextTurn(world, 3);
          yield* endsWith(world, third, "prompt_too_long");
          const parked = yield* world.snapshotWhere(
            (current) => current.board.tasks[0]?.state === "parked",
          );
          assert.deepStrictEqual(
            {
              stints: yield* world.sessionsWhere("backend", () => true),
              reason: parked.board.tasks[0]!.reason,
            },
            {
              stints: {
                count: 3,
                latest: "open",
                reasons: [
                  null,
                  "A fresh conversation: the last one grew too long",
                  "A fresh conversation: the last one grew too long",
                ],
              },
              reason: "its conversation outgrew its context too often",
            },
          );
        }),
      ),
  );

  it.live(
    "a turn the provider broke off queues its task again once; the second time it stops",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          yield* endsWith(world, thread, "api_error");
          const again = yield* world.snapshotWhere(
            (current) =>
              current.board.tasks[0]?.state === "working" && current.board.tasks[0]?.attempts === 2,
          );
          const principal = yield* lastAdmitted(world);
          yield* world.turnStarts(thread);
          yield* endsWith(world, thread, "model_error");
          const parked = yield* world.snapshotWhere(
            (current) => current.board.tasks[0]?.state === "parked",
          );
          assert.deepStrictEqual(
            [again.board.tasks[0]!.attempts, principal, parked.board.tasks[0]!.reason],
            [2, AS_CREW, "its turn broke off twice"],
          );
        }),
      ),
  );

  it.live("Try again gives a task its one re-queue after a broken-off turn back", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () => undefined);
        yield* endsWith(world, thread, "api_error");
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.attempts === 2);
        yield* world.turnStarts(thread);
        yield* endsWith(world, thread, "model_error");
        const parked = yield* world.snapshotWhere(
          (current) => current.board.tasks[0]?.state === "parked",
        );
        yield* world.press({ _tag: "taskRetry", taskId: parked.board.tasks[0]!.id });
        const retried = yield* world.snapshotWhere(
          (current) =>
            current.board.tasks[0]?.state === "working" && current.board.tasks[0]?.attempts === 3,
        );
        const current = (yield* turnsSent(world)).at(-1)!.chat;
        yield* world.turnStarts(current);
        yield* endsWith(world, current, "api_error");
        const again = yield* world.snapshotWhere(
          (frame) =>
            frame.board.tasks[0]?.state === "working" && frame.board.tasks[0]?.attempts === 4,
        );
        assert.deepStrictEqual(
          [retried.board.tasks[0]!.attempts, again.board.tasks[0]!.state],
          [3, "working"],
        );
      }),
    ),
  );

  it.live("in a run, a new conversation after an overflow carries the task on at once", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.press({
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
        yield* world.sessionsWhere("backend", (sessions) => sessions.count === 2);
        const second = yield* currentChat(world);
        const carried = (yield* turnsSent(world)).findLast((turn) => turn.chat === second);
        assert.deepStrictEqual(carried?.text.split("\n").slice(1, 3), [
          "#1 Change a.txt · continues",
          "A fresh conversation: the last one grew too long",
        ]);
      }),
    ),
  );

  // Its turn-start rotation is a transcript gone before a resume: V1's own mechanism (the engine
  // resumes its sessions itself), so it runs on V1 until the cutover (the owner, 2026-10-08).
  itV1("a rotation a turn's start makes counts toward the attempt's two", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const first = yield* firstTurn(world, () => undefined);
        yield* endsWith(world, first, "prompt_too_long");
        yield* world.sessionsWhere("backend", (sessions) => sessions.count === 2);
        const second = yield* currentChat(world);
        const transcript = NodePath.join(world.workspace, "second.jsonl");
        NodeFS.writeFileSync(transcript, "{}\n");
        yield* world.sessionStart(second, {
          source: "startup",
          sessionId: "session-2",
          transcriptPath: transcript,
        });
        yield* world.sessionsWhere(
          "backend",
          (sessions) => sessions.count === 2 && sessions.latest === "active",
        );
        NodeFS.rmSync(transcript);
        const third = yield* nextTurn(world, 2);
        yield* endsWith(world, third, "prompt_too_long");
        const parked = yield* world.snapshotWhere(
          (current) => current.board.tasks[0]?.state === "parked",
        );
        assert.deepStrictEqual(
          [
            (yield* world.sessionsWhere("backend", () => true)).reasons,
            parked.board.tasks[0]!.reason,
          ],
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
