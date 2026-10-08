import { describe, expect, it } from "@effect/vitest";
import { mayAutoUpdate } from "./mateAutoUpdate.logic.ts";

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
