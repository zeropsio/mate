import { describe, expect, it } from "@effect/vitest";
import type { Verb } from "@t3tools/shared/zeropsPermissions";

import type { HqPlacement } from "./hq/placement.ts";
import { changeOffers, heldOf, mayOffer, offerAsker, type OfferViewer } from "./offers.ts";

const ADA: OfferViewer = {
  userId: "u-ada",
  clientUserId: "cu-ada",
  roleCode: "BASIC_USER",
  canCreateProjects: true,
};
const PROJECTS = [
  { id: "p-own", userRoles: [{ clientUserId: "cu-ada", roleCode: "ADMIN" }] },
  { id: "p-other", userRoles: [] },
];

describe("mayOffer — what the client offers, by the rule HQ enforces", () => {
  it.each<[string, Verb, string, boolean]>([
    ["renames a Mate on a project the person administers", "edit_mate_record", "p-own", true],
    ["never one on a project they only see", "edit_mate_record", "p-other", false],
    ["moves a Mate out of its project where they administer it", "detach", "p-own", true],
    ["never where they do not", "detach", "p-other", false],
  ])("%s", (_name, verb, projectId, offered) => {
    const asker = offerAsker(ADA, PROJECTS);
    expect(mayOffer(asker, verb as "edit_mate_record", { projectId, held: "mate" })).toBe(offered);
  });

  /** Org No access with *can create projects*, Owner of the project they made: the main Mate-maker. */
  const MAKER: OfferViewer = {
    userId: "u-mia",
    clientUserId: "cu-mia",
    roleCode: "NO_ACCESS",
    canCreateProjects: true,
  };
  const MADE = [{ id: "p-made", userRoles: [{ clientUserId: "cu-mia", roleCode: "OWNER" }] }];

  it.each<[string, string, ReadonlyArray<string>, boolean]>([
    ["moves the Mate they made within an application it is in", "mate", ["p-made"], true],
    ["never into an application they do not see", "mate", ["p-other"], false],
    ["never as a stage: a Mate becoming an environment is a writer's", "stage", ["p-made"], false],
  ])("%s", (_name, to, appProjectIds, offered) => {
    const asker = offerAsker(MAKER, MADE);
    expect(mayOffer(asker, "move", { projectId: "p-made", held: "mate", to, appProjectIds })).toBe(
      offered,
    );
  });

  it("offers nothing at all to a person the client does not know", () => {
    const asker = offerAsker(undefined, PROJECTS);
    expect(asker).toBeNull();
    expect(mayOffer(asker, "edit_mate_record", { projectId: "p-own", held: "mate" })).toBe(false);
    expect(mayOffer(asker, "read_project", { projectId: "p-own" })).toBe(false);
  });
});

describe("changeOffers — what a person may do with an application's changes (SPEC §3.2a)", () => {
  /** The application `app-1` holds `p-dev` and `p-stage`; `p-else` is in another one. */
  const PLACED = new Map<string, HqPlacement>([
    ["p-dev", { appId: "app-1", appName: "Acme", kind: "devstage", mate: null }],
    ["p-stage", { appId: "app-1", appName: "Acme", kind: "stage", mate: null }],
    ["p-else", { appId: "app-2", appName: "Other", kind: "devstage", mate: null }],
  ]);
  const viewer = (roleCode: string): OfferViewer => ({
    userId: "u-ola",
    clientUserId: "cu-ola",
    roleCode,
    canCreateProjects: false,
  });
  const granted = (projectId: string, roleCode: string) => [
    { id: projectId, userRoles: [{ clientUserId: "cu-ola", roleCode }] },
  ];

  it.each<[string, OfferViewer, ReturnType<typeof granted>, boolean]>([
    ["reads and comments with Read only on the organization", viewer("READ_ONLY"), [], true],
    [
      "reads and comments with Basic user on one of its projects",
      viewer("NO_ACCESS"),
      granted("p-stage", "BASIC_USER"),
      true,
    ],
    [
      // It sees the application listed, never its changes (main's Gitea read rule).
      "neither with only a Read only grant on one of its projects",
      viewer("NO_ACCESS"),
      granted("p-dev", "READ_ONLY"),
      false,
    ],
    [
      "neither with Basic user on another application's project",
      viewer("NO_ACCESS"),
      granted("p-else", "BASIC_USER"),
      false,
    ],
  ])("%s", (_name, person, projects, offered) => {
    expect(changeOffers(offerAsker(person, projects), PLACED, "app-1")).toEqual({
      read: offered,
      comment: offered,
    });
  });

  it("offers nothing to a person the client does not know", () => {
    expect(changeOffers(null, PLACED, "app-1")).toEqual({ read: false, comment: false });
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
