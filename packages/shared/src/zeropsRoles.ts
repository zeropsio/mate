/**
 * Zerops roles, read the one way every rule here reads them; a person's reach on a project
 * (`projectReach`); and the role function — what a person may do with each Mate and whether they
 * may create projects — with the two predicates over Zerops' own facts a client reads before or
 * beside any HQ answer (`mayBearHq`, `mayCreateProjects`).
 *
 * Zerops roles are the only source of rights in Mate. A role or a status arrives as the platform's
 * string; it is normalised once, here (`asOrgRole`): a role this build does not know is
 * `NO_ACCESS`, so a role the platform grows shuts rather than opens. Everything that compares roles
 * does it through `roleAtLeast`; what a role reaches on a project is `projectReach`'s answer alone,
 * which every surface that shows or gates a project by role maps from.
 *
 * Two consumers ask the role function the same question of the same inputs: the Mate app (which
 * rows a person sees, whether *Add Mate* is offered) and a Mate's door (open, listed or hidden for
 * the project it runs in). This module is the role function's only copy since the broker and its
 * Go twin went (ADR 0004). What else a person may do — the structure, a Mate's
 * credential — is the verb rule (`zeropsPermissions.ts`), over the same normalisation: the client
 * runs it over its own live read of Zerops, HQ over the fresh read each of its verbs carries.
 *
 * Pure: no clock, no network, no platform types.
 *
 * @module zeropsRoles
 */

/** The platform's roles, lowest first — the rank every comparison here uses. */
export type ZeropsOrgRole = "NO_ACCESS" | "READ_ONLY" | "BASIC_USER" | "ADMIN" | "OWNER";

const ROLES: ReadonlyArray<ZeropsOrgRole> = [
  "NO_ACCESS",
  "READ_ONLY",
  "BASIC_USER",
  "ADMIN",
  "OWNER",
];

/** A role as the platform spells it; one this build does not know is no role: `NO_ACCESS`. */
export const asOrgRole = (value: string | undefined): ZeropsOrgRole =>
  ROLES.find((role) => role === value) ?? "NO_ACCESS";

/** Whether `role` (normalised by `asOrgRole`) is `floor` or above. */
export const roleAtLeast = (role: string | undefined, floor: ZeropsOrgRole): boolean =>
  ROLES.indexOf(asOrgRole(role)) >= ROLES.indexOf(floor);

/** The one status that carries rights. */
export const ZEROPS_ACTIVE_MEMBER_STATUS = "ACTIVE";

/**
 * A membership's status, as `GET /client/{org}/user/list` spells it.
 *
 * Deliberately open rather than an enumeration: only `ACTIVE` is a member, and
 * every other value the platform sends — `INVITED` in the fixtures, and
 * whatever else it has — means exactly the same thing to these rules, which is
 * nothing. Claiming a closed set nobody measured would make a caller cast.
 */
export type ZeropsMemberStatus = string;

/**
 * What a project is to its group. One `production` per group. A `devstage` project is a Mate that also
 * serves as its group's stage.
 */
export type RoleProjectKind = "mate" | "devstage" | "stage" | "production";

/** Whether a kind is a Mate's: it carries a Mate record and follows a Mate's rules. */
export const isMateKind = (kind: string): boolean => kind === "mate" || kind === "devstage";

export interface RoleRegistryProject {
  readonly id: string;
  readonly kind: RoleProjectKind;
}

export interface RoleRegistryGroup {
  readonly id: string;
  readonly projects: ReadonlyArray<RoleRegistryProject>;
}

/**
 * The account's groups and their projects, as HQ's structure holds them
 * (`hq/registry.ts` in the fork's client runtime).
 */
export interface RoleRegistry {
  readonly groups: ReadonlyArray<RoleRegistryGroup>;
}

/** This person's per-project override, from each project's `userRoles`, as the platform spells it. */
export type ZeropsProjectRoleOverrides = Readonly<Record<string, string>>;

export interface RolePerson {
  readonly id: string;
  /** As the platform spells it; normalised by `asOrgRole`. */
  readonly orgRole: string;
  readonly status: ZeropsMemberStatus;
  readonly canCreateProjects: boolean;
}

export interface RoleInput {
  readonly person: RolePerson;
  readonly overrides: ZeropsProjectRoleOverrides;
  readonly registry: RoleRegistry;
}

/**
 * What a person may do with one Mate:
 *
 * - `open` — the door hands out the standard client scopes plus `exec:operate`;
 * - `listed` — the row is shown and the door refuses with `zerops_read_only`;
 * - `hidden` — the Mate is not theirs to know about.
 */
export type RoleMateVisibility = "open" | "listed" | "hidden";

export interface RoleAnswer {
  readonly active: boolean;
  /** The app's *Add Mate* gate. */
  readonly canCreate: boolean;
  /** Every Mate-kind project in the registry, so a consumer never guesses. */
  readonly mates: Readonly<Record<string, RoleMateVisibility>>;
}

/**
 * A person's role on one project: their override there when they have one,
 * their org role otherwise. An override lowers an owner as readily as it
 * raises a read-only member — both directions are measured.
 */
export function effectiveProjectRole(input: RoleInput, projectId: string): ZeropsOrgRole {
  return effectiveRole(input.overrides[projectId], input.person.orgRole);
}

/** The one effective-role function: a project's override for the person, else their org role. */
export const effectiveRole = (
  override: string | undefined,
  orgRole: string | undefined,
): ZeropsOrgRole => asOrgRole(override ?? orgRole);

/**
 * How far a role reaches on a project: `none`; `read` — sees it, changes nothing; `work` — operates
 * it (Basic user); `administer` — everything, an owner's as an admin's.
 */
export type ProjectReach = "none" | "read" | "work" | "administer";

const REACH: Readonly<Record<ZeropsOrgRole, ProjectReach>> = {
  NO_ACCESS: "none",
  READ_ONLY: "read",
  BASIC_USER: "work",
  ADMIN: "administer",
  OWNER: "administer",
};

/** The one reach function: a role (normalised by `asOrgRole`, so an unknown one reaches nothing). */
export const projectReach = (role: string | undefined): ProjectReach => REACH[asOrgRole(role)];

/** A membership as the session or the member list gives it; active unless it says otherwise. */
export interface MembershipFacts {
  /** Their Zerops user id — what a record names a person by (a Mate's owner, a named merger). */
  readonly userId?: string | undefined;
  readonly roleCode?: string | undefined;
  readonly status?: ZeropsMemberStatus | undefined;
  readonly canCreateProjects?: boolean | undefined;
}

const active = (member: MembershipFacts) =>
  (member.status ?? ZEROPS_ACTIVE_MEMBER_STATUS) === ZEROPS_ACTIVE_MEMBER_STATUS;

/** An active owner or admin of the organization. */
const orgAdmin = (member: MembershipFacts | undefined): boolean =>
  member !== undefined && active(member) && roleAtLeast(member.roleCode, "ADMIN");

/** The member, where it is an active one; none otherwise. */
export const activeMember = <M extends MembershipFacts>(member: M | undefined): M | undefined =>
  member !== undefined && active(member) ? member : undefined;

/**
 * Whether a member bears the organization's HQ and looks after it — before HQ exists, so before it
 * can answer anything: an active owner or admin, whom Zerops lets make and deploy its project.
 */
export const mayBearHq = (member: MembershipFacts | undefined): boolean => orgAdmin(member);

/**
 * Whether a member hands Mates over: an active owner or admin of the organization, who moves a
 * project's OWNER override and mints its new key. HQ's hand-over route decides it again on the
 * person's fresh read.
 */
export const handsOverMates = (member: MembershipFacts | undefined): boolean => orgAdmin(member);

/**
 * Zerops' own *can create projects*: an active owner or admin by their role, anyone else by the
 * flag Zerops sets on their membership. The app's *Add Mate* gate.
 */
export const mayCreateProjects = (member: MembershipFacts): boolean =>
  active(member) && (roleAtLeast(member.roleCode, "ADMIN") || member.canCreateProjects === true);

/** A Mate's door by the reach of the person's role on its project. */
const VISIBILITY: Readonly<Record<ProjectReach, RoleMateVisibility>> = {
  none: "hidden",
  read: "listed",
  work: "open",
  administer: "open",
};

/** What one person may do with each Mate, and whether they may create projects. */
export function zeropsRoleAnswer(input: RoleInput): RoleAnswer {
  const active = input.person.status === ZEROPS_ACTIVE_MEMBER_STATUS;
  const canCreate = mayCreateProjects({
    roleCode: input.person.orgRole,
    status: input.person.status,
    canCreateProjects: input.person.canCreateProjects,
  });
  const mates: Record<string, RoleMateVisibility> = {};
  for (const group of input.registry.groups) {
    for (const project of group.projects) {
      if (!isMateKind(project.kind)) continue;
      mates[project.id] = active
        ? VISIBILITY[projectReach(effectiveProjectRole(input, project.id))]
        : "hidden";
    }
  }
  return { active, canCreate, mates };
}
