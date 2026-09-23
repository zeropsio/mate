import { describe, expect, it } from "vite-plus/test";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { canOperateProject, operableProjectAccess, projectVisibility } from "./projectAccess";
const membership = {
  id: "org",
  membershipId: "membership",
  name: "Organization",
  roleCode: "OWNER",
};
const project: ZeropsProject = {
  id: "project",
  clientId: "org",
  name: "Project",
  status: "ACTIVE",
};
describe("AL-08 / AL-10 authoritative project access", () => {
  // A READ_ONLY project is listed, never opened (D5): it keeps its place in
  // the tree so a colleague can name the Mate they want access to, and its row
  // says whose it is.
  it.each([
    ["OWNER", "open"],
    ["ADMIN", "open"],
    ["BASIC_USER", "open"],
    ["READ_ONLY", "listed"],
    ["NO_ACCESS", "hidden"],
  ] as const)("a %s override reads as %s", (roleCode, visibility) => {
    expect(
      projectVisibility(
        { ...project, userRoles: [{ clientUserId: membership.membershipId, roleCode }] },
        membership,
      ),
    ).toBe(visibility);
  });

  it.each([
    ["OWNER", { role: "OWNER", visibility: "open" }],
    ["BASIC_USER", { role: "BASIC_USER", visibility: "open" }],
    ["READ_ONLY", { role: "READ_ONLY", visibility: "listed" }],
    ["NO_ACCESS", null],
  ] as const)("classifies one project read with a %s override", (roleCode, expected) => {
    const read: ZeropsProject = {
      ...project,
      userRoles: [{ clientUserId: membership.membershipId, roleCode }],
    };
    expect(operableProjectAccess(read, membership)).toEqual(
      expected === null ? null : { project: read, ...expected },
    );
  });

  it.each([
    ["ADMIN", true],
    ["BASIC_USER", true],
    ["READ_ONLY", false],
    ["NO_ACCESS", false],
  ] as const)("honors a %s override even for an owner", (roleCode, allowed) => {
    expect(
      canOperateProject(
        { ...project, userRoles: [{ clientUserId: membership.membershipId, roleCode }] },
        membership,
      ),
    ).toBe(allowed);
  });
  it("does not accept an unrelated organization or a lowering override without a membership ID", () => {
    expect(canOperateProject(project, { ...membership, id: "different" })).toBe(false);
    expect(
      canOperateProject(
        { ...project, userRoles: [{ clientUserId: "membership", roleCode: "NO_ACCESS" }] },
        { ...membership, membershipId: "" },
      ),
    ).toBe(false);
  });
});
