import { assert, describe, it } from "@effect/vitest";
import type { MateTask } from "@t3tools/contracts";
import type { HqAppTask, HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import type { HqNavigationProject } from "@t3tools/shared/hqStream";
import * as Effect from "effect/Effect";

import { ROBOT_TASK_LINK, automatedPool } from "../test/harness/automated.ts";
import { rowsWhere } from "../test/harness/mates.ts";
import type { SocketMessage } from "../test/harness/runningCore.ts";
import { sessionFor, ticketFor } from "../test/harness/runningCore.ts";
import { nextScopeValue, scopeReset } from "../test/harness/scopes.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { BUDGET_SPENT } from "./mateTasks.ts";
import { BUDGET_WAIT } from "./taskSources.ts";

const NAV = { kind: "navigation" } as const;

type Core = Effect.Success<ReturnType<typeof automatedPool>>;

/** The next task the robot is told, of issue `number`. */
const toldTask = (core: Core, number: number) =>
  Effect.map(
    core.robot.link.takeWhere(
      `the task of issue ${String(number)}`,
      (frame: SocketMessage) =>
        frame.type === "task" &&
        (frame["task"] as MateTask).source.kind === "github-issue" &&
        (frame["task"] as MateTask & { source: { number: number } }).source.number === number,
    ),
    (frame) => frame["task"] as MateTask,
  );

const word = (core: Core, report: Record<string, unknown>) =>
  core.robot.link.send({ type: "task-state", report });

const board = (core: Core, session = core.owner) =>
  Effect.map(
    core.call("GET", `/api/apps/${core.appId}/tasks`, { session }),
    (answer) => answer as { readonly status: number; readonly body: unknown },
  );
const tasksOf = (answer: { readonly body: unknown }) =>
  (answer.body as { readonly tasks: ReadonlyArray<HqAppTask> }).tasks;

describe("an application's tasks, what they cost, and the organization's monthly budget", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a task keeps what its Mate reported it cost and how long it worked, when it was taken and when it ended; its Mate's row says them",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          const watching = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
          );
          yield* scopeReset(watching, NAV);
          yield* core.issue(1);
          const task = yield* toldTask(core, 1);
          yield* word(core, {
            taskId: task.id,
            state: "accepted",
            conversationId: "conversation-1",
            spentUsd: 0,
            workedMs: 0,
          });
          yield* word(core, {
            taskId: task.id,
            state: "working",
            spentUsd: 0.42,
            workedMs: 60_000,
          });
          const row = yield* nextScopeValue<HqNavigationProject>(
            watching,
            NAV,
            "project:P_ROBOT",
            (project) => project.mate?.task?.spentUsd === 0.42,
          );
          assert.strictEqual(row.mate?.task?.workedMs, 60_000);
          assert.isString(row.mate?.task?.startedAt);
          yield* word(core, { taskId: task.id, state: "done", spentUsd: 0.5, workedMs: 90_000 });
          const [kept] = yield* rowsWhere(
            core.url,
            "SELECT state, spent_usd, worked_ms::float8 AS worked_ms, started_at IS NOT NULL AS taken, ended_at IS NOT NULL AS ended FROM hq_task",
            (rows) => rows[0]?.["state"] === "done",
          );
          assert.deepStrictEqual(kept, {
            state: "done",
            spent_usd: 0.5,
            worked_ms: 90_000,
            taken: true,
            ended: true,
          });
          yield* watching.close;
        }),
    );

    it.effect(
      "an application's board lists its queued tasks by their place, the one at work, and those that ended, newest first, each linked to where it is followed",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          yield* core.issue(1);
          const first = yield* toldTask(core, 1);
          yield* word(core, {
            taskId: first.id,
            state: "accepted",
            conversationId: "conversation-1",
            spentUsd: 0.1,
            workedMs: 5_000,
          });
          yield* core.issue(2);
          yield* core.issue(3);
          yield* core.tasks((rows) => rows.length === 3 && rows[0]?.["state"] === "working");
          const live = tasksOf(yield* board(core));
          assert.deepStrictEqual(
            live.map((task) => [task.title, task.state, task.position ?? null]),
            [
              ["Issue 2", "queued", 1],
              ["Issue 3", "queued", 2],
              ["Issue 1", "working", null],
            ],
          );
          const working = live[2]!;
          assert.deepInclude(working, {
            label: "acme/tea-shop#1",
            url: "https://github.com/acme/tea-shop/issues/1",
            requestedBy: "nova",
            spentUsd: 0.1,
            workedMs: 5_000,
            link: ROBOT_TASK_LINK,
            endedAt: null,
          });
          assert.strictEqual(working.mate?.projectId, "P_ROBOT");
          assert.isString(working.startedAt);
          yield* word(core, { taskId: first.id, state: "done", spentUsd: 0.3, workedMs: 9_000 });
          yield* toldTask(core, 2);
          const after = tasksOf(yield* board(core));
          const ended = after.filter((task) => task.endedAt !== null);
          assert.deepStrictEqual(
            ended.map((task) => [task.title, task.state, task.spentUsd]),
            [["Issue 1", "done", 0.3]],
          );
          assert.deepStrictEqual(
            after
              .filter((task) => task.state === "queued")
              .map((task) => [task.title, task.position]),
            [["Issue 3", 1]],
          );
          // Whoever sees the application reads its board; anyone else is refused it.
          assert.strictEqual(
            (yield* board(core, yield* sessionFor(core.call, "door-reader"))).status,
            200,
          );
          assert.strictEqual(
            (yield* board(core, yield* sessionFor(core.call, "door-dev"))).status,
            403,
          );
        }),
    );

    it.effect(
      "an owner or admin stops a task from its application's board: one at work, its Mate is told to stop; one waiting goes; a reader may not",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          yield* core.issue(1);
          const first = yield* toldTask(core, 1);
          yield* word(core, {
            taskId: first.id,
            state: "accepted",
            conversationId: "conversation-1",
          });
          yield* core.issue(2);
          const rows = yield* core.tasks((found) => found.length === 2);
          const waitingId = String(rows[1]!["id"]);
          const stop = (taskId: string, session = core.owner) =>
            core.call("POST", `/api/apps/${core.appId}/tasks/${taskId}/stop`, { session });
          const reader = yield* sessionFor(core.call, "door-reader");
          assert.strictEqual((yield* stop(first.id, reader)).status, 403);
          assert.strictEqual((yield* stop("00000000-0000-0000-0000-000000000000")).status, 404);
          assert.strictEqual((yield* stop(first.id)).status, 204);
          const told = yield* core.robot.link.take("task-stop");
          assert.strictEqual(told["taskId"], first.id);
          assert.match(String(told["reason"]), /stopped it in Mate\.$/u);
          assert.strictEqual((yield* stop(waitingId)).status, 204);
          yield* core.tasks((found) => found[1]?.["state"] === "dropped");
        }),
    );

    it.effect(
      "once this month's spend reaches the organization's monthly budget, no task is handed out and the waiting say why, the one at work is stopped; a higher budget lets them go",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          const limits = (body: HqTaskLimitsView, session = core.owner) =>
            core.call("PUT", "/api/org/task-limits", { session, body });
          const developer = yield* sessionFor(core.call, "door-dev");
          assert.strictEqual(
            (yield* limits({ minutes: 60, costUsd: null, monthlyBudgetUsd: 1 }, developer)).status,
            403,
          );
          assert.strictEqual(
            (yield* limits({ minutes: 60, costUsd: null, monthlyBudgetUsd: -1 })).status,
            400,
          );
          const kept = yield* limits({ minutes: 60, costUsd: null, monthlyBudgetUsd: 1 });
          assert.deepStrictEqual(kept.body, {
            minutes: 60,
            costUsd: null,
            monthlyBudgetUsd: 1,
            spentThisMonthUsd: 0,
          });
          yield* core.issue(1);
          const first = yield* toldTask(core, 1);
          yield* word(core, {
            taskId: first.id,
            state: "accepted",
            conversationId: "conversation-1",
          });
          yield* word(core, {
            taskId: first.id,
            state: "working",
            spentUsd: 1.2,
            workedMs: 60_000,
          });
          assert.deepStrictEqual(yield* core.robot.link.take("task-stop"), {
            taskId: first.id,
            reason: BUDGET_SPENT,
          });
          yield* word(core, { taskId: first.id, state: "stopped", spentUsd: 1.25 });
          yield* core.issue(2);
          yield* core.github.seenWhere("the budget's word", (seen) =>
            seen.some((request) =>
              (request.body as { body?: string })?.body?.startsWith(BUDGET_WAIT),
            ),
          );
          const [stopped] = yield* core.tasks(
            (rows) => rows.length === 2 && rows[0]?.["state"] === "stopped",
          );
          assert.strictEqual(stopped!["detail"], BUDGET_SPENT);
          assert.isFalse(
            (yield* core.robot.link.collected).some(
              (frame) => frame.type === "task" && (frame["task"] as MateTask).id !== first.id,
            ),
          );
          const read = yield* core.call("GET", "/api/org/task-limits", { session: core.owner });
          assert.deepStrictEqual(read.body, {
            minutes: 60,
            costUsd: null,
            monthlyBudgetUsd: 1,
            spentThisMonthUsd: 1.25,
          });
          yield* limits({ minutes: 60, costUsd: null, monthlyBudgetUsd: 5 });
          yield* toldTask(core, 2);
        }),
    );
  });
});
