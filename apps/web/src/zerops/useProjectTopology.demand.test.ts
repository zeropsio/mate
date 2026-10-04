import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeInterestDescriptor } from "@t3tools/client-runtime/zerops/data";
import { project } from "./__fixtures__/platformData";

const held = vi.hoisted(() => ({
  visible: true,
  descriptors: [] as Array<RuntimeInterestDescriptor | null>,
  project: null as ReturnType<typeof project> | null,
}));
vi.mock("../state/zerops", () => ({
  PROJECT_HISTORY_WINDOW: { timeGroupBy: "1h", limit: 24, timeZone: "UTC" },
}));
vi.mock("react", () => ({
  useMemo: (f: () => unknown) => f(),
  useSyncExternalStore: () => held.visible,
}));
vi.mock("./useZeropsFeeds", () => ({
  useEnvironmentProjectRef: () => held.project,
  useEnvironmentTopology: () => ({ view: null }),
}));
vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({ runtime: {} }),
  useZeropsDataInterest: (descriptor: RuntimeInterestDescriptor | null) =>
    held.descriptors.push(descriptor),
}));
import { useProjectTopology } from "./useProjectTopology";

beforeEach(() => {
  held.project = project();
  held.visible = true;
  held.descriptors = [];
});
describe("visible panel metric demand", () => {
  it.each([
    { name: "chat without a Mate panel", metrics: false, visible: true },
    { name: "closed Mate panel", metrics: false, visible: true },
    { name: "background browser tab", metrics: true, visible: false },
  ])("$name holds only topology", ({ metrics, visible }) => {
    useProjectTopology(null, { metrics: true });
    expect(held.descriptors.filter(Boolean).map((d) => d!.kind)).toEqual([
      "project-topology",
      "project-current-metrics",
      "project-metric-history",
    ]);
    held.descriptors = [];
    held.visible = visible;
    useProjectTopology(null, { metrics });
    expect(held.descriptors.filter(Boolean).map((d) => d!.kind)).toEqual(["project-topology"]);
  });
});
