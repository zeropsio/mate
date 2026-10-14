/**
 * One person on the team, as their own page and the invitation edit them — the shapes legacy
 * Zerops draws: four role cards (*Role preset*) and *Advanced* (a Zerops role and three flags);
 * then *Project access*, the projects whose own level for them differs from what their role gives,
 * as chips, and a picker that adds more; and the address checked before an invitation.
 *
 * Projects are named the way Mate names them — the Mate project, then the place: "Snap ·
 * production" — never by Zerops's raw tags. A Chief is one person's own Mate for the whole
 * organization, never a project to give.
 *
 * Pure: the member, the viewer's role and the projects arrive read.
 */
import type { InviteeCheck } from "@t3tools/client-runtime/data";
import { nameUnderApp } from "@t3tools/client-runtime/zerops";
import type { ProjectAccessRole } from "@t3tools/client-runtime/zerops/projectAccess";
import {
  membershipLocks,
  MEMBERSHIP_FLAGS,
  ORG_ROLE_CODES,
  presetMembership,
  presetOf,
  sameMembership,
  TEAM_PRESETS,
  type MembershipFlag,
  type OrgMembership,
  type OrgRoleCode,
  type TeamRole,
} from "@t3tools/client-runtime/zerops/teamRoles";
import { asOrgRole, type ZeropsOrgRole } from "@t3tools/shared/zeropsRoles";

import {
  defaultAccessMenu,
  levelOf,
  mayHide,
  type DefaultAccessAction,
  type GivenLevel,
} from "../zerops/projects/projectPeople.logic";
import { ROLE_CODE_WORDS } from "./teamSettings.logic";

/** Each preset as its card says it: legacy Zerops's words. */
export const PRESET_WORDS: Readonly<
  Record<TeamRole, { readonly label: string; readonly description: string }>
> = {
  owner: { label: "Owner", description: "Full control over company settings, billing, and team." },
  admin: {
    label: "Admin",
    description: "Full control over all projects. Can invite developers and guests.",
  },
  developer: {
    label: "Developer",
    description: "Can create new projects and be assigned to projects.",
  },
  guest: {
    label: "Guest",
    description: "Can NOT create projects. Can only be assigned to projects.",
  },
};

/** What each Zerops role gives by itself, as *Advanced* explains it. */
export const ROLE_CODE_DESCRIPTIONS: Readonly<Record<OrgRoleCode, string>> = {
  OWNER: "Full control over all projects, company settings, billing, and team.",
  ADMIN: "Full control over all projects. Can manage users below Admin. No access to billing.",
  BASIC_USER: "Can deploy and operate all projects, but cannot delete them or manage the team.",
  READ_ONLY: "Can view all projects, their logs and metrics, but cannot change anything.",
  NO_ACCESS: "No access by default. Can only reach projects they are individually assigned to.",
};

export const FLAG_WORDS: Readonly<Record<MembershipFlag, string>> = {
  canCreateProjects: "Can create projects",
  canViewFinances: "Can view finances",
  canEditFinances: "Can edit finances",
};

export interface RoleCard {
  readonly role: TeamRole;
  readonly label: string;
  readonly description: string;
  readonly selected: boolean;
  readonly disabled: boolean;
}

/**
 * The four role cards, in legacy's order: the one the membership is exactly lit, none where
 * *Advanced* holds another combination; a card the editor may not give, or every card where they
 * may change nothing, disabled.
 */
export function roleCards(
  editorRole: string | undefined,
  value: OrgMembership,
  editable: boolean,
): ReadonlyArray<RoleCard> {
  const { roles } = membershipLocks(editorRole, value);
  const lit = presetOf(value);
  return TEAM_PRESETS.map((role) => ({
    role,
    ...PRESET_WORDS[role],
    selected: lit === role,
    disabled: !editable || roles[presetMembership(role).roleCode].disabled,
  }));
}

export interface AdvancedChoices {
  /** "Custom (Basic user)" where no card is lit: Advanced opens by itself on it. */
  readonly custom: string | null;
  readonly roles: ReadonlyArray<{
    readonly roleCode: OrgRoleCode;
    readonly label: string;
    readonly description: string;
    readonly active: boolean;
    readonly disabled: boolean;
    readonly reason: string | null;
  }>;
  readonly flags: ReadonlyArray<{
    readonly flag: MembershipFlag;
    readonly label: string;
    readonly checked: boolean;
    readonly disabled: boolean;
    readonly reason: string | null;
  }>;
}

/** *Advanced*: each Zerops role and flag, what is set, and what the editor may not change. */
export function advancedChoices(
  editorRole: string | undefined,
  value: OrgMembership,
  editable: boolean,
): AdvancedChoices {
  const locks = membershipLocks(editorRole, value);
  return {
    custom: presetOf(value) === null ? `Custom (${ROLE_CODE_WORDS[value.roleCode]})` : null,
    roles: ORG_ROLE_CODES.map((roleCode) => ({
      roleCode,
      label: ROLE_CODE_WORDS[roleCode],
      description: ROLE_CODE_DESCRIPTIONS[roleCode],
      active: value.roleCode === roleCode,
      disabled: !editable || locks.roles[roleCode].disabled,
      reason: locks.roles[roleCode].reason ?? null,
    })),
    flags: MEMBERSHIP_FLAGS.map((flag) => ({
      flag,
      label: FLAG_WORDS[flag],
      checked: value[flag],
      disabled: !editable || locks.flags[flag].disabled,
      reason: locks.flags[flag].reason ?? null,
    })),
  };
}

/** *Update user* waits until the membership differs from the one saved. */
export const membershipChanged = (saved: OrgMembership, draft: OrgMembership): boolean =>
  !sameMembership(saved, draft);

/** A project a person can be given, by Mate's name for it. */
export interface AccessProject {
  readonly projectId: string;
  /** "Snap · production", "Snap · Fen", or a project outside any Mate project by its own name. */
  readonly label: string;
}

const KIND_WORDS: Readonly<Record<string, string>> = {
  production: "production",
  stage: "stage",
  devstage: "dev / stage",
};

/**
 * Every project the organization can give, by its Mate name, in order: each Mate project's places
 * and Mates — a place by its kind, or by its own name where the group has several of that kind, a
 * Mate by its name under the app (`nameUnderApp`: "Snap - Kai" is Snap's Kai) — then projects
 * outside any Mate project by their own names. Chiefs never.
 */
export function accessProjects(input: {
  readonly groups: ReadonlyArray<{
    readonly name: string;
    readonly projects: ReadonlyArray<{ readonly projectId: string; readonly kind: string }>;
  }>;
  /** Every project the viewer can name: its Zerops name. */
  readonly roster: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly chiefs: ReadonlySet<string>;
}): ReadonlyArray<AccessProject> {
  const names = new Map(input.roster.map(({ id, name }) => [id, name]));
  const grouped = new Set<string>();
  const inGroups = input.groups.flatMap((group) => {
    for (const { projectId } of group.projects) grouped.add(projectId);
    if (group.projects.some(({ projectId }) => input.chiefs.has(projectId))) return [];
    return group.projects.map(({ projectId, kind }) => {
      const several = group.projects.filter((other) => other.kind === kind).length > 1;
      const whole = names.get(projectId);
      const own = whole === undefined ? undefined : nameUnderApp(whole, group.name);
      const place =
        kind === "mate" || (several && own !== undefined)
          ? (own ?? "Mate")
          : (KIND_WORDS[kind] ?? kind);
      return { projectId, label: `${group.name} · ${place}` };
    });
  });
  const outside = input.roster.flatMap(({ id, name }) =>
    grouped.has(id) || input.chiefs.has(id) ? [] : [{ projectId: id, label: name }],
  );
  return [...inGroups, ...outside].toSorted((a, b) => a.label.localeCompare(b.label));
}

/** A person's own level on each project, by project id: what *Project access* edits. */
export type AccessDraft = Readonly<Record<string, string>>;

/** The draft as their grants read it: each project's own level. */
export const draftOf = (
  grants: ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }>,
): AccessDraft =>
  Object.fromEntries(grants.map(({ projectId, roleCode }) => [projectId, roleCode]));

/** A chip's level: full, a developer's, read only, hidden — or theirs, a project they own. */
export type ProjectChipLevel = "full" | "basic" | "read" | "hidden" | "owner";

/** One menu entry of a project chip: a level, or their own level there dropped. */
export interface ProjectChipAction {
  readonly choice: GivenLevel | "remove";
  readonly label: string;
}

export interface ProjectChip {
  readonly projectId: string;
  readonly label: string;
  readonly level: ProjectChipLevel;
  /** Changed since it was saved. */
  readonly changed: boolean;
  /** Their menu; empty where it is theirs or the viewer may change nothing. */
  readonly actions: ReadonlyArray<ProjectChipAction>;
}

const chipLevel = (roleCode: string): ProjectChipLevel =>
  asOrgRole(roleCode) === "OWNER" ? "owner" : (levelOf(roleCode) ?? "hidden");

/**
 * Their projects as chips, by name: each project whose own level the draft names. A project the
 * viewer can't name is kept as it is, unshown. A chip's menu is legacy's: someone with no
 * organization role is toggled between full and read only or removed; anyone whose role reaches
 * every project is offered what `defaultAccessMenu` offers.
 */
export function projectChips(input: {
  readonly draft: AccessDraft;
  readonly saved: AccessDraft;
  readonly projects: ReadonlyArray<AccessProject>;
  readonly memberRole: string | undefined;
  readonly viewerRole: string | undefined;
  /** The viewer may change their access: an owner, or an admin on someone below admin. */
  readonly editable: boolean;
  /** The viewer's own page. */
  readonly self: boolean;
}): ReadonlyArray<ProjectChip> {
  const role = asOrgRole(input.memberRole);
  return input.projects.flatMap(({ projectId, label }) => {
    const roleCode = input.draft[projectId];
    if (roleCode === undefined) return [];
    const level = chipLevel(roleCode);
    return [
      {
        projectId,
        label,
        level,
        changed: input.saved[projectId] !== roleCode,
        actions:
          !input.editable || level === "owner"
            ? []
            : role === "NO_ACCESS"
              ? [
                  level === "full"
                    ? { choice: "read" as const, label: "Make read only" }
                    : { choice: "full" as const, label: "Give full access" },
                  { choice: "remove" as const, label: "Remove" },
                ]
              : (
                  defaultAccessMenu({
                    viewerRole: input.viewerRole,
                    memberRole: role,
                    self: input.self,
                    held: level,
                    override: true,
                  }) ?? []
                ).map(({ choice, label: words }: DefaultAccessAction) => ({
                  choice,
                  label: words,
                })),
      },
    ];
  });
}

const GIVEN: Readonly<Record<GivenLevel, ProjectAccessRole>> = {
  full: "ADMIN",
  read: "READ_ONLY",
  none: "NO_ACCESS",
};

/** The draft with one project's level set — or, `remove`, their own level there dropped. */
export function withChoice(
  draft: AccessDraft,
  projectId: string,
  choice: GivenLevel | "remove",
): AccessDraft {
  const { [projectId]: _was, ...rest } = draft;
  return choice === "remove" ? rest : { ...rest, [projectId]: GIVEN[choice] };
}

/**
 * The levels the picker offers for someone with this role, each besides *Unset*: read only and
 * full for someone the organization gives nothing; for anyone else the levels their role doesn't
 * give, and hiding for someone who works on or sees every project — never an owner or admin.
 */
export function pickerLevels(memberRole: string | undefined): ReadonlyArray<GivenLevel> {
  const role: ZeropsOrgRole = asOrgRole(memberRole);
  if (role === "NO_ACCESS") return ["read", "full"];
  const base = levelOf(role);
  return [
    ...(base === "read" ? [] : (["read"] as const)),
    ...(base === "full" ? [] : (["full"] as const)),
    ...(mayHide(role) ? (["none"] as const) : []),
  ];
}

/** The picker's choices added to the draft: every project given a level, *Unset* ones left out. */
export function withPicks(
  draft: AccessDraft,
  picks: Readonly<Record<string, GivenLevel | undefined>>,
): AccessDraft {
  return Object.entries(picks).reduce(
    (next, [projectId, level]) => (level === undefined ? next : withChoice(next, projectId, level)),
    draft,
  );
}

/**
 * What saving writes: each project whose level differs from the one saved — a level, or `null`
 * where their own level there goes. A project they own is never written.
 */
export function draftChanges(
  saved: AccessDraft,
  draft: AccessDraft,
): ReadonlyArray<{ readonly projectId: string; readonly roleCode: ProjectAccessRole | null }> {
  const ids = [...new Set([...Object.keys(saved), ...Object.keys(draft)])];
  return ids.flatMap((projectId) => {
    const was = saved[projectId];
    const now = draft[projectId];
    if (was === now || asOrgRole(was) === "OWNER" || asOrgRole(now) === "OWNER") return [];
    return [{ projectId, roleCode: now === undefined ? null : (now as ProjectAccessRole) }];
  });
}

/** A new invitation's draft as the invitation sends it: each project's level. */
export const draftGrants = (
  draft: AccessDraft,
): ReadonlyArray<{ readonly projectId: string; readonly roleCode: ProjectAccessRole }> =>
  Object.entries(draft).map(([projectId, roleCode]) => ({
    projectId,
    roleCode: roleCode as ProjectAccessRole,
  }));

/** Something with one `@` and a dot after it; Zerops judges the rest. */
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** What stops an address before Zerops is asked; `null` where nothing does. */
export function addressProblem(value: string): string | null {
  const address = value.trim();
  if (address === "") return "Enter their e-mail address.";
  return ADDRESS.test(address) ? null : "That isn't an e-mail address.";
}

/** A new account needs both names: Zerops makes it with them. */
export function nameProblem(first: string, last: string): string | null {
  return first.trim() === "" || last.trim() === "" ? "Enter their first and last name." : null;
}

/** Where an invitation goes once Zerops said who the address is. */
export type TeamInviteStep =
  /** "Adding <e-mail>": a new account is named first; someone with an account is not. */
  | { readonly step: "details"; readonly email: string; readonly existing: string | null }
  /** Already in the organization: their own page is where they are changed. */
  | { readonly step: "member"; readonly email: string; readonly clientUserId: string };

export function teamInviteStep(email: string, answer: InviteeCheck): TeamInviteStep {
  switch (answer.kind) {
    case "existing":
      return { step: "details", email, existing: answer.userId };
    case "new":
      return { step: "details", email, existing: null };
    case "member":
      return { step: "member", email, clientUserId: answer.clientUserId };
  }
}
