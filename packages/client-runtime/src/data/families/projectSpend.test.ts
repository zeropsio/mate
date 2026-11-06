// @effect-diagnostics globalDate:off -- fixed instants for calendar-day arithmetic.
import { describe, expect, it } from "vite-plus/test";

import { midnightIn, projectSpendSearch } from "./projectSpend.ts";

describe("the spend read's window", () => {
  it.each([{ zone: "Europe/Prague", day: "2026-10-26", midnight: "2026-10-25T23:00:00.000Z" }])(
    "$day begins at $midnight in $zone, across a clock change too",
    ({ zone, day, midnight }) => {
      expect(new Date(midnightIn(day, zone)).toISOString()).toBe(midnight);
    },
  );

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
