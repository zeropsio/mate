import { afterEach, expect, it, vi } from "vite-plus/test";
import { probeCandidateHealth } from "./useZeropsCandidateHealth";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";

const probe = vi.hoisted(() => vi.fn());
vi.mock("@t3tools/client-runtime/zerops/containerHealth", () => ({
  probeZeropsContainerHealth: (...args: unknown[]) => probe(...args),
}));
afterEach(() => {
  closeAccountLifetime();
  probe.mockReset();
});
it("shares a probe across sidebar, picker and incremental candidate snapshots", async () => {
  openAccountLifetime("account");
  let finish!: (value: string) => void;
  probe.mockImplementation((_origin, _fetch, onVersion) => {
    onVersion("1.2.3");
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const first = probeCandidateHealth("https://container.example", 0);
  const second = probeCandidateHealth("https://container.example/", 0);
  expect(probe).toHaveBeenCalledTimes(1);
  finish("ready");
  expect(await first).toEqual({ health: "ready", serverVersion: "1.2.3" });
  expect(await second).toEqual(await first);
  expect(await probeCandidateHealth("https://container.example", 0)).toEqual(await first);
  expect(probe).toHaveBeenCalledTimes(1);
});
it("re-probes on explicit refresh and never carries a result into another account", async () => {
  openAccountLifetime("account-a");
  probe.mockResolvedValue("unreachable");
  await probeCandidateHealth("https://container.example", 0);
  probe.mockResolvedValue("ready");
  expect(await probeCandidateHealth("https://container.example", 1)).toEqual({ health: "ready" });
  closeAccountLifetime();
  openAccountLifetime("account-b");
  await probeCandidateHealth("https://container.example", 1);
  expect(probe).toHaveBeenCalledTimes(3);
});

it("does not reuse the previous service's health when its address is reused", async () => {
  openAccountLifetime("account");
  probe.mockResolvedValue("ready");
  await probeCandidateHealth("https://container.example", 0, "project:old-service");
  probe.mockResolvedValue("initializing");
  expect(await probeCandidateHealth("https://container.example", 0, "project:new-service")).toEqual(
    { health: "initializing" },
  );
  expect(probe).toHaveBeenCalledTimes(2);
});
