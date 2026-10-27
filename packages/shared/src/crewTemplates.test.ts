import { describe, expect, it } from "@effect/vitest";

import {
  parseCrewHome,
  renderCrewHome,
  validateCrewTopology,
  withSharedDatabase,
  type CrewDefinition,
} from "./crewHome.ts";
import { crewFromProposal, crewFromTemplate } from "./crewTemplates.ts";

describe("crewFromTemplate", () => {
  it.each([
    {
      template: "lead-and-builders",
      members: [
        ["lead", "lead", undefined],
        ["builder-1", "writer", "appdev"],
        ["builder-2", "writer", "webdev"],
      ],
    },
    { template: "empty", members: [] },
  ] as const)("$template writes a crew home that stands as it is", ({ template, members }) => {
    const definition = crewFromTemplate({
      template,
      crew: "crew",
      devHosts: ["appdev", "webdev"],
      mateTint: "coral",
    });

    expect(definition.members.map((m) => [m.handle, m.kind, m.host])).toEqual(members);
    const parsed = parseCrewHome("crew", renderCrewHome(definition));
    expect(parsed).toEqual({ definition, issues: [] });
    expect(
      validateCrewTopology(definition, { devHosts: ["appdev", "webdev"], databaseHosts: [] }),
    ).toEqual([]);
  });

  it("gives every crewmate its own tint and never the Mate's", () => {
    const definition = crewFromTemplate({
      template: "lead-and-builders",
      crew: "crew",
      devHosts: ["appdev"],
      mateTint: "amber",
    });

    const tints = definition.members.map((member) => member.tint);
    expect(new Set(tints).size).toBe(tints.length);
    expect(tints).not.toContain("amber");
    expect(
      definition.members.every((member) => member.host === undefined || member.host === "appdev"),
    ).toBe(true);
  });

  it.each([
    { mateTint: "amber", tints: ["violet", "sky", "coral"] },
    { mateTint: "violet", tints: ["sky", "coral", "olive"] },
    { mateTint: "coral", tints: ["violet", "sky", "olive"] },
  ] as const)(
    "draws the lead in violet and the builders in sky and coral, stepping past $mateTint",
    ({ mateTint, tints }) => {
      const definition = crewFromTemplate({
        template: "lead-and-builders",
        crew: "crew",
        devHosts: [],
        mateTint,
      });
      expect(definition.members.map((member) => member.tint)).toEqual(tints);
    },
  );

  it("opens each job with the line the person reads, in the person's words", () => {
    const definition = crewFromTemplate({
      template: "lead-and-builders",
      crew: "crew",
      devHosts: [],
    });
    expect(definition.members.map((member) => member.job.split("\n")[0])).toEqual([
      "Plans the work and splits it between the crew.",
      "Builds its part of the work.",
      "Builds its part of the work.",
    ]);
  });
});

describe("crewFromProposal", () => {
  const proposal = {
    lead: { name: "Lead", part: "Plans the tea shop and splits the work." },
    builders: [
      { name: "Checkout", part: "Builds the checkout and its payment step." },
      { name: "Catalog", part: "Builds the tea catalog and its search." },
    ],
  };

  it("writes a proposed crew home that stands as it is", () => {
    const definition = crewFromProposal({
      proposal,
      crew: "crew",
      devHosts: ["appdev", "webdev"],
      mateTint: "coral",
    });

    expect(definition.members.map((m) => [m.handle, m.displayName, m.kind, m.host])).toEqual([
      ["lead", "Lead", "lead", undefined],
      ["checkout", "Checkout", "writer", "appdev"],
      ["catalog", "Catalog", "writer", "webdev"],
    ]);
    expect(parseCrewHome("crew", renderCrewHome(definition))).toEqual({ definition, issues: [] });
    expect(
      validateCrewTopology(definition, { devHosts: ["appdev", "webdev"], databaseHosts: [] }),
    ).toEqual([]);
  });

  it("opens each proposed job with its part, the line the person reads", () => {
    const definition = crewFromProposal({ proposal, crew: "crew", devHosts: [] });
    expect(definition.members.map((member) => member.job.split("\n")[0])).toEqual([
      "Plans the tea shop and splits the work.",
      "Builds the checkout and its payment step.",
      "Builds the tea catalog and its search.",
    ]);
    // What a lead and a builder are told past that line is the starting crew's.
    expect(definition.members[0]?.job).toContain("You read and plan; you never change files.");
    expect(definition.members[1]?.job).toContain("Build what your task asks.");
  });

  it.each([
    [
      ["Checkout & Payments", "Search"],
      ["checkout-payments", "search"],
    ],
    [
      ["Café Menu", "API"],
      ["caf-menu", "api"],
    ],
    [
      ["Front end", "Front-end!"],
      ["front-end", "front-end-2"],
    ],
    [
      ["★★★", "A very long name for one crewmate"],
      ["crewmate", "a-very-long-name-for"],
    ],
  ])("gives %j handles %j, each once", (names, handles) => {
    const definition = crewFromProposal({
      proposal: {
        lead: { name: "Lead", part: "Plans it." },
        builders: names.map((name) => ({ name, part: "Builds it." })),
      },
      crew: "crew",
      devHosts: [],
    });
    expect(definition.members.slice(1).map((member) => member.handle)).toEqual(handles);
  });
});

describe("a crew set up on a service with a database", () => {
  const proposal = {
    lead: { name: "Planner", part: "Plans the Shop Front and splits the work." },
    builders: [
      { name: "Accounts", part: "Builds the accounts and their sign-in." },
      { name: "Favourites", part: "Builds the favourites list." },
    ],
  };
  const topology = { devHosts: ["appdev"], databaseHosts: ["appdev"] };
  const sharing = (definition: CrewDefinition) =>
    definition.members.map((member) => [member.handle, member.database]);

  it("a crew set up from a proposal on a service with a database starts, its builders sharing that database", () => {
    const definition = crewFromProposal({
      proposal,
      crew: "crew",
      devHosts: ["appdev"],
      databaseHosts: ["appdev"],
    });
    expect(sharing(definition)).toEqual([
      ["planner", undefined],
      ["accounts", "shared"],
      ["favourites", "shared"],
    ]);
    expect(validateCrewTopology(definition, topology)).toEqual([]);
    expect(parseCrewHome("crew", renderCrewHome(definition))).toEqual({ definition, issues: [] });
  });

  it("a crew set up as a lead and two builders on a service with a database starts, its builders sharing that database", () => {
    const definition = crewFromTemplate({
      template: "lead-and-builders",
      crew: "crew",
      devHosts: ["appdev"],
      databaseHosts: ["appdev"],
    });
    expect(sharing(definition)).toEqual([
      ["lead", undefined],
      ["builder-1", "shared"],
      ["builder-2", "shared"],
    ]);
    expect(validateCrewTopology(definition, topology)).toEqual([]);
  });

  it("a crew set up on a service without a database says nothing of one", () => {
    const definition = crewFromProposal({
      proposal,
      crew: "crew",
      devHosts: ["appdev", "webdev"],
      databaseHosts: ["webdev"],
    });
    expect(sharing(definition)).toEqual([
      ["planner", undefined],
      ["accounts", undefined],
      ["favourites", "shared"],
    ]);
  });

  it("a builder added by hand on a service with a database shares it, and one with its own env keeps it", () => {
    const base = crewFromTemplate({ template: "empty", crew: "crew", devHosts: ["appdev"] });
    const builder = (handle: string, env: Record<string, string>) => ({
      handle,
      displayName: handle,
      kind: "writer" as const,
      readOnly: false,
      host: "appdev",
      restartAfterMerge: false,
      afterLandRestart: false,
      env,
      migrations: [],
      job: "Builds it.\n",
    });
    const definition = {
      ...base,
      members: [builder("tea-page", {}), builder("orders", { DATABASE_URL: "postgres://own" })],
    };

    const declared = withSharedDatabase(definition, ["appdev"]);
    expect(sharing(declared)).toEqual([
      ["tea-page", "shared"],
      ["orders", undefined],
    ]);
    expect(validateCrewTopology(declared, topology)).toEqual([]);
    // Nothing left to declare: the same crew, so nothing is written again.
    expect(withSharedDatabase(declared, ["appdev"])).toBe(declared);
    expect(withSharedDatabase(definition, [])).toBe(definition);
  });
});
