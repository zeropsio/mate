import { act, cloneElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { recordedReport } from "./usageTestFixtures";

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
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useCanGoBack: () => false,
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../../state/usage", async (original) => {
  const actual = await original<typeof import("../../state/usage")>();
  return {
    ...actual,
    useAgentUsage: () => {
      const report = state.answered ? recordedReport() : null;
      const read = state.failedNeighbor
        ? { kind: "unavailable", reason: "HQ usage unavailable. Reconnect or retry HQ access." }
        : state.pending || state.baseline !== "resolved" || !state.answered
          ? { kind: "reading" }
          : { kind: "read", report, stale: false };
      return {
        merged: actual.usageReportView(report),
        overall: actual.usageReportView(report),
        report,
        overallReport: report,
        detailPending: false,
        detailUnavailable: false,
        read,
        stale: false,
        refresh: vi.fn(),
      };
    },
  };
});
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
vi.mock("../ui/button", () => ({ Button: "button", InlineButton: "button" }));
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
  // The page listens for its keyboard shortcuts and Escape on the window.
  vi.stubGlobal("window", new EventTarget());
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
    expect(text(tree)).toContain("Recorded consumption by agents and subagents");
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
  expect(text(tree)).toContain("Reading organization usage from HQ");
  act(() => tree.unmount());
});

it("an empty answer beside a terminal failure names the next action without claiming a read is pending", () => {
  state.baseline = "resolved";
  state.answered = true;
  state.pending = true;
  state.failedNeighbor = true;
  const tree = mount(<UsagePage scope={{}} onScopeChange={vi.fn()} />);
  expect(text(tree)).not.toContain("$0.00");
  expect(text(tree)).not.toContain("Reading organization usage from HQ");
  expect(text(tree)).toContain("Reconnect or retry HQ access");
  act(() => tree.unmount());
});
