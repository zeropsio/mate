/**
 * What HQ offers the reader of an application (`can`), as the flow draws it: allowed as HQ decided,
 * refused in HQ's words, and nothing said where HQ has not said it.
 */
import { hqOffer } from "@t3tools/shared/hqOffers";
import { describe, expect, it } from "vite-plus/test";

import { releaseGateOf, type OfferReading } from "./appOffers";

const LIVE: OfferReading = {
  state: (can, verb) => hqOffer(can, verb, { current: true, unavailableSince: null }),
  words: (state) =>
    state.kind === "refused"
      ? `HQ: ${state.reason}`
      : state.kind === "unknown"
        ? "unsaid"
        : undefined,
};
const DOWN: OfferReading = {
  ...LIVE,
  state: (can, verb) => hqOffer(can, verb, { current: false, unavailableSince: 5 }),
  words: () => "HQ unavailable",
};

describe("releaseGateOf", () => {
  it.each([
    { name: "an application HQ never named", reading: LIVE, can: undefined, gate: undefined },
    {
      name: "HQ's offer",
      reading: LIVE,
      can: { release: { allow: true } },
      gate: { allowed: true },
    },
    {
      name: "HQ's refusal, in its words",
      reading: LIVE,
      can: { release: { allow: false, reason: "not_releaser" } },
      gate: { allowed: false, reason: "HQ: not_releaser", refusedBy: "hq" },
    },
    { name: "HQ not saying", reading: LIVE, can: {}, gate: { allowed: false, reason: "unsaid" } },
    {
      name: "HQ not answering",
      reading: DOWN,
      can: { release: { allow: true } },
      gate: { allowed: false, reason: "HQ unavailable" },
    },
  ])("reads $name", ({ reading, can, gate }) => {
    expect(releaseGateOf(reading, can)).toEqual(gate);
  });
});
