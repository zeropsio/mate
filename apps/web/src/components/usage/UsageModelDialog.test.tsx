import type { AgentUsageRead } from "@t3tools/client-runtime/data";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { UsageDay } from "@t3tools/contracts";
import { recordedReport, statistics } from "./usageTestFixtures";
const source = vi.hoisted(() => ({
  read: { kind: "reading" } as AgentUsageRead,
  retry: vi.fn(),
  periodRead: null as AgentUsageRead | null,
}));
vi.mock("../../zerops/ZeropsAccountData", () => ({
  useAccountDataOptional: () => ({ orgId: "org", retryDetail: source.retry }),
  useDetailDemand: vi.fn(),
  useProjection: (_projection: unknown, key: { owner: string } | null) =>
    key !== null && JSON.parse(key.owner).groupBy === "day" && source.periodRead !== null
      ? source.periodRead
      : source.read,
}));
vi.mock("../ui/dialog", () => ({
  Dialog: "div",
  DialogDescription: "p",
  DialogFooter: "footer",
  DialogHeader: "header",
  DialogPanel: "main",
  DialogPopup: "div",
  DialogTitle: "h2",
}));
vi.mock("../ui/button", () => ({ InlineButton: "button" }));
vi.mock("./UsageShareBar", () => ({
  UsageShareBar: ({ label }: { label: string }) => <span>{label}</span>,
}));
import { UsageModelDialog } from "./UsageModelDialog";
import { usageReportView } from "../../state/usage";
const report = recordedReport({
  groups: [{ ...recordedReport().groups[0]!, provider: "claude", model: "claude-opus-5-5[1m]" }],
});
const model = usageReportView(report, report).models[0]!;
function render(shownModel = model) {
  let tree: ReactTestRenderer;
  act(() => {
    tree = create(
      <UsageModelDialog
        model={shownModel}
        input={{
          sinceDay: UsageDay.make("2026-10-01"),
          untilDay: UsageDay.make("2026-10-07"),
          timeZone: "UTC",
          resolution: "day",
        }}
        scope={{}}
        provenance="live-responses"
        metric="cost"
        chartWindow={{
          days: ["2026-10-01"],
          hours: [],
          resolution: "day",
          timeZone: "UTC",
        }}
        onClose={vi.fn()}
      />,
    );
  });
  return tree!;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  source.retry.mockClear();
  source.periodRead = null;
});
it.each([
  { name: "pending", read: { kind: "reading" } as AgentUsageRead, text: "Reading model usage…" },
  {
    name: "unavailable",
    read: { kind: "unavailable", reason: "refused" } as AgentUsageRead,
    text: "Model usage could not be read.",
  },
  {
    name: "retained",
    read: { kind: "read", report, stale: true } as AgentUsageRead,
    text: "Showing last known model usage.",
  },
])(
  "The model dialog identifies its own $name read without inventing unknown token categories",
  ({ read, text }) => {
    source.read = read;
    const tree = render();
    expect(JSON.stringify(tree.toJSON())).toContain(text);
    expect(JSON.stringify(tree.toJSON())).not.toContain("Token categories are unknown.");
    if (read.kind === "read" && read.stale)
      expect(JSON.stringify(tree.toJSON()).match(/Showing last known/g)).toHaveLength(1);
    if (read.kind !== "reading") {
      const retry = tree.root
        .findAllByType("button")
        .find((node) => node.children.includes("Try again"));
      expect(retry).toBeDefined();
      act(() => retry!.props.onClick());
      expect(source.retry).toHaveBeenCalled();
    }
    act(() => tree.unmount());
  },
);
it("Unknown token categories in the model dialog require recorded unknown components", () => {
  source.read = {
    kind: "read",
    stale: false,
    report: { ...report, totals: { ...report.totals, unknownComponents: "1" } },
  };
  const tree = render();
  expect(JSON.stringify(tree.toJSON())).toContain("Token categories are unknown.");
  act(() => tree.unmount());
});

it("A retained model chart names its own freshness while the model totals stay current", () => {
  source.read = { kind: "read", report, stale: false };
  source.periodRead = { kind: "read", report, stale: true };
  const tree = render();
  expect(JSON.stringify(tree.toJSON())).toContain("Showing last known model chart.");
  expect(JSON.stringify(tree.toJSON())).not.toContain("Showing last known model usage.");
  act(() => tree.unmount());
});

it.each(
  (["reading", "unavailable", "stale", "unknown"] as const).map((state) => ({
    state,
    title: `The model dialog presents its ${state} source record`,
  })),
)("$title", ({ state }) => {
  const sourceReport = recordedReport({
    totals: { ...statistics(), unknownComponents: state === "unknown" ? "1" : "0" },
    groups: [
      {
        key: "Ada",
        provider: "claude",
        model: "recorded-model",
        period: "2026-10-01",
        totals: statistics(),
        costUsdNanos: "7830000000",
      },
    ],
  });
  source.read =
    state === "reading"
      ? { kind: "reading" }
      : state === "unavailable"
        ? { kind: "unavailable", reason: "refused" }
        : { kind: "read", report: sourceReport, stale: false };
  const tree = render(usageReportView(sourceReport, sourceReport).models[0]!);
  if (state === "stale") {
    expect(JSON.stringify(tree.toJSON())).toContain("Tokens by type");
    source.read = { kind: "read", report: sourceReport, stale: true };
    const props = tree.root.findByType(UsageModelDialog).props as Parameters<
      typeof UsageModelDialog
    >[0];
    act(() => tree.update(<UsageModelDialog {...props} />));
  }
  const message =
    state === "reading"
      ? "Reading model usage…"
      : state === "unavailable"
        ? "Model usage could not be read."
        : state === "stale"
          ? "Showing last known model usage."
          : "Token categories are unknown.";
  const text = JSON.stringify(tree.toJSON());
  expect(text).toContain(message);
  if (state !== "unknown") expect(text).not.toContain("Token categories are unknown.");
  if (state === "unavailable" || state === "stale") {
    const retry = tree.root
      .findAllByType("button")
      .find((node) => node.children.includes("Try again"));
    expect(retry).toBeDefined();
    act(() => retry!.props.onClick());
    expect(
      source.retry.mock.calls.map(([scope]) => ({
        family: scope.family,
        model: JSON.parse(scope.ownerId).model,
      })),
    ).toContainEqual({ family: "agentUsage", model: "recorded-model" });
  }
  act(() => tree.unmount());
});
