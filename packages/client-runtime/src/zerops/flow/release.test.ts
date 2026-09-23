import { describe, expect, it } from "vite-plus/test";

import type { ReleaseGate } from "../release.ts";
import { CHECKING_RELEASE, flowReleaseGate } from "./release.ts";

describe("flowReleaseGate", () => {
  const OPEN: ReleaseGate = { allowed: true };
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly halves: { readonly deploys: boolean; readonly forge: boolean };
    readonly expected: ReleaseGate;
  }> = [
    { name: "both halves read", halves: { deploys: true, forge: true }, expected: OPEN },
    {
      // Without the tags, the suggested name could be one that already exists.
      name: "the forge half not read yet",
      halves: { deploys: true, forge: false },
      expected: { allowed: false, reason: CHECKING_RELEASE },
    },
    {
      // Without what production runs, "nothing to release" would be a guess.
      name: "the deploy half not read yet",
      halves: { deploys: false, forge: true },
      expected: { allowed: false, reason: CHECKING_RELEASE },
    },
  ];

  it.each(cases)("$name", ({ halves, expected }) => {
    expect(flowReleaseGate(OPEN, halves)).toEqual(expected);
  });

  it("keeps the offer's own refusal once both halves are read", () => {
    const refused: ReleaseGate = { allowed: false, reason: "Only releasers can tag." };
    expect(flowReleaseGate(refused, { deploys: true, forge: true })).toBe(refused);
  });
});
