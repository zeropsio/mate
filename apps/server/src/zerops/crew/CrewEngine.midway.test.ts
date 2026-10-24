import { assert, describe, it } from "@effect/vitest";
import type { CrewRunOptions } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  applied,
  crewJourney,
  eventually,
  firstTurn,
  reportDone,
  turnsSent,
  type CrewChat,
  type CrewWorld,
} from "./testing/crewWorld.ts";
import { git, write } from "./testing/crewGitFixture.ts";

const OPTIONS: CrewRunOptions = {
  budgetUsd: 3,
  timeLimitHours: 8,
  stopAtUsagePercent: 80,
  landing: "person",
  devGrant: false,
  leadMayStart: false,
};

/** The first task's attempts as the store keeps them: number, ending, its words, ended or not. */
const attemptsOfFirst = (world: CrewWorld) =>
  Effect.gen(function* () {
    const task = yield* firstTask(world);
    return (yield* world.attempts(task.id)).map((row) => [
      row.attempt,
      row.ending,
      row.endingDetail,
      row.endedAt !== null,
    ]);
  });

const firstTask = (world: CrewWorld) =>
  Effect.map(world.tasks, (rows) => rows.find((row) => row.number === 1)!);

/** Turns sent after the first `before`, once there are `count` of them and no more come. */
const turnsAfter = (world: CrewWorld, before: number, count: number) =>
  Effect.gen(function* () {
    yield* eventually(Effect.map(turnsSent(world), (all) => all.length >= before + count));
    yield* world.settled;
    return (yield* turnsSent(world)).slice(before);
  });

/** The first task's attempts once its latest has ended. */
const endedAttempts = (world: CrewWorld) =>
  Effect.gen(function* () {
    yield* eventually(Effect.map(attemptsOfFirst(world), (rows) => rows.at(-1)?.[3] === true));
    return yield* attemptsOfFirst(world);
  });

describe("CrewEngine tasks stopped mid-way", () => {
  it.live(
    "a turn that leaves its task working ends the attempt, how and when; its next turn opens it again",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          const running = yield* attemptsOfFirst(world);
          yield* world.turnEnds(thread);
          const ended = yield* endedAttempts(world);
          yield* world.press({
            _tag: "message",
            handle: "backend",
            text: "Go on",
            attachments: [],
          });
          const reopened = yield* attemptsOfFirst(world);
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
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        yield* world.press({ _tag: "start", ...OPTIONS });
        const runId = (yield* world.snapshotWhere((current) => current.run?.state === "running"))
          .run!.id;
        const thread = yield* firstTurn(world, () => undefined);
        yield* world.press({ _tag: "pause", runId });
        yield* world.snapshotWhere((current) => current.run?.state === "paused");
        yield* world.turnEnds(thread, { state: "interrupted" });
        const ended = yield* endedAttempts(world);
        assert.deepStrictEqual(ended, [[1, "run-paused", "when you stopped it", true]]);
      }),
    ),
  );

  it.live("a rework's attempt has its own row", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* applied(world);
        const thread = yield* firstTurn(world, () =>
          write(world.root, ".crew/backend/b.txt", "crew\n"),
        );
        yield* reportDone(world, thread);
        yield* world.turnEnds(thread);
        const failed = yield* world.snapshotWhere(
          (current) => current.board.tasks[0]?.state === "rework",
        );
        yield* world.press({ _tag: "askFix", taskId: failed.board.tasks[0]!.id });
        yield* world.snapshotWhere((current) => current.board.tasks[0]?.attempts === 2);
        assert.deepStrictEqual(
          [(yield* turnsSent(world)).length, yield* attemptsOfFirst(world)],
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

  it.live("Resume after a restart carries on the turn the pause stopped", () => {
    let thread: CrewChat | undefined;
    let runId = "";
    let before = 0;
    return crewJourney([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.press({ _tag: "start", ...OPTIONS });
          runId = (yield* world.snapshotWhere((current) => current.run?.state === "running")).run!
            .id;
          thread = yield* firstTurn(world, () => undefined);
          yield* world.press({ _tag: "pause", runId });
          yield* world.snapshotWhere((current) => current.run?.state === "paused");
          yield* world.turnEnds(thread, { state: "interrupted" });
          yield* endedAttempts(world);
          before = (yield* turnsSent(world)).length;
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.serverReady;
          yield* world.snapshotWhere((current) => current.run?.state === "paused");
          yield* world.press({ _tag: "resume", runId });
          const carried = yield* turnsAfter(world, before, 1);
          assert.deepStrictEqual(
            [carried.map((turn) => turn.chat), yield* attemptsOfFirst(world)],
            [[thread!], [[1, null, null, false]]],
          );
        }),
    ]);
  });

  it.live("a restart in a running run carries on a task its nudge left standing", () => {
    let thread: CrewChat | undefined;
    let before = 0;
    return crewJourney([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.press({ _tag: "start", ...OPTIONS, budgetUsd: "unlimited" });
          yield* world.snapshotWhere((current) => current.run?.state === "running");
          thread = yield* firstTurn(world, () => undefined);
          yield* world.turnEnds(thread);
          yield* turnsAfter(world, 1, 1);
          yield* world.turnStarts(thread);
          yield* world.turnEnds(thread);
          yield* endedAttempts(world);
          before = (yield* turnsAfter(world, 0, 2)).length;
        }),
      (world) =>
        Effect.gen(function* () {
          yield* world.serverReady;
          const carried = yield* turnsAfter(world, before, 1);
          assert.deepStrictEqual(
            carried.map((turn) => [turn.chat, turn.text.includes("stopped mid-way")]),
            [[thread!, true]],
          );
        }),
    ]);
  });

  it.live(
    "a queued task whose dependency was discarded names itself; Drop the wait starts it",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          const first = yield* firstTask(world);
          yield* world.press({
            _tag: "taskCreate",
            owner: "backend",
            title: "Health check",
            brief: "Add /health.",
            doneWhen: "",
            dependsOn: [first.id],
          });
          yield* world.turnEnds(thread);
          yield* endedAttempts(world);
          yield* world.press({ _tag: "discard", taskId: first.id });
          const waiting = yield* world.snapshotWhere((current) =>
            current.attention.some((row) => row.kind === "dependency-gone"),
          );
          const second = waiting.board.tasks.find((task) => task.number === 2)!;
          yield* world.press({ _tag: "taskEdit", taskId: second.id, dependsOn: [] });
          const started = yield* world.snapshotWhere(
            (current) => current.board.tasks.find((task) => task.number === 2)?.state === "working",
          );
          assert.deepStrictEqual(
            {
              waiting: waiting.attention.map((row) => [row.kind, row.handle, row.taskId]),
              second: second.state,
              started: started.attention,
            },
            {
              waiting: [["dependency-gone", "backend", second.id]],
              second: "queued",
              started: [],
            },
          );
        }),
      ),
  );

  it.live(
    "a run's landing held by your working chat says so, in the crew log and the section",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* world.mateTurnRunning(true);
          yield* world.press({ _tag: "start", ...OPTIONS, landing: "check" });
          yield* world.snapshotWhere((current) => current.run?.state === "running");
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const held = yield* world.snapshotWhere((current) => current.lastError !== null);
          const log = yield* world.log(["landing-held"]);
          assert.deepStrictEqual(
            {
              state: held.board.tasks[0]!.state,
              rows: held.attention.map((row) => row.kind),
              lastError: held.lastError,
              log: log.map((entry) => entry.payload),
            },
            {
              state: "ready",
              rows: ["ready-to-land"],
              lastError: "#1 waits to land: a chat of this Mate is working; land between its turns",
              log: [
                {
                  task: held.board.tasks[0]!.id,
                  detail: "a chat of this Mate is working; land between its turns",
                },
              ],
            },
          );
        }),
      ),
  );

  it.live(
    "a landing that finds your tree moved says so in the crew log, merges again and lands",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* reportDone(world, thread);
          yield* world.turnEnds(thread);
          const ready = yield* world.snapshotWhere(
            (current) => current.board.tasks[0]?.state === "ready",
          );
          write(world.root, "docs/person.md", "person\n");
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "person edits"]);
          yield* world.press({ _tag: "land", taskId: ready.board.tasks[0]!.id });
          yield* world.snapshotWhere((current) => current.board.tasks[0]?.state === "landed");
          const log = yield* world.log(["landing-held"]);
          assert.deepStrictEqual(
            log.map((entry) => entry.payload),
            [
              {
                task: ready.board.tasks[0]!.id,
                detail: "your tree moved since its check; it merges again",
              },
            ],
          );
        }),
      ),
  );
});
