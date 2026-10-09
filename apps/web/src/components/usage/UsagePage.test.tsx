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
  hourly: true,
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
  provenance: "live-responses" as "live-responses" | "legacy-scanner",
  sectionReads: {} as Partial<Record<string, AgentUsageRead>>,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => new Map() }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => [
      initial === readUsagePagePreferences
        ? { metric: testState.metric, windowDays: testState.hourly ? 1 : 7 }
        : typeof initial === "function"
          ? {
              days: testState.hourly ? 1 : 7,
              window: {
                sinceDay: "2026-10-06",
                untilDay: "2026-10-07",
                timeZone: "UTC",
                resolution: testState.hourly ? "hour" : "day",
                sinceTime: "2026-10-06T12:37:00.000Z",
                untilTime: "2026-10-07T12:37:00.000Z",
              },
            }
          : initial === "live-responses"
            ? testState.provenance
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
              testState.hourly,
            ),
            overall: actual.usageReportView(testState.report),
            report: testState.report,
            overallReport: testState.report,
            sections: {
              models: testState.sectionReads.model ?? {
                kind: "read",
                report: testState.models,
                stale: false,
              },
              providers: testState.sectionReads.provider ?? {
                kind: "read",
                report: testState.providers,
                stale: false,
              },
              periods: testState.sectionReads.hour ?? {
                kind: "read",
                report: testState.periods,
                stale: false,
              },
            },
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
    const section = testState.sectionReads[query.groupBy];
    if (section !== undefined) return section;
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

it("Tokens shows each coding agent's recorded tokens in the Hour table", () => {
  testState.metric = "tokens";
  testState.periods = recordedReport({
    groups: [
      {
        key: "hour",
        period: "2026-10-07T12:00:00.000Z",
        provider: "codex",
        totals: statistics("919000"),
        costUsdNanos: null,
      },
    ],
  });
  const cells = [...bodyOf(renderPage()).matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(
    (match) => match[1],
  );
  expect(cells[1]).toBe("919K");
});

it("The Usage range preserves exact minutes and the Hour table names its date and zone", () => {
  testState.periods = recordedReport({
    groups: [
      {
        key: "hour",
        period: "2026-10-07T12:00:00.000Z",
        provider: "codex",
        totals: statistics(),
        costUsdNanos: "0",
      },
    ],
  });
  const markup = renderPage();
  expect(markup).toContain("Oct 6, 12:37 PM UTC");
  expect(bodyOf(markup)).toContain("Oct 7, 12:00 PM UTC");
});

it("Daily Usage identifies the recorded UTC day window", () => {
  testState.hourly = false;
  expect(renderPage()).toContain("Oct 6 to Oct 7 · UTC days");
});

it("A sole contributing Mate keeps its owner, project and name in the Usage summary", () => {
  const owner = { id: "ada", name: "Ada", initials: "A", avatarUrl: null, isViewer: true };
  testState.people = new Map([[owner.id, owner]]);
  testState.identities = new Map([
    [
      "mate-a" as EnvironmentId,
      { mateName: "Fern", projectId: "app-a", projectName: "Shop", ownerState: "known", owner },
    ],
  ]);
  testState.report = recordedReport({
    coverage: [{ ...recordedReport().coverage[0]!, ownerUserId: "ada", label: "Fern" }],
  });
  expect(renderPage()).toContain("Fern · Shop · Ada");
});
beforeEach(() => {
  testState.provenance = "live-responses";
  testState.sectionReads = {};
  testState.metric = "cost";
  testState.hourly = true;
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
    { name: "a cold HQ source", read: { kind: "reading" }, message: "Reading usage" },
    {
      name: "HQ refusal",
      read: { kind: "unavailable", reason: "HQ is offline" },
      message: "Try again",
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
    expect(markup).toContain("Showing last known usage.");
  });
  it("shows the recording boundary without inventing earlier consumption", () => {
    const markup = renderPage();
    expect(markup).toContain("Recorded since Oct 1");
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
    expect(markup).not.toContain("Partial estimate");
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
    expect(markup).toContain("Agent-reported costs");
    expect(markup).toContain("$1.25");
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
    expect(markup).toContain("$1.25 · Agent-reported amount");
    expect(markup).not.toContain("$2.50");
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
    const markup = renderPage();
    expect(markup).toContain(message);
    expect(markup).toMatch(/<details[^>]*><summary[^>]*>Coverage by Mate<\/summary>/);
    expect(markup).not.toMatch(/<details[^>]*open/);
    expect(markup).not.toContain("2026-10-01T");
  });
  it("unknown token categories are labelled unknown", () => {
    testState.report = recordedReport({ totals: { ...statistics(), unknownComponents: "1" } });
    const markup = renderPage();
    expect(markup).toContain("Unknown");
  });
});

it("A partial Usage estimate visibly names the excluded model entries", () => {
  testState.report = recordedReport({
    pricing: {
      ...recordedReport().pricing,
      pricedModelEntries: "1",
      unpricedModelEntries: "21",
      costUsdNanos: "949000",
    },
  });
  const html = renderPage();
  expect(html).toContain("Partial estimate");
  expect(html).toContain("21 unpriced model entries excluded");
});
it("A positive sub-cent Usage amount is never presented as zero dollars", () => {
  testState.report = recordedReport({
    pricing: { ...recordedReport().pricing, costUsdNanos: "949000" },
  });
  expect(renderPage()).toContain("&lt;$0.01");
});

it("The Day table renders the recorded UTC day instead of a local hour", () => {
  testState.hourly = false;
  testState.periods = recordedReport({
    groups: [
      {
        key: "day",
        period: "2026-10-07",
        provider: "codex",
        totals: statistics(),
        costUsdNanos: "1000000000",
      },
    ],
  });
  expect(bodyOf(renderPage())).toContain("Oct 7");
});
it("A coding agent with partly priced usage labels its subtotal as partial", () => {
  testState.providers = recordedReport({
    groups: [
      {
        key: "codex",
        provider: "codex",
        totals: statistics(),
        costUsdNanos: "7830000000",
        unpricedModelEntries: "1",
        unpricedTokens: "900",
      },
    ],
  });
  expect(renderPage().includes("$7.83 · partial")).toBe(true);
});

it("A fully priced zero Usage record remains a known zero amount", () => {
  testState.report = recordedReport({
    pricing: { ...recordedReport().pricing, costUsdNanos: "0" },
  });
  expect(renderPage()).toContain("$0.00");
});

it("Earlier history explains its own source once and names an empty historical period", () => {
  testState.provenance = "legacy-scanner";
  testState.hourly = false;
  testState.report = recordedReport({
    provenance: "legacy-scanner",
    recordedSince: null,
    totals: statistics("0", "0"),
    coverage: [],
  });
  const html = renderPage();
  expect(html).toContain("No earlier history is recorded for this period.");
  expect(html.match(/may include activity outside Mate/g)).toHaveLength(1);
  expect(html).not.toContain("agents and subagents running in Mate");
  expect(html).not.toContain("No recorded Mate usage yet");
  expect(html).not.toContain("No recorded usage yet");
});
it("Agent-reported amounts use readable currency and explain their separate estimate", () => {
  testState.report = recordedReport({
    nativeCosts: { '["USD","provider-reported-estimate",7]': "8265478" },
  });
  const html = renderPage();
  expect(html).toContain("$0.83 · Agent-reported estimate");
  expect(html).toContain(
    "Reported by the coding agent, separately from the API-equivalent token-price estimate.",
  );
  expect(html).not.toContain("provider-reported-estimate");
  expect(html).not.toContain("0.8265478");
  expect(html).toContain("$7.83");
});
it("An unread Usage report names the failed read and offers Try again", () => {
  testState.read = { kind: "unavailable", reason: "HQ denied access" };
  const html = renderPage();
  expect(html).toContain("Usage could not be read.");
  expect(html).toContain("Try again");
  expect(html).not.toContain("Restore HQ access");
});
it.each([
  { group: "hour", breakdown: "time" as const, label: "hourly usage" },
  { group: "model", breakdown: "model" as const, label: "model usage" },
  { group: "provider", breakdown: "time" as const, label: "coding agent usage" },
])(
  "A retained $group detail names its own freshness while the primary report stays current",
  ({ group, breakdown, label }) => {
    testState.accountObservation = true;
    testState.overallReport = testState.report;
    testState.breakdown = breakdown;
    const report =
      group === "model"
        ? testState.models!
        : group === "provider"
          ? testState.providers!
          : testState.periods!;
    testState.sectionReads[group] = { kind: "read", stale: true, report };
    const html = renderPage({ person: "alice" });
    expect(html).toContain(`Showing last known ${label}.`);
    expect(html).toContain("Try again");
    expect(html).not.toContain("Showing last known Usage.");
    expect(html).toContain(
      group === "model" ? "expensive-model" : group === "provider" ? "$7.83" : "$13.00",
    );
  },
);
it("Loading reserves the same five totals in the same order as the Usage report", () => {
  const labels = (html: string) =>
    [...html.matchAll(/<span class="text-xs text-muted-foreground">([^<]+)<\/span>/g)]
      .map((match) => match[1])
      .filter((text) =>
        [
          "Processed tokens",
          "Cached input",
          "Uncached input",
          "Output",
          "Cache write",
          "Cache writes",
          "Estimated cache savings",
        ].includes(text!),
      );
  const loaded = labels(renderPage());
  testState.read = { kind: "reading" };
  const loading = renderPage();
  expect(labels(loading)).toEqual(loaded);
  expect(loading).toContain("Agent-reported costs");
});
it("Coverage explains missing records without diagnosing a broken Mate and offers its named scope", () => {
  testState.report = recordedReport({
    recordedSince: null,
    coverage: [
      {
        mateId: "fern",
        label: "Fern",
        deleted: false,
        value: { state: "unknown", since: null, through: null, gaps: [] },
      },
    ],
  });
  const html = renderPage();
  expect(html).toContain("No usage from this Mate is recorded in this report.");
  expect(html).toContain("Totals include only recorded activity.");
  expect(html).toContain('aria-label="Show usage for Fern"');
  expect(html).not.toContain("Hasn&#x27;t reported usage yet");
});

it.each([
  { currency: "USD", quantity: "1", scale: 7, expected: "&lt;$0.01" },
  { currency: "EUR", quantity: "8265478", scale: 7, expected: "€0.83" },
  { currency: "JPY", quantity: "1", scale: 7, expected: "&lt;¥1" },
  { currency: "credits", quantity: "1", scale: 7, expected: "0.0000001 credits" },
  { currency: "USD", quantity: "0", scale: 7, expected: "$0.00" },
])(
  "Reported $currency amounts preserve a positive amount and their source unit",
  ({ currency, quantity, scale, expected }) => {
    testState.report = recordedReport({
      nativeCosts: { [JSON.stringify([currency, "provider-reported-estimate", scale])]: quantity },
    });
    expect(renderPage()).toContain(expected);
  },
);
it.each(["reading", "unavailable"] as const)(
  "The Hour breakdown names its own %s read instead of reporting missing model data",
  (kind) => {
    testState.periods = null;
    testState.sectionReads.hour = kind === "reading" ? { kind } : { kind, reason: "refused" };
    const html = renderPage();
    expect(html).toContain(
      kind === "reading" ? "Reading hourly usage…" : "Hourly usage could not be read.",
    );
    expect(html).not.toContain("Model usage unavailable");
    expect(html).not.toContain("No recorded model data");
  },
);
it("A capped Usage report explains its visible limits without treating missing records as collection failures", () => {
  testState.report = recordedReport({ groupsMore: true, coverageMore: true });
  const html = renderPage();
  expect(html).toContain("This report contains more sources or groups than can be shown.");
  expect(html).toContain("More Mates are covered than can be listed.");
  expect(html).not.toContain("could not be read");
});
