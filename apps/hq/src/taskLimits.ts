/**
 * The organization's limits on each task (`hq_task_limits`, `HqTaskLimitsView`): minutes of an
 * agent at work on it, and US dollars of model use; 60 minutes and no cost limit until an owner or
 * admin of the organization sets them. Every `task` frame carries them (`MateTask.limits`); its
 * Mate stops the task at either and says where it got to.
 *
 * @module taskLimits
 */
import type { MateTaskLimits } from "@t3tools/contracts";
import type { HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { AutomationRefused } from "./automationRefused.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** A task's limits until the organization sets its own. */
export const DEFAULT_TASK_LIMITS: MateTaskLimits = { minutes: 60, costUsd: null };
/** The most minutes a task may be given: a day. */
const MINUTES_MAX = 1440;

/** The limits as kept, or the defaults. */
export const readTaskLimits = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{ readonly minutes: number; readonly cost_usd: number | null }>`
    SELECT minutes, cost_usd FROM hq_task_limits`;
  return row === undefined
    ? DEFAULT_TASK_LIMITS
    : ({ minutes: row.minutes, costUsd: row.cost_usd } satisfies MateTaskLimits);
});

export class TaskLimits extends Context.Service<
  TaskLimits,
  {
    readonly view: Effect.Effect<HqTaskLimitsView, SqlError>;
    /** Kept by an owner or admin of the organization. */
    readonly keep: (
      userId: string,
      limits: HqTaskLimitsView,
    ) => Effect.Effect<HqTaskLimitsView, AutomationRefused | NotLeader | SqlError | ZeropsError>;
  }
>()("@t3tools/hq/taskLimits") {}

export const taskLimitsLayer = Layer.effect(
  TaskLimits,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    const roles = yield* Roles;
    const view = Effect.provideService(readTaskLimits, SqlClient.SqlClient, sql);
    return TaskLimits.of({
      view,
      keep: (userId, limits) =>
        confirmingRefusal(
          Effect.gen(function* () {
            // Whoever may keep the organization's API keys keeps what a task may spend of them.
            const verdict = can(
              { kind: "person", userId },
              "keep_ai_key",
              null,
              yield* roles.forWrite,
            );
            if (!verdict.allow)
              return yield* new AutomationRefused({ code: "forbidden", reason: verdict.reason });
            if (limits.minutes < 1 || limits.minutes > MINUTES_MAX)
              return yield* new AutomationRefused({ code: "invalid", reason: "minutes" });
            if (limits.costUsd !== null && !(limits.costUsd > 0 && limits.costUsd <= 10_000))
              return yield* new AutomationRefused({ code: "invalid", reason: "cost" });
            yield* leader.write(sql`
              INSERT INTO hq_task_limits (id, minutes, cost_usd, set_by, set_at)
              VALUES (true, ${limits.minutes}, ${limits.costUsd}, ${userId}, now())
              ON CONFLICT (id) DO UPDATE SET minutes = EXCLUDED.minutes,
                cost_usd = EXCLUDED.cost_usd, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at`);
            return yield* view;
          }),
        ),
    });
  }),
);
