import { describe, expect, it } from "vite-plus/test";

import { resolveMoveMembership, validateMoveForm } from "./ZeropsMoveToGroupDialog.logic";

describe("validateMoveForm", () => {
  it("accepts leaving every group without asking anything else", () => {
    expect(validateMoveForm({ target: "none", newGroupName: "", role: "" })).toEqual({});
  });

  it("wants a name for a new group and a role for any group", () => {
    expect(validateMoveForm({ target: "new", newGroupName: " ", role: "" })).toEqual({
      newGroupName: "Give the group a name.",
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
