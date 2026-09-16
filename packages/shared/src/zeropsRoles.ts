/**
 * The role function — Zerops roles turned into what a person may do.
 *
 * Zerops roles are the only source of rights in Mate. Three consumers ask the
 * same question of the same inputs: the Mate app (which rows a person sees,
 * whether *Add Mate* is offered, whether *Release* is), a Mate's door (open,
 * listed or hidden for the project it runs in) and the broker (Gitea teams,
 * site admin, the OIDC `groups` claim). If any of them invented a rule of its
 * own, a person would be told one thing by the list and another by the door.
 *
 * So the rule lives once, here, and once more in Go
 * (`internal/roles` in `zeropsio/gitea-mate`). The two are kept honest by
 * `zeropsRoles.fixtures.json`, a byte-identical copy of that repository's
 * `internal/roles/fixtures.json`: both test suites replay every case and
 * compare the whole answer. A change to the rules is a change to the fixture
 * first, in both repositories.
 *
 * The prose the fixture encodes is `docs/roles.md` there. What is worth
 * repeating here is why two of the rules look asymmetric:
 *
 * - **A group's `write` is "anywhere in the group", not "everywhere".** The
 *   creator of a Mate is its `OWNER` and nothing else's; that is what earns
 *   them write on the group's code repositories, because the code they push is
 *   what their Mate builds.
 * - **`release` falls back to org `ADMIN`/`OWNER` only until the group has a
 *   production project.** The recipe is merged before production exists (the
 *   build order's step 8 precedes step 12), so with no fallback nobody could
 *   ever merge the first one.
 *
 * Pure: no clock, no network, no platform types. The caller reads the member
 * list, each project's `userRoles` and the registry tags, and hands them in.
 *
 * @module zeropsRoles
 */

/** The platform's roles, lowest first — the rank every comparison here uses. */
export type ZeropsOrgRole = "NO_ACCESS" | "READ_ONLY" | "BASIC_USER" | "ADMIN" | "OWNER";

const ROLE_RANK: Readonly<Record<ZeropsOrgRole, number>> = {
  NO_ACCESS: 0,
  READ_ONLY: 1,
  BASIC_USER: 2,
  ADMIN: 3,
  OWNER: 4,
};

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

/** What a project is to its group. One `production` per group (`docs/vocabulary.md`). */
export type RoleProjectKind = "mate" | "stage" | "production";

export interface RoleRegistryProject {
  readonly id: string;
  readonly kind: RoleProjectKind;
}

export interface RoleRegistryGroup {
  readonly id: string;
  /** The Gitea org name, and the name every claim is spelled with. */
  readonly slug: string;
  readonly projects: ReadonlyArray<RoleRegistryProject>;
}

/**
 * The account's groups and their projects, parsed from the registry tags on
 * the org's Gitea project (`groupRegistry.ts` in the fork's client runtime).
 */
export interface RoleRegistry {
  readonly groups: ReadonlyArray<RoleRegistryGroup>;
}

/** This person's per-project override, from each project's `userRoles`. */
export type ZeropsProjectRoleOverrides = Readonly<Record<string, ZeropsOrgRole>>;

export interface RolePerson {
  readonly id: string;
  readonly orgRole: ZeropsOrgRole;
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

export interface RoleGroupRights {
  readonly read: boolean;
  readonly write: boolean;
  readonly release: boolean;
}

export interface RoleAnswer {
  readonly active: boolean;
  readonly siteAdmin: boolean;
  /** The app's *Add Mate* gate. */
  readonly canCreate: boolean;
  /** The OIDC `groups` claim, sorted. */
  readonly claims: ReadonlyArray<string>;
  /** Every Mate-kind project in the registry, so a consumer never guesses. */
  readonly mates: Readonly<Record<string, RoleMateVisibility>>;
  /** Every group in the registry, keyed by slug. */
  readonly groups: Readonly<Record<string, RoleGroupRights>>;
}

function atLeast(role: ZeropsOrgRole, floor: ZeropsOrgRole): boolean {
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[floor];
}

/**
 * A person's role on one project: their override there when they have one,
 * their org role otherwise. An override lowers an owner as readily as it
 * raises a read-only member — both directions are measured.
 */
export function effectiveProjectRole(input: RoleInput, projectId: string): ZeropsOrgRole {
  return input.overrides[projectId] ?? input.person.orgRole;
}

const NOTHING: RoleGroupRights = { read: false, write: false, release: false };

/**
 * Everything one person may do across the account, from one member-list row,
 * their project overrides and the registry.
 */
export function zeropsRoleAnswer(input: RoleInput): RoleAnswer {
  const active = input.person.status === ZEROPS_ACTIVE_MEMBER_STATUS;
  const orgRole = input.person.orgRole;
  const orgAdmin = atLeast(orgRole, "ADMIN");

  const siteAdmin = active && orgRole === "OWNER";
  const canCreate = active && (orgAdmin || input.person.canCreateProjects);

  const mates: Record<string, RoleMateVisibility> = {};
  const groups: Record<string, RoleGroupRights> = {};
  const claims: Array<string> = [];

  for (const group of input.registry.groups) {
    for (const project of group.projects) {
      if (project.kind !== "mate") continue;
      mates[project.id] = !active
        ? "hidden"
        : visibilityOf(effectiveProjectRole(input, project.id));
    }

    if (!active) {
      groups[group.slug] = NOTHING;
      continue;
    }

    // Write is "BASIC_USER or above on ANY of the group's projects": the
    // creator of one Mate writes the group's code, which is what their Mate
    // builds.
    const write = group.projects.some((project) =>
      atLeast(effectiveProjectRole(input, project.id), "BASIC_USER"),
    );
    const read = write || atLeast(orgRole, "READ_ONLY");
    const production = group.projects.find((project) => project.kind === "production");
    // Until a group has a production project there is nothing to hold a role
    // on, and the recipe still has to be merged — so the org's owners and
    // admins stand in for the releasers that do not exist yet.
    const release =
      production === undefined
        ? orgAdmin
        : atLeast(effectiveProjectRole(input, production.id), "BASIC_USER");

    groups[group.slug] = { read, write, release };
    if (read) claims.push(`g:${group.slug}:read`);
    if (write) claims.push(`g:${group.slug}:write`);
    if (release) claims.push(`g:${group.slug}:release`);
  }

  if (siteAdmin) claims.push("org:owner");
  claims.sort();

  return { active, siteAdmin, canCreate, claims, mates, groups };
}

function visibilityOf(role: ZeropsOrgRole): RoleMateVisibility {
  if (atLeast(role, "BASIC_USER")) return "open";
  return role === "READ_ONLY" ? "listed" : "hidden";
}
