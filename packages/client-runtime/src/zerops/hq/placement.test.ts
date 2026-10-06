import { describe, expect, it } from "@effect/vitest";

import type { Known } from "../knowledge/known.ts";
import {
  birthIntentOf,
  heldOf,
  hqMateOffers,
  placeListing,
  placeProjects,
  placementsOf,
  type HqPlacement,
} from "./placement.ts";

interface Listed {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly hq?: HqPlacement;
}

const STRUCTURE = {
  ungrouped: [{ projectId: "p-ada", name: "Ada", mate: { face: "sky:flower" } }],
  apps: [
    {
      id: "app-1",
      name: "Acme CRM",
      projects: [
        {
          projectId: "p-vera",
          name: "Acme CRM - Vera",
          kind: "mate",
          mate: { face: "rose:seal" },
        },
        { projectId: "p-stage", name: "acme-stage", kind: "stage", mate: null },
        {
          projectId: "p-ivo",
          name: "Acme CRM - Ivo",
          kind: "devstage",
          mate: { face: "sky:gem" },
        },
        { projectId: "p-prod", name: "acme", kind: "production", mate: null },
        { projectId: "p-later", name: "later", kind: "preview", mate: null },
      ],
    },
  ],
};

describe("placementsOf", () => {
  it("joins each Mate's logins, as HQ's overview of it says them, onto its record", () => {
    const logins = { "claude-code": { signedInBy: "u-jan", present: true, token: false } };
    const placed = placementsOf(STRUCTURE, new Map([["p-vera", logins]]));
    expect(placed.get("p-vera")?.mate).toEqual({ face: "rose:seal", logins });
    // HQ holds no overview of Ada: its record alone.
    expect(placed.get("p-ada")?.mate).toEqual({ face: "sky:flower" });
  });

  it("is where HQ places each project: its application, its kind, its Mate", () => {
    expect([...placementsOf(STRUCTURE)]).toEqual([
      [
        "p-vera",
        {
          appId: "app-1",
          appName: "Acme CRM",
          kind: "mate",
          mate: { face: "rose:seal" },
        },
      ],
      ["p-stage", { appId: "app-1", appName: "Acme CRM", kind: "stage", mate: null }],
      [
        "p-ivo",
        {
          appId: "app-1",
          appName: "Acme CRM",
          kind: "devstage",
          mate: { face: "sky:gem" },
        },
      ],
      ["p-prod", { appId: "app-1", appName: "Acme CRM", kind: "production", mate: null }],
      ["p-ada", { appId: null, appName: null, kind: "mate", mate: { face: "sky:flower" } }],
    ]);
  });
});

// B5: a stage's press imports first and registers last; one cut short between them leaves a
// project HQ holds nowhere. Its press's record places it in its application as its tier — never a
// project nobody made — and HQ still holds it as nothing.
describe("placementsOf — a press's record of a project HQ holds nowhere", () => {
  const presses = {
    "p-new-stage": { kind: "stage", appId: "app-1" },
    "p-stage": { kind: "production", appId: "app-1" },
    "p-elsewhere": { kind: "stage", appId: "app-gone" },
    "p-new-mate": { kind: "mate", appId: "app-1" },
  } as const;

  it("places a stage's or a production's there as its tier, unregistered; HQ's own word first", () => {
    const placed = placementsOf(STRUCTURE, new Map(), new Map(), presses);
    expect(placed.get("p-new-stage")).toEqual({
      appId: "app-1",
      appName: "Acme CRM",
      kind: "stage",
      mate: null,
      unregistered: true,
    });
    expect(heldOf({ hq: placed.get("p-new-stage") })).toBe("none");
    // What HQ registered stands; an application HQ does not hold, or a Mate's, places nothing.
    expect(placed.get("p-stage")?.kind).toBe("stage");
    expect(placed.has("p-elsewhere")).toBe(false);
    expect(placed.has("p-new-mate")).toBe(false);
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

describe("birthIntentOf", () => {
  it("finds an open birth intent by its id: the application it goes into and its face", () => {
    const structure = {
      ungrouped: [],
      apps: [
        { id: "app-1", name: "Acme", projects: [] },
        {
          id: "app-g",
          name: "G",
          projects: [],
          births: [{ id: "b-1", face: "rose:seal" }],
        },
      ],
    };
    expect(birthIntentOf(structure, "b-1")).toEqual({
      appId: "app-g",
      face: "rose:seal",
    });
    // Closed by its attach, or never HQ's: none.
    expect(birthIntentOf(structure, "b-2")).toBeUndefined();
    expect(birthIntentOf(null, "b-1")).toBeUndefined();
  });
});

describe("hqMateOffers — what HQ offers of a Mate, or of a project it holds nowhere", () => {
  const LIVE = { current: true, unavailableSince: null } as const;
  const OFFERED = {
    ...STRUCTURE,
    unheld: { "p-free": { create_mate_record: { allow: true } } },
    ungrouped: [
      {
        ...STRUCTURE.ungrouped[0]!,
        can: {
          observe_mate: { allow: true },
          edit_mate_record: { allow: false, reason: "not_project_admin" },
          detach: { allow: false, reason: "not_project_admin" },
        },
        moveTo: { "app-1": ["mate"] },
      },
    ],
  };

  it("reads a Mate's verbs and moves as HQ streamed them", () => {
    expect(hqMateOffers(OFFERED, "p-ada", LIVE)).toEqual({
      held: true,
      observe: { kind: "allowed" },
      edit: { kind: "refused", reason: "not_project_admin" },
      detach: { kind: "refused", reason: "not_project_admin" },
      moveTo: { "app-1": ["mate"] },
    });
  });

  it("reads a Mate HQ sent no offers for as unknown, and moves nowhere", () => {
    expect(hqMateOffers(OFFERED, "p-vera", LIVE)).toEqual({
      held: true,
      observe: { kind: "unknown" },
      edit: { kind: "unknown" },
      detach: { kind: "unknown" },
      moveTo: undefined,
    });
  });

  it("reads a project HQ holds nowhere by its record's offer; unknown where HQ named none", () => {
    expect([hqMateOffers(OFFERED, "p-free", LIVE), hqMateOffers(OFFERED, "p-else", LIVE)]).toEqual([
      { held: false, createRecord: { kind: "allowed" } },
      { held: false, createRecord: { kind: "unknown" } },
    ]);
  });

  it("keeps what HQ said, moves included, while it is read again before any outage", () => {
    expect(
      hqMateOffers(OFFERED, "p-ada", { current: false, unavailableSince: null }),
    ).toMatchObject({ held: true, observe: { kind: "allowed" }, moveTo: { "app-1": ["mate"] } });
  });

  it("is unavailable since HQ stopped answering, moves included", () => {
    expect(hqMateOffers(OFFERED, "p-ada", { current: false, unavailableSince: 9 })).toEqual({
      held: true,
      observe: { kind: "unavailable", since: 9 },
      edit: { kind: "unavailable", since: 9 },
      detach: { kind: "unavailable", since: 9 },
      moveTo: undefined,
    });
  });
});

describe("heldOf — what HQ holds a project as, from where it places it", () => {
  it.each([
    ["nothing it places", {}, "none"],
    [
      "a Mate in no application",
      { hq: { appId: null, appName: null, kind: "mate", mate: { name: "Ada", face: "" } } },
      "mate",
    ],
    [
      "an application's stage",
      { hq: { appId: "a", appName: "Acme", kind: "stage", mate: null } },
      "stage",
    ],
    [
      "a dev/stage",
      { hq: { appId: "a", appName: "Acme", kind: "devstage", mate: null } },
      "devstage",
    ],
  ] as const)("%s → %s", (_name, project, held) => {
    expect(heldOf(project)).toBe(held);
  });
});
