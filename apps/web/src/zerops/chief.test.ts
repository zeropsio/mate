import { describe, expect, it } from "vite-plus/test";

import { isChief, chiefQuestion } from "./chief";

describe("isChief", () => {
  it.each([
    { tagList: ["mate", "chief"], expected: true },
    { tagList: ["mate"], expected: false },
    { tagList: [], expected: false },
    { tagList: undefined, expected: false },
  ])("a project tagged $tagList is a Chief's: $expected", ({ tagList, expected }) => {
    expect(isChief({ tagList })).toBe(expected);
  });
});

describe("chiefQuestion", () => {
  it("asks about the organization, never the Chief's own project", () => {
    expect(chiefQuestion("Chief", "Acme Ltd")).toBe(
      "What should Chief look into across Acme Ltd?",
    );
  });

  it("says your organization while its name is not known", () => {
    expect(chiefQuestion("Chief", undefined)).toBe(
      "What should Chief look into across your organization?",
    );
  });
});
