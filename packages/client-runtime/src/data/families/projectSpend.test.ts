// @effect-diagnostics globalDate:off -- fixed instants for calendar-day arithmetic.
import { describe, expect, it } from "vite-plus/test";

import {
  dayIn,
  decodeProjectSpend,
  midnightIn,
  projectSpendSearch,
  spendWindow,
} from "./projectSpend.ts";

const bucket = (projectId: string, from: string, sumTotalPrice: number) => ({
  projectId,
  projectName: "Tea Shop",
  stackId: null,
  stackName: null,
  from,
  till: `${from.slice(0, 10)}T23:59:59${from.slice(19)}`,
  sumTotalPrice,
  cpu: 0,
  ram: 0,
});
const answer = (items: ReadonlyArray<unknown>, totalHits = items.length) => ({
  items,
  totalHits,
  limit: null,
  from: "2026-09-19T00:00:00+02:00",
  till: "2026-10-18T19:00:00+02:00",
  groupBy: "projectId",
  timeGroupBy: "1d",
});

describe("a project's daily Zerops cost as billing answers it", () => {
  it("a day is the date Zerops wrote in the zone asked, never that instant's UTC date", () => {
    const spend = decodeProjectSpend(
      answer([bucket("tea-prod", "2026-09-19T00:00:00+02:00", 0.5)]),
    );
    expect(spend?.byProject["tea-prod"]).toEqual({ "2026-09-19": 0.5 });
    expect(spend).toMatchObject({ firstDay: "2026-09-19", lastDay: "2026-10-18" });
  });

  it("two buckets of one project's day add up", () => {
    const spend = decodeProjectSpend(
      answer([
        bucket("tea-prod", "2026-10-01T00:00:00+02:00", 0.25),
        bucket("tea-prod", "2026-10-01T00:00:00+02:00", 0.5),
      ]),
    );
    expect(spend?.byProject["tea-prod"]?.["2026-10-01"]).toBe(0.75);
  });

  it.each([
    { name: "every row it counted", items: 2, totalHits: 2, complete: true },
    { name: "fewer rows than it counted", items: 2, totalHits: 5, complete: false },
  ])("an answer with $name is complete: $complete", ({ items, totalHits, complete }) => {
    const rows = Array.from({ length: items }, (_, at) =>
      bucket(`p${String(at)}`, "2026-10-01T00:00:00+02:00", 1),
    );
    expect(decodeProjectSpend(answer(rows, totalHits))?.complete).toBe(complete);
  });

  it("an answer without its window reads as nothing", () => {
    expect(decodeProjectSpend({ items: [] })).toBeNull();
  });
});

describe("the spend read's window", () => {
  it.each([
    { zone: "Europe/Prague", at: "2026-10-18T22:30:00.000Z", day: "2026-10-19" },
    { zone: "Europe/Prague", at: "2026-10-18T21:59:00.000Z", day: "2026-10-18" },
    { zone: "America/Los_Angeles", at: "2026-10-19T06:59:00.000Z", day: "2026-10-18" },
    { zone: "Pacific/Auckland", at: "2026-10-18T11:00:00.000Z", day: "2026-10-19" },
  ])("$at is $day in $zone", ({ zone, at, day }) => {
    expect(dayIn(Date.parse(at), zone)).toBe(day);
  });

  it.each([
    { zone: "Europe/Prague", day: "2026-10-25", midnight: "2026-10-24T22:00:00.000Z" },
    { zone: "Europe/Prague", day: "2026-10-26", midnight: "2026-10-25T23:00:00.000Z" },
    { zone: "UTC", day: "2026-10-18", midnight: "2026-10-18T00:00:00.000Z" },
    { zone: "Pacific/Auckland", day: "2026-10-19", midnight: "2026-10-18T11:00:00.000Z" },
  ])("$day begins at $midnight in $zone, across a clock change too", ({ zone, day, midnight }) => {
    expect(new Date(midnightIn(day, zone)).toISOString()).toBe(midnight);
  });

  it("reads 30 days: from the midnight 29 days before today, to now", () => {
    const now = Date.parse("2026-10-18T17:00:00.000Z");
    expect(spendWindow(now, "Europe/Prague")).toEqual({
      from: "2026-09-18T22:00:00.000Z",
      till: "2026-10-18T17:00:00.000Z",
    });
  });

  it("asks the organization's whole spend by project and day, its client named", () => {
    const now = Date.parse("2026-10-18T17:00:00.000Z");
    expect(projectSpendSearch("acme", now, "Europe/Prague")).toMatchObject({
      search: [{ name: "clientId", operator: "eq", value: "acme" }],
      receiverId: "acme",
      groupBy: "projectId",
      timeGroupBy: "1d",
      timeZone: "Europe/Prague",
    });
  });
});
