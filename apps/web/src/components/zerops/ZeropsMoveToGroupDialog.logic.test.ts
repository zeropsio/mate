import { describe, expect, it } from "vite-plus/test";

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

describe("moveChoices — only what HQ offers this person", () => {
  const APPS = [
    { id: "acme", name: "Acme" },
    { id: "beta", name: "Beta" },
  ];
  const ALL_KINDS = ["mate", "devstage", "stage", "production"];

  it("draws the Mate's maker keeping it a dev in an application they see", () => {
    expect(
      moveChoices({ moveTo: { acme: ["mate", "devstage"] }, detach: true, apps: APPS }),
    ).toEqual({ apps: [{ id: "acme", name: "Acme", roles: ["dev"] }], newApp: [], none: true });
  });

  it("draws an org owner placing it anywhere, as anything, in a new application too", () => {
    expect(
      moveChoices({
        moveTo: { acme: ALL_KINDS, beta: ALL_KINDS, new: ALL_KINDS },
        detach: true,
        apps: APPS,
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

  it("draws nothing while HQ has not said, and no kind this build does not know", () => {
    expect([
      moveChoices({ moveTo: undefined, detach: false, apps: APPS }),
      moveChoices({ moveTo: { acme: ["preview"], gone: ["mate"] }, detach: false, apps: APPS }),
    ]).toEqual([
      { apps: [], newApp: [], none: false },
      { apps: [], newApp: [], none: false },
    ]);
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
