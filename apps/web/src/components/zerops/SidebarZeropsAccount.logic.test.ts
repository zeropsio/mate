import { describe, expect, it } from "vite-plus/test";

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";

import {
  SIDEBAR_ACCOUNT_DESTINATIONS,
  sidebarAccountDestinationOf,
  sidebarAccountLines,
  sidebarAccountOrganizationChoices,
} from "./SidebarZeropsAccount.logic";

const organization = (name: string, id = name): ZeropsOrganization => ({
  id,
  name,
  membershipId: `m-${id}`,
});

describe("sidebarAccountLines", () => {
  it("says the person and the organization their projects belong to", () => {
    expect(sidebarAccountLines({ name: "Ada", organization: organization("Zerops") })).toEqual({
      name: "Ada",
      organization: "Zerops",
    });
  });

  it("leaves the organization out until one is known, rather than promising a name", () => {
    expect(sidebarAccountLines({ name: "Ada", organization: null }).organization).toBe(null);
  });

  it("treats an organization named only in whitespace as unnamed", () => {
    expect(
      sidebarAccountLines({ name: "Ada", organization: organization("   ") }).organization,
    ).toBe(null);
  });
});

describe("sidebarAccountOrganizationChoices", () => {
  it("offers nothing to choose when the account has one organization", () => {
    expect(sidebarAccountOrganizationChoices([organization("Zerops")])).toEqual([]);
  });

  it("offers every organization once there is a choice to make", () => {
    const organizations = [organization("Zerops"), organization("Acme")];
    expect(sidebarAccountOrganizationChoices(organizations)).toEqual(organizations);
  });

  it("offers nothing while none has been read", () => {
    expect(sidebarAccountOrganizationChoices([])).toEqual([]);
  });
});

describe("sidebarAccountDestinationOf", () => {
  const cases: ReadonlyArray<[string, string | null]> = [
    ["/settings", "settings"],
    ["/settings/appearance", "settings"],
    ["/usage", "usage"],
    ["/gitea", "gitea"],
    ["/zerops", "projects"],
    ["/", null],
    ["/chat/env/thread", null],
    // A project's own screen is not the projects list; lighting "Projects"
    // there would name a page the person is not on.
    ["/projects/abc", null],
    ["/settingsish", null],
  ];

  for (const [pathname, expected] of cases) {
    it(`reads ${pathname} as ${expected ?? "no destination"}`, () => {
      expect(sidebarAccountDestinationOf(pathname)).toBe(expected);
    });
  }

  it("names a destination for every path it lights", () => {
    for (const destination of SIDEBAR_ACCOUNT_DESTINATIONS) {
      expect(sidebarAccountDestinationOf(destination.to)).toBe(destination.id);
    }
  });
});
