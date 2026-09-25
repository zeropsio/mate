import { USAGE_CONTRACT_VERSION, type EnvironmentId } from "@t3tools/contracts";
import { mergeUsage } from "@t3tools/shared/usageMerge";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  useUsage: vi.fn(),
  identities: new Map() as ReadonlyMap<EnvironmentId, UsageEnvironmentIdentity>,
  metric: "cost" as "cost" | "tokens" | "limits",
  breakdown: "time" as "auto" | "person" | "project" | "mate" | "model" | "time",
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: vi.fn((initial: unknown) => [
      initial === readUsagePagePreferences
        ? { metric: testState.metric, windowDays: 30 }
        : typeof initial === "function"
          ? {
              days: 1,
              window: {
                sinceDay: "2026-08-10",
                untilDay: "2026-08-11",
                timeZone: "UTC",
                resolution: "hour",
                sinceTime: "2026-08-10T12:37:00.000Z",
                untilTime: "2026-08-11T12:37:00.000Z",
              },
            }
          : initial === "cost"
            ? testState.metric
            : initial === "auto"
              ? testState.breakdown
              : initial,
      vi.fn(),
    ]),
  };
});

vi.mock("../../env", () => ({ isElectron: false }));
vi.mock("../../state/usage", () => ({ useUsage: testState.useUsage }));
vi.mock("../../zerops/useUsageEnvironmentIdentities", () => ({
  useUsageEnvironmentIdentities: () => testState.identities,
}));
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
vi.mock("./UsageProviderChart", () => ({ UsageProviderChart: "div" }));
vi.mock("./UsagePriceOverrides", () => ({ UsagePriceOverrides: () => null }));
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

import type { UsageEnvironmentIdentity } from "../../zerops/usageEnvironmentIdentities";
import { UsagePage } from "./UsagePage";
import type { UsageScope } from "./usageDimensions";
import { readUsagePagePreferences } from "./usagePagePreferences";

function renderPage(scope: UsageScope = {}): string {
  return renderToStaticMarkup(<UsagePage scope={scope} onScopeChange={vi.fn()} />);
}

const providerTotals = (codex: number, claude: number) =>
  new Map([
    ["codex", { costUsd: codex, totalTokens: codex * 1_000 }],
    ["claude", { costUsd: claude, totalTokens: claude * 1_000 }],
  ] as const);

const modelTotals = Object.freeze([
  {
    model: "expensive-model",
    provider: "claude" as const,
    costUsd: 10,
    totalTokens: 100,
    records: 1,
    unpricedRecords: 0,
    costShare: 10 / 16,
  },
  {
    model: "token-heavy-model",
    provider: "codex" as const,
    costUsd: 5,
    totalTokens: 1_000,
    records: 1,
    unpricedRecords: 0,
    costShare: 5 / 16,
  },
  {
    model: "token-heavy-cheaper-model",
    provider: "codex" as const,
    costUsd: 1,
    totalTokens: 1_000,
    records: 1,
    unpricedRecords: 0,
    costShare: 1 / 16,
  },
  {
    model: "unpriced-model",
    provider: "codex" as const,
    costUsd: 0,
    totalTokens: 500,
    records: 2,
    unpricedRecords: 2,
    costShare: 0,
  },
]);

beforeEach(() => {
  testState.metric = "cost";
  testState.breakdown = "time";
  testState.identities = new Map();
  const merged = {
    ...mergeUsage([], USAGE_CONTRACT_VERSION),
    models: modelTotals,
    hourly: [
      {
        day: "2026-08-10",
        hourStart: "2026-08-10T13:37:00.000Z",
        costUsd: 13,
        totalTokens: 13_000,
        byProvider: providerTotals(7, 6),
      },
      {
        day: "2026-08-11",
        hourStart: "2026-08-11T11:37:00.000Z",
        costUsd: 11,
        totalTokens: 11_000,
        byProvider: providerTotals(6, 5),
      },
    ],
  };
  testState.useUsage.mockReturnValue({
    merged,
    overall: merged,
    environments: [],
    isPending: false,
    isPartial: false,
    refresh: vi.fn(),
  });
});

describe("UsagePage hourly breakdown", () => {
  it("keeps recent activity visible first without empty hourly rows", () => {
    const markup = renderPage();
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";

    expect(body.match(/<tr/g)).toHaveLength(2);
    expect(body).toContain("$11.00");
    expect(body).toContain("$13.00");
    expect(body.indexOf("$11.00")).toBeLessThan(body.indexOf("$13.00"));
  });

  it("keeps chronological ordering when the token metric is selected", () => {
    testState.metric = "tokens";

    const markup = renderPage();
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";

    expect(body).toMatch(/\$11\.00.*\$13\.00/);
  });
});

describe("UsagePage model breakdown", () => {
  it("sorts models by cost when the cost metric is selected", () => {
    testState.breakdown = "model";

    const markup = renderPage();
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";

    expect(body).toMatch(/expensive-model.*token-heavy-model.*token-heavy-cheaper-model/);
  });

  it("flags a model with no known rates instead of showing it as free", () => {
    testState.breakdown = "model";

    const markup = renderPage();
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";
    const unpricedRow = body.split("<tr").find((row) => row.includes("unpriced-model")) ?? "";

    expect(unpricedRow).toContain("Unpriced");
    expect(unpricedRow).not.toContain("$0.00");
  });

  it("sorts models by token usage when the token metric is selected", () => {
    testState.metric = "tokens";
    testState.breakdown = "model";

    const markup = renderPage();
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";

    expect(body).toMatch(/token-heavy-model.*token-heavy-cheaper-model.*expensive-model/);
    expect(modelTotals.map((model) => model.model)).toEqual([
      "expensive-model",
      "token-heavy-model",
      "token-heavy-cheaper-model",
      "unpriced-model",
    ]);
  });
});

const owner = (id: string, name: string, isViewer = false) => ({
  id,
  name,
  initials: name.slice(0, 2).toUpperCase(),
  avatarUrl: null,
  isViewer,
});

function withEnvironments(
  rows: readonly {
    id: string;
    costUsd: number;
    identity?: UsageEnvironmentIdentity;
    error?: string;
  }[],
) {
  const totalCost = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const current = testState.useUsage();
  const merged = {
    ...current.merged,
    costUsd: totalCost,
    byEnvironment: rows.map((row) => ({
      environmentId: row.id as EnvironmentId,
      costUsd: row.costUsd,
      totalTokens: row.costUsd * 10,
      records: 1,
      unpricedRecords: 0,
      sessions: 1,
      costShare: row.costUsd / totalCost,
      tokenShare: row.costUsd / totalCost,
      providers: ["claude"],
    })),
  };
  testState.useUsage.mockReturnValue({
    ...current,
    merged,
    overall: merged,
    environments: rows.map((row) => ({
      environmentId: row.id,
      label: `label ${row.id}`,
      isPending: false,
      error: row.error ?? null,
      summary: null,
    })),
  });
  testState.identities = new Map(
    rows.flatMap((row) =>
      row.identity === undefined ? [] : [[row.id as EnvironmentId, row.identity] as const],
    ),
  );
}

function breakdownOptions(markup: string): string[] {
  const group = markup.match(/aria-label="Usage breakdown"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
  return [...group.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((match) => match[1] ?? "");
}

describe("UsagePage dimensions", () => {
  it("leaves a single Mate's page as it was", () => {
    testState.breakdown = "auto";
    withEnvironments([
      {
        id: "a",
        costUsd: 10,
        identity: { mateName: "Lena", projectName: "shop", owner: owner("u1", "Ales", true) },
      },
    ]);

    const markup = renderPage();

    expect(breakdownOptions(markup)).toEqual(["Model", "Hour"]);
    expect(markup).not.toContain("Mates");
    expect(markup).not.toContain("people");
    expect(markup).toContain("expensive-model");
  });

  it("leads with Person once two people spend", () => {
    testState.breakdown = "auto";
    withEnvironments([
      {
        id: "a",
        costUsd: 10,
        identity: { mateName: "Lena", projectName: "shop", owner: owner("u1", "Ales", true) },
      },
      {
        id: "b",
        costUsd: 30,
        identity: { mateName: "Otto", projectName: "blog", owner: owner("u2", "Bara") },
      },
    ]);

    const markup = renderPage();
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";

    expect(breakdownOptions(markup)).toEqual(["Person", "Project", "Mate", "Model", "Hour"]);
    expect(body).toMatch(/Bara.*Ales/);
    expect(markup).toContain("· 2 Mates · 2 people");
    expect(markup).toMatch(/Ales.*You/);
  });

  it("shows Project and Mate for one person's Mates in two projects", () => {
    testState.breakdown = "auto";
    withEnvironments([
      {
        id: "a",
        costUsd: 10,
        identity: { mateName: "Lena", projectName: "shop", owner: owner("u1", "Ales", true) },
      },
      {
        id: "b",
        costUsd: 30,
        identity: { mateName: "Otto", projectName: "blog", owner: owner("u1", "Ales", true) },
      },
    ]);

    const markup = renderPage();
    const body = markup.match(/<tbody>(.*?)<\/tbody>/)?.[1] ?? "";

    expect(breakdownOptions(markup)).toEqual(["Project", "Mate", "Model", "Hour"]);
    expect(body).toMatch(/blog.*shop/);
    expect(markup).toContain("· 2 Mates");
    expect(markup).not.toContain("people");
  });

  it("narrows the merge to the scope and names it in the breadcrumb", () => {
    withEnvironments([
      {
        id: "a",
        costUsd: 10,
        identity: { mateName: "Lena", projectName: "shop", owner: owner("u1", "Ales", true) },
      },
      {
        id: "b",
        costUsd: 30,
        identity: { mateName: "Otto", projectName: "blog", owner: owner("u2", "Bara") },
      },
    ]);

    const markup = renderPage({ person: "u2" });
    const include = testState.useUsage.mock.lastCall?.[1] as
      | ((environmentId: EnvironmentId) => boolean)
      | undefined;

    expect(include?.("a" as EnvironmentId)).toBe(false);
    expect(include?.("b" as EnvironmentId)).toBe(true);
    expect(markup).toMatch(/Bara.*aria-label="Clear person filter"/);
  });

  it("names a failed environment by its Mate and project", () => {
    withEnvironments([
      {
        id: "a",
        costUsd: 10,
        identity: { mateName: "Lena", projectName: "shop", owner: owner("u1", "Ales", true) },
        error: "down",
      },
      { id: "b", costUsd: 5, error: "down" },
    ]);

    const markup = renderPage();

    expect(markup).toContain("Lena · shop could not report usage.");
    expect(markup).toContain("label b could not report usage.");
  });
});
