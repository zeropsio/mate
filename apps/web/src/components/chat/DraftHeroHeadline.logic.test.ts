import { describe, expect, it } from "vite-plus/test";

import { draftHeroNoProject, draftHeroProjectName } from "./DraftHeroHeadline.logic";

describe("draftHeroProjectName", () => {
  it.each([
    {
      name: "A Mate's new conversation names its Zerops project, never its workspace's title",
      mateProject: "Shop Front",
      activeProjectTitle: "Fen",
      expected: "Shop Front",
    },
    {
      name: "A Mate's new conversation names its project before its workspace is read",
      mateProject: "Shop Front",
      activeProjectTitle: null,
      expected: "Shop Front",
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

describe("draftHeroNoProject", () => {
  it.each([
    {
      role: "a role that may create projects",
      may: true,
      words: "Add a project to start",
      door: true,
    },
    { role: "a role that may not", may: false, words: "No project to start in yet", door: false },
  ])(
    "With no project to pick, $role is offered New project only where it may make one",
    ({ may, words, door }) => {
      expect(draftHeroNoProject(may)).toEqual({ words, offersNewProject: door });
    },
  );
});
