import { describe, expect, it } from "@effect/vitest";
import { updateBootPending } from "./mateUpdateBoot.ts";
describe("crash-safe update boot admission", () => {
  it.each([
    ["staging", false],
    ["draining", false],
    ["switching", true],
    ["verifying", true],
    ["updated", false],
    ["postponed", false],
    ["failed", false],
    ["idle", false],
  ])("%s holds admission: %s", (phase, pending) =>
    expect(updateBootPending({ protocol: 1, phase, candidate: "2", previous: "1" })).toBe(pending),
  );
  it.each([
    null,
    {},
    { protocol: 1, phase: "swiching" },
    { protocol: 2, phase: "switching", candidate: "2", previous: "1" },
    { protocol: 1, phase: "switching", candidate: "2" },
    { protocol: 1, phase: "verifying", candidate: "", previous: "1" },
  ])("damaged switch state %j fails closed", (state) =>
    expect(() => updateBootPending(state)).toThrow(),
  );
});
