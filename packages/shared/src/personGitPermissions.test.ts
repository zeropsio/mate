import { describe, expect, it } from "vite-plus/test";
import { can, type Facts } from "./zeropsPermissions.ts";

const facts = (roleCode: string, grant: string | null, status = "ACTIVE"): Facts<"fresh"> => ({
  freshness: "fresh",
  members: [{ userId: "u", clientUserId: "c", roleCode, status, canCreateProjects: false }],
  projects: [
    { id: "p", userRoles: grant === null ? [] : [{ clientUserId: "c", roleCode: grant }] },
  ],
});
const person = { kind: "person", userId: "u" } as const;

describe("human Git write permissions (E202)", () => {
  it.each([
    ["NO_ACCESS", "BASIC_USER", true],
    ["READ_ONLY", null, false],
    ["BASIC_USER", null, true],
    ["ADMIN", "READ_ONLY", false],
    ["OWNER", "NO_ACCESS", true],
    ["NO_ACCESS", "READ_ONLY", false],
    ["NO_ACCESS", "future_role", false],
  ] as const)(
    "uses main's write team or active site owner: org %s, grant %s",
    (role, grant, allow) => {
      expect(can(person, "push_repo", { projectIds: ["p"] }, facts(role, grant)).allow).toBe(allow);
    },
  );
  it("preserves the owner's site rights on empty applications without granting admins write", () => {
    expect(can(person, "push_repo", { projectIds: [] }, facts("OWNER", null)).allow).toBe(true);
    expect(can(person, "push_repo", { projectIds: [] }, facts("ADMIN", null)).allow).toBe(false);
  });
  it("denies inactive owners, missing project grants, and other principals", () => {
    expect(
      can(person, "push_repo", { projectIds: ["p"] }, facts("OWNER", null, "INVITED")),
    ).toEqual({ allow: false, reason: "not_active_member" });
    expect(
      can(person, "push_repo", { projectIds: ["gone"] }, facts("NO_ACCESS", "OWNER")).allow,
    ).toBe(false);
    expect(
      can(
        { kind: "mate", projectId: "p" },
        "push_repo",
        { projectIds: ["p"] },
        facts("OWNER", null),
      ).allow,
    ).toBe(false);
  });
});
