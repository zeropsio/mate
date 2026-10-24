import { describe, expect, it } from "vite-plus/test";

import {
  chiefNames,
  chiefOffered,
  chiefQuestion,
  chiefSetupLine,
  chiefSetupEntry,
  hqOrgChief,
  isChief,
  othersChiefs,
  chiefAmong,
  type OrgChief,
  withoutChief,
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
    expect(chiefQuestion("Chief", "Acme Ltd")).toBe("What should Chief look into across Acme Ltd?");
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

  it.each<[string, OrgChief, ReadonlyArray<string>]>([
    ["the viewer's own Chief shows, every other person's is hidden", "p-own", ["p-theirs"]],
    ["with no Chief of their own, every Chief is someone else's", null, ["p-own", "p-theirs"]],
    [
      "while whose is not known, no Chief shows, so none is taken back",
      undefined,
      ["p-own", "p-theirs"],
    ],
  ])("%s", (_title, orgChief, hidden) => {
    expect([...othersChiefs([own, theirs, shop], orgChief)].toSorted()).toEqual(hidden);
  });

  it.each<[string, OrgChief, string | undefined]>([
    ["the menu's top row is the viewer's own Chief", "p-own", "p-own"],
    [
      "a project HQ names as the viewer's Chief is theirs even before its tag is read",
      "p-shop",
      "p-shop",
    ],
    ["someone else's Chief is never the top row", null, undefined],
    ["nothing is the top row while whose is not known", undefined, undefined],
    ["a Chief HQ names but the listing does not hold yet is not drawn", "p-gone", undefined],
  ])("%s", (_title, orgChief, expected) => {
    const candidates = [own, theirs, shop].map((project) => ({ project }));
    expect(chiefAmong(candidates, orgChief)?.project.id).toBe(expected);
  });

  it.each<[string, OrgChief, ReadonlyArray<string>]>([
    [
      "the menu's list leaves out the viewer's own Chief, drawn once as its top row",
      "p-own",
      ["p-theirs", "p-shop"],
    ],
    [
      "the menu's list keeps every Mate when the viewer has no Chief",
      null,
      ["p-own", "p-theirs", "p-shop"],
    ],
    [
      "the menu's list keeps every Mate while whose Chief is not known",
      undefined,
      ["p-own", "p-theirs", "p-shop"],
    ],
  ])("%s", (_title, orgChief, expected) => {
    const candidates = [own, theirs, shop].map((project) => ({ project }));
    expect(withoutChief(candidates, orgChief).map((candidate) => candidate.project.id)).toEqual(
      expected,
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

describe("Chief setup entry", () => {
  it.each([
    ["a no-Chief viewer sees the setup entry only after HQ has answered", true, {}, "idle", true],
    [
      "a viewer with a Chief never sees the setup entry",
      true,
      { chief: { chief: "org" } },
      "idle",
      false,
    ],
    ["unknown Chief state shows neither setup entry", false, {}, "idle", false],
    ["Chief setup keeps its running state", true, {}, "running", false],
    ["Chief setup keeps its failed state", true, {}, "failed", false],
    ["Chief setup keeps its coming state", true, {}, "done", false],
  ] as const)("%s", (_title, read, facts, setup, expected) => {
    expect(chiefSetupEntry(hqOrgChief(facts, read), setup)).toBe(expected);
  });
});

describe("the account menu's Chief offer", () => {
  const app = (...projectIds: ReadonlyArray<string>) => ({
    projects: projectIds.map((projectId) => ({ projectId })),
  });
  it.each<[string, Parameters<typeof chiefOffered>[0], boolean]>([
    [
      "is offered once the organization has a second project and the person may set one up",
      { entry: true, apps: [app("shop-prod", "shop-mate"), app("blog-prod")], chiefs: new Set() },
      true,
    ],
    [
      "is not offered while the organization has one project: a Chief is not useful yet",
      { entry: true, apps: [app("shop-prod", "shop-stage", "shop-mate")], chiefs: new Set() },
      false,
    ],
    [
      "does not count another person's Chief as a project",
      {
        entry: true,
        apps: [app("shop-prod"), app("chief-of-ola")],
        chiefs: new Set(["chief-of-ola"]),
      },
      false,
    ],
    [
      "is not offered to a person who has one, may not make one, or while that is not known",
      { entry: false, apps: [app("shop-prod"), app("blog-prod")], chiefs: new Set() },
      false,
    ],
    [
      "is not offered while the organization's projects are not read",
      { entry: true, apps: undefined, chiefs: new Set() },
      false,
    ],
  ])("%s", (_title, input, offered) => {
    expect(chiefOffered(input)).toBe(offered);
  });
});
