import { describe, expect, it } from "vite-plus/test";

import {
  canCreateMates,
  mateMemberName,
  mateOnlyOwnerOpensIt,
  mateOwnerRecords,
  mateSignerTag,
  resolveMateOwner,
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

describe("resolveMateOwner", () => {
  const jan = {
    id: "cu-jan",
    user: {
      fullName: "Jan Novák",
      avatar: { smallAvatarUrl: "https://example.com/jan.png" },
    },
  };
  const owned = (userRoles: ReadonlyArray<{ clientUserId: string; roleCode: string }>) => ({
    id: PROJECT,
    clientId: ORG,
    userRoles,
  });

  // The whole member row, picture included: the menu wears the owner's face,
  // not just their name.
  it("is the member the project raised to OWNER, picture and all", () => {
    expect(
      resolveMateOwner({
        project: owned([
          { clientUserId: ME, roleCode: "ADMIN" },
          { clientUserId: "cu-jan", roleCode: "OWNER" },
        ]),
        members: [jan],
      }),
    ).toBe(jan);
  });

  // What an org owner's Mate looks like on the wire (measured 2026-09-24):
  // the only per-project roles are the broker's and the container's token
  // users, and the person is named only by the agent they signed in.
  const eva = { id: "cu-eva", user: { id: "u-eva", fullName: "Eva Dvořák" } };
  const services = [
    { clientUserId: "cu-broker", roleCode: "BASIC_USER" },
    { clientUserId: "cu-zcp", roleCode: "BASIC_USER" },
  ];
  const signedIn = (...tags: ReadonlyArray<string>) => ({ ...owned(services), tagList: tags });

  it("is whoever signed the agent in, when the project raised nobody to OWNER", () => {
    expect(
      resolveMateOwner({
        project: signedIn("mate", "mate:bot:Kai", "mate:signer:claude-code:u-eva"),
        members: [jan, eva],
      }),
    ).toBe(eva);
  });

  it("is the first agent's signer when two agents were signed in", () => {
    expect(
      resolveMateOwner({
        project: signedIn("mate:signer:codex:u-eva", "mate:signer:claude-code:u-jan"),
        members: [{ ...jan, user: { ...jan.user, id: "u-jan" } }, eva],
      }),
    ).toBe(eva);
  });

  // A login someone added for their crew says who uses it, not whose Mate it is.
  it("is an agent's signer, never the signer of a login added beside it", () => {
    expect(
      resolveMateOwner({
        project: signedIn("mate:signer:claudeAgent-work:u-jan", "mate:signer:codex:u-eva"),
        members: [{ ...jan, user: { ...jan.user, id: "u-jan" } }, eva],
      }),
    ).toBe(eva);
  });

  it("lets a hand-over's OWNER outrank the signer", () => {
    expect(
      resolveMateOwner({
        project: {
          ...owned([{ clientUserId: "cu-jan", roleCode: "OWNER" }]),
          tagList: ["mate:signer:claude-code:u-eva"],
        },
        members: [jan, eva],
      }),
    ).toBe(jan);
  });

  it("is nobody when the signer is not in the member list", () => {
    expect(
      resolveMateOwner({
        project: signedIn("mate:signer:claude-code:u-gone"),
        members: [jan, eva],
      }),
    ).toBeUndefined();
  });

  for (const [name, userRoles] of [
    ["the project names no OWNER", [{ clientUserId: "cu-jan", roleCode: "ADMIN" }]],
    ["the member list does not have them", [{ clientUserId: "cu-gone", roleCode: "OWNER" }]],
    ["the project names nobody at all", []],
  ] as const) {
    it(`is nobody when ${name} and no agent was signed in`, () => {
      expect(resolveMateOwner({ project: owned(userRoles), members: [jan] })).toBeUndefined();
    });
  }
});

// What the menu knows of a Mate's person from its first paint, before the
// member list is read: whether its records name anybody, and whether anybody
// signed its agent in.
describe("mateOwnerRecords — what a Mate's own records say of its person", () => {
  const OWNER = { clientUserId: "cu-jan", roleCode: "OWNER" };
  const SERVICE = { clientUserId: "cu-zcp", roleCode: "BASIC_USER" };
  it.each([
    {
      name: "an OWNER entry and its agent's signer",
      userRoles: [OWNER],
      tagList: ["mate", "mate:signer:claude-code:u-jan"],
      records: { named: true, signedIn: true, signer: "u-jan" },
    },
    {
      name: "an OWNER entry, nobody signed in (a creator below ADMIN, a hand-over)",
      userRoles: [OWNER, SERVICE],
      tagList: ["mate"],
      records: { named: true, signedIn: false },
    },
    {
      name: "no OWNER entry, the signer names the person (an org owner's Mate)",
      userRoles: [SERVICE],
      tagList: ["mate", "mate:signer:codex:u-eva"],
      records: { named: true, signedIn: true, signer: "u-eva" },
    },
    {
      name: "no OWNER entry and nobody signed in: nobody's",
      userRoles: [SERVICE],
      tagList: ["mate", "mate:bot:Kai"],
      records: { named: false, signedIn: false },
    },
    {
      name: "only a login added beside the agents: nobody's",
      userRoles: [],
      tagList: ["mate:signer:claudeAgent-work:u-jan"],
      records: { named: false, signedIn: false },
    },
    {
      name: "a signer tag that names no user",
      userRoles: undefined,
      tagList: ["mate:signer:codex:"],
      records: { named: false, signedIn: false },
    },
    {
      name: "no records at all",
      userRoles: undefined,
      tagList: undefined,
      records: { named: false, signedIn: false },
    },
    // Two records for one login (two sign-ins racing their tag writes): signed in, by somebody
    // the records do not settle — never the first tag's person (the server reads it the same way).
    {
      name: "two people's records on one login: signed in, whose not known",
      userRoles: [SERVICE],
      tagList: ["mate:signer:claude-code:u-jan", "mate:signer:claude-code:u-eva"],
      records: { named: true, signedIn: true },
    },
    {
      name: "one person twice on one login: theirs",
      userRoles: [SERVICE],
      tagList: ["mate:signer:claude-code:u-jan", "mate:signer:claude-code:u-jan"],
      records: { named: true, signedIn: true, signer: "u-jan" },
    },
    {
      name: "one login not known, the other one person's: not known",
      userRoles: [SERVICE],
      tagList: [
        "mate:signer:codex:u-eva",
        "mate:signer:claude-code:u-jan",
        "mate:signer:claude-code:u-eva",
      ],
      records: { named: true, signedIn: true },
    },
  ])("$name", ({ userRoles, tagList, records }) => {
    expect(mateOwnerRecords({ userRoles, tagList })).toEqual(records);
  });

  it("names no owner from records that name two people on one login", () => {
    const members = [
      { id: "cu-jan", user: { id: "u-jan" } },
      { id: "cu-eva", user: { id: "u-eva" } },
    ];
    const tagList = ["mate:signer:claude-code:u-jan", "mate:signer:claude-code:u-eva"];
    expect(
      resolveMateOwner({ project: { id: "p1", tagList, userRoles: [SERVICE] }, members }),
    ).toBe(undefined);
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

  // A sign-in settles a login recorded for two people: its one record replaces every older one,
  // and never touches a login whose key merely starts the same.
  it.each([
    {
      case: "two people's records on the login become the signer's one",
      tags: [mateSignerTag("claude-code", "eva"), mateSignerTag("claude-code", "ida")],
      expected: [mateSignerTag("claude-code", "jan")],
    },
    {
      case: "a login beyond the defaults keeps its own record",
      tags: [mateSignerTag("claudeAgent-work", "eva"), mateSignerTag("claude-code", "eva")],
      expected: [mateSignerTag("claudeAgent-work", "eva"), mateSignerTag("claude-code", "jan")],
    },
  ])("$case", ({ tags, expected }) => {
    expect(withMateSignerTag(tags, "claude-code", "jan")).toEqual(expected);
  });

  it("records a signer on a project that had no tags at all", () => {
    expect(withMateSignerTag(undefined, "codex", "jan")).toEqual([mateSignerTag("codex", "jan")]);
  });

  // Signing in again with the same account must cost a read and nothing else:
  // the TagWriter writes nothing when the list keeps the same tags.
  it("keeps the tags of a list that already records exactly this signer", () => {
    expect(
      [...withMateSignerTag([mateSignerTag("codex", "jan"), OTHER], "codex", "jan")].sort(),
    ).toEqual([OTHER, mateSignerTag("codex", "jan")].sort());
  });

  for (const [name, tagList] of [
    ["a different signer", [mateSignerTag("codex", "eva")]],
    ["no signer at all", [OTHER]],
    [
      "two signers for the same agent",
      [mateSignerTag("codex", "jan"), mateSignerTag("codex", "eva")],
    ],
  ] as const) {
    it(`rewrites over ${name}`, () => {
      const written = withMateSignerTag(tagList, "codex", "jan");
      expect(written.filter((tag) => tag.startsWith("mate:signer:codex:"))).toEqual([
        mateSignerTag("codex", "jan"),
      ]);
      expect([...written].sort()).not.toEqual([...tagList].sort());
    });
  }
});

describe("the verbs a Mate offers (guide 0.8)", () => {
  const verbs = (orgRole: string | undefined, override?: string) =>
    resolveMateVerbs({ project: project(override), viewer: viewer(orgRole) });

  // A verb a person cannot finish is not offered. Rename, tag and move are
  // writes to the project's own record, which need effective OWNER or ADMIN
  // there, and so is deleting the project; handing a Mate over writes a
  // per-project role, which is an org owner's or admin's verb only.
  for (const [orgRole, override, expected] of [
    [
      "OWNER",
      undefined,
      { open: true, rename: true, tag: true, move: true, delete: true, assign: true },
    ],
    [
      "ADMIN",
      undefined,
      { open: true, rename: true, tag: true, move: true, delete: true, assign: true },
    ],
    // A plain member with a Mate of their own: theirs to rename, to move and
    // to delete (measured 2026-09-15), never theirs to give away.
    [
      "READ_ONLY",
      "OWNER",
      { open: true, rename: true, tag: true, move: true, delete: true, assign: false },
    ],
    [
      "NO_ACCESS",
      "OWNER",
      { open: true, rename: true, tag: true, move: true, delete: true, assign: false },
    ],
    // A member of the org with no standing on this project: they see it.
    [
      "BASIC_USER",
      undefined,
      { open: true, rename: false, tag: false, move: false, delete: false, assign: false },
    ],
    [
      "READ_ONLY",
      undefined,
      { open: false, rename: false, tag: false, move: false, delete: false, assign: false },
    ],
    [
      "NO_ACCESS",
      undefined,
      { open: false, rename: false, tag: false, move: false, delete: false, assign: false },
    ],
    // An override lowers an org owner here, but their org role still lets them
    // hand the Mate to somebody — that is what makes a leaver's Mate
    // recoverable at all.
    [
      "OWNER",
      "READ_ONLY",
      { open: false, rename: false, tag: false, move: false, delete: false, assign: true },
    ],
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
    ).toEqual({
      open: false,
      rename: false,
      tag: false,
      move: false,
      delete: false,
      assign: false,
    });
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
