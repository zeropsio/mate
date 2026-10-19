/**
 * The organization's limits on each task (`hq_task_limits`, `HqTaskLimitsView`): minutes of an
 * agent at work on it, and US dollars of model use; 60 minutes and no cost limit until an owner or
 * admin of the organization sets them. Every `task` frame carries them (`MateTask.limits`); its
 * Mate stops the task at either and says where it got to. Beside them, what all its automated
 * Mates may spend in a calendar month (UTC), counted in the month each report said it: reached, HQ
 * hands out no task, puts those handed out but not taken back in line, and stops those at work
 * (`mateTasks.ts`). And the model they run each new task on: one of `automatedModels`, the default
 * until one is picked, handed to each automated Mate on its link (`provider-keys`, `orgAiKeys.ts`)
 * at once and again when it changes.
 *
 * @module taskLimits
 */
import type { MateTaskLimits } from "@t3tools/contracts";
import type { HqTaskLimitsView } from "@t3tools/shared/hqIntake";
import { automatedModelOf, automatedModelOffer } from "@t3tools/shared/openCodeKeyProviders";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
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
/** The most a budget may be: past it, a typo. */
const BUDGET_MAX = 1_000_000;

/** This calendar month (UTC), as `hq_task_month_spend.month` keys it. */
export const THIS_MONTH = "(date_trunc('month', now() AT TIME ZONE 'UTC'))::date";

/**
 * What the organization's automated Mates spent this calendar month (UTC), as they reported it:
 * each report's rise counted in the month it came (`MateTasks.report`).
 */
export const spentThisMonth = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{ readonly spent: number }>`
    SELECT COALESCE(sum(spent_usd), 0)::float8 AS spent FROM hq_task_month_spend
    WHERE month = ${sql.literal(THIS_MONTH)}`;
  return row?.spent ?? 0;
});

/** Whether this month's spend reached the organization's monthly budget, where it set one. */
export const budgetSpent = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{ readonly budget: number | null }>`
    SELECT monthly_budget_usd AS budget FROM hq_task_limits`;
  if (row?.budget == null) return false;
  return (yield* spentThisMonth) >= row.budget;
});

/** The limits as kept, or the defaults. */
export const readTaskLimits = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{ readonly minutes: number; readonly cost_usd: number | null }>`
    SELECT minutes, cost_usd FROM hq_task_limits`;
  return row === undefined
    ? DEFAULT_TASK_LIMITS
    : ({ minutes: row.minutes, costUsd: row.cost_usd } satisfies MateTaskLimits);
});

/** The model the organization picked for its automated Mates; none while it picked none. */
export const pickedModel = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [row] = yield* sql<{ readonly model: string | null }>`
    SELECT automated_model AS model FROM hq_task_limits`;
  return row?.model ?? undefined;
});

export class TaskLimits extends Context.Service<
  TaskLimits,
  {
    readonly view: Effect.Effect<HqTaskLimitsView, SqlError>;
    /** Kept by an owner or admin of the organization. */
    readonly keep: (
      userId: string,
      /** A monthly budget or a model left out is kept as it is (a client that predates them). */
      limits: Omit<HqTaskLimitsView, "spentThisMonthUsd">,
    ) => Effect.Effect<HqTaskLimitsView, AutomationRefused | NotLeader | SqlError | ZeropsError>;
    /** Ticks after the limits or the model were kept, starting with the current tick. */
    readonly changes: Stream.Stream<number>;
  }
>()("@t3tools/hq/taskLimits") {}

export const taskLimitsLayer = Layer.effect(
  TaskLimits,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    const roles = yield* Roles;
    const ticks = yield* SubscriptionRef.make(0);
    const view = Effect.provideService(
      Effect.gen(function* () {
        const limits = yield* readTaskLimits;
        const [row] = yield* sql<{ readonly budget: number | null; readonly model: string | null }>`
          SELECT monthly_budget_usd AS budget, automated_model AS model FROM hq_task_limits`;
        return {
          ...limits,
          monthlyBudgetUsd: row?.budget ?? null,
          spentThisMonthUsd: yield* spentThisMonth,
          model: automatedModelOf(row?.model),
        } satisfies HqTaskLimitsView;
      }),
      SqlClient.SqlClient,
      sql,
    );
    return TaskLimits.of({
      view,
      changes: SubscriptionRef.changes(ticks),
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
            const budget = limits.monthlyBudgetUsd;
            if (budget != null && !(budget > 0 && budget <= BUDGET_MAX))
              return yield* new AutomationRefused({ code: "invalid", reason: "budget" });
            const model = limits.model;
            if (model !== undefined && automatedModelOffer(model) === undefined)
              return yield* new AutomationRefused({ code: "invalid", reason: "model" });
            const given = budget !== undefined;
            const picked = model !== undefined;
            yield* leader.write(sql`
              INSERT INTO hq_task_limits (id, minutes, cost_usd, monthly_budget_usd,
                automated_model, set_by, set_at)
              VALUES (true, ${limits.minutes}, ${limits.costUsd}, ${budget ?? null},
                ${model?.trim() ?? null}, ${userId}, now())
              ON CONFLICT (id) DO UPDATE SET minutes = EXCLUDED.minutes,
                cost_usd = EXCLUDED.cost_usd, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at,
                monthly_budget_usd = CASE WHEN ${given} THEN EXCLUDED.monthly_budget_usd
                  ELSE hq_task_limits.monthly_budget_usd END,
                automated_model = CASE WHEN ${picked} THEN EXCLUDED.automated_model
                  ELSE hq_task_limits.automated_model END`);
            yield* SubscriptionRef.update(ticks, (tick) => tick + 1);
            return yield* view;
          }),
        ),
    });
  }),
);
