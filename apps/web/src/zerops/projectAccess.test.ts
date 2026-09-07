import { describe, expect, it } from "vite-plus/test";
import { ZeropsApiError, type ZeropsProject } from "@t3tools/client-runtime/zerops";
import { canOperateProject, loadOperableProjects } from "./projectAccess";
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
  it.each(["forbidden", "not-found"] as const)(
    "removes a project that becomes %s between list and detail",
    async (kind) => {
      const result = await loadOperableProjects(
        {
          listAccessibleClientProjects: async () => [project],
          fetchProject: async () => {
            throw new ZeropsApiError("Gone", kind);
          },
        },
        membership,
      );
      expect(result).toEqual([]);
    },
  );
  it("fails an unavailable read instead of manufacturing a deletion", async () => {
    await expect(
      loadOperableProjects(
        {
          listAccessibleClientProjects: async () => [project],
          fetchProject: async () => {
            throw new ZeropsApiError("Offline", "network");
          },
        },
        membership,
      ),
    ).rejects.toMatchObject({ kind: "network" });
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
