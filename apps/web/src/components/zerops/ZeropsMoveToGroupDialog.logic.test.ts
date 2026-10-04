import { describe, expect, it } from "vite-plus/test";

import { offerAsker, type OfferViewer } from "@t3tools/client-runtime/zerops";

import {
  initialMoveForm,
  moveChoices,
  resolveMoveMembership,
  roleWithin,
  validateMoveForm,
  type MoveChoices,
} from "./ZeropsMoveToGroupDialog.logic";

describe("validateMoveForm", () => {
  it("accepts leaving every group without asking anything else", () => {
    expect(validateMoveForm({ target: "none", newGroupName: "", role: "" })).toEqual({});
  });

  it("wants a name for a new group and a role for any group", () => {
    expect(validateMoveForm({ target: "new", newGroupName: " ", role: "" })).toEqual({
      newGroupName: "Give the project a name.",
      role: "Say what this environment is for.",
    });
    expect(validateMoveForm({ target: "g1", newGroupName: "", role: "dev" })).toEqual({});
  });
});

describe("resolveMoveMembership", () => {
  it("asks for a new application by its name, which HQ makes", () => {
    expect(
      resolveMoveMembership({ target: "new", newGroupName: " Beviro CRM ", role: "stage" }),
    ).toEqual({ kind: "new", name: "Beviro CRM", role: "stage" });
  });

  it("joins an existing application without renaming it", () => {
    expect(resolveMoveMembership({ target: "g1", newGroupName: "", role: "prod" })).toEqual({
      kind: "group",
      appId: "g1",
      role: "prod",
    });
  });

  it("leaves every application", () => {
    expect(resolveMoveMembership({ target: "none", newGroupName: "", role: "" })).toEqual({
      kind: "none",
    });
  });

  it("refuses an incomplete form", () => {
    expect(resolveMoveMembership({ target: "new", newGroupName: "", role: "dev" })).toBeUndefined();
  });
});

describe("moveChoices — only what HQ's rule lets this person place", () => {
  const PROJECTS = [
    { id: "p-made", userRoles: [{ clientUserId: "cu-ada", roleCode: "OWNER" }] },
    { id: "p-stage", userRoles: [] },
    { id: "p-hidden", userRoles: [] },
  ];
  const APPS = [
    { id: "acme", name: "Acme", projectIds: ["p-made", "p-stage"] },
    { id: "beta", name: "Beta", projectIds: ["p-hidden"] },
  ];
  const choicesFor = (viewer: OfferViewer | undefined) =>
    moveChoices({
      asker: offerAsker(viewer, PROJECTS),
      projectId: "p-made",
      held: "mate",
      apps: APPS,
    });

  it("lets the person who made the Mate, with no org access, keep it a dev in an application they see", () => {
    expect(
      choicesFor({
        userId: "u-ada",
        clientUserId: "cu-ada",
        roleCode: "NO_ACCESS",
        canCreateProjects: true,
      }),
    ).toEqual({ apps: [{ id: "acme", name: "Acme", roles: ["dev"] }], newApp: [], none: true });
  });

  it("lets an org owner place it anywhere, as anything, in a new application too", () => {
    expect(
      choicesFor({
        userId: "u-ada",
        clientUserId: "cu-eva",
        roleCode: "OWNER",
        canCreateProjects: true,
      }),
    ).toEqual({
      apps: [
        { id: "acme", name: "Acme", roles: ["dev", "stage", "prod"] },
        { id: "beta", name: "Beta", roles: ["dev", "stage", "prod"] },
      ],
      newApp: ["dev", "stage", "prod"],
      none: true,
    });
  });

  it("offers nothing to a person the client does not know", () => {
    expect(choicesFor(undefined)).toEqual({ apps: [], newApp: [], none: false });
  });
});

describe("the move form draws only what may be chosen", () => {
  /** The Mate-maker's choices: dev in Acme, and nothing else. */
  const MAKER: MoveChoices = {
    apps: [{ id: "acme", name: "Acme", roles: ["dev"] }],
    newApp: [],
    none: true,
  };
  const WRITER: MoveChoices = {
    apps: [
      { id: "acme", name: "Acme", roles: ["dev", "stage", "prod"] },
      { id: "beta", name: "Beta", roles: ["dev", "stage", "prod"] },
    ],
    newApp: ["dev", "stage", "prod"],
    none: true,
  };

  it.each([
    [
      "where it is, as what it is",
      WRITER,
      { groupId: "beta", role: "stage" },
      { target: "beta", newGroupName: "", role: "stage" },
    ],
    [
      "the first application it may go into, where it is in none",
      WRITER,
      { groupId: undefined, role: undefined },
      { target: "acme", newGroupName: "", role: "dev" },
    ],
    [
      "the one role it may take, never one it may not",
      MAKER,
      { groupId: "acme", role: "stage" },
      { target: "acme", newGroupName: "", role: "dev" },
    ],
    [
      "out of all, where it may go nowhere else",
      { apps: [], newApp: [], none: true },
      { groupId: "acme", role: "dev" },
      { target: "none", newGroupName: "", role: "" },
    ],
  ] as const)("opens on %s", (_name, choices, current, form) => {
    expect(initialMoveForm(choices, current)).toEqual(form);
  });

  it("keeps the role on a new target where it may take it there, else takes the first it may", () => {
    expect(roleWithin(WRITER, "new", "prod")).toBe("prod");
    expect(roleWithin(MAKER, "acme", "prod")).toBe("dev");
    expect(roleWithin(MAKER, "none", "dev")).toBe("");
  });
});
