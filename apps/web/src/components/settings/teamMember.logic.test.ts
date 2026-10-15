import { presetMembership, type OrgMembership } from "@t3tools/client-runtime/zerops/teamRoles";
import { describe, expect, it } from "vite-plus/test";

import {
  accessProjects,
  addressProblem,
  advancedChoices,
  draftChanges,
  membershipChanged,
  nameProblem,
  pickerLevels,
  projectAccessIntro,
  projectChips,
  roleCards,
  teamInviteStep,
  withChoice,
  withPicks,
} from "./teamMember.logic";

const membership = (
  roleCode: OrgMembership["roleCode"],
  create = false,
  view = false,
  edit = false,
): OrgMembership => ({
  roleCode,
  canCreateProjects: create,
  canViewFinances: view,
  canEditFinances: edit,
});

describe("a person's role, as four cards and Fine-tune permissions", () => {
  it("The cards come in legacy's order, theirs lit", () => {
    expect(
      roleCards("OWNER", presetMembership("developer"), true).map(({ label, selected }) => [
        label,
        selected,
      ]),
    ).toEqual([
      ["Owner", false],
      ["Admin", false],
      ["Developer", true],
      ["Guest", false],
    ]);
  });

  it.each([
    {
      sentence: "An owner may give every card",
      editor: "OWNER",
      editable: true,
      disabled: [false, false, false, false],
    },
    {
      sentence: "An admin may give a developer or a guest, never an owner or admin",
      editor: "ADMIN",
      editable: true,
      disabled: [true, true, false, false],
    },
    {
      sentence: "Someone the viewer may not change has every card disabled",
      editor: "OWNER",
      editable: false,
      disabled: [true, true, true, true],
    },
  ])("$sentence", ({ editor, editable, disabled }) => {
    expect(
      roleCards(editor, presetMembership("guest"), editable).map((card) => card.disabled),
    ).toEqual(disabled);
  });

  it("A combination no card names lights none and names itself on Fine-tune permissions", () => {
    const value = membership("BASIC_USER", true);
    expect(roleCards("OWNER", value, true).some(({ selected }) => selected)).toBe(false);
    expect(advancedChoices("OWNER", value, true).custom).toBe("Custom (Basic user)");
  });

  it("Fine-tune permissions offers the five Zerops roles and three flags, an admin editor's finances locked", () => {
    const choices = advancedChoices("ADMIN", membership("NO_ACCESS", true), true);
    expect(choices.roles.map(({ label, active, disabled }) => [label, active, disabled])).toEqual([
      ["Owner", false, true],
      ["Admin", false, true],
      ["Basic user", false, false],
      ["Read only", false, false],
      ["No access", true, false],
    ]);
    expect(choices.flags.map(({ label, checked, disabled }) => [label, checked, disabled])).toEqual(
      [
        ["Can create projects", true, false],
        ["Can view finances", false, true],
        ["Can edit finances", false, true],
      ],
    );
  });

  it("Update waits until something changed", () => {
    expect(membershipChanged(presetMembership("guest"), presetMembership("guest"))).toBe(false);
    expect(membershipChanged(presetMembership("guest"), presetMembership("developer"))).toBe(true);
  });
});

describe("what an invitation may give", () => {
  it("never offers a person's Chief as a project to give", () => {
    expect(
      accessProjects({
        groups: [{ name: "Chief · Petra", projects: [{ projectId: "chief", kind: "mate" }] }],
        roster: [{ id: "chief", name: "Chief" }],
        chiefs: new Set(["chief"]),
      }),
    ).toEqual([]);
  });

  it("Each Mate project's places and Mates are named by it, outside ones by their own names, Chiefs never", () => {
    expect(
      accessProjects({
        groups: [
          {
            name: "Snap",
            projects: [
              { projectId: "snap-prod", kind: "production" },
              { projectId: "snap-stage", kind: "stage" },
              { projectId: "snap-fen", kind: "mate" },
            ],
          },
          { name: "Petra's Chief", projects: [{ projectId: "chief", kind: "mate" }] },
        ],
        roster: [
          { id: "snap-fen", name: "Snap - Fen" },
          { id: "old", name: "legacy-api" },
          { id: "chief", name: "Chief" },
        ],
        chiefs: new Set(["chief"]),
      }).map(({ label }) => label),
    ).toEqual(["legacy-api", "Snap · Fen", "Snap · production", "Snap · stage"]);
  });
});

describe("a person's project access, as chips", () => {
  const PROJECTS = [
    { projectId: "p", label: "Snap · production" },
    { projectId: "s", label: "Snap · stage" },
    { projectId: "m", label: "Snap · Fen" },
  ];
  const chips = (memberRole: string, draft: Record<string, string>, viewerRole = "OWNER") =>
    projectChips({
      draft,
      saved: {},
      projects: PROJECTS,
      memberRole,
      viewerRole,
      editable: true,
      self: false,
    }).map(({ label, level, actions }) => [label, level, actions.map((one) => one.label)]);

  it.each([
    {
      sentence: "A guest's full project offers read only, or removing it",
      memberRole: "NO_ACCESS",
      draft: { p: "ADMIN" },
      shown: [["Snap · production", "full", ["Make read only", "Remove"]]],
    },
    {
      sentence:
        "A read-only member's hidden project shows hidden, its way back removing the override",
      memberRole: "READ_ONLY",
      draft: { s: "NO_ACCESS" },
      shown: [["Snap · stage", "hidden", ["Give full access", "Remove override"]]],
    },
    {
      sentence: "A Mate they own is theirs: shown, never changed here",
      memberRole: "NO_ACCESS",
      draft: { m: "OWNER" },
      shown: [["Snap · Fen", "owner", []]],
    },
  ])("$sentence", ({ memberRole, draft, shown }) => {
    expect(chips(memberRole, draft)).toEqual(shown);
  });

  it.each([
    { role: "NO_ACCESS", levels: ["read", "full"] },
    { role: "ADMIN", levels: ["read"] },
    { role: "READ_ONLY", levels: ["full", "none"] },
    { role: "BASIC_USER", levels: ["read", "full", "none"] },
    { role: "OWNER", levels: ["read"] },
  ])("The picker offers $role the levels their role doesn't give: $levels", ({ role, levels }) => {
    expect(pickerLevels(role)).toEqual(levels);
  });

  it("Add projects puts each picked project's level in the draft; Unset ones stay out", () => {
    expect(withPicks({ p: "ADMIN" }, { s: "read", m: undefined })).toEqual({
      p: "ADMIN",
      s: "READ_ONLY",
    });
  });

  it("Saving writes each project whose level changed, a removed one as none of their own", () => {
    const saved = { p: "ADMIN", s: "READ_ONLY", m: "OWNER" };
    const draft = withChoice(withChoice(saved, "p", "read"), "s", "remove");
    expect(draftChanges(saved, { ...draft, x: "NO_ACCESS" })).toEqual([
      { projectId: "p", roleCode: "READ_ONLY" },
      { projectId: "s", roleCode: null },
      { projectId: "x", roleCode: "NO_ACCESS" },
    ]);
  });
});

describe("an invitation's address, checked", () => {
  it.each([
    { value: "eva@example.com", problem: null },
    { value: "  Eva@Example.com ", problem: null },
    { value: "", problem: "Enter their e-mail address." },
    { value: "eva", problem: "That isn't an e-mail address." },
    { value: "eva@example", problem: "That isn't an e-mail address." },
  ])("An address is checked before Zerops is asked: $value", ({ value, problem }) => {
    expect(addressProblem(value)).toBe(problem);
  });

  it.each([
    { first: "Eva", last: "Dvořáková", problem: null },
    { first: " ", last: "Dvořáková", problem: "Enter their first and last name." },
    { first: "Eva", last: "", problem: "Enter their first and last name." },
  ])("A new person needs both names: '$first' '$last'", ({ first, last, problem }) => {
    expect(nameProblem(first, last)).toBe(problem);
  });

  it.each([
    {
      sentence: "An address with no Zerops account is asked for a name",
      answer: { kind: "new" } as const,
      step: { step: "details", email: "petra.kralova@example.com", existing: null },
    },
    {
      sentence: "An address with an account goes straight to their role",
      answer: { kind: "existing", userId: "u-petra" } as const,
      step: { step: "details", email: "petra.kralova@example.com", existing: "u-petra" },
    },
    {
      sentence: "An address already in the organization goes no further, the field saying why",
      answer: { kind: "member", clientUserId: "cu-petra", roleCode: "NO_ACCESS" } as const,
      step: { problem: "petra.kralova@example.com is in Acme already." },
    },
  ])("$sentence", ({ answer, step }) => {
    expect(teamInviteStep("petra.kralova@example.com", answer, "Acme")).toEqual(step);
  });
});

describe("what Project access says a role reaches by itself", () => {
  it.each([
    { role: "owner", says: "every project" },
    { role: "admin", says: "every project" },
    { role: "developer", says: "the projects they create and the projects you add here" },
    { role: "guest", says: "only the projects you add here" },
  ] as const)("a $role is told it reaches $says", ({ role, says }) => {
    const { roleCode, canCreateProjects } = presetMembership(role);
    expect(
      projectAccessIntro({ roleCode, createsProjects: canCreateProjects, viewerGives: true }),
    ).toContain(says);
  });

  it("never promises every project to a role that reaches none by itself", () => {
    for (const createsProjects of [false, true]) {
      const intro = projectAccessIntro({
        roleCode: "NO_ACCESS",
        createsProjects,
        viewerGives: true,
      });
      expect(intro).not.toContain("all projects");
      expect(intro).not.toContain("every project");
    }
  });

  it.each([
    { role: "guest", says: "only the projects they are given" },
    { role: "developer", says: "the projects they create and the projects they are given" },
    { role: "admin", says: "a project listed here at a different level" },
  ] as const)(
    "tells a viewer who may not change their access what a $role reaches, never what they would add or set",
    ({ role, says }) => {
      const { roleCode, canCreateProjects } = presetMembership(role);
      const intro = projectAccessIntro({
        roleCode,
        createsProjects: canCreateProjects,
        viewerGives: false,
      });
      expect(intro).toContain(says);
      expect(intro).not.toMatch(/you add|Set a different/u);
    },
  );
});
