import { describe, expect, it } from "vite-plus/test";

import { type HqOfferState, type HqOffers, hqOffer } from "./hqOffers.ts";

describe("hqOffer", () => {
  it.each<[string, HqOffers | undefined, string, HqOfferState]>([
    ["an allow", { merge_change: { allow: true } }, "merge_change", { kind: "allowed" }],
    [
      "a refusal, with HQ's reason",
      { release: { allow: false, reason: "not_releaser" } },
      "release",
      { kind: "refused", reason: "not_releaser" },
    ],
    [
      "a reason this build does not know, by itself",
      { release: { allow: false, reason: "later_reason" } },
      "release",
      { kind: "refused", reason: "later_reason" },
    ],
    ["no record yet", undefined, "release", { kind: "unknown" }],
    ["a verb HQ did not answer", { release: { allow: true } }, "redeploy", { kind: "unknown" }],
  ])("%s", (_, can, verb, expected) => {
    expect(hqOffer(can, verb)).toEqual(expected);
  });
});
