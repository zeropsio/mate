import type { EnvironmentId, UsageReport, UsageReportQuery } from "@t3tools/contracts";
import type { AgentUsageRead } from "@t3tools/client-runtime/data";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  UsageEnvironmentIdentity,
  UsageEnvironmentOwner,
} from "../../zerops/usageEnvironmentIdentities";
import { recordedReport, statistics } from "./usageTestFixtures";

const testState = vi.hoisted(() => ({
  identities: new Map() as ReadonlyMap<EnvironmentId, UsageEnvironmentIdentity>,
  owners: "resolved" as "resolving" | "resolved" | "unavailable",
  metric: "cost" as "cost" | "tokens" | "limits",
  breakdown: "time" as "auto" | "person" | "project" | "mate" | "model" | "time",
  report: null as UsageReport | null,
  overallReport: null as UsageReport | null,
  accountObservation: false,
  people: new Map<string, UsageEnvironmentOwner>(),
  models: null as UsageReport | null,
  periods: null as UsageReport | null,
  providers: null as UsageReport | null,
  read: null as AgentUsageRead | null,
  stale: false,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => new Map() }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => [
      initial === readUsagePagePreferences
        ? { metric: testState.metric, windowDays: 1 }
        : typeof initial === "function"
          ? {
              days: 1,
              window: {
                sinceDay: "2026-10-06",
                untilDay: "2026-10-07",
                timeZone: "UTC",
                resolution: "hour",
                sinceTime: "2026-10-06T12:37:00.000Z",
                untilTime: "2026-10-07T12:37:00.000Z",
              },
            }
          : initial === "auto"
            ? testState.breakdown
            : initial,
      vi.fn(),
    ],
  };
});
vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useCanGoBack: () => false,
}));
vi.mock("../../state/usage", async (original) => {
  const actual = await original<typeof import("../../state/usage")>();
  return {
    ...actual,
    useAgentUsage: (...args: Parameters<typeof actual.useAgentUsage>) =>
      testState.accountObservation
        ? actual.useAgentUsage(...args)
        : {
            merged: actual.usageReportView(
              testState.report,
              testState.models,
              testState.providers,
              testState.periods,
              true,
            ),
            overall: actual.usageReportView(testState.report),
            report: testState.report,
            overallReport: testState.report,
            detailPending: false,
            detailUnavailable: false,
            read: testState.read ?? {
              kind: "read",
              report: testState.report,
              stale: testState.stale,
            },
            stale: testState.stale,
            refresh: vi.fn(),
          },
  };
});
vi.mock("../../zerops/ZeropsAccountData", () => ({
  useAccountDataOptional: () => ({ orgId: "org", retryDetail: vi.fn() }),
  useDetailDemand: vi.fn(),
  useProjection: (_projection: unknown, key: { owner: string } | null) => {
    if (key === null) return { kind: "reading" };
    const query = JSON.parse(key.owner) as UsageReportQuery;
    const report = query.ownerUserId === null ? testState.overallReport : testState.report;
    return {
      kind: "read",
      stale: false,
      report: { ...report, query, groups: query.groupBy === "mate" ? report?.groups : [] },
    };
  },
}));
vi.mock("../../zerops/useUsageEnvironmentIdentities", () => ({
  useUsageEnvironmentIdentities: () => ({
    identities: testState.identities,
    people: testState.people,
    owners: testState.owners,
    listed: true,
    baseline: "resolved",
    projects: new Map(
      [...testState.identities.values()].flatMap((identity) =>
        identity.projectId === null
          ? []
          : [[identity.projectId, identity.projectName ?? identity.projectId]],
      ),
    ),
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
vi.mock("./UsageProviderChart", () => ({ UsageProviderChart: "div" }));
vi.mock("./usageProviders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./usageProviders")>();
  return {
    ...actual,
    PROVIDER_PRESENTATION: {
      codex: { color: "white", label: "Codex", mark: "span" },
      claude: { color: "orange", label: "Claude Code", mark: "span" },
    },
  };
});

import { UsagePage } from "./UsagePage";
import type { UsageScope } from "./usageDimensions";
import { readUsagePagePreferences } from "./usagePagePreferences";
function renderPage(scope: UsageScope = {}) {
  return renderToStaticMarkup(<UsagePage scope={scope} onScopeChange={vi.fn()} />);
}
const bodyOf = (markup: string) => markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";
beforeEach(() => {
  testState.metric = "cost";
  testState.breakdown = "time";
  testState.identities = new Map();
  testState.read = null;
  testState.stale = false;
  testState.report = recordedReport();
  testState.overallReport = null;
  testState.accountObservation = false;
  testState.people = new Map();
  testState.providers = recordedReport({
    groups: [{ key: "codex", provider: "codex", totals: statistics(), costUsdNanos: "7830000000" }],
  });
  testState.periods = recordedReport({
    groups: [
      {
        key: "[period,codex]",
        period: "2026-10-06T13:00:00.000Z",
        provider: "codex",
        totals: statistics("13000"),
        costUsdNanos: "13000000000",
      },
      {
        key: "[later,codex]",
        period: "2026-10-07T11:00:00.000Z",
        provider: "codex",
        totals: statistics("11000"),
        costUsdNanos: "11000000000",
      },
    ],
  });
  testState.models = recordedReport({
    groups: [
      {
        key: "expensive",
        provider: "claude",
        model: "expensive-model",
        totals: statistics("100"),
        costUsdNanos: "10000000000",
      },
      {
        key: "heavy",
        provider: "codex",
        model: "token-heavy-model",
        totals: statistics("1000"),
        costUsdNanos: "5000000000",
      },
      {
        key: "cheap",
        provider: "codex",
        model: "token-heavy-cheaper-model",
        totals: statistics("1000"),
        costUsdNanos: "1000000000",
      },
      {
        key: "unpriced",
        provider: "codex",
        model: "unpriced-model",
        totals: statistics("500"),
        costUsdNanos: null,
      },
    ],
  });
});
describe("recorded HQ usage presentation", () => {
  it.each([
    { name: "selecting Alice's 100 tokens", filteredMate: "mate-a" },
    { name: "selecting Alice after a Mate's owner changed", filteredMate: "mate-b" },
  ])("$name retains Bob's independently authorized selector identity", ({ filteredMate }) => {
    testState.accountObservation = true;
    testState.metric = "tokens";
    testState.breakdown = "person";
    testState.people = new Map([
      ["alice", { id: "alice", name: "Alice", initials: "A", avatarUrl: null, isViewer: true }],
      ["bob", { id: "bob", name: "Bob", initials: "B", avatarUrl: null, isViewer: false }],
    ]);
    const alice = { ...recordedReport().coverage[0]!, ownerUserId: "alice" };
    const bob = {
      ...alice,
      originId: "origin-b",
      mateId: "mate-b",
      ownerUserId: "bob",
      label: "Bob's Mate",
    };
    testState.overallReport = recordedReport({
      totals: statistics("300", "2"),
      coverage: [alice, bob],
      groups: [
        { key: "mate-a", totals: statistics("100"), costUsdNanos: "1000000000" },
        { key: "mate-b", totals: statistics("200"), costUsdNanos: "2000000000" },
      ],
    });
    testState.report = recordedReport({
      totals: statistics("100"),
      coverage: [{ ...alice, mateId: filteredMate }],
      groups: [{ key: filteredMate, totals: statistics("100"), costUsdNanos: "1000000000" }],
      generation: { ...recordedReport().generation, access: "f".repeat(64) },
    });
    const all = renderPage();
    expect(all).toContain("Bob");
    expect(bodyOf(all)).toContain("200");
    const scoped = renderPage({ person: "alice" });
    expect(scoped).toContain("100");
    expect(scoped).toContain('value="bob"');
    expect(scoped).toContain("Bob");
    expect(scoped).not.toContain("Unknown owner");
  });
  it("keeps recent activity visible first without empty hourly rows", () => {
    const body = bodyOf(renderPage());
    expect(body.match(/<tr/g)).toHaveLength(2);
    expect(body.indexOf("$11.00")).toBeLessThan(body.indexOf("$13.00"));
  });
  it("keeps chronological ordering when the token metric is selected", () => {
    testState.metric = "tokens";
    const body = bodyOf(renderPage());
    expect(body.indexOf("11K")).toBeLessThan(body.indexOf("13K"));
  });
  it("sorts models by cost when the cost metric is selected", () => {
    testState.breakdown = "model";
    const body = bodyOf(renderPage());
    expect(body.indexOf("expensive-model")).toBeLessThan(body.indexOf("token-heavy-model"));
  });
  it("flags a model with no known rates instead of showing it as free", () => {
    testState.breakdown = "model";
    const row = bodyOf(renderPage())
      .split("<tr")
      .find((row) => row.includes("unpriced-model"));
    expect(row).toContain("Unpriced");
    expect(row).not.toContain("$0.00");
  });
  it("sorts models by token usage when the token metric is selected", () => {
    testState.breakdown = "model";
    testState.metric = "tokens";
    const body = bodyOf(renderPage());
    expect(body.indexOf("token-heavy-model")).toBeLessThan(body.indexOf("expensive-model"));
  });
  it("leaves a single Mate's page as it was", () => {
    testState.breakdown = "auto";
    const markup = renderPage();
    expect(markup).not.toContain(">Owner</button>");
    expect(markup).not.toContain(">Mate</button>");
  });
  it("leads with Person once two people spend", () => {
    testState.breakdown = "auto";
    const ownerA = { id: "user-a", name: "Sam", initials: "S", avatarUrl: null, isViewer: true };
    const ownerB = { id: "user-b", name: "Alex", initials: "A", avatarUrl: null, isViewer: false };
    testState.identities = new Map([
      [
        "environment-a" as EnvironmentId,
        {
          mateName: "A",
          projectId: "app-a",
          projectName: "Shop",
          ownerState: "known",
          owner: ownerA,
        },
      ],
      [
        "environment-b" as EnvironmentId,
        {
          mateName: "B",
          projectId: "app-a",
          projectName: "Shop",
          ownerState: "known",
          owner: ownerB,
        },
      ],
    ]);
    testState.report = recordedReport({
      totals: statistics("2000", "2"),
      groups: [
        { key: "mate-a", totals: statistics(), costUsdNanos: "1000000000" },
        { key: "mate-b", totals: statistics(), costUsdNanos: "1000000000" },
      ],
      coverage: [
        { ...recordedReport().coverage[0]!, ownerUserId: "user-a" },
        {
          ...recordedReport().coverage[0]!,
          originId: "origin-b",
          mateId: "mate-b",
          label: "B",
          ownerUserId: "user-b",
        },
      ],
    });
    const markup = renderPage();
    expect(markup).toContain("Sam");
    expect(markup).toContain("Alex");
    expect(markup).toContain('value="person"');
    expect(markup).toContain('value="mate"');
  });
  it("shows Project and Mate for one person's Mates in two projects", () => {
    testState.breakdown = "auto";
    testState.report = recordedReport({
      totals: statistics("2000", "2"),
      groups: [
        { key: "mate-a", totals: statistics(), costUsdNanos: "1000000000" },
        { key: "mate-b", totals: statistics(), costUsdNanos: "1000000000" },
      ],
      coverage: [
        { ...recordedReport().coverage[0]! },
        {
          ...recordedReport().coverage[0]!,
          originId: "origin-b",
          mateId: "mate-b",
          label: "B",
          appId: "app-b",
        },
      ],
    });
    const markup = renderPage();
    expect(markup).toContain('value="project"');
    expect(markup).toContain('value="mate"');
    expect(markup).toContain("app-a");
    expect(markup).toContain("app-b");
  });
  it("narrows the merge to the scope and names it in the breadcrumb", () => {
    expect(renderPage({ project: "app-a" })).toContain("app-a");
  });
  it.each([
    { name: "a cold HQ source", read: { kind: "reading" }, message: "Reading organization" },
    {
      name: "HQ refusal",
      read: { kind: "unavailable", reason: "HQ is offline" },
      message: "Retry",
    },
    {
      name: "before the first fact",
      read: {
        kind: "read",
        stale: false,
        report: recordedReport({ totals: statistics("0", "0"), recordedSince: null }),
      },
      message: "No recorded Mate usage",
    },
  ] as const)("$name never shows an invented zero", ({ read, message }) => {
    testState.read = read;
    const markup = renderPage();
    expect(markup.toLowerCase()).toContain(message.toLowerCase());
    expect(markup).not.toContain("$0.00");
  });
  it("an HQ outage retains permitted values labelled last known", () => {
    testState.stale = true;
    const markup = renderPage();
    expect(markup).toContain("$7.83");
    expect(markup).toContain("Last-known HQ report");
  });
  it("shows the recording boundary without inventing earlier consumption", () => {
    const markup = renderPage();
    expect(markup).toContain("No data before");
    expect(markup).not.toContain("transcript");
    expect(markup).not.toContain("Not connected, so not counted");
  });
  it("unpriced provider and period consumption is never presented as free", () => {
    testState.report = recordedReport({
      pricing: {
        ...recordedReport().pricing,
        costUsdNanos: null,
        pricedModelEntries: "0",
        unpricedModelEntries: "1",
      },
    });
    testState.providers = recordedReport({
      groups: [{ key: "codex", provider: "codex", totals: statistics(), costUsdNanos: null }],
    });
    testState.periods = recordedReport({
      groups: [
        {
          key: "[period,codex]",
          period: "2026-10-06T13:00:00.000Z",
          provider: "codex",
          totals: statistics(),
          costUsdNanos: null,
        },
      ],
    });
    const markup = renderPage();
    expect(markup).toContain("Unpriced");
    expect(markup).not.toContain("$0.00");
  });
  it("a provider omitted from a recorded period is unknown rather than free", () => {
    testState.providers = recordedReport({
      groups: [
        { key: "codex", provider: "codex", totals: statistics(), costUsdNanos: null },
        { key: "claude", provider: "claude", totals: statistics(), costUsdNanos: "7830000000" },
      ],
    });
    testState.periods = recordedReport({
      groups: [
        {
          key: "period",
          period: "2026-10-01",
          provider: "claude",
          totals: statistics(),
          costUsdNanos: "7830000000",
        },
      ],
    });
    const body = bodyOf(renderPage());
    expect(body).toContain("$7.83");
    expect(body).toContain("No data");
    expect(body).not.toContain("$0.00");
  });
  it("provider-reported costs remain separate from the API-equivalent estimate", () => {
    testState.report = recordedReport({ nativeCosts: { '["USD","response",6]': "1250000" } });
    const markup = renderPage();
    expect(markup).toContain("Provider-reported costs");
    expect(markup).toContain("USD 1.25");
    expect(markup).toContain("$7.83");
  });
  it("a turn using two models stays one headline turn and keeps its reported cost separate", () => {
    testState.breakdown = "model";
    testState.report = recordedReport({ nativeCosts: { '["USD","turn",6]': "1250000" } });
    testState.models = recordedReport({
      groups: [
        {
          key: "parent",
          provider: "claude",
          model: "parent-model",
          totals: statistics("600"),
          costUsdNanos: "6000000000",
          nativeCosts: { '["USD","model",6]': "750000" },
        },
        {
          key: "child",
          provider: "claude",
          model: "child-model",
          totals: statistics("400"),
          costUsdNanos: "1830000000",
          nativeCosts: { '["USD","model",6]': "500000" },
        },
      ],
    });
    const markup = renderPage();
    expect(markup).toContain("1 turn");
    expect(markup).not.toContain("2 turns");
    expect(markup).toContain("parent-model");
    expect(markup).toContain("child-model");
    expect(markup).toContain("USD 1.25 · turn");
    expect(markup).not.toContain("USD 2.5");
    expect(markup).toContain("A turn can use several models");
  });
  it.each([
    {
      gap: "codex-resumed-turns-unavailable",
      message: "Usage from resumed Codex threads is unavailable.",
    },
  ])("$gap names the missing provider evidence", ({ gap, message }) => {
    testState.report = recordedReport({
      state: "partial",
      coverage: [
        {
          ...recordedReport().coverage[0]!,
          value: { ...recordedReport().coverage[0]!.value, gaps: [gap], state: "partial" },
        },
      ],
    });
    expect(renderPage()).toContain(message);
  });
  it("unknown token categories are labelled unknown", () => {
    testState.report = recordedReport({ totals: { ...statistics(), unknownComponents: "1" } });
    const markup = renderPage();
    expect(markup).toContain("Unknown");
  });
});
