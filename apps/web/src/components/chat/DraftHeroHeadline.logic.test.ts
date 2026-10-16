import { describe, expect, it } from "vite-plus/test";

import {
  draftHeroHeadlineKind,
  draftHeroNoProject,
  draftHeroProjectName,
} from "./DraftHeroHeadline.logic";

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

describe("draftHeroHeadlineKind", () => {
  it.each([
    {
      name: "A conversation whose project is known asks what to do in it",
      resolved: true,
      inEnvironment: true,
      choosable: false,
      kind: "question",
    },
    {
      name: "A conversation in a Mate's environment whose project is still read says nothing yet, never that there is no project",
      resolved: false,
      inEnvironment: true,
      choosable: false,
      kind: "reading",
    },
    {
      name: "A conversation in a Mate's environment never offers a project picker while its own project is read",
      resolved: false,
      inEnvironment: true,
      choosable: true,
      kind: "reading",
    },
    {
      name: "A conversation in no environment offers the projects there are",
      resolved: false,
      inEnvironment: false,
      choosable: true,
      kind: "choose",
    },
    {
      name: "A conversation in no environment, with no project to pick, says there is none",
      resolved: false,
      inEnvironment: false,
      choosable: false,
      kind: "no-project",
    },
  ] as const)("$name", ({ resolved, inEnvironment, choosable, kind }) => {
    expect(
      draftHeroHeadlineKind({
        hasResolvedProject: resolved,
        inEnvironment,
        canChooseProject: choosable,
      }),
    ).toBe(kind);
  });
});
