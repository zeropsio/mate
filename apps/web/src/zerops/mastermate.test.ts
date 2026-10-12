import { describe, expect, it } from "vite-plus/test";

import { isMastermate, mastermateQuestion } from "./mastermate";

describe("isMastermate", () => {
  it.each([
    { tagList: ["mate", "mastermate"], expected: true },
    { tagList: ["mate"], expected: false },
    { tagList: [], expected: false },
    { tagList: undefined, expected: false },
  ])("a project tagged $tagList is a Mastermate's: $expected", ({ tagList, expected }) => {
    expect(isMastermate({ tagList })).toBe(expected);
  });
});

describe("mastermateQuestion", () => {
  it("asks about the organization, never the Mastermate's own project", () => {
    expect(mastermateQuestion("Mastermate", "Acme Ltd")).toBe(
      "What should Mastermate look into across Acme Ltd?",
    );
  });

  it("says your organization while its name is not known", () => {
    expect(mastermateQuestion("Mastermate", undefined)).toBe(
      "What should Mastermate look into across your organization?",
    );
  });
});
