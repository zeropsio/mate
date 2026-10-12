import { describe, expect, it } from "vite-plus/test";

import {
  chiefNames,
  chiefQuestion,
  chiefSetupLine,
  isChief,
  othersChiefs,
  ownChiefAmong,
  type OwnChief,
} from "./chief";

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

describe("whose Chief", () => {
  const own = { id: "p-own", tagList: ["mate", "chief"] };
  const theirs = { id: "p-theirs", tagList: ["mate", "chief"] };
  const shop = { id: "p-shop", tagList: ["mate"] };

  it.each<[string, OwnChief, ReadonlyArray<string>]>([
    ["the viewer's own Chief shows, every other person's is hidden", "p-own", ["p-theirs"]],
    ["with no Chief of their own, every Chief is someone else's", null, ["p-own", "p-theirs"]],
    [
      "while whose is not known, no Chief shows, so none is taken back",
      undefined,
      ["p-own", "p-theirs"],
    ],
  ])("%s", (_title, ownChief, hidden) => {
    expect([...othersChiefs([own, theirs, shop], ownChief)].toSorted()).toEqual(hidden);
  });

  it.each<[string, OwnChief, string | undefined]>([
    ["the menu's top row is the viewer's own Chief", "p-own", "p-own"],
    [
      "a project HQ names as the viewer's Chief is theirs even before its tag is read",
      "p-shop",
      "p-shop",
    ],
    ["someone else's Chief is never the top row", null, undefined],
    ["nothing is the top row while whose is not known", undefined, undefined],
    ["a Chief HQ names but the listing does not hold yet is not drawn", "p-gone", undefined],
  ])("%s", (_title, ownChief, expected) => {
    const candidates = [own, theirs, shop].map((project) => ({ project }));
    expect(ownChiefAmong(candidates, ownChief)?.project.id).toBe(expected);
  });
});

describe("chiefNames", () => {
  it.each<[string, Parameters<typeof chiefNames>[0], string]>([
    [
      "the person's first name",
      { firstName: "Aleš", fullName: "Aleš R", email: "a@x.io" },
      "Chief · Aleš",
    ],
    [
      "the first word of the full name without a first name",
      { fullName: "Jan Novak", email: "j@x.io" },
      "Chief · Jan",
    ],
    ["the address's name without any name", { email: "karlos@zerops.io" }, "Chief · karlos"],
    ["the Chief alone without anybody signed in", null, "Chief"],
  ])("names the project after %s", (_title, user, name) => {
    expect(chiefNames(user)).toEqual({ name, botName: "Chief" });
  });
});

describe("chiefSetupLine", () => {
  it.each<[string, Parameters<typeof chiefSetupLine>[0], ReturnType<typeof chiefSetupLine>]>([
    [
      "offers to set one up where the person has none",
      { own: null, mayCreate: true, setup: "idle" },
      "offer",
    ],
    ["offers nothing to a person who has one", { own: "p", mayCreate: true, setup: "idle" }, null],
    [
      "offers nothing while whose Chief is not known",
      { own: undefined, mayCreate: true, setup: "idle" },
      null,
    ],
    [
      "offers nothing where the person may not make its project",
      { own: null, mayCreate: false, setup: "idle" },
      null,
    ],
    [
      "says one is being set up while it runs",
      { own: null, mayCreate: true, setup: "running" },
      "running",
    ],
    [
      "says the setup stopped, to be tried again",
      { own: "p", mayCreate: true, setup: "failed" },
      "stopped",
    ],
    ["says nothing once it is set up", { own: "p", mayCreate: true, setup: "done" }, null],
  ])("%s", (_title, input, line) => {
    expect(chiefSetupLine(input)).toBe(line);
  });
});
