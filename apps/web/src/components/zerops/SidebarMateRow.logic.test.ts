import { describe, expect, it } from "vite-plus/test";

import { changeMarkTone, ownerMark } from "./SidebarMateRow.logic";

describe("ownerMark — whose Mate it is, as a 16 px mark before its name", () => {
  it.each([
    {
      case: "a person with a picture",
      owner: { name: "Petra Malá", initials: "PM", avatarUrl: "https://cdn/petra.png" },
      initial: "P",
      picture: "https://cdn/petra.png",
    },
    {
      case: "a person without one",
      owner: { name: "Jan Beneš", initials: "JB", avatarUrl: null },
      initial: "J",
      picture: null,
    },
    {
      case: "a picture that is an empty string",
      owner: { name: "Eva Dvořák", initials: "ed", avatarUrl: "" },
      initial: "E",
      picture: null,
    },
  ])("draws $case", ({ owner, initial, picture }) => {
    expect(ownerMark(owner)).toMatchObject({
      initial,
      picture,
      label: `${owner.name}'s Mate`,
    });
  });

  it("gives one person one hue, every time, on the colour wheel", () => {
    const petra = { name: "Petra Malá", initials: "PM", avatarUrl: null };
    const hue = ownerMark(petra).hue;
    expect(ownerMark(petra).hue).toBe(hue);
    expect(Number.isInteger(hue)).toBe(true);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it("tells people apart by their hue", () => {
    const hues = new Set(
      ["Petra Malá", "Jan Beneš", "Eva Dvořák", "Aleš Rechtorik", "Karlos Mika"].map(
        (name) => ownerMark({ name, initials: name.slice(0, 1), avatarUrl: null }).hue,
      ),
    );
    expect(hues.size).toBeGreaterThanOrEqual(4);
  });
});

describe("changeMarkTone — the one colour a change row's mark may wear", () => {
  const change = (overrides: Partial<Parameters<typeof changeMarkTone>[0]> = {}) => ({
    number: 4,
    mergeability: "mergeable" as const,
    checks: "passing" as const,
    ...overrides,
  });
  // Amber is "didn't go through", red is "broken" (S3); everything else is
  // the mark's own grey — the verdict itself lives in the review.
  it.each([
    { case: "merges, checks passing", pull: change(), tone: undefined },
    { case: "merges, no checks", pull: change({ checks: "none" }), tone: undefined },
    { case: "merges, checks running", pull: change({ checks: "pending" }), tone: undefined },
    { case: "merges, checks failing", pull: change({ checks: "failing" }), tone: "failed" },
    {
      case: "behind main",
      pull: change({ mergeability: "conflicting", checks: "passing" }),
      tone: "attention",
    },
    {
      case: "behind main, checks failing",
      pull: change({ mergeability: "conflicting", checks: "failing" }),
      tone: "failed",
    },
    {
      case: "behind main, checks running",
      pull: change({ mergeability: "conflicting", checks: "pending" }),
      tone: undefined,
    },
    { case: "Gitea still checking", pull: change({ mergeability: "checking" }), tone: undefined },
  ] as const)("$case: $tone", ({ pull, tone }) => {
    expect(changeMarkTone(pull, false)).toBe(tone);
  });

  it("says nothing for a change drawn from memory: its verdict is Gitea's to say again", () => {
    expect(changeMarkTone(change({ checks: "failing" }), true)).toBeUndefined();
  });
});
