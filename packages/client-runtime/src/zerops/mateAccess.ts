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
 * Mate's door runs before it refuses and HQ runs over its structure. A list
 * that invented its own rule would tell a person one thing
 * and the door another.
 *
 * Pure: no clock, no network, no platform types (rule R1). The caller reads
 * the project and the viewer's membership and hands them in.
 *
 * @module mateAccess
 */

import {
  asOrgRole,
  roleAtLeast,
  zeropsRoleAnswer,
  type RoleMateVisibility,
  type ZeropsOrgRole,
} from "@t3tools/shared/zeropsRoles";

import type { HqPlacement } from "./hq/placement.ts";

export type { RoleMateVisibility };

/** As much of a project as this decision needs. */
export interface MateAccessProject {
  readonly id: string;
  readonly clientId?: string | undefined;
  readonly userRoles?:
    | ReadonlyArray<{ readonly clientUserId: string; readonly roleCode: string }>
    | undefined;
  /**
   * Where HQ places it: its Mate's logins name who signed each of its agents in (D6), joined from
   * HQ's overview for whoever may operate it (`observe_mate`).
   */
  readonly hq?: HqPlacement | undefined;
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
 * What this person may do to a Mate's project on the platform — following it, its face and its
 * place are HQ's offers (`can`, `@t3tools/shared/hqOffers`).
 *
 * One rule for the whole screen (guide 0.8): **a verb a person cannot finish
 * is not offered**. Every one of these is a platform write that the platform
 * will refuse from the wrong role, and offering it anyway turns a permission
 * into an error message after the fact.
 *
 * - `delete` — taking the Mate's project off Zerops, which needs effective
 *   `OWNER` or `ADMIN` **there** (measured 2026-09-15: a member below `ADMIN`,
 *   the `OWNER` of the project they made, deleted it; the OpenAPI says the same
 *   for every role below `ADMIN`). The creator of a Mate is its `OWNER`, so
 *   their own Mate is theirs to delete; an org owner or admin may delete
 *   anyone's.
 * - `rename` — renaming the Mate's project, whose name is the Mate's (D3): a
 *   `PUT /project/{id}`, which needs effective `OWNER` or `ADMIN` there as
 *   deleting it does (measured: tags and rename need effective `OWNER`/`ADMIN`).
 * - `assign` — handing a Mate to somebody else, which writes a per-project
 *   role override and is therefore an org `OWNER`/`ADMIN` verb only (D11).
 *   The Mate's own owner cannot give it away; being able to would let anyone
 *   hand their Mate — and whatever is in its conversation — to anyone.
 */
export interface MateVerbs {
  readonly delete: boolean;
  readonly rename: boolean;
  readonly assign: boolean;
}

export function resolveMateVerbs(input: {
  readonly project: MateAccessProject;
  readonly viewer: MateAccessViewer;
}): MateVerbs {
  const orgAdmin = roleAtLeast(input.viewer.roleCode, "ADMIN");
  const projectAdmin = roleAtLeast(resolveMateProjectRole(input), "ADMIN");
  return {
    delete: projectAdmin,
    rename: projectAdmin,
    assign: orgAdmin && input.project.clientId === input.viewer.id,
  };
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
        /** The user id — what a Mate's signers name. */
        readonly id?: string | undefined;
        readonly fullName?: string | undefined;
        readonly firstName?: string | undefined;
        readonly lastName?: string | undefined;
        readonly email?: string | undefined;
        readonly avatar?:
          | {
              readonly smallAvatarUrl?: string | null | undefined;
              readonly largeAvatarUrl?: string | null | undefined;
              readonly externalAvatarUrl?: string | null | undefined;
            }
          | null
          | undefined;
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
 * What a Mate's own records say of its person before anybody is looked up, as
 * facts: whether they name anybody at all (an `OWNER` entry, or the signer of
 * its agent), and whether anybody has
 * signed its agent in (D6's signer of the agent's own login; a login added
 * beside it names only who uses that one).
 *
 * Read off the project and where HQ places it, so a list knows them as soon as
 * HQ's overview of the Mate names its logins: a Mate whose records name nobody
 * is nobody's whether or not anybody is named yet, and the first person to sign
 * its agent in makes it theirs. A viewer HQ sends no overview to sees no signer.
 */
export function mateOwnerRecords(project: Pick<MateAccessProject, "hq" | "userRoles">): {
  readonly named: boolean | undefined;
  readonly signedIn: boolean;
  /** The Zerops user id who signed its agent in, where somebody did. */
  readonly signer: string | undefined;
  /** The Zerops user id HQ makes it the Mate of (`matePerson`): its signer, or its maker. */
  readonly person: string | undefined;
  /** It runs on an agent Mate signs nobody in to (its overview): it waits on no sign-in. */
  readonly runsWithoutSignIn: boolean;
} {
  const records = matePerson(project);
  const owned = project.userRoles?.some((entry) => entry.roleCode === "OWNER");
  return { named: records.signedIn || records.person !== undefined || owned, ...records };
}

/**
 * The agents whose own signer speaks for the Mate, in the order it is named by; a login added
 * beside them names only who uses it.
 */
const MATE_OWNER_SIGNER_KEYS: ReadonlyArray<string> = ["claude-code", "codex"];

/**
 * What HQ says of the agents' own logins: a current signer, else the last recorded signer for
 * display. Claude Code comes first; history never says the login is signed in.
 */
function mateOwnerSigner(project: Pick<MateAccessProject, "hq">): {
  readonly signedIn: boolean;
  readonly signer: string | undefined;
} {
  const logins = project.hq?.mate?.logins ?? {};
  const activeSigner = MATE_OWNER_SIGNER_KEYS.map((key) => logins[key]?.signedInBy).find(
    (userId): userId is string => typeof userId === "string" && userId.length > 0,
  );
  const signer = MATE_OWNER_SIGNER_KEYS.map(
    (key) => logins[key]?.signedInBy ?? logins[key]?.lastSignedInBy,
  ).find((userId): userId is string => typeof userId === "string" && userId.length > 0);
  return { signedIn: activeSigner !== undefined, signer };
}

/**
 * Whether anybody has ever signed one of a Mate's logins in, any agent's: a current signer, the
 * last one a sign-out keeps, or the signer HQ saved before its live logins arrive. A Mate signed
 * in once has arrived for good (`mateArrivingUntil`); it never says the login is signed in now.
 */
export function mateSignedInOnce(project: Pick<MateAccessProject, "hq">): boolean {
  return Object.values(project.hq?.mate?.logins ?? {}).some((login) =>
    [login?.signedInBy, login?.lastSignedInBy].some(
      (userId) => typeof userId === "string" && userId.length > 0,
    ),
  );
}

/** The current or last signer, else a ready agent's maker, as HQ names them. */
function matePerson(project: Pick<MateAccessProject, "hq">) {
  const { signedIn, signer } = mateOwnerSigner(project);
  const mate = project.hq?.mate;
  const runsWithoutSignIn = mate?.runsWithoutSignIn === true;
  const person =
    signer ??
    (runsWithoutSignIn ? (mate?.madeBy ?? mate?.standupRequestedBy ?? undefined) : undefined);
  return { signedIn, signer, person, runsWithoutSignIn };
}

/** A member row is an integration token when its address is the token's own (`token-<id>@zerops.io`). */
const TOKEN_EMAIL = /^token-[^@]+@zerops\.io$/iu;

/** Whether a member row is one of the organization's integration tokens, not a person. */
export function isTokenMember(member: {
  readonly user?: { readonly email?: string | undefined } | undefined;
}): boolean {
  return TOKEN_EMAIL.test(member.user?.email ?? "");
}

/**
 * Handing a Mate over: one person's project role list with this project's
 * role set — or, `null`, gone from it — and their every other project's
 * untouched (guide 0.8, D11).
 *
 * `PUT /client-user/{id}/roles` replaces the person's list wholesale, so the
 * caller sends the whole thing; a blind write would drop the person's role on
 * every other project. Measured both ways: the same call, lowered, takes a
 * Mate away, and a list without the project drops it alone (F7, 2026-10-03).
 */
export function withMateProjectRole(
  projectRoleList:
    | ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }>
    | undefined,
  projectId: string,
  roleCode: ZeropsOrgRole | null,
): ReadonlyArray<{ readonly projectId: string; readonly roleCode: string }> {
  const others = (projectRoleList ?? [])
    .filter((entry) => entry.projectId !== projectId)
    .map((entry) => ({ projectId: entry.projectId, roleCode: entry.roleCode }));
  return roleCode === null ? others : [...others, { projectId, roleCode }];
}
