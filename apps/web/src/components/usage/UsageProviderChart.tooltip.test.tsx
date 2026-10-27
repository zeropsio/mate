import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { UsageProviderChart } from "./UsageProviderChart";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

it("Chart periods expose recorded, zero, unpriced and missing values to keyboard and touch", async () => {
  const { usageReportView } = await import("../../state/usage");
  const { recordedReport, statistics } = await import("./usageTestFixtures");
  const report = recordedReport({
    groups: [
      {
        key: "priced",
        period: "2026-10-01",
        provider: "claude",
        totals: statistics("100"),
        costUsdNanos: "949000",
      },
      {
        key: "zero",
        period: "2026-10-02",
        provider: "claude",
        totals: statistics("0"),
        costUsdNanos: "0",
      },
      {
        key: "unpriced",
        period: "2026-10-03",
        provider: "claude",
        totals: statistics("900"),
        costUsdNanos: null,
      },
    ],
  });
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(
      <UsageProviderChart
        providers={["claude"]}
        days={["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]}
        daily={usageReportView(report, null, null, report).daily}
        hours={[]}
        hourly={[]}
        metric="cost"
        resolution="day"
        timeZone="UTC"
      />,
    );
  });
  const periods = tree!.root.findAll(
    (node) => node.props.role === "button" && node.props.tabIndex === 0,
  );
  expect(periods).toHaveLength(4);
  expect(periods.map((node) => node.props["aria-label"])).toEqual([
    "Oct 1 · UTC day; cost; Claude Code: <$0.01",
    "Oct 2 · UTC day; cost; Claude Code: $0.00",
    "Oct 3 · UTC day; cost; Claude Code: Unpriced",
    "Oct 4 · UTC day; cost; Claude Code: No data",
  ]);
  for (const event of ["onFocus", "onClick"] as const) {
    act(() => periods[2]!.props[event]());
    expect(JSON.stringify(tree!.toJSON())).toContain("Unpriced");
  }
  const preventDefault = vi.fn();
  act(() => periods[3]!.props.onKeyDown({ key: "Enter", preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(JSON.stringify(tree!.toJSON())).toContain("No data");
  act(() => tree!.unmount());
});

it.each([
  {
    name: "unpriced provider",
    daily: [
      {
        day: "2026-10-01",
        costUsd: 7.83,
        costKnown: false,
        totalTokens: 2000,
        byProvider: new Map([
          ["claude" as const, { costUsd: 7.83, costKnown: true, totalTokens: 1000 }],
          ["codex" as const, { costUsd: 0, costKnown: false, totalTokens: 1000 }],
        ]),
      },
    ],
    known: "$7.83",
  },
  { name: "missing period", daily: [], known: null },
])("$name never becomes a free cost in the chart tooltip", ({ daily, known }) => {
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(
      <UsageProviderChart
        providers={["claude", "codex"]}
        days={["2026-10-01"]}
        daily={daily}
        hours={[]}
        hourly={[]}
        metric="cost"
        resolution="day"
        timeZone="UTC"
      />,
      {
        createNodeMock: () => ({
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 260 }),
          style: { setProperty: vi.fn() },
          clientWidth: 960,
          clientHeight: 260,
          offsetWidth: 100,
          offsetHeight: 50,
        }),
      },
    );
  });
  act(() =>
    tree!.root
      .find((node) => typeof node.props.onMouseMove === "function")
      .props.onMouseMove({ clientX: 0, clientY: 0 }),
  );
  const tooltip = tree!.root.find(
    (node) => node.props.style?.left === "var(--usage-tooltip-left, 0px)",
  );
  const text = tooltip
    .findAllByType("span")
    .flatMap((node) => node.children.filter((child) => typeof child === "string"))
    .join(" ");
  expect(text).not.toContain("$0.00");
  expect(text).toContain(known === null ? "No data" : "Unpriced");
  expect(text).toContain("Priced cost");
  if (known !== null) expect(text).toContain(known);
  act(() => tree!.unmount());
});
