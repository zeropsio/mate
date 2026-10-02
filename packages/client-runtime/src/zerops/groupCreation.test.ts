import { describe, expect, it } from "vite-plus/test";

import {
  canWriteRegistry,
  mateAwaitingRegistryLine,
  onlyTheseCanAddAProject,
  resolveAddProjectVerb,
  resolveGroupGitea,
  finishMateSetupScope,
  finishMateSetupVerb,
  resolveMateRegistration,
  type MateRegistration,
} from "./groupCreation.ts";
import type { ZeropsRegistry } from "./hq/registry.ts";
import type { OfferViewer } from "./offers.ts";

const ACME: ZeropsRegistry = {
  groups: [
    {
      groupId: "g-acme",
      name: "Acme",
      slug: "g-acme",
      projects: [{ projectId: "p-fen", kind: "mate" }],
    },
  ],
};

function viewer(roleCode: string | undefined, extra: Partial<OfferViewer> = {}): OfferViewer {
  return { userId: "u-1", clientUserId: "cu-1", roleCode, canCreateProjects: false, ...extra };
}

describe("who may add a project", () => {
  it.each([
    { role: "OWNER", expected: true },
    { role: "ADMIN", expected: true },
    { role: "BASIC_USER", expected: false },
    { role: "READ_ONLY", expected: false },
    { role: "NO_ACCESS", expected: false },
  ])("$role writes the registry: $expected", ({ role, expected }) => {
    expect(canWriteRegistry(viewer(role))).toBe(expected);
  });

  it("is nobody the session does not name: unknown is no", () => {
    expect(canWriteRegistry(undefined)).toBe(false);
    expect(resolveAddProjectVerb({ viewer: undefined })).toMatchObject({ offered: false });
  });

  it("does not offer it to a member who can create projects — the registry is not theirs", () => {
    // The same person IS offered *Add Mate*: making a project is a platform
    // right, writing the registry is not.
    const verb = resolveAddProjectVerb({
      viewer: viewer("READ_ONLY", { canCreateProjects: true }),
      admins: [{ id: "cu-9", user: { fullName: "Jan Novák" } }],
    });
    expect(verb).toEqual({ offered: false, reason: "Only Jan Novák adds a project." });
  });

  it("offers it to an owner", () => {
    expect(resolveAddProjectVerb({ viewer: viewer("OWNER") })).toEqual({ offered: true });
  });

  it.each([
    { admins: [], expected: "Only an owner or admin adds a project." },
    {
      admins: [{ id: "a", user: { fullName: "Jan" } }],
      expected: "Only Jan adds a project.",
    },
    {
      admins: [
        { id: "a", user: { fullName: "Jan" } },
        { id: "b", user: { email: "eva@acme.test" } },
      ],
      expected: "Only Jan and eva@acme.test add a project.",
    },
    {
      admins: [
        { id: "a", user: { fullName: "Jan" } },
        { id: "b", user: { fullName: "Eva" } },
        { id: "c", user: { fullName: "Petr" } },
      ],
      expected: "Only Jan, Eva and Petr add a project.",
    },
    // A name nobody can be read for is better absent than guessed at.
    { admins: [{ id: "a" }], expected: "Only an owner or admin adds a project." },
  ])("names who can: $expected", ({ admins, expected }) => {
    expect(onlyTheseCanAddAProject(admins)).toBe(expected);
  });
});

describe("resolveGroupGitea", () => {
  it.each([
    { organizationExists: true, expected: "ready" },
    { organizationExists: false, expected: "being-set-up" },
    { organizationExists: undefined, expected: "unknown" },
  ])("reads $organizationExists as $expected", ({ organizationExists, expected }) => {
    expect(resolveGroupGitea({ organizationExists })).toBe(expected);
  });
});

describe("resolveMateRegistration", () => {
  it("is registered once the registry names the project", () => {
    expect(resolveMateRegistration({ registry: ACME, projectId: "p-fen" })).toBe("registered");
  });

  it("waits for an owner for a Mate a member created", () => {
    expect(resolveMateRegistration({ registry: ACME, projectId: "p-new" })).toBe("awaiting-owner");
  });

  it.each([
    {
      admins: [],
      expected:
        "Waiting for an owner or admin to add it to the project — until then it cannot push.",
    },
    {
      admins: [{ id: "a", user: { fullName: "Jan" } }],
      expected: "Waiting for Jan to add it to the project — until then it cannot push.",
    },
    {
      admins: [
        { id: "a", user: { fullName: "Jan" } },
        { id: "b", user: { fullName: "Eva" } },
      ],
      expected: "Waiting for Jan or Eva to add it to the project — until then it cannot push.",
    },
  ])("says $expected", ({ admins, expected }) => {
    expect(mateAwaitingRegistryLine(admins)).toBe(expected);
  });
});

describe("finishMateSetupVerb", () => {
  const HALF_MADE = {
    registration: "registered" as MateRegistration,
    containerMissing: false,
    pressStopped: false,
    closedOffMissing: false,
    needsHarden: false,
    pastGrace: true,
    viewerIsAdder: false,
    hasContainer: true,
    recordMissing: false,
    mayCreateRecord: false,
  };
  it.each([
    {
      name: "an owner, on a Mate nobody has registered",
      input: { ...HALF_MADE, registration: "awaiting-owner" },
      viewerRole: "OWNER",
      expected: "Finish setup",
    },
    {
      name: "an admin, who may write the registry too",
      input: { ...HALF_MADE, registration: "awaiting-owner" },
      viewerRole: "ADMIN",
      expected: "Finish setup",
    },
    {
      name: "an owner, on a Mate whose container never came",
      input: { ...HALF_MADE, containerMissing: true },
      viewerRole: "OWNER",
      expected: "Finish setup",
    },
    {
      name: "an owner, on a Mate whose press in this tab stopped",
      input: { ...HALF_MADE, pressStopped: true },
      viewerRole: "OWNER",
      expected: "Finish setup",
    },
    {
      name: "an owner, on a Mate whose press stopped before its close-off was marked",
      input: { ...HALF_MADE, closedOffMissing: true },
      viewerRole: "OWNER",
      expected: "Finish setup",
    },
    // A press may still be running in another browser for two minutes: its Mate reads
    // unregistered, or not closed off, for those seconds, and finishing it then would race it.
    {
      name: "nobody, on a Mate made a moment ago that nobody has registered yet",
      input: { ...HALF_MADE, registration: "awaiting-owner", pastGrace: false },
      viewerRole: "OWNER",
      expected: undefined,
    },
    {
      name: "nobody, on a Mate made a moment ago whose close-off is not marked yet",
      input: { ...HALF_MADE, closedOffMissing: true, pastGrace: false },
      viewerRole: "OWNER",
      expected: undefined,
    },
    {
      name: "an owner, at once, on a Mate whose press in this tab stopped",
      input: { ...HALF_MADE, pressStopped: true, pastGrace: false },
      viewerRole: "OWNER",
      expected: "Finish setup",
    },
    // Read off the platform's token list, in any browser, after a reload too.
    {
      name: "an owner, on a Mate whose key is still ADMIN — a pool claim whose harden never ran",
      input: { ...HALF_MADE, needsHarden: true },
      viewerRole: "OWNER",
      expected: "Finish setup",
    },
    // `needsHarden` is the viewer's to fix — an org owner or the key's creator (`mateHardenableBy`).
    {
      name: "the member who created its key, on a Mate whose key is still ADMIN",
      input: { ...HALF_MADE, needsHarden: true, viewerIsAdder: true },
      viewerRole: "BASIC_USER",
      expected: "Finish setup",
    },
    // Closing off is all the adder may do, and a Mate with no container has nothing to close off:
    // never reported finished (pass 28 review).
    {
      name: "nobody but an owner or admin, on a Mate whose press stopped before its container",
      input: { ...HALF_MADE, pressStopped: true, viewerIsAdder: true, hasContainer: false },
      viewerRole: "BASIC_USER",
      expected: undefined,
    },
    // Closing off needs no registry rights: the member who added it may close it off.
    {
      name: "the member who added it, on a Mate its press left open",
      input: { ...HALF_MADE, closedOffMissing: true, viewerIsAdder: true },
      viewerRole: "BASIC_USER",
      expected: "Finish setup",
    },
    {
      name: "another member, on a Mate a press left open",
      input: { ...HALF_MADE, closedOffMissing: true },
      viewerRole: "BASIC_USER",
      expected: undefined,
    },
    {
      name: "the member who added it, on a Mate nobody has registered: that is an owner's",
      input: { ...HALF_MADE, registration: "awaiting-owner", viewerIsAdder: true },
      viewerRole: "BASIC_USER",
      expected: undefined,
    },
    {
      name: "the member who made it, and cannot finish it",
      input: { ...HALF_MADE, registration: "awaiting-owner" },
      viewerRole: "READ_ONLY",
      expected: undefined,
    },
    {
      name: "a BASIC_USER, who still cannot write the Gitea project's tags",
      input: { ...HALF_MADE, containerMissing: true },
      viewerRole: "BASIC_USER",
      expected: undefined,
    },
    {
      name: "an owner, on a Mate already whole",
      input: HALF_MADE,
      viewerRole: "OWNER",
      expected: undefined,
    },
    // A Mate HQ holds no record of — its record's write failed mid-way, or it sits in no
    // application with none — is finished by whoever HQ's rule lets create its record.
    {
      name: "whoever may create its record, on a Mate HQ holds no record of",
      input: { ...HALF_MADE, recordMissing: true, mayCreateRecord: true },
      viewerRole: "BASIC_USER",
      expected: "Finish setup",
    },
    {
      name: "nobody else, on a Mate HQ holds no record of",
      input: { ...HALF_MADE, recordMissing: true },
      viewerRole: "OWNER",
      expected: undefined,
    },
    {
      name: "nobody, on a Mate made a moment ago whose record is not written yet",
      input: { ...HALF_MADE, recordMissing: true, mayCreateRecord: true, pastGrace: false },
      viewerRole: "OWNER",
      expected: undefined,
    },
    {
      name: "somebody whose role has not been read yet",
      input: { ...HALF_MADE, registration: "awaiting-owner" },
      viewerRole: undefined,
      expected: undefined,
    },
  ] as const)("offers nothing but the right verb to $name", ({ input, viewerRole, expected }) => {
    expect(finishMateSetupVerb({ ...input, writer: canWriteRegistry(viewer(viewerRole)) })).toBe(
      expected,
    );
  });
});

describe("finishMateSetupScope", () => {
  it.each([
    { role: "OWNER", want: "whole" },
    { role: "ADMIN", want: "whole" },
    { role: "BASIC_USER", want: "close-off" },
    { role: undefined, want: "close-off" },
  ])("$role: $want", ({ role, want }) => {
    expect(finishMateSetupScope(canWriteRegistry(viewer(role)))).toBe(want);
  });
});
