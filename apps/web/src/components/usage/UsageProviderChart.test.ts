import { describe, expect, it } from "vite-plus/test";

import { buildPeriodColumns, niceScale } from "./UsageProviderChart";
import { providersWithUsage } from "./usageProviders";

describe("Decision: fix what the audit lists; no new features; no test weakened.", () => {
  it("The Usage chart draws isolated positive and zero periods without filling missing periods", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { UsageProviderChart } = await import("./UsageProviderChart");
    const { usageReportView } = await import("../../state/usage");
    const { recordedReport, statistics } = await import("./usageTestFixtures");
    const report = recordedReport({
      groups: [
        {
          key: "first",
          period: "2026-10-01",
          provider: "claude",
          totals: statistics("100"),
          costUsdNanos: "949000",
        },
        {
          key: "last",
          period: "2026-10-03",
          provider: "claude",
          totals: statistics("0"),
          costUsdNanos: "0",
        },
      ],
    });
    const html = renderToStaticMarkup(
      createElement(UsageProviderChart, {
        providers: ["claude"],
        days: ["2026-10-01", "2026-10-02", "2026-10-03"],
        daily: usageReportView(report, null, null, report).daily,
        hours: [],
        hourly: [],
        metric: "cost",
        resolution: "day",
        timeZone: "UTC",
      }),
    );
    const marks = [...html.matchAll(/<rect[^>]+data-usage-value=[^>]+>/g)].map((match) => match[0]);
    expect(marks).toHaveLength(2);
    const viewHeight = Number(html.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1]);
    for (const mark of marks) {
      const height = Number(mark.match(/height="([\d.]+)"/)![1]);
      const top = Number(mark.match(/ y="([\d.]+)"/)![1]);
      expect(height).toBeGreaterThan(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + height).toBeLessThanOrEqual(viewHeight);
    }
    expect(html).toContain('data-usage-value="0"');
    expect(html).not.toContain("<path");
  });
});

describe("niceScale", () => {
  it("never puts the peak above the top of the scale", () => {
    // Regression: an earlier version stopped at the last step below the peak,
    // so the tallest day was drawn past the plot and clipped.
    for (const peak of [1122.71, 999, 1, 0.04, 1_400_000_000, 37.5, 5000, 100.001]) {
      const { max } = niceScale(peak, 4);
      expect(max, `peak ${peak}`).toBeGreaterThanOrEqual(peak);
    }
  });

  it("starts at zero and ends at the maximum", () => {
    const { max, ticks } = niceScale(1122.71, 4);

    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeCloseTo(max, 6);
  });

  it("uses evenly spaced 1/2/5 steps", () => {
    const { ticks } = niceScale(1122.71, 4);
    const steps = ticks.slice(1).map((tick, index) => tick - (ticks[index] ?? 0));

    for (const step of steps) expect(step).toBeCloseTo(steps[0] ?? 0, 6);
    const [first = 0] = steps;
    const normalized = first / 10 ** Math.floor(Math.log10(first));
    expect([1, 2, 5, 10]).toContain(Math.round(normalized));
  });

  it("keeps the tick count near the requested resolution", () => {
    const { ticks } = niceScale(1122.71, 4);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(7);
  });

  it("degrades to a single zero tick with no data", () => {
    expect(niceScale(0, 4)).toEqual({ max: 0, ticks: [0] });
  });
});

describe("buildPeriodColumns", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03"];
  const byDay = new Map([
    [
      "2026-08-01",
      {
        day: "2026-08-01",
        costUsd: 30,
        totalTokens: 300,
        byProvider: new Map([
          ["codex" as const, { costUsd: 10, totalTokens: 100 }],
          ["claude" as const, { costUsd: 20, totalTokens: 200 }],
        ]),
      },
    ],
    // 2026-08-02 is deliberately absent: no recorded evidence for that day.
    [
      "2026-08-03",
      {
        day: "2026-08-03",
        costUsd: 5,
        totalTokens: 50,
        byProvider: new Map([["claude" as const, { costUsd: 5, totalTokens: 50 }]]),
      },
    ],
  ]);

  it("plots each day on its own", () => {
    expect(buildPeriodColumns(days, byDay, "cost").map((column) => column.total)).toEqual([
      30,
      null,
      5,
    ]);
  });

  it("reads the requested metric", () => {
    expect(buildPeriodColumns(days, byDay, "tokens").map((column) => column.total)).toEqual([
      300,
      null,
      50,
    ]);
  });

  it("keeps band values absolute rather than cumulative", () => {
    // Regression: the bands were once stack offsets, which drew Claude Code
    // permanently above Codex regardless of which provider spent more.
    const [first] = buildPeriodColumns(days, byDay, "cost");

    expect(first?.bands).toEqual([
      { provider: "codex", value: 10 },
      { provider: "claude", value: 20 },
      { provider: "grok", value: null },
      { provider: "cursor", value: null },
      { provider: "opencode", value: null },
      { provider: "antigravity", value: null },
    ]);
  });

  it("reports the total as the sum of its bands", () => {
    for (const column of buildPeriodColumns(days, byDay, "cost")) {
      const sum = column.bands.reduce((running, band) => running + (band.value ?? 0), 0);
      if (column.total !== null) expect(column.total).toBeCloseTo(sum, 9);
    }
  });
});

describe("providersWithUsage", () => {
  it("omits providers with no cost or tokens", () => {
    expect(
      providersWithUsage([
        { provider: "codex", costUsd: 0, totalTokens: 0 },
        { provider: "claude", costUsd: 0, totalTokens: 200 },
      ]),
    ).toEqual(["claude"]);
  });
});

describe("hourly chart columns", () => {
  it("keeps missing hours unknown and preserves hourly provider values", () => {
    const byHour = new Map([
      [
        "2026-08-11T09:37:00.000Z",
        {
          day: "2026-08-11",
          hourStart: "2026-08-11T09:37:00.000Z",
          costUsd: 4,
          totalTokens: 40,
          byProvider: new Map([["codex" as const, { costUsd: 4, totalTokens: 40 }]]),
        },
      ],
    ]);

    expect(
      buildPeriodColumns(
        ["2026-08-11T08:37:00.000Z", "2026-08-11T09:37:00.000Z", "2026-08-11T10:37:00.000Z"],
        byHour,
        "cost",
      ).map((column) => column.total),
    ).toEqual([null, 4, null]);
  });
});

it("Past 24h plots recorded clock-hour rows inside minute-exact window edges", async () => {
  const { enumerateHourStarts } = await import("@t3tools/shared/usageFormat");
  const { usageReportView } = await import("../../state/usage");
  const { recordedReport, statistics } = await import("./usageTestFixtures");
  const report = recordedReport();
  const periods = recordedReport({
    groups: [
      {
        key: "hour",
        period: "2026-10-07T12:00:00.000Z",
        provider: "claude",
        totals: statistics("919000"),
        costUsdNanos: null,
      },
    ],
  });
  const rows = usageReportView(report, null, null, periods, true).hourly;
  const hours = enumerateHourStarts("2026-10-06T12:37:00.000Z", "2026-10-07T12:37:00.000Z");
  expect(
    buildPeriodColumns(hours, new Map(rows.map((row) => [row.hourStart, row])), "tokens").at(-1)
      ?.total,
  ).toBe(919000);
  expect(hours).toHaveLength(25);
});

it.each([0.000949, 0.0199, 0.099])(
  "Positive sub-cent chart ticks remain distinguishable at a peak of %s",
  async (peak) => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { UsageProviderChart } = await import("./UsageProviderChart");
    const html = renderToStaticMarkup(
      createElement(UsageProviderChart, {
        providers: ["claude"],
        days: ["2026-10-07"],
        daily: [
          {
            day: "2026-10-07",
            costUsd: peak,
            totalTokens: 100,
            byProvider: new Map([["claude" as const, { costUsd: peak, totalTokens: 100 }]]),
          },
        ],
        hours: [],
        hourly: [],
        metric: "cost",
        resolution: "day",
        timeZone: "UTC",
      }),
    );
    const ticks = [...html.matchAll(/<span[^>]*>(\$[\d.]+)<\/span>/g)].map((match) => match[1]);
    expect(ticks.length).toBeGreaterThan(1);
    expect(new Set(ticks).size).toBe(ticks.length);
  },
);
