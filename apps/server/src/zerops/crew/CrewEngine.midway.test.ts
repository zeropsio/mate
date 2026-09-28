import { assert, describe, it } from "@effect/vitest";
import type { CrewRunOptions } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { CREW_ID } from "./CrewHome.ts";
import { CrewStore } from "./CrewStore.ts";
import { eventually, spiEvent, withCrewEngine } from "./testing/crewEngineFixture.ts";
import {
  applied,
  command,
  dispatchedOf,
  firstTurn,
  reportDone,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
import { write } from "./testing/crewGitFixture.ts";

const OPTIONS: CrewRunOptions = {
  budgetUsd: 3,
  timeLimitHours: 8,
  stopAtUsagePercent: 80,
  landing: "person",
  devGrant: false,
  leadMayStart: false,
};

/** The first task's attempts as the store keeps them: number, ending, its words, ended or not. */
const attemptsOfFirst = Effect.gen(function* () {
  const store = yield* CrewStore;
  const task = (yield* store.assignments(CREW_ID)).find((row) => row.number === 1);
  return (yield* store.attemptsOf(task!.assignment)).map((row) => [
    row.attempt,
    row.ending,
    row.endingDetail,
    row.endedAt !== null,
  ]);
});

/** The first task's attempts once its latest has ended. */
const endedAttempts = Effect.gen(function* () {
  yield* eventually(Effect.map(attemptsOfFirst, (rows) => rows.at(-1)?.[3] === true));
  return yield* attemptsOfFirst;
});

describe("CrewEngine tasks stopped mid-way", () => {
  it.live(
    "a turn that leaves its task working ends the attempt, how and when; its next turn opens it again",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          const running = yield* attemptsOfFirst;
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const ended = yield* endedAttempts;
          yield* command({ _tag: "message", handle: "backend", text: "Go on", attachments: [] });
          const reopened = yield* attemptsOfFirst;
          assert.deepStrictEqual(
            { running, ended, reopened },
            {
              running: [[1, null, null, false]],
              ended: [[1, "no-report", "its turn ended without a report", true]],
              reopened: [[1, null, null, false]],
            },
          );
        }),
      ),
  );

  it.live("a run's pause ends the attempt of the turn it interrupts, in the run's words", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* command({ _tag: "start", ...OPTIONS });
        const runId = (yield* snapshotWhere((current) => current.run?.state === "running")).run!.id;
        const thread = yield* firstTurn(world, () => undefined);
        yield* command({ _tag: "pause", runId });
        yield* snapshotWhere((current) => current.run?.state === "paused");
        yield* world.publish(spiEvent("turn.completed", thread, { state: "interrupted" }));
        const ended = yield* endedAttempts;
        assert.deepStrictEqual(ended, [[1, "run-paused", "you paused the run", true]]);
      }),
    ),
  );

  it.live("a rework's attempt has its own row", () =>
    withCrewEngine((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/b.txt", "crew\n"),
        );
        yield* reportDone(thread);
        yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
        const failed = yield* snapshotWhere(
          (current) => current.board.tasks[0]?.state === "rework",
        );
        yield* command({ _tag: "askFix", taskId: failed.board.tasks[0]!.id });
        yield* snapshotWhere((current) => current.board.tasks[0]?.attempts === 2);
        assert.deepStrictEqual(
          [(yield* dispatchedOf(world, "thread.turn.start")).length, yield* attemptsOfFirst],
          [
            2,
            [
              [1, null, null, false],
              [2, null, null, false],
            ],
          ],
        );
      }),
    ),
  );
});
