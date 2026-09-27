import { describe, expect, it } from "@effect/vitest";

import { parseCrewHome, renderCrewHome, validateCrewTopology } from "./crewHome.ts";
import { crewFromTemplate } from "./crewTemplates.ts";

describe("crewFromTemplate", () => {
  it.each([
    {
      template: "feature-team",
      withLead: false,
      members: [
        ["builder-1", "writer", "appdev"],
        ["builder-2", "writer", "webdev"],
        ["reviewer", "reader", undefined],
      ],
    },
    {
      template: "feature-team",
      withLead: true,
      members: [
        ["lead", "lead", undefined],
        ["builder-1", "writer", "appdev"],
        ["builder-2", "writer", "webdev"],
        ["reviewer", "reader", undefined],
      ],
    },
    {
      template: "solo-reviewer",
      withLead: true,
      members: [
        ["builder", "writer", "appdev"],
        ["reviewer", "reader", undefined],
      ],
    },
    { template: "empty", withLead: true, members: [] },
  ] as const)(
    "$template (lead: $withLead) writes a crew home that applies as it is",
    ({ template, withLead, members }) => {
      const definition = crewFromTemplate({
        template,
        crew: "crew",
        devHosts: ["appdev", "webdev"],
        withLead,
        mateTint: "coral",
      });

      expect(definition.members.map((m) => [m.handle, m.kind, m.host])).toEqual(members);
      const parsed = parseCrewHome("crew", renderCrewHome(definition));
      expect(parsed).toEqual({ definition, issues: [] });
      expect(
        validateCrewTopology(definition, { devHosts: ["appdev", "webdev"], databaseHosts: [] }),
      ).toEqual([]);
    },
  );

  it("gives every crewmate its own tint and never the Mate's", () => {
    const definition = crewFromTemplate({
      template: "feature-team",
      crew: "crew",
      devHosts: ["appdev"],
      withLead: true,
      mateTint: "amber",
    });

    const tints = definition.members.map((member) => member.tint);
    expect(new Set(tints).size).toBe(tints.length);
    expect(tints).not.toContain("amber");
    expect(
      definition.members.every((member) => member.host === undefined || member.host === "appdev"),
    ).toBe(true);
  });
});
