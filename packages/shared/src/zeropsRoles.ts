/**
 * Zerops roles, read the one way every rule here reads them; a person's reach on a project
 * (`projectReach`); and the two predicates over Zerops' own facts a client reads before or beside
 * any HQ answer (`mayBearHq`, `mayCreateProjects`).
 *
 * Zerops roles are the only source of rights in Mate. A role or a status arrives as the platform's
 * string; it is normalised once, here (`asOrgRole`): a role this build does not know is
 * `NO_ACCESS`, so a role the platform grows shuts rather than opens. Everything that compares roles
 * does it through `roleAtLeast`; what a role reaches on a project is `projectReach`'s answer alone,
 * which every surface that shows or gates a project by role maps from.
 *
 * What else a person may do — the structure, a Mate's credential — is the verb rule
 * (`zeropsPermissions.ts`), over the same normalisation: the client runs it over its own live read
 * of Zerops, HQ over the fresh read each of its verbs carries.
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
