import { assert, describe, it } from "@effect/vitest";
import type { HqScheduleRule, HqScheduleView } from "@t3tools/shared/hqIntake";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { automatedPool } from "../test/harness/automated.ts";
import { rowsWhere } from "../test/harness/mates.ts";
import { sessionFor } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { nextDue } from "./schedules.ts";

const at = (iso: string) => Date.parse(iso);
const isoOf = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
const prague = (every: HqScheduleRule["every"], time: string, day?: number): HqScheduleRule => ({
  every,
  at: time,
  timeZone: "Europe/Prague",
  ...(day === undefined ? {} : { day }),
});

describe("when a schedule is next due", () => {
  it.each([
    [
      "every day at 9:00 in Prague, the day its clocks go forward, at 9:00 summer time",
      prague("day", "09:00"),
      "2026-03-28T08:00:00.000Z",
      "2026-03-29T07:00:00.000Z",
    ],
    [
      "every day at 9:00 in Prague, the day its clocks go back, at 9:00 winter time",
      prague("day", "09:00"),
      "2026-10-24T07:00:00.000Z",
      "2026-10-25T08:00:00.000Z",
    ],
    [
      "every weekday at 9:00, after Friday's, on Monday",
      prague("weekday", "09:00"),
      "2026-10-16T08:00:00.000Z",
      "2026-10-19T07:00:00.000Z",
    ],
    [
      "every Monday at 9:00, at the very time of one run, a week on, past the clocks going back",
      prague("week", "09:00", 1),
      "2026-10-19T07:00:00.000Z",
      "2026-10-26T08:00:00.000Z",
    ],
    [
      "at a time the clocks skip, the moment after the gap",
      prague("day", "02:30"),
      "2026-03-28T02:00:00.000Z",
      "2026-03-29T01:30:00.000Z",
    ],
    [
      "every day at 9:00 in New York, the day its clocks go forward, at 9:00 there",
      { every: "day", at: "09:00", timeZone: "America/New_York" },
      "2026-03-07T15:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
    ],
  ] as const)("%s", (_title, rule, after, due) => {
    assert.strictEqual(isoOf(nextDue(rule, at(after))!), due);
  });

  it("a time zone that is none has no next time", () => {
    assert.isUndefined(
      nextDue({ every: "day", at: "09:00", timeZone: "Mars/Olympus" }, at("2026-10-17T00:00:00Z")),
    );
  });
});

describe("an application's schedules", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a schedule's brief becomes a task each time it is due, once per time, and its run is skipped while its last one is live",
      () =>
        Effect.gen(function* () {
          const core = yield* automatedPool({ busy: true, scheduleEvery: Duration.millis(50) });
          const path = `/api/apps/${core.appId}/schedules`;
          const brief = "Update the dependencies.\nOpen a change for review.";
          const rule = prague("day", "09:00");
          const developer = yield* sessionFor(core.call, "door-dev");
          const refused = yield* core.call("POST", path, {
            session: developer,
            body: { name: "Upkeep", brief, rule },
          });
          assert.strictEqual(refused.status, 403);
          for (const wrong of [
            { ...rule, timeZone: "Mars/Olympus" },
            { ...rule, every: "week" },
            { ...rule, day: 2 },
          ]) {
            const invalid = yield* core.call("POST", path, {
              session: core.owner,
              body: { name: "Upkeep", brief, rule: wrong },
            });
            assert.strictEqual(invalid.status, 400);
          }
          const made = yield* core.call("POST", path, {
            session: core.owner,
            body: { name: "Upkeep", brief, rule },
          });
          assert.strictEqual(made.status, 201);
          const schedule = made.body as HqScheduleView;
          const now = yield* Clock.currentTimeMillis;
          assert.isTrue(Date.parse(schedule.nextAt!) > now);
          // Due an hour ago.
          const due = (iso: string) =>
            core.sql`UPDATE hq_schedule SET next_at = ${iso}::timestamptz`;
          const past = isoOf(now - 3_600_000);
          yield* due(past);
          const [task] = yield* rowsWhere(
            core.url,
            "SELECT source_key, source, body, requested_by FROM hq_task",
            (rows) => rows.length === 1,
          );
          assert.deepStrictEqual(task, {
            source_key: `schedule:${schedule.id}/${past}`,
            source: { kind: "schedule", name: "Upkeep", title: "Update the dependencies." },
            body: brief,
            requested_by: "owner",
          });
          const moved = yield* rowsWhere(
            core.url,
            "SELECT next_at > now() AS ahead FROM hq_schedule",
            (rows) => rows[0]?.["ahead"] === true,
          );
          assert.strictEqual(moved[0]!["ahead"], true);
          // Due again while its last run still waits: skipped, and moved on.
          yield* due(isoOf(now - 60_000));
          yield* rowsWhere(
            core.url,
            "SELECT next_at > now() AS ahead FROM hq_schedule",
            (rows) => rows[0]?.["ahead"] === true,
          );
          const tasks = yield* rowsWhere(core.url, "SELECT 1 FROM hq_task", () => true);
          assert.strictEqual(tasks.length, 1);
          const listed = yield* core.call("GET", path, { session: core.owner });
          assert.strictEqual((listed.body as { schedules: Array<unknown> }).schedules.length, 1);
          const removed = yield* core.call("DELETE", `${path}/${schedule.id}`, {
            session: core.owner,
          });
          assert.strictEqual(removed.status, 204);
        }),
    );
  });
});
