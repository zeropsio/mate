import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { UsageProviderChart } from "./UsageProviderChart";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));

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
        referenceTime={undefined}
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
