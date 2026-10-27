import { describe, expect, it } from "vite-plus/test";
import { updateOutcome } from "./mateUpdate.ts";

describe("Mate update evidence", () => {
  const pressed = { from: "1", bootId: "old" };
  it("a dropped socket or the same boot proves no outcome", () => {
    expect(updateOutcome(pressed, null)).toBeNull();
    expect(updateOutcome(pressed, { serverVersion: "1", bootId: "old" })).toBeNull();
    expect(updateOutcome(pressed, { serverVersion: "1" })).toBeNull();
  });
  it("a changed version proves an update, including a late return", () => {
    expect(updateOutcome(pressed, { serverVersion: "2", bootId: "new" })).toEqual({
      kind: "succeeded",
    });
  });
  it("a later boot on the original version proves the update did not take", () => {
    expect(updateOutcome(pressed, { serverVersion: "1", bootId: "new" })).toEqual({
      kind: "failed",
      reason: "The update did not take: this Mate is still on 1.",
    });
  });
  it("an absent original boot cannot prove a restart on the same version", () => {
    expect(updateOutcome({ from: "1" }, { serverVersion: "1", bootId: "new" })).toBeNull();
  });
  describe("a press that only a container restart answers", () => {
    const zcp = (behind: boolean, installed = behind ? "9.225.0" : "9.226.0") => ({
      installed: "1",
      latest: "1",
      available: false,
      checkedAt: "now",
      zcp: { installed, latest: "9.226.0", behind },
      restart: { needed: behind },
    });
    const restart = { ...pressed, restart: { zcp: "9.226.0" } };
    it.each([
      {
        name: "the same boot, still draining, proves nothing",
        server: { serverVersion: "1", bootId: "old", update: zcp(true) },
        attempt: "restart-1",
        expected: null,
      },
      {
        name: "its own attempt postponed settles it, saying why",
        server: {
          serverVersion: "1",
          bootId: "old",
          update: {
            ...zcp(true),
            restart: {
              needed: true,
              phase: "postponed" as const,
              reason: "its work wasn't done within 10 minutes",
              attempt: "restart-1",
            },
          },
        },
        attempt: "restart-1",
        expected: {
          kind: "failed",
          reason: "Update postponed; its work wasn't done within 10 minutes",
        },
      },
      {
        name: "an older attempt postponed is not this press's",
        server: {
          serverVersion: "1",
          bootId: "old",
          update: {
            ...zcp(true),
            restart: {
              needed: true,
              phase: "postponed" as const,
              reason: "x",
              attempt: "restart-0",
            },
          },
        },
        attempt: "restart-1",
        expected: null,
      },
      {
        name: "the next boot with zcp current proves it",
        server: { serverVersion: "1", bootId: "new", update: zcp(false) },
        attempt: "restart-1",
        expected: { kind: "succeeded" },
      },
      {
        name: "the next boot with zcp still behind did not take",
        server: { serverVersion: "1", bootId: "new", update: zcp(true) },
        attempt: "restart-1",
        expected: {
          kind: "failed",
          reason: "The restart didn't install Zerops Control Plane 9.226.0.",
        },
      },
    ])("$name", ({ server, attempt, expected }) => {
      expect(updateOutcome(restart, server, attempt)).toEqual(expected);
    });
    it("a restart for mate too proves both, and names what did not move", () => {
      const both = { ...pressed, restart: { zcp: "9.226.0", mate: "2" } };
      expect(
        updateOutcome(both, { serverVersion: "2", bootId: "new", update: zcp(false) }),
      ).toEqual({ kind: "succeeded" });
      expect(
        updateOutcome(both, {
          serverVersion: "1",
          bootId: "new",
          update: { ...zcp(false), latest: "2", available: true },
        }),
      ).toEqual({ kind: "failed", reason: "The restart didn't install mate 2." });
    });
  });
});
