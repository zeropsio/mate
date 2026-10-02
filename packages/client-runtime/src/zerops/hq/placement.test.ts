import { describe, expect, it } from "@effect/vitest";

import type { Known } from "../knowledge/known.ts";
import { placeListing, placeProjects, placementsOf, type HqPlacement } from "./placement.ts";

interface Listed {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly hq?: HqPlacement;
}

const STRUCTURE = {
  ungrouped: [{ projectId: "p-ada", name: "scratch", mate: { name: "Ada", face: "sky:flower" } }],
  apps: [
    {
      id: "app-1",
      name: "Acme CRM",
      projects: [
        {
          projectId: "p-vera",
          name: "Acme CRM - Vera",
          kind: "mate",
          mate: { name: "Vera", face: "rose:seal" },
        },
        { projectId: "p-stage", name: "acme-stage", kind: "stage", mate: null },
        {
          projectId: "p-ivo",
          name: "Acme CRM - Ivo",
          kind: "devstage",
          mate: { name: "Ivo", face: "sky:gem" },
        },
        { projectId: "p-prod", name: "acme", kind: "production", mate: null },
        { projectId: "p-later", name: "later", kind: "preview", mate: null },
      ],
    },
  ],
};

describe("placementsOf", () => {
  it("is where HQ places each project: its application, its kind, its Mate", () => {
    expect([...placementsOf(STRUCTURE)]).toEqual([
      [
        "p-vera",
        {
          appId: "app-1",
          appName: "Acme CRM",
          kind: "mate",
          mate: { name: "Vera", face: "rose:seal" },
        },
      ],
      ["p-stage", { appId: "app-1", appName: "Acme CRM", kind: "stage", mate: null }],
      [
        "p-ivo",
        {
          appId: "app-1",
          appName: "Acme CRM",
          kind: "devstage",
          mate: { name: "Ivo", face: "sky:gem" },
        },
      ],
      ["p-prod", { appId: "app-1", appName: "Acme CRM", kind: "production", mate: null }],
      [
        "p-ada",
        { appId: null, appName: null, kind: "mate", mate: { name: "Ada", face: "sky:flower" } },
      ],
    ]);
  });
});

describe("placeProjects", () => {
  it("joins each project HQ places, leaves the rest as they are, and takes back a placement HQ dropped", () => {
    const placements = placementsOf(STRUCTURE);
    const loose: Listed = { id: "p-loose", name: "loose", status: "ACTIVE" };
    const dropped: Listed = {
      id: "p-gone",
      name: "gone",
      status: "ACTIVE",
      hq: { appId: "app-0", appName: "Old", kind: "mate", mate: null },
    };
    const placed = placeProjects<Listed>(
      [{ id: "p-vera", name: "Acme CRM - Vera", status: "ACTIVE" }, loose, dropped],
      placements,
    );
    expect(placed[0]?.hq).toEqual(placements.get("p-vera"));
    expect(placed[1]).toBe(loose);
    expect(placed[2]).toEqual({ id: "p-gone", name: "gone", status: "ACTIVE" });
  });
});

describe("placeListing", () => {
  const placements = placementsOf(STRUCTURE);
  const vera = {
    key: "p-vera:zcp",
    project: { id: "p-vera", name: "Acme CRM - Vera", status: "ACTIVE" },
  };
  const loose = { key: "p-loose:zcp", project: { id: "p-loose", name: "loose", status: "ACTIVE" } };

  it("places the projects of a listing that is known, and keeps its stamp and every row it need not touch", () => {
    const listing: Known<ReadonlyArray<typeof vera>> = {
      state: "known",
      value: [vera, loose],
      asOf: { ordinal: 4, atMs: 40 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
    const placed = placeListing(listing, placements);
    if (placed.state !== "known") throw new Error("the listing stays known");
    expect(placed.asOf).toBe(listing.asOf);
    expect(placed.value[0]).toEqual({
      ...vera,
      project: { ...vera.project, hq: placements.get("p-vera") },
    });
    expect(placed.value[1]).toBe(loose);
  });

  it("leaves a listing that holds no rows as it is", () => {
    const unread: Known<ReadonlyArray<typeof vera>> = { state: "unread", waitingFor: null };
    expect(placeListing(unread, placements)).toBe(unread);
  });
});
