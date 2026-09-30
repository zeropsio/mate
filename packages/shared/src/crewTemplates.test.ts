import { describe, expect, it } from "@effect/vitest";

import { parseCrewHome, renderCrewHome, validateCrewTopology } from "./crewHome.ts";
import { crewFromTemplate } from "./crewTemplates.ts";

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
      "Builds its part of the work, in its own copy of the code.",
      "Builds its part of the work, in its own copy of the code.",
    ]);
  });
});
