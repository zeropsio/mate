import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { makeBrowserFrameDemand } from "./browserStreamLinks.tsx";
const ENV = EnvironmentId.make("mate");

describe("account browser stream demand", () => {
  it("the panel and card share one stream, closed after their last release", () => {
    const stop = vi.fn();
    const start = vi.fn(() => ({ stop }));
    const host = makeBrowserFrameDemand(start);
    const panel = host.hold(ENV);
    const card = host.hold(ENV);
    expect(start).toHaveBeenCalledTimes(1);
    panel();
    expect(stop).not.toHaveBeenCalled();
    card();
    card();
    expect(stop).toHaveBeenCalledTimes(1);
  });
  it("sign-out closes demand before late releases and mounts", () => {
    const stop = vi.fn();
    const start = vi.fn(() => ({ stop }));
    const host = makeBrowserFrameDemand(start);
    const release = host.hold(ENV);
    host.close();
    host.hold(ENV)();
    release();
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
