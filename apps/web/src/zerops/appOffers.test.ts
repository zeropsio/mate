/**
 * What HQ offers the reader of an application (`can`), as the flow draws it: allowed as HQ decided,
 * refused in HQ's words, and nothing said where HQ has not said it.
 */
import { describe, expect, it } from "vite-plus/test";

import { releaseGateOf } from "@t3tools/client-runtime/zerops/appOffers";

describe("a release the merge limit holds", () => {
  // witness: packages/client-runtime/src/zerops/appOffers.ts | reason: hqMergeOfferWords(offer, mergers, nameOf, "release") ?? "", → reason: hqMergeOfferWords(offer, mergers, nameOf) ?? "",
  it("A release held by the project's merge limit says who releases, by name", () => {
    const names: Readonly<Record<string, string>> = { "u-ada": "Ada K.", "u-sam": "Sam R." };
    expect(
      releaseGateOf(
        { release: { allow: false, reason: "not_app_merger" } },
        { mergers: { people: ["u-ada", "u-sam"] }, nameOf: (userId) => names[userId] },
      ),
    ).toEqual({
      allowed: false,
      reason: "Only Ada K., Sam R. and the organization's Owner and Admins release here.",
      refusedBy: "hq",
    });
  });
});

describe("releaseGateOf", () => {
  // witness: packages/client-runtime/src/zerops/appOffers.ts | ...(offer.kind === "refused" ? { refusedBy: "hq" as const } : {}), →
  it.each([
    { name: "an application HQ never named", can: undefined, gate: undefined },
    { name: "HQ's offer", can: { release: { allow: true } as const }, gate: { allowed: true } },
    {
      name: "HQ's refusal, in its words",
      can: { release: { allow: false, reason: "not_releaser" } as const },
      gate: {
        allowed: false,
        reason: "You need more than Read access to production to release.",
        refusedBy: "hq",
      },
    },
    { name: "HQ not saying", can: {}, gate: { allowed: false, reason: "HQ has not said yet." } },
  ])("reads $name", ({ can, gate }) => {
    expect(releaseGateOf(can)).toEqual(gate);
  });
});
