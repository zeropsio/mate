import { act, cloneElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  UsageDay,
  EnvironmentId,
  USAGE_CONTRACT_VERSION,
  type UsageSummary,
} from "@t3tools/contracts";
import { mergeUsage } from "@t3tools/shared/usageMerge";

const state = vi.hoisted(() => ({
  baseline: "resolving" as "resolving" | "resolved" | "unavailable",
  answered: false,
  pending: false,
  failedNeighbor: false,
  presentations: new Map(),
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<object>()),
  useAtomValue: () => state.presentations,
}));
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../state/usage", () => ({
  useProviderUsage: () => ({
    merged: {
      ...mergeUsage([], USAGE_CONTRACT_VERSION),
      costUsd: state.answered && !state.pending ? 7.83 : 0,
      records: state.answered && !state.pending ? 1 : 0,
    },
    overall: mergeUsage([], USAGE_CONTRACT_VERSION),
    environments: state.answered
      ? [
          {
            environmentId: EnvironmentId.make("env-a"),
            label: "A",
            summary: summary(),
            error: null,
            isPending: false,
          },
          ...(state.pending
            ? [
                {
                  environmentId: EnvironmentId.make("env-b"),
                  label: "B",
                  summary: null,
                  error: state.failedNeighbor ? "failed" : null,
                  isPending: !state.failedNeighbor,
                },
              ]
            : []),
        ]
      : [],
    isPending: false,
    isPartial: state.pending,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../zerops/useUsageEnvironmentIdentities", () => ({
  useUsageEnvironmentIdentities: () => ({
    baseline: state.baseline,
    listed: state.baseline === "resolved",
    owners: "resolved",
    projects: new Map([["app-a", "Shop"]]),
    identities:
      state.baseline === "resolved"
        ? new Map([
            [
              EnvironmentId.make("env-a"),
              {
                mateName: "A",
                projectId: "app-a",
                projectName: "Shop",
                ownerState: "unknown",
                owner: null,
              },
            ],
          ])
        : new Map(),
  }),
}));
vi.mock("../../zerops/useUsageMates", () => ({ useUsageMates: () => [] }));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/scroll-area", () => ({ ScrollArea: "div" }));
vi.mock("../ui/select", () => ({
  Select: "div",
  SelectItem: "div",
  SelectPopup: "div",
  SelectTrigger: "div",
  SelectValue: "div",
}));
vi.mock("../ui/sidebar", () => ({ SidebarInset: "div" }));
vi.mock("../ui/toggle-group", () => ({ Toggle: "button", ToggleGroup: "div" }));
vi.mock("../WorkspaceBreadcrumb", () => ({
  WorkspaceBreadcrumb: "div",
  WorkspaceBreadcrumbItem: "div",
  WorkspaceBreadcrumbSeparator: "span",
}));
vi.mock("../WorkspacePageContainer", () => ({ WorkspacePageContainer: "main" }));
vi.mock("../WorkspacePageHeader", () => ({ WorkspacePageHeader: "header" }));
vi.mock("./UsageProviderChart", () => ({ UsageProviderChart: () => null }));
vi.mock("./UsagePriceOverrides", () => ({ UsagePriceOverrides: () => null }));
vi.mock("./usagePagePreferences", () => ({
  readUsagePagePreferences: () => ({ metric: "cost", windowDays: 30 }),
  saveUsagePagePreferences: vi.fn(),
}));
vi.mock("~/zerops/useWaitLine", () => ({ useWaitLine: (text: string | null) => text !== null }));
vi.mock("../zerops/WaitLine", () => ({
  WaitLine: ({ text }: { text: string }) => <p>{text}</p>,
  PageWaitLine: ({ text }: { text: string }) => <p>{text}</p>,
}));

import { UsagePage } from "./UsagePage";
import { UsageLimitsSection } from "./UsageLimits";

function summary(): UsageSummary {
  return {
    contractVersion: USAGE_CONTRACT_VERSION,
    readAt: "2026-10-07T12:00:00Z",
    timeZone: "UTC",
    sinceDay: UsageDay.make("2026-10-01"),
    untilDay: UsageDay.make("2026-10-07"),
    buckets: [],
    sources: [],
    pricing: { status: "fresh", source: "test", fetchedAt: null, knownModels: 0 },
    scanDurationMs: 0,
  };
}
function mount(element: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(element);
  });
  return tree!;
}
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
const presentation = (phase: "connecting" | "connected") => ({
  entry: { target: { label: "A" } },
  connection: { phase, error: null },
  serverConfig: phase === "connected" ? { providers: [] } : null,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.baseline = "resolving";
  state.answered = false;
  state.pending = false;
  state.failedNeighbor = false;
  state.presentations = new Map();
});

describe("Usage source transitions", () => {
  it("a cold scoped URL shows no zero, then the answered estimate", () => {
    const page = <UsagePage scope={{ project: "app-a" }} onScopeChange={vi.fn()} />;
    const tree = mount(page);
    expect(text(tree)).toContain("Reading organization");
    expect(text(tree)).not.toContain("$0.00");
    expect(text(tree)).not.toContain("No activity");
    state.baseline = "resolved";
    state.answered = true;
    act(() => tree.update(cloneElement(page)));
    expect(text(tree)).toContain("$7.83");
    act(() => tree.unmount());
  });

  it("delayed Limits never claims none, including after a previous empty read", () => {
    vi.useFakeTimers();
    state.presentations = new Map([[EnvironmentId.make("env-a"), presentation("connecting")]]);
    const section = <UsageLimitsSection identities={new Map()} listed now={0} />;
    const tree = mount(section);
    act(() => vi.advanceTimersByTime(60_000));
    expect(text(tree)).toContain("Reading subscription limits");
    expect(text(tree)).not.toContain("No provider");
    state.presentations = new Map([[EnvironmentId.make("env-a"), presentation("connected")]]);
    act(() => tree.update(cloneElement(section)));
    expect(text(tree)).toContain("No provider");
    state.presentations = new Map([
      [EnvironmentId.make("env-a"), presentation("connected")],
      [EnvironmentId.make("env-b"), presentation("connecting")],
    ]);
    act(() => tree.update(cloneElement(section)));
    expect(text(tree)).not.toContain("No provider");
    act(() => tree.unmount());
    vi.useRealTimers();
  });

  it("Cost to Limits states the account scope and preserves the project when returning", () => {
    state.baseline = "resolved";
    state.answered = true;
    const tree = mount(<UsagePage scope={{ project: "app-a" }} onScopeChange={vi.fn()} />);
    act(() =>
      tree.root
        .findAllByProps({ "aria-label": "Usage metric" })[0]!
        .props.onValueChange(["limits"]),
    );
    expect(text(tree)).toContain("Limits are account-wide subscription quotas");
    act(() =>
      tree.root.findAllByProps({ "aria-label": "Usage metric" })[0]!.props.onValueChange(["cost"]),
    );
    expect(text(tree)).toContain("Shop");
    expect(text(tree)).toContain("Agent API-equivalent usage estimate");
    act(() => tree.unmount());
  });
});

it("equal-name project rows drill into distinct stable IDs", async () => {
  const { usageDimensions } = await import("./usageDimensions");
  const { UsageDimensionTable } = await import("./UsageDimensionViews");
  const identities = new Map([
    [
      EnvironmentId.make("env-a"),
      {
        mateName: "A",
        projectId: "app-a",
        projectName: "Shop",
        ownerState: "unknown" as const,
        owner: null,
      },
    ],
    [
      EnvironmentId.make("env-b"),
      {
        mateName: "B",
        projectId: "app-b",
        projectName: "Shop",
        ownerState: "unknown" as const,
        owner: null,
      },
    ],
  ]);
  const dimensions = usageDimensions({
    identities,
    labels: new Map(),
    metric: "cost",
    byEnvironment: [...identities.keys()].map((environmentId) => ({
      environmentId,
      costUsd: 1,
      totalTokens: 1,
      records: 1,
      unpricedRecords: 0,
      sessions: 1,
      costShare: 0.5,
      tokenShare: 0.5,
      providers: [],
    })),
  });
  const onScopeChange = vi.fn();
  const tree = mount(
    <UsageDimensionTable
      dimension="project"
      dimensions={dimensions}
      metric="cost"
      scope={{}}
      onScopeChange={onScopeChange}
    />,
  );
  const rows = tree.root.findAllByProps({ "aria-label": "Show Shop usage" });
  act(() => rows[0]!.props.onClick());
  act(() => rows[1]!.props.onClick());
  expect(onScopeChange.mock.calls).toEqual([[{ project: "app-a" }], [{ project: "app-b" }]]);
  act(() => tree.unmount());
});

it("choosing a project replaces an old name bookmark", () => {
  state.baseline = "resolved";
  const onScopeChange = vi.fn();
  const tree = mount(<UsagePage scope={{ legacyProject: "Shop" }} onScopeChange={onScopeChange} />);
  expect(text(tree)).toContain("old project-name URL");
  const picker = tree.root.findByProps({ "aria-label": "Usage project" }).parent!;
  act(() => picker.props.onValueChange("app-a"));
  expect(onScopeChange).toHaveBeenCalledWith({ project: "app-a", legacyProject: undefined });
  act(() => tree.unmount());
});

it("an empty fast answer cannot turn an unresolved subtotal into zero", () => {
  state.baseline = "resolved";
  state.answered = true;
  state.pending = true;
  const tree = mount(<UsagePage scope={{}} onScopeChange={vi.fn()} />);
  expect(text(tree)).not.toContain("$0.00");
  expect(text(tree)).not.toContain("No activity in this window");
  expect(text(tree)).toContain("Usage coverage is incomplete");
  act(() => tree.unmount());
});

it("an empty answer beside a terminal failure names the next action without claiming a read is pending", () => {
  state.baseline = "resolved";
  state.answered = true;
  state.pending = true;
  state.failedNeighbor = true;
  const tree = mount(<UsagePage scope={{}} onScopeChange={vi.fn()} />);
  expect(text(tree)).not.toContain("$0.00");
  expect(text(tree)).not.toContain("Usage coverage is incomplete");
  expect(text(tree)).toContain("reconnect or retry them");
  act(() => tree.unmount());
});
