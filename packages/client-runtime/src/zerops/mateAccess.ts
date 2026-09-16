/**
 * Whose Mate a Mate is, on the client side of the same rule the door applies.
 *
 * ## Listed, not hidden (D5)
 *
 * Every member of the org sees every Mate in the list. Only its owner, and the
 * org's owners and admins, open one: a conversation carries tool output, file
 * contents and whatever the agent printed, and that is the Mate's owner's.
 *
 * The old shape hid what a person could not open, which is worse in both
 * directions — a colleague could not tell a Mate they were not allowed into
 * from one that did not exist, and asking for access meant asking about
 * something they could not name. So a row they cannot open **says so in
 * place**: "Jan's Mate — only Jan opens it".
 *
 * ## One rule, three consumers
 *
 * The answer comes from `@t3tools/shared/zeropsRoles`, the same function the
 * Mate's door runs before it refuses and the broker runs before it writes a
 * Gitea team. A list that invented its own rule would tell a person one thing
 * and the door another.
 *
 * Pure: no clock, no network, no platform types (rule R1). The caller reads
 * the project and the viewer's membership and hands them in.
 *
 * @module mateAccess
 */

import {
  zeropsRoleAnswer,
  type RoleMateVisibility,
  type ZeropsOrgRole,
} from "@t3tools/shared/zeropsRoles";

export type { RoleMateVisibility };

/** As much of a project as this decision needs. */
export interface MateAccessProject {
  readonly id: string;
  readonly clientId?: string | undefined;
  readonly userRoles?:
    | ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>
    | undefined;
}

/** As much of the viewer's org membership as this decision needs. */
export interface MateAccessViewer {
  /** The org this membership is in. */
  readonly id: string;
  /** The `clientUser` id — what a project's `userRoles` names. */
  readonly membershipId: string;
  readonly roleCode?: string | undefined;
  readonly canCreateProjects?: boolean | undefined;
}

const KNOWN_ROLES: ReadonlyArray<ZeropsOrgRole> = [
  "NO_ACCESS",
  "READ_ONLY",
  "BASIC_USER",
  "ADMIN",
  "OWNER",
];

/**
 * A role neither side recognises is not a role: it reads as `NO_ACCESS`, so a
 * role the platform grew and this build has never heard of hides the Mate
 * rather than opening it — the same way the door treats it.
 */
function asOrgRole(value: string | undefined): ZeropsOrgRole {
  return KNOWN_ROLES.find((role) => role === value) ?? "NO_ACCESS";
}

/**
 * What this viewer may do with this Mate: `open`, `listed` (seen, never
 * opened) or `hidden` (not theirs to know about).
 *
 * A project in another org is `hidden`: a membership says nothing about a
 * project it does not cover.
 */
export function resolveMateVisibility(input: {
  readonly project: MateAccessProject;
  readonly viewer: MateAccessViewer;
}): RoleMateVisibility {
  if (input.project.clientId !== input.viewer.id) return "hidden";
  // An override this membership cannot be matched against is no override: the
  // project named per-person roles and we cannot tell which one is ours.
  if (input.project.userRoles?.length && input.viewer.membershipId.length === 0) return "hidden";
  const override = input.project.userRoles?.find(
    (entry) => entry.clientUserId === input.viewer.membershipId,
  )?.roleCode;

  const answer = zeropsRoleAnswer({
    person: {
      id: input.viewer.membershipId,
      orgRole: asOrgRole(input.viewer.roleCode),
      status: "ACTIVE",
      canCreateProjects: input.viewer.canCreateProjects === true,
    },
    overrides: override === undefined ? {} : { [input.project.id]: asOrgRole(override) },
    registry: {
      groups: [
        {
          id: input.project.id,
          slug: input.project.id,
          projects: [{ id: input.project.id, kind: "mate" }],
        },
      ],
    },
  });
  return answer.mates[input.project.id] ?? "hidden";
}

/**
 * This viewer's effective role on this project: their override there when the
 * project names one, their org role otherwise.
 */
export function resolveMateProjectRole(input: {
  readonly project: MateAccessProject;
  readonly viewer: MateAccessViewer;
}): ZeropsOrgRole {
  if (input.project.clientId !== input.viewer.id) return "NO_ACCESS";
  const override = input.project.userRoles?.find(
    (entry) => entry.clientUserId === input.viewer.membershipId,
  )?.roleCode;
  return override === undefined ? asOrgRole(input.viewer.roleCode) : asOrgRole(override);
}

/**
 * What this person may do with a Mate besides open it.
 *
 * One rule for the whole screen (guide 0.8): **a verb a person cannot finish
 * is not offered**. Every one of these is a platform write that the platform
 * will refuse from the wrong role, and offering it anyway turns a permission
 * into an error message after the fact.
 *
 * - `create` — the app's *Add Mate* gate: `zeropsRoleAnswer(...).canCreate`,
 *   which is org `ADMIN`/`OWNER` or the *can create projects* flag. One rule,
 *   not the two the screen used to carry.
 * - `rename`, `tag`, `move` — writes to the project's own record, which need
 *   effective `OWNER` or `ADMIN` **there** (measured 2026-09-15: a project's
 *   env and tags are the owner's and the admins'; a `BASIC_USER` gets `403`).
 *   The creator of a Mate is its `OWNER`, so their own Mate is theirs to
 *   rename and to move.
 * - `assign` — handing a Mate to somebody else, which writes a per-project
 *   role override and is therefore an org `OWNER`/`ADMIN` verb only (D11).
 *   The Mate's own owner cannot give it away; being able to would let anyone
 *   hand their Mate — and whatever is in its conversation — to anyone.
 */
export interface MateVerbs {
  readonly open: boolean;
  readonly rename: boolean;
  readonly tag: boolean;
  readonly move: boolean;
  readonly assign: boolean;
}

const RANK: Readonly<Record<ZeropsOrgRole, number>> = {
  NO_ACCESS: 0,
  READ_ONLY: 1,
  BASIC_USER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function resolveMateVerbs(input: {
  readonly project: MateAccessProject;
  readonly viewer: MateAccessViewer;
}): MateVerbs {
  const visibility = resolveMateVisibility(input);
  const projectRole = resolveMateProjectRole(input);
  const writesHere = RANK[projectRole] >= RANK.ADMIN;
  const orgAdmin = RANK[asOrgRole(input.viewer.roleCode)] >= RANK.ADMIN;
  return {
    open: visibility === "open",
    rename: writesHere,
    tag: writesHere,
    move: writesHere,
    assign: orgAdmin && input.project.clientId === input.viewer.id,
  };
}

/**
 * Whether this person may make a Mate at all — the app's one *Add Mate* gate
 * (guide 0.8), and the same answer the role function gives every other
 * consumer.
 */
export function canCreateMates(viewer: {
  readonly roleCode?: string | undefined;
  readonly canCreateProjects?: boolean | undefined;
  readonly status?: string | undefined;
}): boolean {
  return zeropsRoleAnswer({
    person: {
      id: "",
      orgRole: asOrgRole(viewer.roleCode),
      status: viewer.status ?? "ACTIVE",
      canCreateProjects: viewer.canCreateProjects === true,
    },
    overrides: {},
    registry: { groups: [] },
  }).canCreate;
}

/**
 * The one line a row the person cannot open carries, in place of the verb.
 *
 * Names the owner when the account can be read for one. Without a name it says
 * the same thing without pretending to know who — "its owner" is honest, and a
 * wrong name would be worse than none.
 */
export function mateOnlyOwnerOpensIt(ownerName?: string | undefined): string {
  const owner = ownerName?.trim() ?? "";
  return owner.length === 0
    ? "Only its owner opens this Mate."
    : `${owner}'s Mate — only ${owner} opens it.`;
}

/**
 * The door's own reason for refusing a `READ_ONLY` member
 * (`environmentHttp.ts`). Its whole purpose is that this case never reads as
 * the generic permission error: "the environment credential does not grant the
 * required access" is true and says nothing, and this is not a fault to
 * recover from — it is whose Mate it is.
 */
export const ZEROPS_READ_ONLY_DOOR_REASON = "zerops_read_only";

/** A member row, as much of it as naming an owner needs. */
export interface MateOwnerCandidate {
  /** The `clientUser` id — what a project's `userRoles` names. */
  readonly id: string;
  readonly user?:
    | {
        readonly fullName?: string | undefined;
        readonly firstName?: string | undefined;
        readonly lastName?: string | undefined;
        readonly email?: string | undefined;
      }
    | undefined;
}

/** What to call a member. An e-mail beats a blank; a blank beats a guess. */
export function mateMemberName(member: MateOwnerCandidate): string | undefined {
  const user = member.user;
  if (user === undefined) return undefined;
  const full = user.fullName?.trim();
  if (full) return full;
  const joined = [user.firstName?.trim(), user.lastName?.trim()].filter(Boolean).join(" ");
  if (joined.length > 0) return joined;
  const email = user.email?.trim();
  return email && email.length > 0 ? email : undefined;
}

/**
 * Who owns this Mate, from its `userRoles` and the org's member list.
 *
 * The owner is whoever the project itself raised to `OWNER` — the person who
 * created it (a creator becomes their project's `OWNER`, measured
 * 2026-09-15). An org owner holds that role everywhere without an entry, which
 * is why it is the project's own list that is read and not the org's: the
 * answer wanted here is "whose Mate", not "who could get in".
 *
 * `undefined` when the project names no owner of its own, or when the member
 * list does not have them. The row then says the same thing without a name.
 */
export function resolveMateOwnerName(input: {
  readonly project: MateAccessProject;
  readonly members: ReadonlyArray<MateOwnerCandidate>;
}): string | undefined {
  const ownerEntry = input.project.userRoles?.find((entry) => entry.roleCode === "OWNER");
  if (ownerEntry === undefined) return undefined;
  const member = input.members.find((entry) => entry.id === ownerEntry.clientUserId);
  return member === undefined ? undefined : mateMemberName(member);
}

/**
 * D6's record of who signed an agent in: a tag on the Mate's own project,
 * `mate:signer:{agent}:{userId}`.
 *
 * It lives there and not in the container because a Mate's own key is
 * `BASIC_USER` on its project and cannot write tags (measured 2026-09-16): the
 * app writes it **as the person**, and neither the Mate nor its agent can
 * forge it. The server reads it with its own key and refuses a turn from
 * anybody else.
 */
export const MATE_SIGNER_TAG_PREFIX = "mate:signer";

export function mateSignerTag(agentId: string, userId: string): string {
  return `${MATE_SIGNER_TAG_PREFIX}:${agentId}:${userId}`;
}

/**
 * The project's tag list with this agent's signer replaced.
 *
 * Every other tag survives, this agent's previous signer does not, and a list
 * that already says the right thing comes back **identical** — the caller
 * skips the write, so signing in again with the same account costs a read and
 * nothing else.
 */
export function withMateSignerTag(
  tagList: ReadonlyArray<string> | undefined,
  agentId: string,
  userId: string,
): ReadonlyArray<string> {
  const wanted = mateSignerTag(agentId, userId);
  const kept = (tagList ?? []).filter(
    (tag) => !tag.startsWith(`${MATE_SIGNER_TAG_PREFIX}:${agentId}:`),
  );
  return [...kept, wanted];
}

/** Whether the list already records exactly this signer for this agent. */
export function mateSignerTagIsCurrent(
  tagList: ReadonlyArray<string> | undefined,
  agentId: string,
  userId: string,
): boolean {
  const current = (tagList ?? []).filter((tag) =>
    tag.startsWith(`${MATE_SIGNER_TAG_PREFIX}:${agentId}:`),
  );
  return current.length === 1 && current[0] === mateSignerTag(agentId, userId);
}

/**
 * Handing a Mate over: the project's `userRoles` with one person raised (or
 * lowered) and everybody else's override untouched (guide 0.8, D11).
 *
 * `PUT /project/{id}` replaces the list wholesale, so the caller sends the
 * whole thing; a blind write would drop every other person's role on the
 * project. Overrides are measured in both directions — the same call, lowered,
 * takes a Mate away.
 */
export function withMateProjectRole(
  userRoles:
    | ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>
    | undefined,
  clientUserId: string,
  roleCode: ZeropsOrgRole,
): ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }> {
  const others = (userRoles ?? []).filter((entry) => entry.clientUserId !== clientUserId);
  return [...others, { clientUserId, roleCode }];
}
