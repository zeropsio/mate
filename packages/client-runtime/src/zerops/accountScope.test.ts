import { describe, expect, it } from "@effect/vitest";

import type { ZeropsOrganization } from "./api.ts";
import {
  canCreateProjectsInOrganization,
  resolveActiveZeropsOrganization,
  zeropsOrganizationRoleLabel,
} from "./accountScope.ts";

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

describe("resolveActiveZeropsOrganization", () => {
  it("prefers the organization explicitly named by the Zerops hand-over", () => {
    expect(
      resolveActiveZeropsOrganization(organizations, {
        preferredClientId: "org-dev",
        storedClientUserId: "cu-owner",
        storedClientId: "org-owner",
      })?.membershipId,
    ).toBe("cu-dev");
  });

  it("restores the exact clientUser membership before falling back to clientId", () => {
    expect(
      resolveActiveZeropsOrganization(organizations, {
        preferredClientId: null,
        storedClientUserId: "cu-dev",
        storedClientId: "org-owner",
      })?.membershipId,
    ).toBe("cu-dev");
  });

  it("selects the only organization but requires an explicit choice when several are new", () => {
    expect(
      resolveActiveZeropsOrganization([organizations[0]!], {
        preferredClientId: null,
        storedClientUserId: null,
        storedClientId: null,
      })?.id,
    ).toBe("org-owner");
    expect(
      resolveActiveZeropsOrganization(organizations, {
        preferredClientId: null,
        storedClientUserId: null,
        storedClientId: null,
      }),
    ).toBeNull();
  });
});

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
