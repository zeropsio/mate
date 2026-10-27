import { describe, expect, it } from "@effect/vitest";
import { makeSourceFence } from "./sourceFence.ts";

describe("shared source read fence", () => {
  it("cannot clear an invalidation received while the source read was in flight", () => {
    const fence = makeSourceFence();
    const started = fence.capture();
    fence.invalidate();
    expect(fence.accept(started)).toBe(false);
    expect(fence.dirty()).toBe(true);
    expect(fence.accept(fence.capture())).toBe(true);
    expect(fence.dirty()).toBe(false);
  });
});
