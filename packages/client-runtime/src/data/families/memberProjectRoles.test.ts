import { describe, expect, it } from "vite-plus/test";

import { memberProjectRolesFamily } from "./memberProjectRoles.ts";

const sampled = memberProjectRolesFamily.sampled!;

describe("one member's own grants, as Zerops lists them", () => {
  it("Each grant is the project and its role; the grant's own id is left behind", () => {
    expect(
      sampled.decode({
        projectRoleList: [
          { id: "r1", projectId: "p1", roleCode: "READ_ONLY" },
          { id: "r2", projectId: "p2", roleCode: "BASIC_USER" },
        ],
      }),
    ).toEqual([
      { projectId: "p1", roleCode: "READ_ONLY" },
      { projectId: "p2", roleCode: "BASIC_USER" },
    ]);
  });

  it("A member with no grants of their own holds none", () => {
    expect(sampled.decode({})).toEqual([]);
  });

  it("An answer that isn't a list of grants is no answer", () => {
    expect(sampled.decode("nope")).toBeNull();
  });

  it("A grant that names no project is left out alone", () => {
    expect(
      sampled.decode({
        projectRoleList: [{ roleCode: "READ_ONLY" }, { projectId: "p1", roleCode: "OWNER" }],
      }),
    ).toEqual([{ projectId: "p1", roleCode: "OWNER" }]);
  });

  it("Read from the member's own grants", () => {
    expect(sampled.path({ orgId: "org", ownerId: "cu-eva" })).toBe("/client-user/cu-eva/roles");
  });
});
