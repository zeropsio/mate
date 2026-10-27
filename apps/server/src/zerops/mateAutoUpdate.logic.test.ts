import { describe, expect, it } from "@effect/vitest";
import { mayAutoRestart, mayAutoUpdate, restartReading } from "./mateAutoUpdate.logic.ts";

describe("automatic Mate updates", () => {
  it.each([
    {
      name: "a compatible stable candidate and current HQ permission update",
      policy: true,
      protocol: 1,
      compatible: true,
      phase: "idle",
      failed: undefined,
      available: true,
      expected: true,
    },
    {
      name: "unknown HQ policy postpones",
      policy: undefined,
      protocol: 1,
      compatible: true,
      phase: "idle",
      available: true,
      expected: false,
    },
    {
      name: "an organization hold postpones",
      policy: false,
      protocol: 1,
      compatible: true,
      phase: "idle",
      available: true,
      expected: false,
    },
    {
      name: "old zcp needs an attended restart",
      policy: true,
      protocol: undefined,
      compatible: true,
      phase: "idle",
      available: true,
      expected: false,
    },
    {
      name: "incompatible release needs confirmation",
      policy: true,
      protocol: 1,
      compatible: false,
      phase: "idle",
      available: true,
      expected: false,
    },
    {
      name: "a failed version is skipped",
      policy: true,
      protocol: 1,
      compatible: true,
      phase: "postponed",
      failed: "0.15.0",
      available: true,
      expected: false,
    },
    {
      name: "a newer release can follow a failed candidate",
      policy: true,
      protocol: 1,
      compatible: true,
      phase: "postponed",
      failed: "0.14.9",
      available: true,
      expected: true,
    },
    {
      name: "an accepted update is not launched twice",
      policy: true,
      protocol: 1,
      compatible: true,
      phase: "draining",
      available: true,
      expected: false,
    },
    {
      name: "no available candidate does nothing",
      policy: true,
      protocol: 1,
      compatible: true,
      phase: "idle",
      available: false,
      expected: false,
    },
  ])("$name", ({ policy, protocol, compatible, phase, failed, available, expected }) => {
    expect(
      mayAutoUpdate({
        enabled: policy,
        latest: "0.15.0",
        available,
        updater:
          protocol === undefined
            ? undefined
            : {
                protocol,
                rollbackCompatible: compatible,
                phase,
                runningVersion: "0.14.8",
                ...(failed === undefined ? {} : { failedVersion: failed }),
              },
      }),
    ).toBe(expected);
  });
});

describe("automatic restarts for a Mate only a restart gets current", () => {
  const reading = restartReading({
    installed: "0.15.200",
    zcp: { installed: "9.225.0", latest: "9.226.0" },
  });
  it.each([
    {
      name: "the organization allows it",
      enabled: true,
      restartedFor: undefined,
      underWay: false,
      expected: true,
    },
    {
      name: "unknown HQ policy postpones",
      enabled: undefined,
      restartedFor: undefined,
      underWay: false,
      expected: false,
    },
    {
      name: "an organization hold postpones",
      enabled: false,
      restartedFor: undefined,
      underWay: false,
      expected: false,
    },
    {
      name: "a restart under way is not asked again",
      enabled: true,
      restartedFor: undefined,
      underWay: true,
      expected: false,
    },
    {
      name: "a container already restarted for this reading is not restarted again",
      enabled: true,
      restartedFor: reading,
      underWay: false,
      expected: false,
    },
    {
      name: "a restart for an older reading does not hold a newer one",
      enabled: true,
      restartedFor: "zcp 9.224.0 -> 9.225.0; mate 0.15.200",
      underWay: false,
      expected: true,
    },
  ])("$name", ({ enabled, restartedFor, underWay, expected }) => {
    expect(mayAutoRestart({ enabled, restartNeeded: true, reading, restartedFor, underWay })).toBe(
      expected,
    );
  });
});

describe("one reading of zcp", () => {
  it("zcp's versions read the same with or without a leading v", () => {
    expect(
      restartReading({ installed: "0.15.200", zcp: { installed: "v9.225.0", latest: "v9.226.0" } }),
    ).toBe(
      restartReading({ installed: "0.15.200", zcp: { installed: "9.225.0", latest: "9.226.0" } }),
    );
  });
});
