import { describe, expect, it } from "vite-plus/test";

import { type HqOfferState, hqOffer } from "./hqOffers.ts";

const LIVE = { current: true, unavailableSince: null } as const;

describe("hqOffer", () => {
  it.each<
    [string, unknown, string, { current: boolean; unavailableSince: number | null }, HqOfferState]
  >([
    ["an allow", { merge_change: { allow: true } }, "merge_change", LIVE, { kind: "allowed" }],
    [
      "a refusal, with HQ's reason",
      { release: { allow: false, reason: "not_releaser" } },
      "release",
      LIVE,
      { kind: "refused", reason: "not_releaser" },
    ],
    [
      "a reason this build does not know, by itself",
      { release: { allow: false, reason: "later_reason" } },
      "release",
      LIVE,
      { kind: "refused", reason: "later_reason" },
    ],
    ["no record yet", undefined, "release", LIVE, { kind: "unknown" }],
    [
      "a verb HQ did not answer",
      { release: { allow: true } },
      "redeploy",
      LIVE,
      { kind: "unknown" },
    ],
    [
      "a decision this build cannot read",
      { release: { allow: "yes" } },
      "release",
      LIVE,
      { kind: "unknown" },
    ],
    [
      "any verb while HQ does not answer, since when",
      { release: { allow: true } },
      "release",
      { current: false, unavailableSince: 1_000 },
      { kind: "unavailable", since: 1_000 },
    ],
    [
      "a stale record before HQ says it is gone",
      { release: { allow: true } },
      "release",
      { current: false, unavailableSince: null },
      { kind: "unknown" },
    ],
  ])("%s", (_, can, verb, hq, expected) => {
    expect(hqOffer(can as Record<string, unknown> | undefined, verb, hq)).toEqual(expected);
  });
});
