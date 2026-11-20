import { describe, expect, it } from "vite-plus/test";

import {
  chiefNames,
  chiefQuestion,
  chiefSetupLine,
  isChief,
} from "@t3tools/client-runtime/zerops/chief";

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
    expect(chiefQuestion("Chief", "Acme Ltd")).toBe("What should Chief look into across Acme Ltd?");
  });

  it("says your organization while its name is not known", () => {
    expect(chiefQuestion("Chief", undefined)).toBe(
      "What should Chief look into across your organization?",
    );
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
