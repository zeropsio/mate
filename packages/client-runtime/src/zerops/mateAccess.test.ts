import { describe, expect, it } from "vite-plus/test";

import {
  canCreateMates,
  mateMemberName,
  mateOnlyOwnerOpensIt,
  mateSignerTag,
  mateSignerTagIsCurrent,
  resolveMateOwnerName,
  resolveMateVerbs,
  resolveMateVisibility,
  withMateProjectRole,
  withMateSignerTag,
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

describe("the signer tag (D6)", () => {
  const OTHER = "mate:g:acme";

  it("keeps every other tag and replaces this agent's signer", () => {
    expect(
      withMateSignerTag(
        [OTHER, mateSignerTag("claude-code", "old"), "mate:role:dev"],
        "claude-code",
        "jan",
      ),
    ).toEqual([OTHER, "mate:role:dev", mateSignerTag("claude-code", "jan")]);
  });

  it("leaves the other agent's signer alone", () => {
    expect(withMateSignerTag([mateSignerTag("codex", "eva")], "claude-code", "jan")).toEqual([
      mateSignerTag("codex", "eva"),
      mateSignerTag("claude-code", "jan"),
    ]);
  });

  it("records a signer on a project that had no tags at all", () => {
    expect(withMateSignerTag(undefined, "codex", "jan")).toEqual([mateSignerTag("codex", "jan")]);
  });

  // Signing in again with the same account must cost a read and nothing else:
  // the caller skips the write when the list already says the right thing.
  it("recognises a list that already records exactly this signer", () => {
    expect(mateSignerTagIsCurrent([OTHER, mateSignerTag("codex", "jan")], "codex", "jan")).toBe(
      true,
    );
  });

  for (const [name, tagList] of [
    ["a different signer", [mateSignerTag("codex", "eva")]],
    ["no signer at all", [OTHER]],
    [
      "two signers for the same agent",
      [mateSignerTag("codex", "jan"), mateSignerTag("codex", "eva")],
    ],
    ["nothing", undefined],
  ] as const) {
    it(`rewrites over ${name}`, () => {
      expect(mateSignerTagIsCurrent(tagList, "codex", "jan")).toBe(false);
    });
  }
});

describe("the verbs a Mate offers (guide 0.8)", () => {
  const verbs = (orgRole: string | undefined, override?: string) =>
    resolveMateVerbs({ project: project(override), viewer: viewer(orgRole) });

  // A verb a person cannot finish is not offered. Rename, tag and move are
  // writes to the project's own record, which need effective OWNER or ADMIN
  // there; handing a Mate over writes a per-project role, which is an org
  // owner's or admin's verb only.
  for (const [orgRole, override, expected] of [
    ["OWNER", undefined, { open: true, rename: true, tag: true, move: true, assign: true }],
    ["ADMIN", undefined, { open: true, rename: true, tag: true, move: true, assign: true }],
    // A plain member with a Mate of their own: theirs to rename and to move,
    // never theirs to give away.
    ["READ_ONLY", "OWNER", { open: true, rename: true, tag: true, move: true, assign: false }],
    ["NO_ACCESS", "OWNER", { open: true, rename: true, tag: true, move: true, assign: false }],
    // A member of the org with no standing on this project: they see it.
    [
      "BASIC_USER",
      undefined,
      { open: true, rename: false, tag: false, move: false, assign: false },
    ],
    [
      "READ_ONLY",
      undefined,
      { open: false, rename: false, tag: false, move: false, assign: false },
    ],
    [
      "NO_ACCESS",
      undefined,
      { open: false, rename: false, tag: false, move: false, assign: false },
    ],
    // An override lowers an org owner here, but their org role still lets them
    // hand the Mate to somebody — that is what makes a leaver's Mate
    // recoverable at all.
    ["OWNER", "READ_ONLY", { open: false, rename: false, tag: false, move: false, assign: true }],
  ] as const) {
    it(`${String(orgRole)} with project override ${String(override)}`, () => {
      expect(verbs(orgRole, override)).toEqual(expected);
    });
  }

  it("offers nothing on a project in another organization", () => {
    expect(
      resolveMateVerbs({
        project: { id: PROJECT, clientId: "another-org" },
        viewer: viewer("OWNER"),
      }),
    ).toEqual({ open: false, rename: false, tag: false, move: false, assign: false });
  });
});

describe("canCreateMates — the one Add Mate gate", () => {
  for (const [name, input, allowed] of [
    ["an org owner", { roleCode: "OWNER" }, true],
    ["an org admin without the flag", { roleCode: "ADMIN" }, true],
    ["a member with the flag", { roleCode: "NO_ACCESS", canCreateProjects: true }, true],
    ["a read-only member with the flag", { roleCode: "READ_ONLY", canCreateProjects: true }, true],
    ["a member without it", { roleCode: "BASIC_USER" }, false],
    ["a read-only member without it", { roleCode: "READ_ONLY" }, false],
    ["somebody who is not active", { roleCode: "OWNER", status: "INVITED" }, false],
  ] as const) {
    it(`${allowed ? "offers" : "withholds"} Add Mate from ${name}`, () => {
      expect(canCreateMates(input)).toBe(allowed);
    });
  }
});

describe("withMateProjectRole — handing a Mate over", () => {
  it("raises one person and leaves everybody else's override alone", () => {
    expect(
      withMateProjectRole(
        [
          { clientUserId: "cu-jan", roleCode: "OWNER" },
          { clientUserId: "cu-eva", roleCode: "BASIC_USER" },
        ],
        "cu-eva",
        "OWNER",
      ),
    ).toEqual([
      { clientUserId: "cu-jan", roleCode: "OWNER" },
      { clientUserId: "cu-eva", roleCode: "OWNER" },
    ]);
  });

  it("adds an override to a project that had none", () => {
    expect(withMateProjectRole(undefined, "cu-eva", "OWNER")).toEqual([
      { clientUserId: "cu-eva", roleCode: "OWNER" },
    ]);
  });

  // The same call, lowered, takes a Mate away — overrides are measured in
  // both directions.
  it("takes a Mate away when it lowers somebody", () => {
    expect(
      withMateProjectRole([{ clientUserId: "cu-jan", roleCode: "OWNER" }], "cu-jan", "READ_ONLY"),
    ).toEqual([{ clientUserId: "cu-jan", roleCode: "READ_ONLY" }]);
  });
});
