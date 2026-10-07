import { describe, expect, it, vi } from "vite-plus/test";
import type { RunToEnd } from "../runToEnd.ts";
import { hardenMateProject } from "./hardenMateProject.ts";

function rig() {
  const writes = vi.fn().mockResolvedValue({ keyNotLowered: null });
  const mateKey = vi.fn().mockResolvedValue("key-1");
  const recheckKey = vi.fn().mockResolvedValue(undefined);
  let active = true;
  return {
    writes,
    mateKey,
    recheckKey,
    close: () => {
      active = false;
    },
    run: () =>
      hardenMateProject({
        api: { mateKey, recheckKey },
        orgId: "org",
        projectId: "project",
        keyWider: true,
        active: () => active,
        run: writes as RunToEnd,
        unobserved: "Ask the owner again.",
      }),
  };
}

describe("finish-setup key coordination", () => {
  it("hardens only the owner-named key and rechecks after the same completed write", async () => {
    const r = rig();
    await r.run();
    expect(r.writes).toHaveBeenCalledWith(
      { kind: "harden-project", orgId: "org", projectId: "project", keyTokenId: "key-1" },
      expect.anything(),
    );
    expect(r.recheckKey).toHaveBeenCalledWith("project");
    expect(r.writes.mock.invocationCallOrder[0]).toBeLessThan(
      r.recheckKey.mock.invocationCallOrder[0]!,
    );
  });
  it.each(["refused", "unavailable"])(
    "a %s key read is never treated as an absent key",
    async (reason) => {
      const r = rig();
      r.mateKey.mockRejectedValue(new Error(reason));
      await expect(r.run()).rejects.toThrow(reason);
      expect(r.writes).not.toHaveBeenCalled();
    },
  );
  it("fences a late key answer from a closed account", async () => {
    const r = rig();
    r.mateKey.mockImplementation(async () => {
      r.close();
      return "key-1";
    });
    await expect(r.run()).rejects.toThrow("no longer active");
    expect(r.writes).not.toHaveBeenCalled();
  });
  it("keeps the wider-key verdict when narrowing was refused", async () => {
    const r = rig();
    r.writes.mockResolvedValue({ keyNotLowered: "Owner only" });
    expect(await r.run()).toEqual({ keyNotLowered: "Owner only" });
    expect(r.recheckKey).not.toHaveBeenCalled();
  });
});
