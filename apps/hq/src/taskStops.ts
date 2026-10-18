/**
 * A person stopping an application's task from Mate (`POST /api/apps/:appId/tasks/:taskId/stop`):
 * by one who may keep the application's intake, for a task of that application that is still
 * queued, being handed over, at work or waiting for an answer. It stops as any stop does
 * (`MateTasks.stop`): dropped while no Mate took it, else its Mate told to stop; the task's own
 * report, and the line where it came from, then say it stopped.
 *
 * @module taskStops
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { AutomationRefused } from "./automationRefused.ts";
import type { NotLeader } from "./leader.ts";
import { MateTasks } from "./mateTasks.ts";
import { can } from "./permissions.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** Why the task stopped, as its source and its Mate are told: after "<Mate> stopped: ". */
export const STOPPED_IN_MATE = "someone stopped it in Mate.";

type TaskStopError = AutomationRefused | NotLeader | SqlError | ZeropsError;

export class TaskStops extends Context.Service<
  TaskStops,
  {
    readonly stop: (
      userId: string,
      appId: string,
      taskId: string,
    ) => Effect.Effect<void, TaskStopError>;
  }
>()("@t3tools/hq/taskStops") {}

export const taskStopsLayer = Layer.effect(
  TaskStops,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const roles = yield* Roles;
    const tasks = yield* MateTasks;
    const refuse = (code: AutomationRefused["code"], reason: string) =>
      Effect.fail(new AutomationRefused({ code, reason }));
    return TaskStops.of({
      stop: (userId, appId, taskId) =>
        confirmingRefusal(
          Effect.gen(function* () {
            const verdict = can(
              { kind: "person", userId },
              "keep_intake",
              null,
              yield* roles.forWrite,
            );
            if (!verdict.allow) return yield* refuse("forbidden", verdict.reason);
            const [task] = yield* sql<{ readonly state: string }>`
              SELECT state FROM hq_task
              WHERE app_id::text = ${appId} AND id::text = ${taskId}`;
            if (task === undefined) return yield* refuse("not_found", "task_not_found");
            if (!["queued", "assigned", "working", "waiting"].includes(task.state))
              return yield* refuse("conflict", "task_ended");
            yield* tasks.stop(taskId, STOPPED_IN_MATE);
          }),
        ),
    });
  }),
);
