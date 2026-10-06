import { describe, expect, it } from "vite-plus/test";

import {
  mateMemberName,
  mateOnlyOwnerOpensIt,
  mateOwnerRecords,
  resolveMateVerbs,
  resolveMateVisibility,
  withMateProjectRole,
} from "./mateAccess.ts";
import type { HqPlacement } from "./hq/placement.ts";

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

describe("mateMemberName", () => {
  it.each([
    [
      "a full name over an e-mail it also has",
      { fullName: "Jan Novák", email: "jan@example.com" },
      "Jan Novák",
    ],
    [
      "first and last when there is no full name",
      { firstName: "Eva", lastName: "Dvořák" },
      "Eva Dvořák",
    ],
    ["an e-mail rather than a blank", { email: "quiet@example.com" }, "quiet@example.com"],
    ["nothing at all when the member has no name", {}, undefined],
  ] as const)("reads %s", (_name, user, expected) => {
    expect(mateMemberName({ id: "cu-x", user })).toBe(expected);
  });
});

/** A Mate HQ places in no application, its overview's logins naming who signed each in. */
const placedWith = (signers: Readonly<Record<string, string>>): HqPlacement => ({
  appId: null,
  appName: null,
  kind: "mate",
  mate: {
    face: "",
    logins: Object.fromEntries(
      Object.entries(signers).map(([key, userId]) => [
        key,
        { signedInBy: userId === "" ? null : userId, present: true, token: false },
      ]),
    ),
  },
});

// A7: the owner named from HQ's people (`hqMates.ts`), never a member list read — HQ names exactly
// the people the reader's view names, a token never.
describe("mateOwnerRecords — what a Mate's own records say of its person", () => {
  const OWNER = { clientUserId: "cu-jan", roleCode: "OWNER" };
  const SERVICE = { clientUserId: "cu-zcp", roleCode: "BASIC_USER" };
  it.each([
    {
      name: "an OWNER entry and its agent's signer",
      userRoles: [OWNER],
      signers: { "claude-code": "u-jan" },
      records: { named: true, signedIn: true, signer: "u-jan" },
    },
    {
      name: "an OWNER entry, nobody signed in (a creator below ADMIN, a hand-over)",
      userRoles: [OWNER, SERVICE],
      signers: {},
      records: { named: true, signedIn: false },
    },
    {
      name: "no OWNER entry, the signer names the person (an org owner's Mate)",
      userRoles: [SERVICE],
      signers: { codex: "u-eva" },
      records: { named: true, signedIn: true, signer: "u-eva" },
    },
    {
      name: "no OWNER entry and nobody signed in: nobody's",
      userRoles: [SERVICE],
      signers: {},
      records: { named: false, signedIn: false },
    },
    {
      name: "only a login added beside the agents: nobody's",
      userRoles: [],
      signers: { "claudeAgent-work": "u-jan" },
      records: { named: false, signedIn: false },
    },
    {
      name: "a signer that names no user",
      userRoles: undefined,
      signers: { codex: "" },
      records: { named: undefined, signedIn: false },
    },
    {
      name: "no overview relayed: no signer known",
      userRoles: undefined,
      signers: undefined,
      records: { named: undefined, signedIn: false },
    },
  ])("$name", ({ userRoles, signers, records }) => {
    expect(
      mateOwnerRecords({
        userRoles,
        ...(signers === undefined ? {} : { hq: placedWith(signers) }),
      }),
    ).toEqual({
      ...records,
      person: "signer" in records ? records.signer : undefined,
      runsWithoutSignIn: false,
    });
  });
});

describe("the verbs a Mate offers (guide 0.8)", () => {
  const verbs = (orgRole: string | undefined, override?: string) =>
    resolveMateVerbs({ project: project(override), viewer: viewer(orgRole) });

  // A verb a person cannot finish is not offered. Deleting the project, and renaming it — a Mate's
  // name is its project's (D3) — need effective OWNER or ADMIN there; handing a Mate over writes a
  // per-project role, which is an org owner's or admin's verb only.
  for (const [orgRole, override, expected] of [
    ["OWNER", undefined, { delete: true, rename: true, assign: true }],
    ["ADMIN", undefined, { delete: true, rename: true, assign: true }],
    // A plain member with a Mate of their own: theirs to delete (measured
    // 2026-09-15) and to rename, never theirs to give away.
    ["READ_ONLY", "OWNER", { delete: true, rename: true, assign: false }],
    ["NO_ACCESS", "OWNER", { delete: true, rename: true, assign: false }],
    // A member of the org with no standing on this project: they see it.
    ["BASIC_USER", undefined, { delete: false, rename: false, assign: false }],
    ["READ_ONLY", undefined, { delete: false, rename: false, assign: false }],
    ["NO_ACCESS", undefined, { delete: false, rename: false, assign: false }],
    // An override lowers an org owner here, but their org role still lets them
    // hand the Mate to somebody — that is what makes a leaver's Mate
    // recoverable at all.
    ["OWNER", "READ_ONLY", { delete: false, rename: false, assign: true }],
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
    ).toEqual({ delete: false, rename: false, assign: false });
  });
});

// The E2E run (F8): the list held 200 rows, nearly all integration tokens, and a token was its
// default. A Mate is handed to a person, a member who has joined.
describe("withMateProjectRole — handing a Mate over", () => {
  it("sets this project's role and leaves the person's other projects alone", () => {
    expect(
      withMateProjectRole(
        [
          { projectId: "p-other", roleCode: "READ_ONLY" },
          { projectId: "p-fen", roleCode: "BASIC_USER" },
        ],
        "p-fen",
        "OWNER",
      ),
    ).toEqual([
      { projectId: "p-other", roleCode: "READ_ONLY" },
      { projectId: "p-fen", roleCode: "OWNER" },
    ]);
  });

  it("adds an override for a person who had none", () => {
    expect(withMateProjectRole(undefined, "p-fen", "OWNER")).toEqual([
      { projectId: "p-fen", roleCode: "OWNER" },
    ]);
  });

  // The same call, lowered, takes a Mate away — overrides are measured in
  // both directions.
  it("takes a Mate away when it lowers somebody", () => {
    expect(
      withMateProjectRole([{ projectId: "p-fen", roleCode: "OWNER" }], "p-fen", "READ_ONLY"),
    ).toEqual([{ projectId: "p-fen", roleCode: "READ_ONLY" }]);
  });
});

describe("a ready agent's person from HQ", () => {
  it.each([
    ["ready: its maker", true, {}, "u-maker"],
    ["not ready: no signer", false, {}, undefined],
    ["signed in: the signer first", true, { codex: "u-signer" }, "u-signer"],
  ] as const)("%s", (_case, ready, signers, person) => {
    const placement = placedWith(signers);
    const project = {
      id: PROJECT,
      hq: {
        ...placement,
        mate: { ...placement.mate!, madeBy: "u-maker", runsWithoutSignIn: ready },
      },
    };
    expect(mateOwnerRecords(project).person).toBe(person);
    expect(mateOwnerRecords(project).runsWithoutSignIn).toBe(ready);
  });
});

it.each([false, true])(
  "a signed-out Mate keeps its last signer over its maker (runsWithoutSignIn: %s)",
  (runsWithoutSignIn) => {
    const hq: HqPlacement = {
      ...placedWith({}),
      mate: {
        face: "",
        madeBy: "u-maker",
        runsWithoutSignIn,
        logins: {
          "claude-code": {
            signedInBy: null,
            lastSignedInBy: "u-eva",
            present: false,
            token: false,
          },
        },
      },
    };
    const project = { id: PROJECT, clientId: ORG, userRoles: [], hq };
    expect(mateOwnerRecords(project)).toEqual({
      named: true,
      signedIn: false,
      signer: "u-eva",
      person: "u-eva",
      runsWithoutSignIn,
    });
  },
);

it("logout keeps Claude's badge priority when Codex remains signed in by someone else", () => {
  const hq: HqPlacement = {
    ...placedWith({}),
    mate: {
      face: "",
      logins: {
        "claude-code": { signedInBy: null, lastSignedInBy: "u-eva", present: false, token: false },
        codex: { signedInBy: "u-jan", lastSignedInBy: "u-jan", present: true, token: false },
      },
    },
  };
  expect(mateOwnerRecords({ hq, userRoles: [] })).toEqual({
    named: true,
    signedIn: true,
    signer: "u-eva",
    person: "u-eva",
    runsWithoutSignIn: false,
  });
});
