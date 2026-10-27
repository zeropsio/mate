import { describe, expect, it } from "vite-plus/test";

import { personMark } from "./person.logic";

describe("personMark — one person, one mark, wherever they appear", () => {
  it.each([
    { case: "a full name", name: "Petra Malá", letter: "P" },
    { case: "the first name alone", name: "Petra", letter: "P" },
    { case: "a lower-case name", name: "eva dvořák", letter: "E" },
    { case: "a name with spaces around it", name: "  Jan Beneš ", letter: "J" },
  ])("draws $case with one letter", ({ name, letter }) => {
    expect(personMark({ name }).letter).toBe(letter);
  });

  it("gives the same person the same hue whether a surface names them in full or by first name", () => {
    expect(personMark({ name: "Petra" }).hue).toBe(personMark({ name: "Petra Malá" }).hue);
    expect(personMark({ name: "petra malá" }).hue).toBe(personMark({ name: "Petra Malá" }).hue);
  });

  it("tells people apart by their hue", () => {
    const hues = new Set(
      ["Petra", "Jan", "Eva", "Tomáš", "Dana"].map((name) => personMark({ name }).hue),
    );
    expect(hues.size).toBeGreaterThanOrEqual(4);
  });

  it.each([
    { case: "a picture", picture: "https://cdn/petra.png", expected: "https://cdn/petra.png" },
    { case: "no picture", picture: null, expected: null },
    { case: "an empty picture", picture: " ", expected: null },
  ])("keeps $case as the person's picture", ({ picture, expected }) => {
    expect(personMark({ name: "Petra", picture }).picture).toBe(expected);
  });
});
