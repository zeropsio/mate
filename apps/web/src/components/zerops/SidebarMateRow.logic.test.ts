import { describe, expect, it } from "vite-plus/test";

import { ownerMark } from "./SidebarMateRow.logic";

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
