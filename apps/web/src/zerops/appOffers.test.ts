/**
 * What HQ offers the reader of an application (`can`), as the flow draws it: allowed as HQ decided,
 * refused in HQ's words, and nothing said where HQ has not said it.
 */
import { describe, expect, it } from "vite-plus/test";

import { releaseGateOf } from "./appOffers";

describe("a release the merge limit holds", () => {
  // witness: apps/web/src/zerops/appOffers.ts | reason: hqMergeOfferWords(offer, mergers, nameOf) ?? "", → reason: "",
  it("A release to Git held by the project's merge limit says who merges, as the held Merge does", () => {
    const names: Readonly<Record<string, string>> = { "u-ada": "Ada K.", "u-sam": "Sam R." };
    expect(
      releaseGateOf(
        { release: { allow: false, reason: "not_app_merger" } },
        { mergers: { people: ["u-ada", "u-sam"] }, nameOf: (userId) => names[userId] },
      ),
    ).toEqual({
      allowed: false,
      reason: "Only Ada K., Sam R. and the organization's Owner and Admins merge here.",
      refusedBy: "hq",
    });
  });
});

describe("releaseGateOf", () => {
  it.each([
    { name: "an application HQ never named", can: undefined, gate: undefined },
    { name: "HQ's offer", can: { release: { allow: true } as const }, gate: { allowed: true } },
    {
      name: "HQ's refusal, in its words",
      can: { release: { allow: false, reason: "not_releaser" } as const },
      gate: {
        allowed: false,
        reason:
          "To release, this project needs a Zerops project, and you need more than Read access to its production.",
        refusedBy: "hq",
      },
    },
    { name: "HQ not saying", can: {}, gate: { allowed: false, reason: "HQ has not said yet." } },
  ])("reads $name", ({ can, gate }) => {
    expect(releaseGateOf(can)).toEqual(gate);
  });
});
