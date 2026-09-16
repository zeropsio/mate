import { describe, expect, it } from "vite-plus/test";

import {
  mateMemberName,
  mateOnlyOwnerOpensIt,
  resolveMateOwnerName,
  resolveMateVisibility,
} from "./mateAccess.ts";

const ORG = "org-1";
const PROJECT = "project-1";
const ME = "cu-me";

const viewer = (
  roleCode: string | undefined,
  overrides: Partial<{ membershipId: string }> = {},
) => ({
  id: ORG,
  membershipId: overrides.membershipId ?? ME,
  roleCode,
});

const project = (override?: string) => ({
  id: PROJECT,
  clientId: ORG,
  ...(override === undefined ? {} : { userRoles: [{ clientUserId: ME, roleCode: override }] }),
});

describe("resolveMateVisibility", () => {
  // The same table the door decides by. A row that says `listed` is a row the
  // person sees and the door refuses.
  for (const [orgRole, override, expected] of [
    ["OWNER", undefined, "open"],
    ["ADMIN", undefined, "open"],
    ["BASIC_USER", undefined, "open"],
    ["READ_ONLY", undefined, "listed"],
    ["NO_ACCESS", undefined, "hidden"],
    // The creator of a Mate is its OWNER whatever the org says about them.
    ["READ_ONLY", "OWNER", "open"],
    ["NO_ACCESS", "BASIC_USER", "open"],
    // An override lowers an org owner as readily as it raises a member.
    ["OWNER", "READ_ONLY", "listed"],
    ["OWNER", "NO_ACCESS", "hidden"],
    // A role this build has never heard of shuts the door rather than opening it.
    ["OWNER", "SUPERVISOR", "hidden"],
    ["SUPERVISOR", undefined, "hidden"],
    [undefined, undefined, "hidden"],
  ] as const) {
    it(`${String(orgRole)} with project override ${String(override)} → ${expected}`, () => {
      expect(resolveMateVisibility({ project: project(override), viewer: viewer(orgRole) })).toBe(
        expected,
      );
    });
  }

  it("hides a project in another organization", () => {
    expect(
      resolveMateVisibility({
        project: { id: PROJECT, clientId: "another-org" },
        viewer: viewer("OWNER"),
      }),
    ).toBe("hidden");
  });

  it("hides a project whose overrides cannot be matched to this membership", () => {
    expect(
      resolveMateVisibility({
        project: project("OWNER"),
        viewer: viewer("OWNER", { membershipId: "" }),
      }),
    ).toBe("hidden");
  });
});

describe("mateOnlyOwnerOpensIt", () => {
  it("names the owner when one is known", () => {
    expect(mateOnlyOwnerOpensIt("Jan")).toBe("Jan's Mate — only Jan opens it.");
  });

  // A wrong name would be worse than none, and so would a blank.
  for (const name of [undefined, "", "   "]) {
    it(`says the same thing without a name (${JSON.stringify(name)})`, () => {
      expect(mateOnlyOwnerOpensIt(name)).toBe("Only its owner opens this Mate.");
    });
  }
});

describe("resolveMateOwnerName", () => {
  const members = [
    { id: "cu-jan", user: { fullName: "Jan Novák", email: "jan@example.com" } },
    { id: "cu-eva", user: { firstName: "Eva", lastName: "Dvořák" } },
    { id: "cu-quiet", user: { email: "quiet@example.com" } },
    { id: "cu-blank", user: {} },
  ];

  for (const [name, clientUserId, expected] of [
    ["a full name", "cu-jan", "Jan Novák"],
    ["first and last when there is no full name", "cu-eva", "Eva Dvořák"],
    ["an e-mail rather than a blank", "cu-quiet", "quiet@example.com"],
    ["nothing at all when the member has no name", "cu-blank", undefined],
    ["nothing when the member list does not have them", "cu-gone", undefined],
  ] as const) {
    it(`reads ${name}`, () => {
      expect(
        resolveMateOwnerName({
          project: { id: PROJECT, clientId: ORG, userRoles: [{ clientUserId, roleCode: "OWNER" }] },
          members,
        }),
      ).toBe(expected);
    });
  }

  it("names nobody when the project raised nobody to OWNER", () => {
    expect(
      resolveMateOwnerName({
        project: {
          id: PROJECT,
          clientId: ORG,
          userRoles: [{ clientUserId: ME, roleCode: "ADMIN" }],
        },
        members,
      }),
    ).toBeUndefined();
  });

  it("prefers a full name over an e-mail it also has", () => {
    expect(mateMemberName(members[0]!)).toBe("Jan Novák");
  });
});
