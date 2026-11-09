/**
 * What HQ offers the reader of an application (`can`), as the flow draws it: allowed as HQ decided,
 * refused in HQ's words, and nothing said where HQ has not said it.
 */
import { hqOffer } from "@t3tools/shared/hqOffers";
import { describe, expect, it } from "vite-plus/test";

import { releaseGateOf, type OfferReading } from "./appOffers";

const LIVE: OfferReading = {
  state: hqOffer,
  words: (state) =>
    state.kind === "refused"
      ? `HQ: ${state.reason}`
      : state.kind === "unknown"
        ? "unsaid"
        : undefined,
};

describe("releaseGateOf", () => {
  it.each([
    { name: "an application HQ never named", reading: LIVE, can: undefined, gate: undefined },
    {
      name: "HQ's offer",
      reading: LIVE,
      can: { release: { allow: true } as const },
      gate: { allowed: true },
    },
    {
      name: "HQ's refusal, in its words",
      reading: LIVE,
      can: { release: { allow: false, reason: "not_releaser" } as const },
      gate: { allowed: false, reason: "HQ: not_releaser", refusedBy: "hq" },
    },
    { name: "HQ not saying", reading: LIVE, can: {}, gate: { allowed: false, reason: "unsaid" } },
  ])("reads $name", ({ reading, can, gate }) => {
    expect(releaseGateOf(reading, can)).toEqual(gate);
  });
});
