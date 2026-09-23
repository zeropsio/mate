import { describe, expect, it } from "vite-plus/test";
import { ZeropsApiError, type ZeropsProject } from "@t3tools/client-runtime/zerops";
import {
  canOperateProject,
  operableProjectAccess,
  projectVisibility,
  verifyOperableProjects,
} from "./projectAccess";
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

  it("keeps a READ_ONLY project in the tree, not openable", async () => {
    const readOnly: ZeropsProject = {
      ...project,
      userRoles: [{ clientUserId: membership.membershipId, roleCode: "READ_ONLY" }],
    };
    const result = await verifyOperableProjects(
      {
        listAccessibleClientProjects: async () => [readOnly],
        fetchProject: async () => readOnly,
      },
      membership,
    );

    expect(result).toEqual([{ project: readOnly, role: "READ_ONLY", visibility: "listed" }]);
  });

  it("drops a NO_ACCESS project — that Mate is not theirs to know about", async () => {
    const hidden: ZeropsProject = {
      ...project,
      userRoles: [{ clientUserId: membership.membershipId, roleCode: "NO_ACCESS" }],
    };
    const result = await verifyOperableProjects(
      {
        listAccessibleClientProjects: async () => [hidden],
        fetchProject: async () => hidden,
      },
      membership,
    );

    expect(result).toEqual([]);
  });

  // One project's read, classified on its own: a round turns each answer into
  // that project's evidence without waiting for the others.
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
  it.each(["forbidden", "not-found"] as const)(
    "removes a project that becomes %s between list and detail",
    async (kind) => {
      const result = await verifyOperableProjects(
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
      verifyOperableProjects(
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
  it("directly verifies a previously known project omitted by indexed search", async () => {
    const requested: string[] = [];
    const result = await verifyOperableProjects(
      {
        listAccessibleClientProjects: async () => [],
        fetchProject: async (projectId) => {
          requested.push(projectId);
          return project;
        },
      },
      membership,
    );
    expect(result).toEqual([]);
    expect(requested).toEqual([]);

    const verified = await verifyOperableProjects(
      {
        listAccessibleClientProjects: async () => [],
        fetchProject: async (projectId) => {
          requested.push(projectId);
          return project;
        },
      },
      membership,
      [project],
    );
    expect(verified.map((entry) => entry.project.id)).toEqual([project.id]);
    expect(requested).toEqual([project.id]);
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
