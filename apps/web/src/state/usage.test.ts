import { describe, expect, it } from "vite-plus/test";
import { UsageDay, EnvironmentId, type UsageSummaryInput } from "@t3tools/contracts";
import { usageReportQuery, usageReportTotals } from "./usage.logic";
import { recordedReport } from "../components/usage/usageTestFixtures";
const window: UsageSummaryInput = {
  sinceDay: UsageDay.make("2026-10-01"),
  untilDay: UsageDay.make("2026-10-07"),
  timeZone: "UTC",
  resolution: "day",
};

describe("recorded consumption report selection", () => {
  it.each([
    {
      name: "organization consumption comes from HQ",
      scope: {},
      match: { appId: null, mateId: null, ownerUserId: null },
    },
    {
      name: "project scope uses the stable HQ app identity",
      scope: { project: "app-a" },
      match: { appId: "app-a" },
    },
    {
      name: "Mate scope uses the recorded Mate identity",
      scope: { mate: EnvironmentId.make("mate-a") },
      match: { mateId: "mate-a" },
    },
    {
      name: "owner scope uses the current HQ owner",
      scope: { person: "u-a" },
      match: { ownerUserId: "u-a" },
    },
  ])("$name", ({ scope, match }) => expect(usageReportQuery(window, scope)).toMatchObject(match));
  it("a rolling day requests the exact recorded window", () => {
    expect(
      usageReportQuery(
        {
          ...window,
          resolution: "hour",
          sinceTime: "2026-10-06T12:17:00.000Z",
          untilTime: "2026-10-07T12:17:00.000Z",
        },
        {},
      ),
    ).toMatchObject({
      mode: "exact",
      since: "2026-10-06T12:17:00.000Z",
      until: "2026-10-07T12:17:00.000Z",
    });
  });
  it("daily history requests complete UTC days including the last selected day", () =>
    expect(usageReportQuery(window, {})).toMatchObject({
      mode: "utc-days",
      since: "2026-10-01T00:00:00.000Z",
      until: "2026-10-08T00:00:00.000Z",
    }));
  it("HQ automatic pricing remains an estimate separate from native reported cost", () => {
    expect(usageReportTotals(recordedReport())).toMatchObject({
      costUsd: 7.83,
      totalTokens: 1000,
      records: 1,
    });
  });
  it.each([
    { priced: "2", unpriced: "0", pricedShare: 1, unpricedShare: 0 },
    { priced: "1", unpriced: "1", pricedShare: 0.5, unpricedShare: 0.5 },
    { priced: "0", unpriced: "2", pricedShare: 0, unpricedShare: 1 },
  ])(
    "one turn prices its $priced priced and $unpriced unpriced model entries independently",
    ({ priced, unpriced, pricedShare, unpricedShare }) => {
      const report = recordedReport();
      expect(
        usageReportTotals({
          ...report,
          pricing: {
            ...report.pricing,
            pricedModelEntries: priced,
            unpricedModelEntries: unpriced,
          },
        }),
      ).toMatchObject({
        records: 1,
        costQuality: { modelPricedShare: pricedShare, unpricedShare },
      });
    },
  );
});
