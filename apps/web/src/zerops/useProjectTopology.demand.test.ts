import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { RuntimeInterestDescriptor } from "@t3tools/client-runtime/zerops/data";
import { project } from "./__fixtures__/platformData";

const held = vi.hoisted(() => ({
  visible: true,
  descriptors: [] as Array<RuntimeInterestDescriptor | null>,
  details: [] as Array<string>,
  project: null as ReturnType<typeof project> | null,
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
vi.mock("./ZeropsAccountData", () => ({
  useAccountDataOptional: () => null,
  useDetailDemand: (family: string, _listing: string | undefined, ownerId: string | null) => {
    if (ownerId !== null) held.details.push(`${family}:${ownerId}`);
  },
}));
import { useProjectTopology } from "./useProjectTopology";

beforeEach(() => {
  held.project = project();
  held.visible = true;
  held.descriptors = [];
  held.details = [];
});
describe("visible panel metric demand", () => {
  it.each([
    { name: "chat without a Mate panel", metrics: false, visible: true },
    { name: "closed Mate panel", metrics: false, visible: true },
    { name: "background browser tab", metrics: true, visible: false },
  ])("$name holds only topology", ({ metrics, visible }) => {
    // Its own organization's, whichever the menu shows.
    const projectId = `${held.project!.organization.organizationId}/${held.project!.projectId}`;
    useProjectTopology(null, { metrics: true });
    expect(held.descriptors.filter(Boolean).map((d) => d!.kind)).toEqual(["project-topology"]);
    expect(held.details).toEqual([`usage:${projectId}`, `usageHistory:${projectId}`]);
    held.descriptors = [];
    held.details = [];
    held.visible = visible;
    useProjectTopology(null, { metrics });
    expect(held.descriptors.filter(Boolean).map((d) => d!.kind)).toEqual(["project-topology"]);
    expect(held.details).toEqual([]);
  });
});
