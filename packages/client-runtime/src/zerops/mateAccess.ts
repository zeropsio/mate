/**
 * A person's native role on a Mate's project, from the project row and their org role as Zerops
 * pushes them, and HQ's verdict on whether the Mate opens for them (`mateEntryVisibility`). What they
 * may do to it is `mateState`'s; provider ownership is separate.
 */

import { effectiveRole, type ZeropsOrgRole } from "@t3tools/shared/zeropsRoles";
import type { HqPersonFacts } from "@t3tools/shared/hqStream";
import { ZeropsAgentId } from "@t3tools/contracts";

import type { MatePresence } from "@t3tools/shared/hqMates";

import type { AgentAdmissionAttention } from "./agentAdmissionAttention.ts";
import type { HqPlacement } from "./hq/placement.ts";

/** As much of a project as this decision needs. */
interface MateAccessProject {
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
interface MateAccessViewer {
  /** The org this membership is in. */
  readonly id: string;
  /** The `clientUser` id — what a project's `userRoles` names. */
  readonly membershipId: string;
  readonly roleCode?: string | undefined;
  readonly canCreateProjects?: boolean | undefined;
}

/** Whether a Mate opens for the person or is only listed to them. */
export type MateVisibility = "open" | "listed";

/**
 * HQ's verdict on a Mate for the person (`person.entry`): only `operates` opens it. `unknown` while
 * the entry has not arrived: nothing is judged on a guess.
 */
export const mateEntryVisibility = (
  entry: HqPersonFacts["entry"] | undefined,
): MateVisibility | "unknown" =>
  entry === undefined ? "unknown" : entry === "operates" ? "open" : "listed";

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
interface MateOwnerCandidate {
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
const MATE_AGENT_LOGINS: ReadonlyArray<string> = ZeropsAgentId.literals;

const NOBODY_SIGNED_IN = "Nobody has signed in yet";
const WAITING_FOR_YOUR_SIGN_IN = "Waiting for your sign-in";
const WAITING_FOR_SIGN_IN = "Waiting for sign-in";

/**
 * Whom a Mate's agent sign-in waits on: its owner acts in it alone, so its owner HQ names; its
 * maker or stand-up asker stands in only while HQ has not named one.
 */
export function signInAwaitedBy(input: {
  readonly ownerUserId?: string | undefined;
  readonly madeBy?: string | undefined;
  readonly standUpBy?: string | undefined;
}): string | undefined {
  return input.ownerUserId ?? input.madeBy ?? input.standUpBy;
}

/**
 * Whether a Mate says that nobody has signed its agent in, and whether that sign-in waits on the
 * viewer (the owner, 2026-09-29: "mate without auth / owner should have the state specially
 * handled"). The line is said only where nothing was asked: a Mate somebody has talked to says
 * what was asked. It is a fact with nothing to press on it: the Mate's page holds the sign-in.
 *
 * To its owner as HQ records it — its maker until a hand-over names another; its maker, or its
 * stand-up's asker, only while HQ names none — the line says it waits
 * on them: "Waiting for your sign-in", in ink, with the amber dot of what needs them (board D1,
 * 2026-09-30). One state, one phrase whichever flow made it (run 4, 2026-10-02). A Mate whose
 * sign-in somebody is waited for never reads like a failure (the owner, 2026-10-01): anybody else
 * reads that it waits for a sign-in, quietly, and a viewer not known yet reads nothing. A Mate
 * that names nobody reads the fact. A Mate that runs on an agent that needs no sign-in (Cursor,
 * OpenCode…: HQ's overview) waits on nobody's sign-in and says none of it.
 */
export function mateSignInWait(input: {
  /**
   * What its records say (`mateOwnerRecords`): `named` unknown while HQ has not named its owner; a
   * Mate that runs on an agent Mate signs nobody in to (HQ's overview) waits on no sign-in.
   */
  readonly records: {
    readonly named: boolean | undefined;
    readonly signedIn: boolean;
    readonly runsWithoutSignIn?: boolean | undefined;
  };
  /** The surface already says what was asked. */
  readonly asked: boolean;
  /**
   * Whether HQ names anybody who signed its agents in (its project's `everSignedIn`): `some`, `none`,
   * or `undefined` while HQ has not said — then nothing is said of a sign-in.
   */
  readonly hqSigners: "some" | "none" | undefined;
  /**
   * What HQ holds of the Mate (its presence's `overview`), `undefined` with no presence at all.
   * Whether anybody signed its agent in is HQ's to say only once it has heard the Mate (`live` or
   * `stored`); otherwise nothing is said of a sign-in.
   */
  readonly overview: MatePresence["overview"] | undefined;
  /** Whom HQ names its owner (`ownerUserId`): the person its sign-in waits on. */
  readonly ownerUserId?: string | undefined;
  /** Who added it, as HQ's stand-up record names them (`readZeropsMembership(…).standUp`). */
  readonly standUpBy?: string | undefined;
  /** Who made it, as HQ's record names them (`readZeropsMembership(…).madeBy`). */
  readonly madeBy?: string | undefined;
  /** The Zerops user looking, when known. */
  readonly viewer?: string | undefined;
  /**
   * Its link is made, so its page can show the sign-in. Until then the words are said and it
   * does not wait on the viewer: the page is still connecting, and the dot would ask for what
   * the page cannot offer yet.
   */
  readonly linked?: boolean | undefined;
  /**
   * What its admission says (`mateAdmissionSummary`), the verdict its composer says too. A login
   * that no longer works is said even under an ask: its owner reads the composer's words, anybody
   * else that it waits for a sign-in.
   */
  readonly admission?: Pick<AgentAdmissionAttention, "cause" | "text"> | null | undefined;
}): {
  readonly signInLine: string | undefined;
  readonly waitsOnViewer: boolean;
  /**
   * Whether `signInLine` is the answer: `false` exactly where no line is said because a fact the
   * line needs is still unknown (HQ's signers, HQ's overview, or the viewer of an awaited
   * sign-in), so a row says nothing in its place until it is (the owner, 2026-09-30: "a reload
   * paints nothing it takes back").
   */
  readonly settled: boolean;
} {
  const { records } = input;
  const viewer = input.viewer !== undefined && input.viewer.length > 0 ? input.viewer : undefined;
  const awaited = signInAwaitedBy(input);
  if (input.admission?.cause === "expired-login" && records.runsWithoutSignIn !== true) {
    if (viewer === undefined)
      return { signInLine: undefined, waitsOnViewer: false, settled: false };
    const yours = awaited === viewer;
    return {
      signInLine: yours ? input.admission.text : WAITING_FOR_SIGN_IN,
      waitsOnViewer: yours && input.linked === true,
      settled: true,
    };
  }
  if (
    records.signedIn ||
    input.hqSigners === "some" ||
    (input.overview !== undefined && input.overview !== "live" && input.overview !== "stored") ||
    input.asked ||
    records.runsWithoutSignIn === true
  ) {
    return { signInLine: undefined, waitsOnViewer: false, settled: true };
  }
  // HQ has not said whether anybody signed in, or has not been heard of the Mate: nothing yet.
  if (input.hqSigners === undefined || input.overview === undefined) {
    return { signInLine: undefined, waitsOnViewer: false, settled: false };
  }
  if (awaited === undefined) {
    return { signInLine: NOBODY_SIGNED_IN, waitsOnViewer: false, settled: true };
  }
  // Whose sign-in it waits for, never a failure — and nothing until it is known who is looking.
  if (viewer === undefined) return { signInLine: undefined, waitsOnViewer: false, settled: false };
  const yours = awaited === viewer;
  return {
    signInLine: yours ? WAITING_FOR_YOUR_SIGN_IN : WAITING_FOR_SIGN_IN,
    waitsOnViewer: yours && input.linked === true,
    settled: true,
  };
}

/**
 * Whether a Mate says "Waiting for your sign-in" (`mateSignInWait`): the same verdict, for a door
 * that says why it waits — read from HQ's facts, so it holds wherever the row does, its link open
 * or not. Without `linked` only `waitsOnViewer` changes; the line does not depend on it.
 */
export function waitsForViewerSignIn(
  input: Omit<Parameters<typeof mateSignInWait>[0], "linked">,
): boolean {
  return mateSignInWait(input).signInLine === WAITING_FOR_YOUR_SIGN_IN;
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

/** A member row is an integration token when its address is the token's own (`token-<id>@zerops.io`). */
const TOKEN_EMAIL = /^token-[^@]+@zerops\.io$/iu;

/** Whether a member row is one of the organization's integration tokens, not a person. */
export function isTokenMember(member: {
  readonly user?: { readonly email?: string | undefined } | undefined;
}): boolean {
  return TOKEN_EMAIL.test(member.user?.email ?? "");
}
