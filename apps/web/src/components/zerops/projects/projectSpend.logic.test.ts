import type { UsageReport } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  averageLine,
  dayLabel,
  formatUsd,
  joinSpend,
  moneyParts,
  spendBarPx,
  spendState,
  subscriptionLine,
  tokenSpendByDay,
  tokenSpendQuery,
} from "./projectSpend.logic";

const DAYS = Array.from({ length: 30 }, (_, at) =>
  new Date(Date.parse("2026-09-19T00:00:00.000Z") + at * 86_400_000).toISOString().slice(0, 10),
);
const TODAY = "2026-10-18";
const compute = { days: DAYS, usd: DAYS.map((_, at) => (at === 29 ? 0.21 : at === 0 ? 1 : 0.5)) };
const group = (period: string, costUsdNanos: string | null, provider = "opencode") =>
  ({ key: period, period, provider, costUsdNanos }) as unknown as UsageReport["groups"][number];
const report = (groups: ReadonlyArray<UsageReport["groups"][number]>) =>
  ({ groups }) as unknown as UsageReport;

describe("a project's spend series", () => {
  it("joins compute and tokens on the same days, a day without tokens costing nothing", () => {
    const series = joinSpend(
      compute,
      tokenSpendByDay(
        report([group("2026-10-18", "630000000"), group("2026-09-19", "2000000000")]),
      ),
      TODAY,
    );
    expect(series.days).toHaveLength(30);
    expect(series.days[0]).toEqual({
      day: "2026-09-19",
      computeUsd: 1,
      tokensUsd: 2,
      totalUsd: 3,
    });
    expect(series.days[1]?.tokensUsd).toBe(0);
    expect(series.days[29]).toMatchObject({ computeUsd: 0.21, tokensUsd: 0.63 });
  });

  it("adds every provider's tokens of a day; an unpriced line adds nothing", () => {
    const byDay = tokenSpendByDay(
      report([
        group("2026-10-01", "1000000000", "opencode"),
        group("2026-10-01", "500000000", "codex"),
        group("2026-10-02", null),
      ]),
    );
    expect(byDay.get("2026-10-01")).toBe(1.5);
    expect(byDay.get("2026-10-02")).toBe(0);
  });

  it("totals the 30 days, averages them a day, and finds today last", () => {
    const series = joinSpend(compute, new Map([["2026-10-18", 0.63]]), TODAY);
    expect(series.computeUsd).toBeCloseTo(1 + 28 * 0.5 + 0.21);
    expect(series.tokensUsd).toBeCloseTo(0.63);
    expect(series.totalUsd).toBeCloseTo(15.84);
    expect(series.averageUsd).toBeCloseTo(15.84 / 30);
    expect(series.maxUsd).toBe(1);
    expect(series.todayIndex).toBe(29);
  });

  it("marks no day today when the read's window ended before it", () => {
    expect(joinSpend(compute, new Map(), "2026-10-19").todayIndex).toBe(-1);
  });

  it("asks HQ for the project's tokens on the organization's key by day, over the same dates", () => {
    expect(tokenSpendQuery("tea-shop", TODAY, "Europe/Prague")).toMatchObject({
      since: "2026-09-19T00:00:00.000Z",
      until: "2026-10-19T00:00:00.000Z",
      mode: "utc-days",
      appId: "tea-shop",
      ownerUserId: "automated",
      groupBy: "day",
    });
  });
});

describe("what the spend shows for its reads", () => {
  const read = { kind: "read" as const, report: report([]), stale: false };
  it.each([
    { name: "both read", computeRead: { kind: "read", ...compute }, tokens: read, kind: "loaded" },
    { name: "billing reading", computeRead: { kind: "reading" }, tokens: read, kind: "loading" },
    {
      name: "HQ reading",
      computeRead: { kind: "read", ...compute },
      tokens: { kind: "reading" },
      kind: "loading",
    },
    { name: "billing refused", computeRead: { kind: "unknown" }, tokens: read, kind: "unknown" },
    {
      name: "HQ unable to report tokens",
      computeRead: { kind: "read", ...compute },
      tokens: { kind: "unavailable", reason: "No." },
      kind: "unknown",
    },
  ] as const)("$name: $kind", ({ computeRead, tokens, kind }) => {
    expect(spendState(computeRead, tokens, TODAY).kind).toBe(kind);
  });
});

describe("spend's words", () => {
  it.each([
    { usd: 64.3, text: "$64.30" },
    { usd: 1234.5, text: "$1,234.50" },
    { usd: 0, text: "$0.00" },
    { usd: 0.003, text: "<$0.01" },
  ])("$usd reads $text", ({ usd, text }) => {
    expect(formatUsd(usd)).toBe(text);
  });

  it("splits the figure into dollars and cents", () => {
    expect(moneyParts(64.3)).toEqual({ whole: "$64", cents: ".30" });
  });

  it.each([
    { day: "2026-09-19", label: "19 Sep" },
    { day: TODAY, label: "Today" },
  ])("labels $day as $label", ({ day, label }) => {
    expect(dayLabel(day, TODAY)).toBe(label);
  });

  it("says the daily average", () => {
    expect(averageLine(64.3 / 30)).toBe("avg $2.14 a day");
  });

  it.each([
    { mates: [], line: null },
    {
      mates: [{ name: "Raya", provider: "Claude" }],
      line: "Raya runs on a Claude subscription; it is not in this figure.",
    },
    {
      mates: [
        { name: "Raya", provider: "Claude" },
        { name: "Vera", provider: "Claude" },
      ],
      line: "Raya and Vera run on a Claude subscription; it is not in this figure.",
    },
    {
      mates: [
        { name: "Raya", provider: "Claude" },
        { name: "Juno", provider: "Codex" },
      ],
      line: "Raya runs on a Claude subscription and Juno runs on a Codex subscription; they are not in this figure.",
    },
  ])("names the Mates on a subscription: $line", ({ mates, line }) => {
    expect(subscriptionLine(mates)).toBe(line);
  });
});

describe("the spend chart's bars", () => {
  it.each([
    { usd: 0, px: 0 },
    { usd: 0.01, px: 2 },
    { usd: 0.2, px: 2 },
    { usd: 5, px: 45 },
    { usd: 10, px: 90 },
  ])(
    "a day with spend draws a visible bar, at least 2 px: $usd against a top day of 10 → $px px",
    ({ usd, px }) => {
      expect(spendBarPx(usd, 90 / 10)).toBe(px);
    },
  );
});
