import { describe, expect, it } from "vite-plus/test";

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";

import {
  SIDEBAR_ACCOUNT_DESTINATIONS,
  sidebarAccountDestinationOf,
  sidebarAccountLines,
  sidebarAccountOrganizationChoices,
  sidebarAccountRoleLine,
} from "./SidebarZeropsAccount.logic";

const organization = (name: string, id = name): ZeropsOrganization => ({
  id,
  name,
  membershipId: `m-${id}`,
});

// What the viewer is in the organization the list shows, under their name
// at the top of the menu — as the approved prototype drew it: "Owner of …".
describe("sidebarAccountRoleLine", () => {
  it.each([
    ["OWNER", "Owner of Northwind s.r.o."],
    ["ADMIN", "Admin of Northwind s.r.o."],
    ["BASIC_USER", "Northwind s.r.o. · Basic user"],
    [undefined, "Northwind s.r.o. · Member"],
  ])("%s: %s", (roleCode, line) => {
    expect(
      sidebarAccountRoleLine({
        ...organization(" Northwind s.r.o. "),
        ...(roleCode === undefined ? {} : { roleCode }),
      }),
    ).toBe(line);
  });

  it("says nothing until an organization is known", () => {
    expect(sidebarAccountRoleLine(null)).toBeNull();
    expect(sidebarAccountRoleLine(organization("  "))).toBeNull();
  });
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
  it("still names the one organization an account is in: the trigger promises it", () => {
    // The row that opens this menu wears the two-way chevron and the
    // organization's name. Dropping the group left that promise unanswered.
    expect(sidebarAccountOrganizationChoices([organization("Zerops")])).toEqual([
      organization("Zerops"),
    ]);
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
    ["/git", "git"],
    ["/zerops", "projects"],
    ["/", null],
    ["/chat/env/thread", null],
    // A project's own screen is not the projects list; lighting "Projects"
    // there would name a page the person is not on.
    ["/projects/abc", null],
    ["/settingsish", null],
  ];

  it.each(
    Array.from(cases, ([pathname, expected]) => ({
      title: `reads ${pathname} as ${expected ?? "no destination"}`,
      pathname,
      expected,
    })),
  )("$title", ({ pathname, expected }) => {
    expect(sidebarAccountDestinationOf(pathname)).toBe(expected);
  });

  it("names a destination for every path it lights", () => {
    for (const destination of SIDEBAR_ACCOUNT_DESTINATIONS) {
      expect(sidebarAccountDestinationOf(destination.to)).toBe(destination.id);
    }
  });
});
