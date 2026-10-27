import { describe, expect, it } from "vite-plus/test";

import type { ZeropsOrganization } from "@t3tools/client-runtime/zerops";

import {
  organizationSwitchLanding,
  SIDEBAR_ACCOUNT_DESTINATIONS,
  sidebarAccountDestinationOf,
  sidebarAccountLines,
  sidebarAccountOrganizationChoices,
  sidebarAccountRoleLine,
  sidebarAccountRoleParts,
} from "./SidebarZeropsAccount.logic";

const organization = (name: string, id = name): ZeropsOrganization => ({
  id,
  name,
  membershipId: `m-${id}`,
});

// What the viewer is in the organization the list shows, under their name
// at the top of the menu, one shape for every role: "… · Owner".
describe("sidebarAccountRoleLine", () => {
  it.each([
    ["OWNER", "Northwind s.r.o. · Owner"],
    ["ADMIN", "Northwind s.r.o. · Admin"],
    ["BASIC_USER", "Northwind s.r.o. · Works on every project"],
    [undefined, "Northwind s.r.o."],
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

// The foot says the same line under the viewer's name, the organization's name its own part.
describe("sidebarAccountRoleParts", () => {
  it.each([
    ["OWNER", ["", "Acme", " · Owner"]],
    ["ADMIN", ["", "Acme", " · Admin"]],
    ["BASIC_USER", ["", "Acme", " · Works on every project"]],
  ] as const)("%s: %j", (roleCode, [before, name, after]) => {
    expect(sidebarAccountRoleParts({ ...organization("Acme"), roleCode })).toEqual({
      before,
      organization: name,
      after,
    });
  });

  it("says the organization alone where no role is known", () => {
    expect(sidebarAccountRoleParts(organization("Acme"))).toEqual({
      before: "",
      organization: "Acme",
      after: "",
    });
    expect(sidebarAccountRoleParts(null)).toBeNull();
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
    ["/settings/team", "team"],
    ["/settings/team/invite", "team"],
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

// Aleš, 2026-10-25: switching from Mate s.r.o. to Mate2 s.r.o. on Kara's conversation kept its
// address and read "This conversation isn't in your Zerops projects", while the menu already listed
// Mate2's Cal. A link opened to another organization's conversation still reads that.
describe("organizationSwitchLanding", () => {
  it.each([
    {
      name: "a conversation of the organization left lands home",
      pathname: "/env-1/thread-1",
      to: "m-b",
      lands: "/",
    },
    { name: "a change of it lands home", pathname: "/change/g1/appdev/4", to: "m-b", lands: "/" },
    { name: "a Mate of it lands home", pathname: "/mate/p1", to: "m-b", lands: "/" },
    {
      name: "Settings reads the new organization in place",
      pathname: "/settings/appearance",
      to: "m-b",
      lands: null,
    },
    { name: "the projects read it in place", pathname: "/zerops", to: "m-b", lands: null },
    { name: "Git reads it in place", pathname: "/git", to: "m-b", lands: null },
    { name: "home stays home", pathname: "/", to: "m-b", lands: null },
    {
      name: "the organization in view picked again stays",
      pathname: "/env-1/thread-1",
      to: "m-a",
      lands: null,
    },
  ])("$name", ({ pathname, to, lands }) => {
    expect(organizationSwitchLanding({ pathname, from: "m-a", to })).toBe(lands);
  });
});
