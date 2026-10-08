import { assert, describe, it } from "@effect/vitest";
import type { CrewRunOptions, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { ServerCommandReadiness } from "../../spi/serverCommandReadiness.ts";
import { CREW_ID } from "./CrewHome.ts";
import { CrewStore } from "./CrewStore.ts";
import {
  eventually,
  drained,
  runningPersonThread,
  spiEvent,
  withCrewEngine,
  withCrewEngines,
  type CrewWorld,
} from "./testing/crewEngineFixture.ts";
import {
  AS_CREW,
  applied,
  command,
  dispatchedOf,
  firstTurn,
  reportDone,
  snapshotWhere,
} from "./testing/crewEngineSteps.ts";
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

/** The rig's backend #16: started at 05:43:55, last touched at 05:49:15, 26 s before its $3 run paused. */
const RIG_STARTED = "2026-09-27T05:43:55.000Z";
const RIG_IDLE_SINCE = "2026-09-27T05:49:15.000Z";

const firstTask = Effect.flatMap(CrewStore, (store) =>
  Effect.map(store.assignments(CREW_ID), (rows) => rows.find((row) => row.number === 1)!),
);

/** Turns sent after the first `before`, once there are `count` of them and no more come. */
const turnsAfter = (world: CrewWorld, before: number, count: number) =>
  Effect.gen(function* () {
    yield* eventually(
      Effect.map(dispatchedOf(world, "thread.turn.start"), (all) => all.length >= before + count),
    );
    yield* drained;
    return (yield* dispatchedOf(world, "thread.turn.start")).slice(before);
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
        assert.deepStrictEqual(ended, [[1, "run-paused", "when you stopped it", true]]);
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

  it.live(
    "the rig: a working task with no turn stops its queue; the next run carries it on as its starter",
    () => {
      let thread: ThreadId | undefined;
      let before = 0;
      return withCrewEngines([
        (world) =>
          Effect.gen(function* () {
            yield* applied(world);
            yield* command({ _tag: "start", ...OPTIONS });
            const runId = (yield* snapshotWhere((current) => current.run?.state === "running")).run!
              .id;
            thread = yield* firstTurn(world, () => undefined);
            for (const title of ["Health check", "Metrics"]) {
              yield* command({
                _tag: "taskCreate",
                owner: "backend",
                title,
                brief: title,
                doneWhen: "",
                dependsOn: [],
              });
            }
            yield* world.publish(
              spiEvent("turn.completed", thread, {
                state: "completed",
                terminalReason: "budget_exhausted",
                totalCostUsd: 3,
              }),
            );
            yield* snapshotWhere((current) => current.run?.state === "paused");
            yield* endedAttempts;
            yield* command({ _tag: "stop", runId });
            yield* snapshotWhere((current) => current.run?.state === "stopped");
            // The rig's rows, as an engine before attempt endings left them.
            const store = yield* CrewStore;
            const task = yield* firstTask;
            const [attempt] = yield* store.attemptsOf(task.assignment);
            yield* store.putAttempt({
              ...attempt!,
              ending: null,
              endingDetail: null,
              endedAt: null,
              startedAt: RIG_STARTED,
            });
            yield* store.putAssignment({ ...task, updatedAt: RIG_IDLE_SINCE });
            before = (yield* dispatchedOf(world, "thread.turn.start")).length;
          }),
        (world) =>
          Effect.gen(function* () {
            yield* (yield* ServerCommandReadiness).complete;
            yield* endedAttempts;
            const store = yield* CrewStore;
            const [attempt] = yield* store.attemptsOf((yield* firstTask).assignment);
            const idle = yield* snapshotWhere((current) => current.attention[0]?.text != null);
            const quiet = yield* turnsAfter(world, before, 0);
            yield* command({
              _tag: "start",
              ...OPTIONS,
              budgetUsd: "unlimited",
              landing: "lead",
            });
            const carried = yield* turnsAfter(world, before, 1);
            const board = yield* snapshotWhere(() => true);
            assert.deepStrictEqual(
              {
                closed: [attempt!.ending, attempt!.endingDetail, attempt!.endedAt],
                idle: idle.board.tasks.map((task) => task.state),
                waiting: idle.attention.map((row) => [row.kind, row.handle, row.text, row.at]),
                quiet: quiet.length,
                carried: carried.map((turn) => [
                  turn.threadId,
                  turn.message.text.includes("stopped mid-way"),
                ]),
                principal: (yield* Ref.get(world.admitted)).at(-1)?.principal,
                board: board.board.tasks.map((task) => task.state),
                after: board.attention,
              },
              {
                closed: ["no-report", "its turn ended without a report", RIG_IDLE_SINCE],
                idle: ["working", "queued", "queued"],
                waiting: [
                  ["stalled", "backend", "its turn ended without a report", RIG_IDLE_SINCE],
                ],
                quiet: 0,
                carried: [[thread!, true]],
                principal: AS_CREW,
                board: ["working", "queued", "queued"],
                after: [],
              },
            );
          }),
      ]);
    },
  );

  it.live("Resume after a restart carries on the turn the pause stopped", () => {
    let thread: ThreadId | undefined;
    let runId = "";
    let before = 0;
    return withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* command({ _tag: "start", ...OPTIONS });
          runId = (yield* snapshotWhere((current) => current.run?.state === "running")).run!.id;
          thread = yield* firstTurn(world, () => undefined);
          yield* command({ _tag: "pause", runId });
          yield* snapshotWhere((current) => current.run?.state === "paused");
          yield* world.publish(spiEvent("turn.completed", thread, { state: "interrupted" }));
          yield* endedAttempts;
          before = (yield* dispatchedOf(world, "thread.turn.start")).length;
        }),
      (world) =>
        Effect.gen(function* () {
          yield* (yield* ServerCommandReadiness).complete;
          yield* snapshotWhere((current) => current.run?.state === "paused");
          yield* command({ _tag: "resume", runId });
          const carried = yield* turnsAfter(world, before, 1);
          assert.deepStrictEqual(
            [carried.map((turn) => turn.threadId), yield* attemptsOfFirst],
            [[thread!], [[1, null, null, false]]],
          );
        }),
    ]);
  });

  it.live("a restart in a running run carries on a task its nudge left standing", () => {
    let thread: ThreadId | undefined;
    let before = 0;
    return withCrewEngines([
      (world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* command({ _tag: "start", ...OPTIONS, budgetUsd: "unlimited" });
          yield* snapshotWhere((current) => current.run?.state === "running");
          thread = yield* firstTurn(world, () => undefined);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          yield* turnsAfter(world, 1, 1);
          yield* world.publish(spiEvent("turn.started", thread, {}));
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          yield* endedAttempts;
          before = (yield* turnsAfter(world, 0, 2)).length;
        }),
      (world) =>
        Effect.gen(function* () {
          yield* (yield* ServerCommandReadiness).complete;
          const carried = yield* turnsAfter(world, before, 1);
          assert.deepStrictEqual(
            carried.map((turn) => [turn.threadId, turn.message.text.includes("stopped mid-way")]),
            [[thread!, true]],
          );
        }),
    ]);
  });

  it.live(
    "a queued task whose dependency was discarded names itself; Drop the wait starts it",
    () =>
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () => undefined);
          const first = yield* firstTask;
          yield* command({
            _tag: "taskCreate",
            owner: "backend",
            title: "Health check",
            brief: "Add /health.",
            doneWhen: "",
            dependsOn: [first.assignment],
          });
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          yield* endedAttempts;
          yield* command({ _tag: "discard", taskId: first.assignment });
          const waiting = yield* snapshotWhere((current) =>
            current.attention.some((row) => row.kind === "dependency-gone"),
          );
          const second = waiting.board.tasks.find((task) => task.number === 2)!;
          yield* command({ _tag: "taskEdit", taskId: second.id, dependsOn: [] });
          const started = yield* snapshotWhere(
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
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          yield* Ref.set(world.threads, [runningPersonThread()]);
          yield* command({ _tag: "start", ...OPTIONS, landing: "check" });
          yield* snapshotWhere((current) => current.run?.state === "running");
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const held = yield* snapshotWhere((current) => current.lastError !== null);
          const log = yield* (yield* CrewStore).logOf(CREW_ID, ["landing-held"]);
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
      withCrewEngine((world) =>
        Effect.gen(function* () {
          yield* applied(world);
          const thread = yield* firstTurn(world, () =>
            write(world.root, ".crew/backend/ok.txt", "ok\n"),
          );
          yield* reportDone(thread);
          yield* world.publish(spiEvent("turn.completed", thread, { state: "completed" }));
          const ready = yield* snapshotWhere(
            (current) => current.board.tasks[0]?.state === "ready",
          );
          write(world.root, "docs/person.md", "person\n");
          git(world.root, ["add", "-A"]);
          git(world.root, ["commit", "-q", "-m", "person edits"]);
          yield* command({ _tag: "land", taskId: ready.board.tasks[0]!.id });
          yield* snapshotWhere((current) => current.board.tasks[0]?.state === "landed");
          const log = yield* (yield* CrewStore).logOf(CREW_ID, ["landing-held"]);
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
