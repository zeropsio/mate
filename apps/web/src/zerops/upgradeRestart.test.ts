import { describe, expect, it, vi } from "vite-plus/test";
import { restartAndVerifyMate, type UpgradeProbe } from "./upgradeRestart";

describe("restart before connecting to an older Mate", () => {
  it("restarts once and waits through the old server and downtime before accepting compatibility", async () => {
    const restart = vi.fn(async () => {});
    const replies: UpgradeProbe[] = ["incompatible", "unreachable", "compatible"];
    const probe = vi.fn(async () => replies.shift()!);
    expect(
      await restartAndVerifyMate({ restart, probe, wait: async () => {}, isCurrent: () => true }),
    ).toBe("compatible");
    expect(restart).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(3);
  });
  it("does not claim an update or restart repeatedly when the published server is still incompatible", async () => {
    const restart = vi.fn(async () => {});
    expect(
      await restartAndVerifyMate({
        restart,
        probe: async () => "incompatible",
        wait: async () => {},
        isCurrent: () => true,
        attempts: 3,
      }),
    ).toBe("incompatible");
    expect(restart).toHaveBeenCalledTimes(1);
  });
  it("does not restart for a closed account lifetime", async () => {
    const restart = vi.fn(async () => {});
    expect(
      await restartAndVerifyMate({
        restart,
        probe: async () => "compatible",
        wait: async () => {},
        isCurrent: () => false,
      }),
    ).toBe("cancelled");
    expect(restart).not.toHaveBeenCalled();
  });
  it("does not publish a successful probe after logout", async () => {
    let current = true;
    expect(
      await restartAndVerifyMate({
        restart: async () => {},
        probe: async () => {
          current = false;
          return "compatible";
        },
        wait: async () => {},
        isCurrent: () => current,
      }),
    ).toBe("cancelled");
  });
  it("reports a lost restart response without submitting the restart again", async () => {
    const restart = vi.fn(async () => {
      throw new Error("Restart outcome is uncertain");
    });
    const probe = vi.fn(async (): Promise<UpgradeProbe> => "compatible");
    await expect(
      restartAndVerifyMate({ restart, probe, wait: async () => {}, isCurrent: () => true }),
    ).rejects.toThrow("uncertain");
    expect(restart).toHaveBeenCalledTimes(1);
    expect(probe).not.toHaveBeenCalled();
  });
});
