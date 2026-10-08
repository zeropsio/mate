import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { UsageDay, type UsageSummaryInput, type UsageReportQuery } from "@t3tools/contracts";
import { recordedReport } from "../components/usage/usageTestFixtures";
const state = vi.hoisted(() => ({
  demands: [] as { family: string; owner: string | null }[],
  refresh: vi.fn(),
  accounting: "1",
}));
vi.mock("../zerops/ZeropsAccountData", () => ({
  useAccountDataOptional: () => ({ orgId: "org", retryDetail: state.refresh }),
  useDetailDemand: (family: string, _listing: undefined, owner: string | null) =>
    state.demands.push({ family, owner }),
  useProjection: (_projection: unknown, key: { owner: string } | null) =>
    key === null
      ? { kind: "reading" }
      : {
          kind: "read",
          stale: false,
          report: recordedReport({
            query: JSON.parse(key.owner) as UsageReportQuery,
            groups:
              JSON.parse(key.owner).groupBy === "model"
                ? [
                    {
                      key: "codex-model",
                      provider: "codex",
                      model: "native-model",
                      totals: recordedReport().totals,
                      costUsdNanos: "7830000000",
                    },
                  ]
                : recordedReport().groups,
            generation: {
              accounting: JSON.parse(key.owner).groupBy === "model" ? state.accounting : "1",
              access: "0".repeat(64),
              pricing: "prices",
            },
          }),
        },
}));
import { useAgentUsage } from "./usage";
const window: UsageSummaryInput = {
  sinceDay: UsageDay.make("2026-10-01"),
  untilDay: UsageDay.make("2026-10-07"),
  timeZone: "UTC",
  resolution: "day",
};
function Harness({
  enabled = true,
  provenance = "live-responses",
}: {
  enabled?: boolean;
  provenance?: NonNullable<UsageReportQuery["provenance"]>;
}) {
  const view = useAgentUsage(window, {}, enabled, provenance);
  return (
    <span data-models={JSON.stringify(view.merged.models)}>
      {view.detailPending ? "Reading breakdown" : "Read"}
    </span>
  );
}
beforeEach(() => {
  state.demands = [];
  state.refresh.mockClear();
  state.accounting = "1";
});
describe("usage observation ownership", () => {
  it("Cost and Tokens demand only HQ reports without opening Mate sockets", () => {
    renderToStaticMarkup(<Harness />);
    expect(state.demands).toHaveLength(5);
    expect(new Set(state.demands.map((demand) => demand.family))).toEqual(new Set(["agentUsage"]));
    expect(
      state.demands.every((demand) => JSON.parse(demand.owner!).provenance === "live-responses"),
    ).toBe(true);
  });
  it("Limits holds no consumption report demand", () => {
    renderToStaticMarkup(<Harness enabled={false} />);
    expect(state.demands.every((demand) => demand.owner === null)).toBe(true);
  });
  it("earlier history remains a separate HQ report and is never added to live turns", () => {
    renderToStaticMarkup(<Harness provenance="legacy-scanner" />);
    expect(
      state.demands.every((demand) => JSON.parse(demand.owner!).provenance === "legacy-scanner"),
    ).toBe(true);
  });
  it("a newer group report cannot silently mix with an older accounting total", () => {
    expect(renderToStaticMarkup(<Harness />)).toContain("native-model");
    state.accounting = "2";
    const markup = renderToStaticMarkup(<Harness />);
    expect(markup).toContain("Reading breakdown");
    expect(markup).toContain('data-models="[]"');
  });
});
