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
  now: 0,
  retry: vi.fn(),
  retryRoster: vi.fn(),
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<object>()),
  useAtomValue: () => state.presentations,
}));
vi.mock("../../zerops/useNowMs", () => ({ useNowMs: () => state.now }));
vi.mock("./usageShortcuts", async (original) => ({
  ...(await original<object>()),
  resolveUsageShortcut: () => "usage.period.day",
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
        sections: { models: read, providers: read, periods: read },
        detailPending: false,
        detailUnavailable: false,
        read,
        stale: false,
        refresh: state.retry,
      };
    },
  };
});
vi.mock("../../zerops/useUsageEnvironmentIdentities", () => ({
  useUsageEnvironmentIdentities: () => ({
    baseline: state.baseline,
    refresh: state.retryRoster,
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
vi.mock("../ui/tooltip", () => ({
  Tooltip: "div",
  TooltipPopup: "div",
  TooltipTrigger: ({
    render,
    children,
  }: {
    render?: React.ReactElement;
    children?: React.ReactNode;
  }) => (render ? cloneElement(render, undefined, children) : <div>{children}</div>),
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
    expect(text(tree)).toContain("Reading usage");
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
    expect(text(tree)).not.toContain("No coding agent");
    state.presentations = new Map([[EnvironmentId.make("env-a"), presentation("connected")]]);
    act(() => tree.update(cloneElement(section)));
    expect(text(tree)).toContain("No coding agent");
    state.presentations = new Map([
      [EnvironmentId.make("env-a"), presentation("connected")],
      [EnvironmentId.make("env-b"), presentation("connecting")],
    ]);
    act(() => tree.update(cloneElement(section)));
    expect(text(tree)).not.toContain("No coding agent");
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
  const pickers = tree.root.findAllByProps({ "aria-label": "Usage project" });
  expect(pickers).toHaveLength(2);
  for (const trigger of pickers) {
    onScopeChange.mockClear();
    act(() => trigger.parent!.props.onValueChange("app-a"));
    expect(onScopeChange).toHaveBeenCalledExactlyOnceWith({
      project: "app-a",
      legacyProject: undefined,
    });
  }
  act(() => tree.unmount());
});

it("an empty fast answer cannot turn an unresolved subtotal into zero", () => {
  state.baseline = "resolved";
  state.answered = true;
  state.pending = true;
  const tree = mount(<UsagePage scope={{}} onScopeChange={vi.fn()} />);
  expect(text(tree)).not.toContain("$0.00");
  expect(text(tree)).not.toContain("No activity in this window");
  expect(text(tree)).toContain("Reading usage");
  act(() => tree.unmount());
});

it("an empty answer beside a terminal failure names the next action without claiming a read is pending", () => {
  state.baseline = "resolved";
  state.answered = true;
  state.pending = true;
  state.failedNeighbor = true;
  const tree = mount(<UsagePage scope={{}} onScopeChange={vi.fn()} />);
  expect(text(tree)).not.toContain("$0.00");
  expect(text(tree)).not.toContain("Reading usage");
  expect(text(tree)).toContain("Try again");
  act(() => tree.unmount());
});

it("Earlier history cannot select Past 24h through the page shortcut", () => {
  const tree = mount(<UsagePage scope={{}} onScopeChange={vi.fn()} />);
  const history = tree.root.findAllByProps({ "aria-label": "Usage history" })[0]!;
  act(() => history.props.onValueChange(["legacy-scanner"]));
  act(() => window.dispatchEvent(new Event("keydown")));
  expect(tree.root.findAllByProps({ "aria-label": "Usage period" })[0]!.props.value).not.toBe([
    "1",
  ]);
  expect(text(tree)).not.toContain('"value":["1"]');
  act(() => tree.unmount());
});
it("Limits receives the current shared clock while Usage stays open", () => {
  state.baseline = "resolved";
  vi.spyOn(Date, "now").mockImplementation(() => state.now);
  state.now = Date.parse("2026-09-03T12:00:00.000Z");
  state.presentations = new Map([
    [
      EnvironmentId.make("env-a"),
      {
        ...presentation("connected"),
        serverConfig: {
          providers: [
            {
              instanceId: "codex",
              driver: "codex",
              enabled: true,
              installed: true,
              version: null,
              status: "ready",
              auth: { status: "authenticated" },
              checkedAt: "2026-09-03T12:00:00.000Z",
              models: [],
              slashCommands: [],
              skills: [],
              usageLimits: {
                checkedAt: "2026-09-03T12:00:00.000Z",
                windows: [
                  {
                    id: "session",
                    kind: "session",
                    label: "Session",
                    usedPercent: 40,
                    windowDurationMins: 300,
                    resetsAt: "2026-09-03T14:00:00.000Z",
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  ]);
  const page = <UsagePage scope={{}} onScopeChange={vi.fn()} />;
  const tree = mount(page);
  act(() =>
    tree.root.findAllByProps({ "aria-label": "Usage metric" })[0]!.props.onValueChange(["limits"]),
  );
  expect(text(tree)).toContain("resets in 2h 0m");
  state.now = Date.parse("2026-09-03T13:00:00.000Z");
  act(() => tree.update(cloneElement(page)));
  expect(text(tree)).toContain("resets in 1h 0m");
  state.now = Date.parse("2026-09-03T14:01:00.000Z");
  act(() => tree.update(cloneElement(page)));
  expect(text(tree)).toContain("reset confirmation pending");
  act(() => tree.unmount());
  vi.restoreAllMocks();
});

it("Usage recovery invokes its existing report retry and coverage selects the named Mate", () => {
  state.baseline = "resolved";
  state.answered = true;
  state.failedNeighbor = true;
  state.retry.mockClear();
  const onScopeChange = vi.fn();
  const tree = mount(<UsagePage scope={{}} onScopeChange={onScopeChange} />);
  const retry = tree.root
    .findAllByType("button")
    .find((node) => node.children.includes("Try again"));
  expect(retry).toBeDefined();
  act(() => retry!.props.onClick());
  expect(state.retry).toHaveBeenCalledTimes(1);
  state.failedNeighbor = false;
  act(() => tree.update(<UsagePage scope={{}} onScopeChange={onScopeChange} />));
  const mate = tree.root.findByProps({ "aria-label": "Show usage for A" });
  act(() => mate.props.onClick());
  expect(onScopeChange.mock.calls).toEqual([[{ mate: "mate-a" }]]);
  act(() => tree.unmount());
});

it("An unread Limits roster retries its roster owner instead of the Usage report", () => {
  state.baseline = "unavailable";
  state.retry.mockClear();
  state.retryRoster.mockClear();
  const tree = mount(<UsagePage scope={{}} onScopeChange={vi.fn()} />);
  act(() =>
    tree.root.findAllByProps({ "aria-label": "Usage metric" })[0]!.props.onValueChange(["limits"]),
  );
  const retry = tree.root
    .findAllByType("button")
    .find((node) => node.children.includes("Try again"));
  expect(retry).toBeDefined();
  act(() => retry!.props.onClick());
  expect(state.retryRoster).toHaveBeenCalledTimes(1);
  expect(state.retry).not.toHaveBeenCalled();
  act(() => tree.unmount());
});
