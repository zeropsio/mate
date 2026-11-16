import { describe, expect, it } from "@effect/vitest";

import type { ZeropsOrganization } from "./api.ts";
import { canCreateProjectsInOrganization, zeropsOrganizationRoleLabel } from "./accountScope.ts";

const organizations: ReadonlyArray<ZeropsOrganization> = [
  {
    id: "org-owner",
    membershipId: "cu-owner",
    name: "Owner account",
    roleCode: "OWNER",
  },
  {
    id: "org-dev",
    membershipId: "cu-dev",
    name: "Developer account",
    roleCode: "NO_ACCESS",
    canCreateProjects: true,
  },
];

describe("Zerops organization permissions", () => {
  it("uses capability flags for Developer and role fallbacks for Admin/Owner", () => {
    expect(canCreateProjectsInOrganization(organizations[0]!)).toBe(true);
    expect(canCreateProjectsInOrganization(organizations[1]!)).toBe(true);
    expect(
      canCreateProjectsInOrganization({
        id: "org-guest",
        membershipId: "cu-guest",
        name: "Guest account",
        roleCode: "NO_ACCESS",
        canCreateProjects: false,
      }),
    ).toBe(false);
  });

  it("distinguishes Developer from Guest even though both are NO_ACCESS", () => {
    expect(zeropsOrganizationRoleLabel(organizations[1]!)).toBe("Developer");
    expect(
      zeropsOrganizationRoleLabel({
        id: "org-guest",
        membershipId: "cu-guest",
        name: "Guest account",
        roleCode: "NO_ACCESS",
      }),
    ).toBe("Guest");
  });
});
