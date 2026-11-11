import { describe, expect, it } from "vite-plus/test";

import {
  mateMemberName,
  mateOnlyOwnerOpensIt,
  mateOwnerRecords,
  resolveMateVerbs,
  resolveMateVisibility,
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
  it.each(
    Array.from(
      [
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
      ] as const,
      ([orgRole, override, expected]) => ({
        title: `${String(orgRole)} with project override ${String(override)} → ${expected}`,
        orgRole,
        override,
        expected,
      }),
    ),
  )("$title", ({ orgRole, override, expected }) => {
    expect(resolveMateVisibility({ project: project(override), viewer: viewer(orgRole) })).toBe(
      expected,
    );
  });

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
    expect(mateOnlyOwnerOpensIt("Jan")).toBe("Jan's Mate — you have Read access.");
  });

  // A wrong name would be worse than none, and so would a blank.
  it.each(
    Array.from([undefined, "", "   "], (name) => ({
      title: `says the same thing without a name (${JSON.stringify(name)})`,
      name,
    })),
  )("$title", ({ name }) => {
    expect(mateOnlyOwnerOpensIt(name)).toBe("You have Read access to this Mate.");
  });
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
  it.each([
    {
      name: "HQ names an owner, and its agent's signer",
      owned: true,
      signers: { "claude-code": "u-jan" },
      records: { named: true, signedIn: true },
    },
    {
      name: "HQ names an owner, nobody signed in (a creator below ADMIN, a hand-over)",
      owned: true,
      signers: {},
      records: { named: true, signedIn: false },
    },
    {
      name: "HQ names no owner and nobody signed in: nobody's",
      owned: false,
      signers: {},
      records: { named: false, signedIn: false },
    },
    {
      name: "only a login added beside the agents: nobody's",
      owned: false,
      signers: { "claudeAgent-work": "u-jan" },
      records: { named: false, signedIn: false },
    },
    {
      name: "a signer that names no user",
      owned: undefined,
      signers: { codex: "" },
      records: { named: undefined, signedIn: false },
    },
    {
      name: "no overview relayed: no signer known",
      owned: undefined,
      signers: undefined,
      records: { named: undefined, signedIn: false },
    },
  ])("$name", ({ owned, signers, records }) => {
    expect(
      mateOwnerRecords(signers === undefined ? {} : { hq: placedWith(signers) }, owned),
    ).toEqual({ ...records, runsWithoutSignIn: false });
  });
});

describe("the verbs a Mate offers (guide 0.8)", () => {
  const verbs = (orgRole: string | undefined, override?: string) =>
    resolveMateVerbs({ project: project(override), viewer: viewer(orgRole) });

  // A verb a person cannot finish is not offered. Deleting the project, and renaming it — a Mate's
  // name is its project's (D3) — need effective OWNER or ADMIN there.
  it.each(
    Array.from(
      [
        ["OWNER", undefined, { delete: true, rename: true }],
        ["ADMIN", undefined, { delete: true, rename: true }],
        // A plain member with a Mate of their own: theirs to delete (measured
        // 2026-09-15) and to rename.
        ["READ_ONLY", "OWNER", { delete: true, rename: true }],
        ["NO_ACCESS", "OWNER", { delete: true, rename: true }],
        // A member of the org with no standing on this project: they see it.
        ["BASIC_USER", undefined, { delete: false, rename: false }],
        ["READ_ONLY", undefined, { delete: false, rename: false }],
        ["NO_ACCESS", undefined, { delete: false, rename: false }],
        // An override lowers an org owner here.
        ["OWNER", "READ_ONLY", { delete: false, rename: false }],
      ] as const,
      ([orgRole, override, expected]) => ({
        title: `${String(orgRole)} with project override ${String(override)}`,
        orgRole,
        override,
        expected,
      }),
    ),
  )("$title", ({ orgRole, override, expected }) => {
    expect(verbs(orgRole, override)).toEqual(expected);
  });

  it("offers nothing on a project in another organization", () => {
    expect(
      resolveMateVerbs({
        project: { id: PROJECT, clientId: "another-org" },
        viewer: viewer("OWNER"),
      }),
    ).toEqual({ delete: false, rename: false });
  });
});

// A listing row that names only the viewer's own grant (`mine`) keeps it as `viewerRoleCode`.
describe("a member's own project grant decides their Mate as a named override does", () => {
  const own = (roleCode: string) => ({ id: PROJECT, clientId: ORG, viewerRoleCode: roleCode });
  it.each([
    {
      title: "a basic user who owns the project deletes and renames its Mate",
      orgRole: "BASIC_USER",
      grant: "OWNER",
      verbs: { delete: true, rename: true },
    },
    {
      title: "an admin held read-only on the project neither deletes nor renames its Mate",
      orgRole: "ADMIN",
      grant: "READ_ONLY",
      verbs: { delete: false, rename: false },
    },
  ] as const)("$title", ({ orgRole, grant, verbs }) => {
    const input = { project: own(grant), viewer: viewer(orgRole, { membershipId: "" }) };
    expect(resolveMateVerbs(input)).toEqual(verbs);
  });

  it("an admin held read-only on the project sees its Mate listed, never opened", () => {
    expect(
      resolveMateVisibility({
        project: own("READ_ONLY"),
        viewer: viewer("ADMIN", { membershipId: "" }),
      }),
    ).toBe("listed");
  });
});

describe("an automated Mate's records", () => {
  it.each([
    ["automated, nobody signed in", true, true],
    ["ordinary, nobody signed in", false, false],
  ] as const)(
    "an automated Mate waits on nobody's sign-in: its agents run on the organization's key (%s)",
    (_case, automated, runsWithoutSignIn) => {
      const placement = placedWith({});
      const project = {
        id: PROJECT,
        hq: { ...placement, mate: { ...placement.mate!, madeBy: "u-maker", automated } },
      };
      expect(mateOwnerRecords(project, undefined)).toMatchObject({ runsWithoutSignIn });
    },
  );
});
