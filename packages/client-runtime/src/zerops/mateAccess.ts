/**
 * A person's native role on a Mate's project, through the one shared role function
 * (`@t3tools/shared/zeropsRoles`): whether the Mate is hidden, listed or open for them, from the
 * project row and their org role as Zerops pushes them, and the platform writes the client makes
 * itself (delete, rename). Provider ownership is separate.
 */

import {
  asOrgRole,
  effectiveRole,
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
  /** The viewer's own grant, where the listing named theirs alone (`mine`) and nobody else's. */
  readonly viewerRoleCode?: string | undefined;
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
  const override = viewerProjectGrant(input);
  // An override this membership cannot be matched against is no override: the
  // project named per-person roles and we cannot tell which one is ours.
  if (
    override === undefined &&
    input.project.userRoles?.length &&
    input.viewer.membershipId.length === 0
  )
    return "hidden";

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

/** The viewer's grant on this project: the one its roles name for them, else their own one. */
export function viewerProjectGrant(input: {
  readonly project: MateAccessProject;
  readonly viewer: MateAccessViewer;
}): string | undefined {
  return (
    input.project.userRoles?.find((entry) => entry.clientUserId === input.viewer.membershipId)
      ?.roleCode ?? input.project.viewerRoleCode
  );
}

/**
 * This viewer's effective role on this project: their grant there when the
 * project names one, their org role otherwise.
 */
export function resolveMateProjectRole(input: {
  readonly project: MateAccessProject;
  readonly viewer: MateAccessViewer;
}): ZeropsOrgRole {
  if (input.project.clientId !== input.viewer.id) return "NO_ACCESS";
  return effectiveRole(viewerProjectGrant(input), input.viewer.roleCode);
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
 *
 * Handing a Mate over is an organization owner's or admin's (`handsOverMates`).
 */
export interface MateVerbs {
  readonly delete: boolean;
  readonly rename: boolean;
}

export function resolveMateVerbs(input: {
  readonly project: MateAccessProject;
  readonly viewer: MateAccessViewer;
}): MateVerbs {
  const projectAdmin = roleAtLeast(resolveMateProjectRole(input), "ADMIN");
  return {
    delete: projectAdmin,
    rename: projectAdmin,
  };
}

/**
 * What a person whose role only reads a Mate has, in the product's words (Read access): said as
 * what they have, never as another product's permission or as what they may not do.
 */
export const MATE_READ_ACCESS_LINE = "You have Read access to this Mate.";

/**
 * The one line a row the person cannot open carries, in place of the verb.
 *
 * Names the owner when the account can be read for one. Without a name it says
 * the same access without inventing ownership.
 */
export function mateOnlyOwnerOpensIt(ownerName?: string | undefined): string {
  const owner = ownerName?.trim() ?? "";
  return owner.length === 0 ? MATE_READ_ACCESS_LINE : `${owner}'s Mate — you have Read access.`;
}

/**
 * The door's own reason for refusing a `READ_ONLY` member
 * (`environmentHttp.ts`). Its whole purpose is that this case never reads as
 * the generic permission error: "the environment credential does not grant the
 * required access" is true and says nothing, and this is not a fault to
 * recover from — it is the role Zerops gives them in the project.
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
 * What a Mate's own records say of whose it is and of its sign-in before anybody is looked up, as
 * facts: whether HQ names an owner of it (`ownerUserId`, the only word on whose it is: nothing here
 * guesses one from its maker or its signer), whether anybody is signed in to its agent now (D6's
 * signer of the agent's own login; a login added beside it names only who uses that one), and
 * whether it waits on no sign-in at all. A viewer HQ sends no overview to sees nobody signed in.
 */
export function mateOwnerRecords(
  project: Pick<MateAccessProject, "hq">,
  /** Whether HQ names an owner of it (`ownerUserId`); `undefined` while HQ has not said. */
  owned: boolean | undefined,
): {
  readonly named: boolean | undefined;
  readonly signedIn: boolean;
  /**
   * It runs on an agent Mate signs nobody in to (its overview), or it is automated, on the
   * organization's key: it waits on no sign-in.
   */
  readonly runsWithoutSignIn: boolean;
} {
  const mate = project.hq?.mate;
  const logins = mate?.logins ?? {};
  return {
    named: owned,
    signedIn: MATE_AGENT_LOGINS.some((key) => {
      const userId = logins[key]?.signedInBy;
      return typeof userId === "string" && userId.length > 0;
    }),
    // An automated Mate's agents run on the organization's key: nobody signs it in, ever.
    runsWithoutSignIn: mate?.runsWithoutSignIn === true || mate?.automated === true,
  };
}

/** The agents' own logins, whose signer signs the Mate's agent in; a login added beside them does not. */
const MATE_AGENT_LOGINS: ReadonlyArray<string> = ["claude-code", "codex"];

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

/** A member row is an integration token when its address is the token's own (`token-<id>@zerops.io`). */
const TOKEN_EMAIL = /^token-[^@]+@zerops\.io$/iu;

/** Whether a member row is one of the organization's integration tokens, not a person. */
export function isTokenMember(member: {
  readonly user?: { readonly email?: string | undefined } | undefined;
}): boolean {
  return TOKEN_EMAIL.test(member.user?.email ?? "");
}
