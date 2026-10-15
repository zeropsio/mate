import { describe, expect, it } from "vite-plus/test";

import { draftHeroProjectName } from "./DraftHeroHeadline.logic";

describe("draftHeroProjectName", () => {
  it.each([
    {
      name: "A Mate's new conversation names its Zerops project, never its workspace's title",
      mateProject: "Recipe Box",
      activeProjectTitle: "Fen",
      expected: "Recipe Box",
    },
    {
      name: "A Mate's new conversation names its project before its workspace is read",
      mateProject: "Recipe Box",
      activeProjectTitle: null,
      expected: "Recipe Box",
    },
    {
      name: "A conversation nobody lives in names the project the header names",
      mateProject: undefined,
      activeProjectTitle: "docs",
      expected: "docs",
    },
    {
      name: "Nothing is named while neither is known",
      mateProject: undefined,
      activeProjectTitle: null,
      expected: null,
    },
  ])("$name", ({ mateProject, activeProjectTitle, expected }) => {
    expect(draftHeroProjectName({ mateProject, activeProjectTitle })).toBe(expected);
  });
});
