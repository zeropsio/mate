import { describe, expect, it } from "vite-plus/test";

import { nextHqStanding, type HqStanding } from "./accountHq";

describe("nextHqStanding", () => {
  const healthy = { kind: "healthy", build: "b1" } as const;
  const down = { kind: "unreachable" } as const;
  it.each<[string, HqStanding, Parameters<typeof nextHqStanding>[1], HqStanding]>([
    ["a first answer as the official HQ", { kind: "unknown" }, healthy, { kind: "healthy" }],
    [
      "a first read that fails: unavailable from now",
      { kind: "unknown" },
      down,
      { kind: "unavailable", since: 5_000 },
    ],
    [
      "an outage keeps the time it began",
      { kind: "unavailable", since: 1_000 },
      { kind: "not-ready", state: "standby", official: "unknown" },
      { kind: "unavailable", since: 1_000 },
    ],
    ["HQ back", { kind: "unavailable", since: 1_000 }, healthy, { kind: "healthy" }],
  ])("%s", (_name, previous, health, expected) => {
    expect(nextHqStanding(previous, health, 5_000)).toEqual(expected);
  });
});
