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
  it("mints an id for a new group and carries its name", () => {
    expect(
      resolveMoveMembership(
        { target: "new", newGroupName: " Beviro CRM ", role: "stage" },
        () => "fresh-id",
      ),
    ).toEqual({ kind: "group", groupId: "fresh-id", role: "stage", label: "Beviro CRM" });
  });

  it("joins an existing group without renaming it", () => {
    expect(
      resolveMoveMembership({ target: "g1", newGroupName: "", role: "prod" }, () => "unused"),
    ).toEqual({ kind: "group", groupId: "g1", role: "prod" });
  });

  it("leaves every group", () => {
    expect(
      resolveMoveMembership({ target: "none", newGroupName: "", role: "" }, () => "unused"),
    ).toEqual({ kind: "none" });
  });

  it("refuses an incomplete form", () => {
    expect(
      resolveMoveMembership({ target: "new", newGroupName: "", role: "dev" }, () => "x"),
    ).toBeUndefined();
  });
});
