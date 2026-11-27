import { expect, it } from "vite-plus/test";

import { parseScheduleAsk, scheduleAskRequest } from "./scheduleAsk.logic";

const fence = (fields: Record<string, unknown>) =>
  JSON.stringify({
    title: "Update the dependencies every night",
    name: "Nightly dependency update",
    brief: "Update the dependencies, run the tests, and open a change when they pass.",
    ...fields,
  });

const requestOf = (fields: Record<string, unknown>) => {
  const ask = parseScheduleAsk(fence(fields));
  return ask === null ? null : scheduleAskRequest(ask, "Europe/Prague");
};

// witness: apps/web/src/components/ask/scheduleAsk.logic.ts | `${match[1]!.padStart(2, "0")}:${match[2]!}` → `${match[1]!}:${match[2]!}`
it("AK+1: A schedule ask proposes the schedule its fence names, its weekday and its clock as HQ counts them and its zone the Mate's or else the person's, and a fence with no brief, a cadence HQ has not, a week with no day or a time off the clock proposes none; breaks: the card offers a schedule HQ refuses, or makes one on another day or at another time than the Mate proposed", () => {
  expect(requestOf({ every: "day", at: "3:00" })).toEqual({
    name: "Nightly dependency update",
    brief: "Update the dependencies, run the tests, and open a change when they pass.",
    rule: { every: "day", at: "03:00", timeZone: "Europe/Prague" },
  });
  expect(
    requestOf({ every: "week", day: "Sunday", at: "18:30", timeZone: "America/New_York" })?.rule,
  ).toEqual({ every: "week", day: 0, at: "18:30", timeZone: "America/New_York" });
  expect(requestOf({ every: "week", day: "monday", at: "09:00" })?.rule.day).toBe(1);
  expect(requestOf({ every: "weekday", at: "07:15" })?.rule).toEqual({
    every: "weekday",
    at: "07:15",
    timeZone: "Europe/Prague",
  });

  expect(requestOf({ every: "day", at: "03:00", brief: " " })).toBeNull();
  expect(requestOf({ every: "month", at: "03:00" })).toBeNull();
  expect(requestOf({ every: "week", at: "03:00" })).toBeNull();
  expect(requestOf({ every: "day", at: "24:00" })).toBeNull();
  expect(requestOf({ every: "day", at: "3pm" })).toBeNull();
  expect(parseScheduleAsk("every night at three")).toBeNull();
});
