import { describe, expect, it } from "vite-plus/test";

import {
  canWriteRegistry,
  onlyTheseCanAddAProject,
  planGroupMembership,
  planGroupRegistration,
  resolveAddProjectVerb,
  resolveGroupGitea,
} from "./groupCreation.ts";
import { parseZeropsRegistry } from "./groupRegistry.ts";
import type { MateAccessViewer } from "./mateAccess.ts";

const EMPTY = parseZeropsRegistry(["mate:tool:gitea"]);
const ACME = parseZeropsRegistry([
  "mate:tool:gitea",
  "mate:gn:g-acme:acme",
  "mate:gm:g-acme:p-fen:mate",
]);

function viewer(roleCode: string, extra: Partial<MateAccessViewer> = {}): MateAccessViewer {
  return { id: "org-1", membershipId: "cu-1", roleCode, ...extra };
}

describe("who may add a project", () => {
  it.each([
    { role: "OWNER", expected: true },
    { role: "ADMIN", expected: true },
    { role: "BASIC_USER", expected: false },
    { role: "READ_ONLY", expected: false },
    { role: "NO_ACCESS", expected: false },
  ])("$role writes the registry: $expected", ({ role, expected }) => {
    expect(canWriteRegistry({ roleCode: role })).toBe(expected);
  });

  it("does not offer it to a member who can create projects — the registry is not theirs", () => {
    // The same person IS offered *Add Mate*: making a project is a platform
    // right, writing the registry is not.
    const verb = resolveAddProjectVerb({
      viewer: viewer("READ_ONLY", { canCreateProjects: true }),
      admins: [{ id: "cu-9", user: { fullName: "Jan Novák" } }],
      hasRegistry: true,
    });
    expect(verb).toEqual({ offered: false, reason: "Only Jan Novák adds a project." });
  });

  it("offers it to an owner once the account has a Gitea", () => {
    expect(resolveAddProjectVerb({ viewer: viewer("OWNER"), hasRegistry: true })).toEqual({
      offered: true,
    });
  });

  it("refuses an owner too while there is no registry to write to", () => {
    expect(resolveAddProjectVerb({ viewer: viewer("OWNER"), hasRegistry: false })).toEqual({
      offered: false,
      reason: "Your account's Gitea is still being set up.",
    });
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

describe("planGroupRegistration", () => {
  it("writes the group's name tag and keeps every other tag", () => {
    const result = planGroupRegistration({ name: "Acme", groupId: "g-1", registry: EMPTY });
    expect(result).toEqual({
      ok: true,
      plan: { groupId: "g-1", slug: "acme", tagList: ["mate:gn:g-1:acme", "mate:tool:gitea"] },
    });
  });

  it("keeps the groups that are already there, and their memberships", () => {
    const result = planGroupRegistration({ name: "Beta", groupId: "g-2", registry: ACME });
    expect(result.ok && result.plan.tagList).toEqual([
      "mate:gm:g-acme:p-fen:mate",
      "mate:gn:g-2:beta",
      "mate:gn:g-acme:acme",
      "mate:tool:gitea",
    ]);
  });

  it.each([
    { name: "Acme", expected: "acme-2" },
    { name: "acme!", expected: "acme-2" },
    { name: "Ácme", expected: "acme-2" },
  ])("numbers $name past the slug acme already taken", ({ name, expected }) => {
    const result = planGroupRegistration({ name, groupId: "g-2", registry: ACME });
    expect(result.ok && result.plan.slug).toBe(expected);
  });

  it.each([
    { name: "  ", groupId: "g-2", registry: EMPTY, reason: "A project needs a name." },
    { name: "Acme", groupId: "g-acme", registry: ACME, reason: "That project already exists." },
  ])("refuses $reason", ({ name, groupId, registry, reason }) => {
    expect(planGroupRegistration({ name, groupId, registry })).toEqual({ ok: false, reason });
  });
});

describe("planGroupMembership", () => {
  it("adds a Mate to the group", () => {
    const result = planGroupMembership({
      registry: ACME,
      groupId: "g-acme",
      projectId: "p-nova",
      kind: "mate",
    });
    expect(result.ok && result.tagList).toContain("mate:gm:g-acme:p-nova:mate");
    expect(result.ok && result.tagList).toContain("mate:gm:g-acme:p-fen:mate");
  });

  it("is a no-op for a project already in the group as that kind", () => {
    const result = planGroupMembership({
      registry: ACME,
      groupId: "g-acme",
      projectId: "p-fen",
      kind: "mate",
    });
    expect(result).toEqual({
      ok: true,
      tagList: ["mate:gm:g-acme:p-fen:mate", "mate:gn:g-acme:acme", "mate:tool:gitea"],
    });
  });

  it.each([
    {
      name: "a group that is not registered",
      registry: ACME,
      groupId: "g-nope",
      projectId: "p-1",
      kind: "mate" as const,
      reason: "That project is not in the registry.",
    },
    {
      name: "changing what an environment already is",
      registry: ACME,
      groupId: "g-acme",
      projectId: "p-fen",
      kind: "stage" as const,
      reason: "That environment is already the group's mate.",
    },
    {
      name: "a second production",
      registry: parseZeropsRegistry(["mate:gn:g-acme:acme", "mate:gm:g-acme:p-prod:production"]),
      groupId: "g-acme",
      projectId: "p-prod2",
      kind: "production" as const,
      reason: "This project already has a production.",
    },
  ])("refuses $name", ({ registry, groupId, projectId, kind, reason }) => {
    expect(planGroupMembership({ registry, groupId, projectId, kind })).toEqual({
      ok: false,
      reason,
    });
  });

  it("allows a second stage", () => {
    const one = planGroupMembership({
      registry: ACME,
      groupId: "g-acme",
      projectId: "p-stage",
      kind: "stage",
    });
    expect(one.ok).toBe(true);
    const two = planGroupMembership({
      registry: parseZeropsRegistry(one.ok ? one.tagList : []),
      groupId: "g-acme",
      projectId: "p-stage-x",
      kind: "stage",
    });
    expect(two.ok && two.tagList).toContain("mate:gm:g-acme:p-stage-x:stage");
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
