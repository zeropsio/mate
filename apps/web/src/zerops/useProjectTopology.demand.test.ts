import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { project } from "./__fixtures__/platformData";
const calls = vi.hoisted(() => ({ demands: [] as string[], retry: vi.fn(), retryDetail: vi.fn() }));
vi.mock("react", () => ({ useSyncExternalStore: () => true }));
vi.mock("./useZeropsFeeds", () => ({
  useEnvironmentProjectRef: () => project(),
  useEnvironmentTopology: () => ({ view: null }),
}));
vi.mock("./ZeropsAccountData", () => ({
  useAccountDataOptional: () => calls,
  useDetailDemand: (family: string, _listing: string | undefined, owner: string | null) => {
    if (owner !== null) calls.demands.push(family);
  },
}));
import { useProjectTopology } from "./useProjectTopology";
it.each([false, true])(
  "a topology page uses navigation services and retries that reader: metrics=%s",
  (metrics) => {
    calls.demands.length = 0;
    calls.retry.mockClear();
    calls.retryDetail.mockClear();
    const read = useProjectTopology(EnvironmentId.make("environment"), { metrics });
    expect(calls.demands).toEqual(metrics ? ["usage", "usageHistory"] : []);
    read.again();
    expect(calls.retry).toHaveBeenCalledOnce();
    expect(calls.retryDetail).not.toHaveBeenCalled();
  },
);
