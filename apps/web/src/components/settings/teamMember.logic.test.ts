import {
  ORG_ROLE_CODES,
  presetMembership,
  type OrgMembership,
} from "@t3tools/client-runtime/zerops/teamRoles";
import { LEGACY_VOCABULARY_PATTERNS } from "@t3tools/shared/legacyVocabulary";
import { describe, expect, it } from "vite-plus/test";

import {
  accessProjects,
  addressProblem,
  advancedChoices,
  draftChanges,
  inviteGrants,
  inviteLevels,
  invitePreselect,
  inviteProjects,
  inviteReachLine,
  PRESET_WORDS,
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

describe("an invitation on one page", () => {
  const SNAP = {
    groupId: "g-snap",
    name: "Snap",
    projects: [
      { projectId: "snap-prod", kind: "production" },
      { projectId: "snap-fen", kind: "mate" },
    ],
  };
  const BEVIRO = {
    groupId: "g-beviro",
    name: "Beviro",
    projects: [{ projectId: "beviro-kai", kind: "mate" }],
  };

  it("Each Mate project is one choice holding all its places and Mates; outside projects by their own names; Chiefs never", () => {
    expect(
      inviteProjects({
        groups: [
          SNAP,
          {
            groupId: "g-chief",
            name: "Petra's Chief",
            projects: [{ projectId: "chief", kind: "mate" }],
          },
        ],
        roster: [
          { id: "snap-fen", name: "Snap - Fen" },
          { id: "old", name: "legacy-api" },
          { id: "chief", name: "Chief" },
        ],
        chiefs: new Set(["chief"]),
      }),
    ).toEqual([
      { key: "old", name: "legacy-api", projectIds: ["old"] },
      { key: "g-snap", name: "Snap", projectIds: ["snap-prod", "snap-fen"] },
    ]);
  });

  const choices = inviteProjects({
    groups: [SNAP, BEVIRO],
    roster: [],
    chiefs: new Set(),
  });
  it.each([
    {
      sentence: "Inviting from a project picks that project",
      projects: choices,
      from: "g-beviro",
      picked: ["g-beviro"],
    },
    {
      sentence: "The organization's only project is picked",
      projects: choices.slice(0, 1),
      from: undefined,
      picked: [choices[0]!.key],
    },
    {
      sentence: "With several projects and none to start from, none is picked",
      projects: choices,
      from: undefined,
      picked: [],
    },
    {
      sentence: "A project to start from that the viewer can't give isn't picked",
      projects: choices,
      from: "g-gone",
      picked: [],
    },
  ])("$sentence", ({ projects, from, picked }) => {
    expect(invitePreselect({ projects, from })).toEqual(picked);
  });

  it("Each picked project gives every one of its places and Mates at the chosen level: Full as full, Read as read only", () => {
    expect(inviteGrants({ projects: choices, picked: ["g-snap"], level: "full" })).toEqual([
      { projectId: "snap-prod", roleCode: "ADMIN" },
      { projectId: "snap-fen", roleCode: "ADMIN" },
    ]);
    expect(inviteGrants({ projects: choices, picked: ["g-beviro"], level: "read" })).toEqual([
      { projectId: "beviro-kai", roleCode: "READ_ONLY" },
    ]);
  });

  it.each([
    { role: "developer", levels: ["full", "read"], level: "full" },
    { role: "guest", levels: ["read"], level: "read" },
    { role: "admin", levels: [], level: null },
    { role: "owner", levels: [], level: null },
  ] as const)(
    "a $role is given projects at $levels, $level first; a role reaching every project is given none",
    ({ role, levels, level }) => {
      expect(inviteLevels(presetMembership(role))).toEqual({ levels, level });
    },
  );

  it("a member who works on or sees every project by their role is given no projects", () => {
    expect(inviteLevels(membership("BASIC_USER"))).toEqual({ levels: [], level: null });
    expect(inviteLevels(membership("READ_ONLY"))).toEqual({ levels: [], level: null });
  });

  it.each([
    { role: "owner", says: /billing/u, never: /^$/u },
    { role: "admin", says: /every project/iu, never: /billing and/u },
    { role: "developer", says: /projects of their own/u, never: /every project/iu },
    { role: "guest", says: /Starts nothing/u, never: /starts projects/u },
  ] as const)(
    "the $role card says what the role can do, true to what Zerops gives it",
    ({ role, says, never }) => {
      expect(PRESET_WORDS[role].description).toMatch(says);
      if (role !== "owner") expect(PRESET_WORDS[role].description).not.toMatch(never);
    },
  );
});

describe("what a role reaches, in the glossary's words", () => {
  const said = new Set(
    ORG_ROLE_CODES.flatMap((roleCode) =>
      [false, true].flatMap((createsProjects) => [
        projectAccessIntro({ roleCode, createsProjects, viewerGives: true }),
        projectAccessIntro({ roleCode, createsProjects, viewerGives: false }),
        inviteReachLine(membership(roleCode, createsProjects), 0),
        inviteReachLine(membership(roleCode, createsProjects), 2),
      ]),
    ),
  );
  it.each([...said])("never names a role by a retired word: %s", (line) => {
    for (const { pattern } of LEGACY_VOCABULARY_PATTERNS) expect(line).not.toMatch(pattern);
  });
});

describe("what an invitation's projects say a role reaches", () => {
  it.each([
    { role: "owner", projects: 2, says: "An owner reaches every project." },
    { role: "admin", projects: 2, says: "An admin reaches every project." },
    {
      role: "developer",
      projects: 2,
      says: "They get the projects you pick here, and the ones they start.",
    },
    { role: "developer", projects: 0, says: "No projects to give yet: they can start their own." },
    { role: "guest", projects: 2, says: "They see only the projects you pick here." },
    {
      role: "guest",
      projects: 0,
      says: "No projects to give yet: they see the ones you add them to later.",
    },
  ] as const)(
    "a $role with $projects projects to give is told: $says",
    ({ role, projects, says }) => {
      expect(inviteReachLine(presetMembership(role), projects)).toBe(says);
    },
  );
});
