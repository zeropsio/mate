import { describe, expect, it } from "vite-plus/test";
import { releaseNavigationOffer } from "./releaseNavigation.ts";

const candidate = {
  head: "a".repeat(40),
  suggestion: "v0.1.1",
  summary: { subjects: ["Make the bakery greeting dynamic"], total: 1, more: 0, atLeast: false },
};
const ready = { permission: { allow: true }, hasProduction: true, inFlight: null } as const;

describe("HQ navigation release offer", () => {
  it.each([
    ["landed code", candidate, ready, { allow: true }],
    [
      "no production",
      candidate,
      { ...ready, hasProduction: false },
      { allow: false, reason: "There is no production to release to." },
    ],
    [
      "person refused",
      candidate,
      { ...ready, permission: { allow: false, reason: "production_not_writable" } },
      { allow: false, reason: "production_not_writable" },
    ],
    [
      "accepted release",
      candidate,
      { ...ready, inFlight: "v0.1.1" },
      { allow: false, reason: "Releasing v0.1.1…" },
    ],
    [
      "production caught up",
      { ...candidate, summary: { ...candidate.summary, total: 0 } },
      ready,
      { allow: false, reason: "Production already runs what is merged." },
    ],
    [
      "no recipe head",
      { ...candidate, head: null },
      ready,
      { allow: false, reason: "Nothing is merged to release." },
    ],
  ] as const)("%s", (_label, source, input, gate) => {
    const offer = releaseNavigationOffer(source, input);
    expect(offer).toEqual({ ...source, gate, inFlight: input.inFlight });
  });
  it("does not invent a release from incomplete source coverage", () => {
    expect(releaseNavigationOffer(null, ready)).toBeNull();
  });
});
