import { describe, expect, it } from "vite-plus/test";

import type { ReleaseGate } from "../release.ts";
import { CHECKING_RELEASE, flowReleaseGate, type FlowHalf } from "./release.ts";

describe("flowReleaseGate", () => {
  const OPEN: ReleaseGate = { allowed: true };
  const FAILED: FlowHalf = { failed: "Gitea did not answer" };
  const CANT_CHECK: ReleaseGate = {
    allowed: false,
    reason: "Can't check what can be released: Gitea did not answer.",
  };
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly halves: { readonly deploys: FlowHalf; readonly forge: FlowHalf };
    readonly expected: ReleaseGate;
  }> = [
    { name: "both halves read", halves: { deploys: "read", forge: "read" }, expected: OPEN },
    {
      // Without the tags, the suggested name could be one that already exists.
      name: "the forge half not read yet",
      halves: { deploys: "read", forge: "unread" },
      expected: { allowed: false, reason: CHECKING_RELEASE },
    },
    {
      // Without what production runs, "nothing to release" would be a guess.
      name: "the deploy half not read yet",
      halves: { deploys: "unread", forge: "read" },
      expected: { allowed: false, reason: CHECKING_RELEASE },
    },
    {
      // A read that keeps failing is not still checking: it says why, and never forever "Checking".
      name: "the deploy half failed",
      halves: { deploys: FAILED, forge: "read" },
      expected: CANT_CHECK,
    },
    {
      name: "the forge half failed while the deploy half is still unread",
      halves: { deploys: "unread", forge: FAILED },
      expected: CANT_CHECK,
    },
  ];

  it.each(cases)("$name", ({ halves, expected }) => {
    expect(flowReleaseGate(OPEN, halves)).toEqual(expected);
  });

  it("keeps the offer's own refusal once both halves are read", () => {
    const refused: ReleaseGate = { allowed: false, reason: "Only releasers can tag." };
    expect(flowReleaseGate(refused, { deploys: "read", forge: "read" })).toBe(refused);
  });
});
