import { assert, describe, it } from "@effect/vitest";
import type { MateTask } from "@t3tools/contracts";
import type { HqAppTask, HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import type { HqNavigationProject } from "@t3tools/shared/hqStream";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { ROBOT_TASK_LINK, automatedPool } from "../test/harness/automated.ts";
import { rowsWhere } from "../test/harness/mates.ts";
import type { SocketMessage } from "../test/harness/runningCore.ts";
import { sessionFor, ticketFor } from "../test/harness/runningCore.ts";
import { nextScopeValue, scopeReset, scopeValue } from "../test/harness/scopes.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { BUDGET_SPENT, BUDGET_WAIT } from "./taskSources.ts";

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
          // Said again while it works: its row moves with it.
          yield* word(core, {
            taskId: task.id,
            state: "working",
            spentUsd: 0.45,
            workedMs: 120_000,
          });
          const later = yield* nextScopeValue<HqNavigationProject>(
            watching,
            NAV,
            "project:P_ROBOT",
            (project) => project.mate?.task?.spentUsd === 0.45,
          );
          assert.strictEqual(later.mate?.task?.workedMs, 120_000);
          yield* word(core, { taskId: task.id, state: "done", spentUsd: 0.5, workedMs: 90_000 });
          const [kept] = yield* rowsWhere(
            core.url,
            "SELECT state, spent_usd, worked_ms::float8 AS worked_ms, started_at IS NOT NULL AS taken, ended_at IS NOT NULL AS ended FROM hq_task",
            (rows) => rows[0]?.["state"] === "done",
          );
          // A word told late, or again, never lowers what it spent or worked.
          assert.deepStrictEqual(kept, {
            state: "done",
            spent_usd: 0.5,
            worked_ms: 120_000,
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
            model: "nebius/zai-org/GLM-5.3",
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
            model: "nebius/zai-org/GLM-5.3",
          });
          yield* limits({ minutes: 60, costUsd: null, monthlyBudgetUsd: 5 });
          yield* toldTask(core, 2);
        }),
    );

    it.effect(
      "this month's spend counts what each word added in the month it came: a task taken last month, or never seen at work, spends this month; a word told again adds nothing",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          const spent = Effect.map(
            core.call("GET", "/api/org/task-limits", { session: core.owner }),
            (answer) => (answer.body as HqTaskLimitsView).spentThisMonthUsd,
          );
          const kept = (spentUsd: number, workedMs: number) =>
            rowsWhere(
              core.url,
              "SELECT spent_usd, worked_ms::float8 AS worked_ms FROM hq_task",
              (rows) => rows[0]?.["spent_usd"] === spentUsd && rows[0]?.["worked_ms"] === workedMs,
            );
          const sql = (statement: string) => rowsWhere(core.url, statement, () => true);
          yield* core.issue(1);
          const task = yield* toldTask(core, 1);
          yield* word(core, { taskId: task.id, state: "accepted", conversationId: "c-1" });
          yield* word(core, { taskId: task.id, state: "working", spentUsd: 0.5, workedMs: 1 });
          yield* kept(0.5, 1);
          assert.strictEqual(yield* spent, 0.5);
          // Taken last month, woken by a review this month; and what last month spent stays there.
          const lastMonth = "date_trunc('month', now() AT TIME ZONE 'UTC') - interval '10 days'";
          yield* sql(`UPDATE hq_task SET started_at = ${lastMonth}`);
          yield* sql(
            `INSERT INTO hq_task_month_spend (month, app_id, spent_usd) SELECT (${lastMonth})::date, id, 7 FROM hq_app`,
          );
          yield* word(core, { taskId: task.id, state: "working", spentUsd: 0.8, workedMs: 2 });
          yield* kept(0.8, 2);
          assert.strictEqual(yield* spent, 0.8);
          // Told again, or late with less: nothing added.
          yield* word(core, { taskId: task.id, state: "working", spentUsd: 0.3, workedMs: 3 });
          yield* kept(0.8, 3);
          assert.strictEqual(yield* spent, 0.8);
          // Never seen at work at all: its spend counts all the same.
          yield* sql("UPDATE hq_task SET started_at = NULL");
          yield* word(core, { taskId: task.id, state: "working", spentUsd: 1, workedMs: 4 });
          yield* kept(1, 4);
          assert.strictEqual(yield* spent, 1);
        }),
    );

    it.effect(
      "once the budget is reached, a task handed out but not yet taken goes back in line, no try against it, and its Mate is told to drop it, also when its word that it took it comes late; a higher budget hands it out again",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool({ tasks: { acceptWithin: Duration.minutes(5) } });
          const limits = (monthlyBudgetUsd: number) =>
            core.call("PUT", "/api/org/task-limits", {
              session: core.owner,
              body: { minutes: 60, costUsd: null, monthlyBudgetUsd },
            });
          yield* limits(1);
          yield* core.issue(1);
          const first = yield* toldTask(core, 1);
          yield* word(core, { taskId: first.id, state: "accepted", conversationId: "c-1" });
          yield* word(core, { taskId: first.id, state: "done", spentUsd: 0.6, workedMs: 1 });
          yield* core.issue(2);
          const second = yield* toldTask(core, 2);
          yield* core.tasks((rows) => rows[1]?.["state"] === "assigned");
          // The budget lowered under this month's spend while the robot has not taken it yet.
          yield* limits(0.5);
          assert.deepStrictEqual(yield* core.robot.link.take("task-stop"), {
            taskId: second.id,
            reason: BUDGET_SPENT,
            requeued: true,
          });
          const [, back] = yield* core.tasks((rows) => rows[1]?.["state"] === "queued");
          assert.deepInclude(back, { mate_project_id: null, attempts: 0 });
          // Its word that it took it, late: it waits in line still, and its Mate drops it again.
          yield* word(core, { taskId: second.id, state: "accepted", conversationId: "c-2" });
          assert.deepStrictEqual(yield* core.robot.link.take("task-stop"), {
            taskId: second.id,
            reason: BUDGET_SPENT,
            requeued: true,
          });
          yield* core.tasks((rows) => rows[1]?.["state"] === "queued");
          yield* limits(5);
          assert.strictEqual((yield* toldTask(core, 2)).id, second.id);
        }),
    );

    it.effect(
      "while the budget stays spent, a waiting task's line keeps saying so as the queue moves, never its place",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          yield* core.call("PUT", "/api/org/task-limits", {
            session: core.owner,
            body: { minutes: 60, costUsd: null, monthlyBudgetUsd: 1 },
          });
          yield* core.issue(1);
          const first = yield* toldTask(core, 1);
          yield* word(core, { taskId: first.id, state: "accepted", conversationId: "c-1" });
          yield* word(core, { taskId: first.id, state: "done", spentUsd: 1.5, workedMs: 1 });
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
          yield* core.issue(2);
          yield* core.issue(3);
          const budgetLines = (count: number) =>
            core.github.seenWhere(
              "the budget's lines",
              (seen) =>
                seen.filter((request) =>
                  (request.body as { body?: string })?.body?.startsWith(BUDGET_WAIT),
                ).length >= count,
            );
          yield* budgetLines(2);
          // The queue moves: the first waiting one goes.
          const rows = yield* core.tasks((found) => found.length === 3);
          const stop = yield* core.call(
            "POST",
            `/api/apps/${core.appId}/tasks/${String(rows[1]!["id"])}/stop`,
            { session: core.owner },
          );
          assert.strictEqual(stop.status, 204);
          yield* core.tasks((found) => found[1]?.["state"] === "dropped");
          yield* core.issue(4);
          yield* budgetLines(3);
          const log = yield* core.github.commentLog;
          const sinceBudget = log.slice(
            log.findIndex(([, , text]) => text.startsWith(BUDGET_WAIT)),
          );
          assert.isFalse(sinceBudget.some(([, , text]) => text.includes("in line")));
        }),
    );

    it.effect(
      "the board says a task is stopping until its Mate stops it; a stop of one that ended leaves it as it ended",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          const stop = (taskId: string) =>
            core.call("POST", `/api/apps/${core.appId}/tasks/${taskId}/stop`, {
              session: core.owner,
            });
          yield* core.issue(1);
          const first = yield* toldTask(core, 1);
          yield* word(core, { taskId: first.id, state: "accepted", conversationId: "c-1" });
          const watching = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
          );
          yield* scopeReset(watching, NAV);
          assert.strictEqual((yield* stop(first.id)).status, 204);
          yield* core.robot.link.take("task-stop");
          assert.deepStrictEqual(
            tasksOf(yield* board(core)).map((task) => task.state),
            ["stopping"],
          );
          yield* nextScopeValue<HqNavigationProject>(
            watching,
            NAV,
            "project:P_ROBOT",
            (project) => project.mate?.task?.stopping === true,
          );
          yield* watching.close;
          yield* word(core, { taskId: first.id, state: "stopped" });
          yield* core.tasks((rows) => rows[0]?.["state"] === "stopped");
          assert.deepStrictEqual(
            tasksOf(yield* board(core)).map((task) => task.state),
            ["stopped"],
          );
          // Ended already: nothing to stop, and it stays as it ended.
          assert.strictEqual((yield* stop(first.id)).status, 204);
          assert.strictEqual((yield* stop("not-a-task")).status, 404);
          assert.deepStrictEqual(
            tasksOf(yield* board(core)).map((task) => task.state),
            ["stopped"],
          );
        }),
    );

    it.effect(
      "the board says a done task whose change was merged is merged, and closed unmerged, closed",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          yield* core.issue(1);
          const first = yield* toldTask(core, 1);
          yield* word(core, { taskId: first.id, state: "accepted", conversationId: "c-1" });
          yield* word(core, { taskId: first.id, state: "done" });
          yield* core.tasks((rows) => rows[0]?.["state"] === "done");
          const sql = (statement: string) => rowsWhere(core.url, statement, () => true);
          yield* sql(
            "INSERT INTO hq_repo (app_id, name, created_by) SELECT id, 'appdev', 'door-owner' FROM hq_app ON CONFLICT DO NOTHING",
          );
          yield* sql(
            "INSERT INTO hq_change (app_id, repo, number, mate_project_id, branch, title, state) SELECT id, 'appdev', 1, 'P_ROBOT', 'mate/P_ROBOT/1', 'Cart', 'closed' FROM hq_app",
          );
          yield* sql("UPDATE hq_task SET change_repo = 'appdev', change_number = 1");
          assert.deepStrictEqual(
            tasksOf(yield* board(core)).map((task) => task.state),
            ["closed"],
          );
          yield* sql("UPDATE hq_change SET state = 'merged'");
          assert.deepStrictEqual(
            tasksOf(yield* board(core)).map((task) => task.state),
            ["merged"],
          );
        }),
    );

    it.effect(
      "a free Mate's row says when its last task ended, and that HQ stopped it once this month's budget was spent",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool();
          yield* core.call("PUT", "/api/org/task-limits", {
            session: core.owner,
            body: { minutes: 60, costUsd: null, monthlyBudgetUsd: 1 },
          });
          const watching = yield* core.socket(
            `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
          );
          yield* scopeReset(watching, NAV);
          yield* core.issue(1);
          const task = yield* toldTask(core, 1);
          yield* word(core, { taskId: task.id, state: "accepted", conversationId: "c-1" });
          yield* word(core, { taskId: task.id, state: "working", spentUsd: 1.2 });
          yield* core.robot.link.take("task-stop");
          yield* word(core, { taskId: task.id, state: "stopped", spentUsd: 1.25 });
          const row = yield* nextScopeValue<HqNavigationProject>(
            watching,
            NAV,
            "project:P_ROBOT",
            (project) => project.mate?.task?.ended === "stopped",
          );
          assert.strictEqual(row.mate?.task?.why, "budget");
          assert.isString(row.mate?.task?.endedAt);
          yield* watching.close;
        }),
    );

    it.effect("a free Mate's row keeps its last task however long ago it ended", () =>
      Effect.gen(function* () {
        const core = yield* automatedPool();
        yield* core.issue(1);
        const task = yield* toldTask(core, 1);
        yield* word(core, { taskId: task.id, state: "accepted", conversationId: "c-1" });
        yield* word(core, { taskId: task.id, state: "failed", detail: "The build broke." });
        yield* core.tasks((rows) => rows[0]?.["state"] === "failed");
        yield* rowsWhere(
          core.url,
          "UPDATE hq_task SET ended_at = now() - interval '30 days', updated_at = now() - interval '30 days'",
          () => true,
        );
        const watching = yield* core.socket(
          `/api/structure/ws?ticket=${yield* ticketFor(core.call, core.owner)}`,
        );
        const row = scopeValue<HqNavigationProject>(
          yield* scopeReset(watching, NAV),
          "project:P_ROBOT",
        );
        assert.strictEqual(row.mate?.task?.ended, "failed");
        assert.notProperty(row.mate?.task ?? {}, "why");
        yield* watching.close;
      }),
    );
  });
});
