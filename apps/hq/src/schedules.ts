/**
 * An application's schedules (`hq_schedule`, `@t3tools/shared/hqIntake` `HqScheduleView`): a brief
 * its automated Mates get as a task each time it is due — every day, every weekday, or one day a
 * week, at a time of day in a time zone, through its changes of clock (`nextDue`). Made, listed and
 * removed by the organization's structure writers (`keep_intake`).
 *
 * The leading Core looks every `every` (30 s) for schedules due: each becomes a task through HQ's
 * door (`TaskIntake`) of a `ScheduleSource`, its work item `schedule:<id>/<due ISO>` — so a restart
 * between taking it in and moving the schedule on never makes it twice — asked for by the
 * schedule's maker; a run whose schedule's last run is still live is skipped. Then the schedule is
 * next due at its first time after now: runs missed while no Core led are one run, not many.
 *
 * @module schedules
 */
import type { HqScheduleRequest, HqScheduleRule, HqScheduleView } from "@t3tools/shared/hqIntake";
import { HqScheduleRule as ScheduleRule } from "@t3tools/shared/hqIntake";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";

import { AutomationRefused } from "./automationRefused.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { can } from "./permissions.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import { TaskIntake, cleanTaskTitle } from "./taskSources.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** How many schedules an application keeps. */
const SCHEDULES_MAX = 20;
/** The most calendar days between two runs of a rule: a week, and a day of slack. */
const DAYS_AHEAD = 8;

/**
 * When `rule` is next due strictly after `after` (epoch ms): the first calendar day from `after`'s
 * own, in the rule's time zone, the rule takes, at its time of day there. A time the clock skips
 * that day (spring forward) is the moment after the gap; one it repeats (fall back), the first.
 * None for a time zone that is none.
 */
export const nextDue = (rule: HqScheduleRule, after: number): number | undefined => {
  const zone = DateTime.zoneMakeNamed(rule.timeZone);
  if (Option.isNone(zone)) return undefined;
  const [hour, minute] = rule.at.split(":").map(Number) as [number, number];
  const today = DateTime.toParts(DateTime.makeZonedUnsafe(after, { timeZone: zone.value }));
  for (let ahead = 0; ahead <= DAYS_AHEAD; ahead += 1) {
    // The calendar day `ahead` days on, as a date with no zone: its weekday is the zone's.
    const day = DateTime.toPartsUtc(
      DateTime.makeUnsafe({
        year: today.year,
        month: today.month,
        day: today.day + ahead,
        hour: 12,
        minute: 0,
        second: 0,
        millisecond: 0,
      }),
    );
    if (rule.every === "weekday" && (day.weekDay === 0 || day.weekDay === 6)) continue;
    if (rule.every === "week" && day.weekDay !== rule.day) continue;
    const due = DateTime.makeZoned(
      {
        year: day.year,
        month: day.month,
        day: day.day,
        hour,
        minute,
        second: 0,
        millisecond: 0,
      },
      { timeZone: zone.value, adjustForTimeZone: true, disambiguation: "compatible" },
    );
    if (Option.isSome(due) && DateTime.toEpochMillis(due.value) > after)
      return DateTime.toEpochMillis(due.value);
  }
  return undefined;
};

const decodeRule = Schema.decodeUnknownOption(ScheduleRule);
const encodeRule = Schema.encodeSync(Schema.fromJsonString(ScheduleRule));

type ScheduleError = AutomationRefused | NotLeader | SqlError | ZeropsError;

export class Schedules extends Context.Service<
  Schedules,
  {
    readonly make: (
      userId: string,
      appId: string,
      request: HqScheduleRequest,
    ) => Effect.Effect<HqScheduleView, ScheduleError>;
    readonly list: (
      userId: string,
      appId: string,
    ) => Effect.Effect<ReadonlyArray<HqScheduleView>, ScheduleError>;
    readonly remove: (
      userId: string,
      appId: string,
      id: string,
    ) => Effect.Effect<void, ScheduleError>;
  }
>()("@t3tools/hq/schedules") {}

interface ScheduleRow {
  readonly id: string;
  readonly app_id: string;
  readonly name: string;
  readonly brief: string;
  readonly rule: unknown;
  readonly next_at: string | null;
  readonly created_by: string;
}

const COLUMNS = `id::text AS id, app_id::text AS app_id, name, brief, rule, created_by,
  to_char(next_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS next_at`;

const viewOf = (row: ScheduleRow): HqScheduleView | undefined => {
  const rule = Option.getOrUndefined(decodeRule(row.rule));
  return rule === undefined
    ? undefined
    : { id: row.id, name: row.name, brief: row.brief, rule, nextAt: row.next_at };
};

const isoOf = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

export const schedulesLayer = (options: { readonly every?: Duration.Duration } = {}) =>
  Layer.effect(
    Schedules,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const leader = yield* Leader;
      const roles = yield* Roles;
      const intake = yield* TaskIntake;

      const refuse = (code: AutomationRefused["code"], reason: string) =>
        Effect.fail(new AutomationRefused({ code, reason }));

      const authorized = (userId: string, appId: string) =>
        Effect.gen(function* () {
          const verdict = can(
            { kind: "person", userId },
            "keep_intake",
            null,
            yield* roles.forWrite,
          );
          if (!verdict.allow) return yield* refuse("forbidden", verdict.reason);
          const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
          if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
        });

      /** Each schedule due, run — or skipped while its last run is live — and moved on. */
      const runDue = Effect.gen(function* () {
        if ((yield* leader.status).state !== "active") return;
        const due = yield* sql<ScheduleRow & { readonly next_at: string }>`
          SELECT ${sql.literal(COLUMNS)}
          FROM hq_schedule WHERE next_at <= now() ORDER BY next_at LIMIT 50`;
        const now = yield* Clock.currentTimeMillis;
        for (const schedule of due) {
          const rule = Option.getOrUndefined(decodeRule(schedule.rule));
          const at = schedule.next_at;
          const dueMs = Date.parse(at);
          const live = yield* sql`
            SELECT 1 FROM hq_task WHERE app_id::text = ${schedule.app_id}
              AND source_key LIKE ${`schedule:${schedule.id}/%`}
              AND state IN ('queued', 'assigned', 'working', 'waiting')`;
          if (live.length === 0)
            yield* intake.enqueue({
              appId: schedule.app_id,
              source: {
                kind: "schedule",
                name: schedule.name,
                title: cleanTaskTitle(schedule.brief.split("\n")[0] ?? "", schedule.name),
              },
              body: schedule.brief,
              sourceKey: `schedule:${schedule.id}/${at}`,
              deliveryId: `schedule:${schedule.id}/${at}`,
              requestedBy: schedule.created_by,
            });
          else yield* Effect.logInfo("a schedule's run skipped: its last run is live", { at });
          const next = rule === undefined ? undefined : nextDue(rule, Math.max(now, dueMs));
          // Moved on from the run it took: a schedule changed meanwhile keeps its own next time.
          yield* leader.write(sql`
            UPDATE hq_schedule
            SET next_at = ${next === undefined ? null : isoOf(next)}::timestamptz
            WHERE id::text = ${schedule.id} AND next_at = ${at}::timestamptz`);
        }
      });

      yield* Effect.forkScoped(
        Effect.forever(
          Effect.andThen(
            Effect.sleep(options.every ?? Duration.seconds(30)),
            runDue.pipe(
              Effect.catchCause((cause) => Effect.logWarning("schedules not run", cause)),
            ),
          ),
        ),
      );

      return Schedules.of({
        make: (userId, appId, request) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* authorized(userId, appId);
              const name = request.name.trim();
              if (name.length > 80) return yield* refuse("invalid", "name");
              if (request.brief.length > 16_000) return yield* refuse("invalid", "brief");
              const { rule } = request;
              if ((rule.every === "week") !== (rule.day !== undefined))
                return yield* refuse("invalid", "day");
              const next = nextDue(rule, yield* Clock.currentTimeMillis);
              if (next === undefined) return yield* refuse("invalid", "time_zone");
              const [count] = yield* sql<{ readonly count: number }>`
                SELECT count(*)::int AS count FROM hq_schedule WHERE app_id::text = ${appId}`;
              if ((count?.count ?? 0) >= SCHEDULES_MAX)
                return yield* refuse("conflict", "too_many");
              const [row] = yield* leader.write(sql<ScheduleRow>`
                INSERT INTO hq_schedule (app_id, name, brief, rule, next_at, created_by)
                VALUES (${appId}::uuid, ${name}, ${request.brief}, ${encodeRule(rule)}::jsonb,
                  ${isoOf(next)}::timestamptz, ${userId})
                RETURNING ${sql.literal(COLUMNS)}`);
              const view = row === undefined ? undefined : viewOf(row);
              if (view === undefined) return yield* refuse("invalid", "rule");
              return view;
            }),
          ),
        list: (userId, appId) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* authorized(userId, appId);
              const rows = yield* sql<ScheduleRow>`
                SELECT ${sql.literal(COLUMNS)} FROM hq_schedule
                WHERE app_id::text = ${appId} ORDER BY seq`;
              return rows.flatMap((row) => viewOf(row) ?? []);
            }),
          ),
        remove: (userId, appId, id) =>
          confirmingRefusal(
            Effect.gen(function* () {
              yield* authorized(userId, appId);
              const gone = yield* leader.write(sql`
                DELETE FROM hq_schedule WHERE app_id::text = ${appId} AND id::text = ${id}
                RETURNING 1`);
              if (gone.length === 0) return yield* refuse("not_found", "schedule_not_found");
            }),
          ),
      });
    }),
  );
