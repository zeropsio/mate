/**
 * Account membership, read once a round, and each demanded project judged on the row the account's
 * store holds: Zerops filters the organization's project listing by the viewer's token, so the
 * store already knows which projects are the viewer's, and nothing is read per project.
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import type { ProjectStanding } from "../../../data/projections/projects.ts";
import { canCreateProjectsInOrganization } from "../../accountScope.ts";
import {
  ZeropsApiError,
  zeropsClientsFromUser,
  type ZeropsApiClient,
  type ZeropsOrganization,
  type ZeropsProject,
  type ZeropsUser,
} from "../../api.ts";
import { diagnosticFailure, mateDiagnostics } from "../../diagnostics.ts";
import { zeropsErrorMessage } from "../../errors.ts";
import { resolveMateVisibility, type RoleMateVisibility } from "../../mateAccess.ts";
import {
  ZeropsOrganizationId,
  type AccountRef,
  type OrganizationRef,
  type ProjectRef,
} from "../types.ts";
import type { GrantEvent, GrantFailure, ProjectOutcome } from "./grant.ts";

/** A round's answers, as the grant takes them: the account part, then each project. */
export type AccessRoundEvent = Extract<
  GrantEvent,
  { readonly type: "ROUND_ACCOUNT" | "ROUND_PROJECT" }
>;

export interface AccessRoundRequest {
  readonly round: number;
  /** Projects held by a route or explicit action. */
  readonly carried: ReadonlyArray<ProjectRef>;
  readonly report: (event: AccessRoundEvent) => Effect.Effect<void>;
}

/** `fetchUser` failed: the round's own failure (G1). */
export interface AccessRoundFailure {
  readonly failure: GrantFailure;
  /** What went wrong, in the platform's words. */
  readonly message: string;
}

/** The port the grant's interpreter verifies through. */
export interface AccessVerifier {
  /** Runs one round, reporting each answer as it arrives; fails only as a round (G1). */
  readonly verifyRound: (request: AccessRoundRequest) => Effect.Effect<void, AccessRoundFailure>;
  /** Judges one project between rounds: a per-project retry, or a denial's confirmation (G6). */
  readonly verifyProject: (project: ProjectRef) => Effect.Effect<ProjectOutcome>;
}

export type AccessVerifierClient = Pick<ZeropsApiClient, "fetchUser">;

// ── The per-project classifier ────────────────────────────────────────────────────────────────

/**
 * Which of the account's projects this client will admit, and on what terms.
 *
 * Two answers, not one (D5). A project the viewer is `BASIC_USER` or above on
 * is **open**: they connect to it, and the data runtime lets them write.
 * A project they are `READ_ONLY` on is **listed**: it stays in the tree with
 * its name and its owner, and the row says in place that it is not theirs to
 * open. Only `NO_ACCESS` drops out, because that Mate is not theirs to know
 * about at all.
 *
 * Listing what cannot be opened is the whole point: hiding it left a colleague
 * unable to tell a Mate they were not allowed into from one that did not
 * exist, and unable to name the thing they wanted access to.
 *
 * The rule itself is `mateAccess.ts` → `@t3tools/shared/zeropsRoles`, the same
 * function the Mate's door runs before it refuses.
 */
export type OperableProjectRole = "OWNER" | "ADMIN" | "BASIC_USER" | "READ_ONLY";

export interface OperableProjectAccess {
  readonly project: ZeropsProject;
  readonly role: OperableProjectRole;
  /**
   * `open` — connect to it and write in it. `listed` — it is in the tree, its
   * row says whose it is, and nothing here may be changed.
   */
  readonly visibility: Exclude<RoleMateVisibility, "hidden">;
}

/** One project's read, classified against the viewer's membership; `null` when it is hidden. */
export function operableProjectAccess(
  project: ZeropsProject,
  membership: ZeropsOrganization,
): OperableProjectAccess | null {
  const visibility = resolveMateVisibility({
    project,
    viewer: {
      id: membership.id,
      membershipId: membership.membershipId,
      roleCode: membership.roleCode,
      canCreateProjects: membership.canCreateProjects,
    },
  });
  if (visibility === "hidden") return null;
  const role =
    project.userRoles?.find((entry) => entry.clientUserId === membership.membershipId)?.roleCode ??
    membership.roleCode;
  if (visibility === "listed") return { project, role: "READ_ONLY", visibility };
  return role === "OWNER" || role === "ADMIN" || role === "BASIC_USER"
    ? { project, role, visibility }
    : null;
}

// ── The REST verifier ─────────────────────────────────────────────────────────────────────────

/** Why a read did not answer, as the grant tells failures apart. */
function grantFailure(cause: unknown): GrantFailure {
  if (cause instanceof ZeropsApiError) {
    switch (cause.kind) {
      case "network":
      case "uncertain":
        return { kind: "transport", detail: cause.message };
      case "server":
        return { kind: "server", status: cause.status ?? 500 };
      default:
        return { kind: "malformed", detail: cause.message };
    }
  }
  if (cause instanceof DOMException && cause.name === "TimeoutError") {
    return { kind: "timeout", afterMs: 0 };
  }
  return { kind: "transport", detail: cause instanceof Error ? cause.message : String(cause) };
}

/** A read that did not answer, with what the platform said. */
interface ReadFailure {
  readonly cause: unknown;
}

const readPlatform = <A>(
  read: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, ReadFailure> => Effect.tryPromise({ try: read, catch: (cause) => ({ cause }) });

/** A project's row, as the account's store holds it, judged against the viewer's membership. */
const projectOutcome = (
  project: ProjectRef,
  row: ZeropsProject,
  membership: ZeropsOrganization,
): ProjectOutcome => {
  const access = operableProjectAccess(row, membership);
  return {
    kind: "verified",
    access:
      access === null
        ? { project, role: "NO_ACCESS", mutationsAllowed: false, userRoles: [] }
        : {
            project,
            role: access.role,
            mutationsAllowed: access.visibility === "open",
            userRoles: row.userRoles ?? [],
          },
  };
};

/**
 * Where the store says a project stands, judged against the viewer's membership. A hidden project
 * is verified with no access; one its owner refused or proved deleted is that project's denial
 * (G6); one the store does not know yet waits like a read that did not answer.
 */
const judgeProject = (
  project: ProjectRef,
  standing: ProjectStanding,
  membership: ZeropsOrganization,
): ProjectOutcome => {
  switch (standing.kind) {
    case "listed": {
      // A listing row names the viewer's own grant without whose it is: theirs, as a grant.
      const { viewerRoleCode, ...row } = standing.project;
      const named = row.userRoles?.some(
        ({ clientUserId }) => clientUserId === membership.membershipId,
      );
      return projectOutcome(
        project,
        viewerRoleCode === undefined || named === true
          ? row
          : {
              ...row,
              userRoles: [
                ...(row.userRoles ?? []),
                { clientUserId: membership.membershipId, roleCode: viewerRoleCode },
              ],
            },
        membership,
      );
    }
    case "denied":
      return { kind: "denied", evidence: "direct-forbidden" };
    case "deleted":
      return { kind: "denied", evidence: "direct-not-found" };
    case "unknown":
      return {
        kind: "failed",
        failure: { kind: "transport", detail: "The project's row is not read yet." },
      };
  }
};

export interface RestAccessVerifierOptions {
  readonly client: AccessVerifierClient;
  /** Where one project stands as the account's store holds it now. */
  readonly standing: (project: ProjectRef) => ProjectStanding;
  readonly account: AccountRef;
  /** Told each user a round reads, so the session's memberships stay current. */
  readonly onUser: (user: ZeropsUser) => void;
  /**
   * The user the session verified last, and when: a round within `RECENT_USER_MS` of it takes
   * that user rather than reading it again.
   */
  readonly recentUser?: () => { readonly user: ZeropsUser; readonly atMs: number } | null;
}

/** How long a user the session verified stands in for a round's own read of it. */
export const RECENT_USER_MS = 60_000;

/** The verifier over the Zerops REST API, measured as `access-round` diagnostics. */
export function makeRestAccessVerifier(options: RestAccessVerifierOptions): AccessVerifier {
  const { client, account } = options;
  /** The memberships the last round read, to judge a project read between rounds. */
  let memberships: ReadonlyArray<ZeropsOrganization> = [];
  const organizationRef = (organizationId: string): OrganizationRef => ({
    kind: "organization",
    account,
    organizationId: ZeropsOrganizationId.make(organizationId),
  });
  return {
    verifyRound: ({ round, carried, report }) => {
      const span = mateDiagnostics.span("access-round", { round });
      // Identity and membership are read; the demanded projects are the store's.
      let reads = 0;
      return Effect.gen(function* () {
        const recent = options.recentUser?.() ?? null;
        const now = yield* Clock.currentTimeMillis;
        const fresh = recent !== null && now - recent.atMs < RECENT_USER_MS;
        if (!fresh) reads++;
        const user = fresh
          ? recent.user
          : yield* readPlatform((signal) => client.fetchUser(signal));
        options.onUser(user);
        const organizations = zeropsClientsFromUser(user);
        memberships = organizations;
        const targets = new Map<
          string,
          { readonly ref: ProjectRef; readonly membership: ZeropsOrganization }
        >();
        for (const ref of carried) {
          const membership = organizations.find(({ id }) => id === ref.organization.organizationId);
          if (membership !== undefined) targets.set(ref.projectId, { ref, membership });
        }
        const queue = [...targets.values()];
        yield* report({
          type: "ROUND_ACCOUNT",
          round,
          organizations: organizations.map((organization) => ({
            organization: organizationRef(organization.id),
            // One creation rule for the whole app (guide 0.8): the shared role function.
            mutationsAllowed: canCreateProjectsInOrganization(organization),
          })),
          projects: queue.map(({ ref }) => ref),
        });
        yield* Effect.forEach(
          queue,
          ({ ref, membership }) =>
            report({
              type: "ROUND_PROJECT",
              round,
              project: ref,
              outcome: judgeProject(ref, options.standing(ref), membership),
            }),
          { discard: true },
        );
      }).pipe(
        Effect.tap(() => Effect.sync(() => span.end({ outcome: "verified", reads }))),
        Effect.mapError(({ cause }): AccessRoundFailure => {
          span.end({ outcome: "failed", reads, ...diagnosticFailure(cause) });
          return { failure: grantFailure(cause), message: zeropsErrorMessage(cause) };
        }),
        // A round cut off by the epoch's end is dropped, never verified.
        Effect.onInterrupt(() => Effect.sync(span.drop)),
      );
    },
    verifyProject: (project) => {
      const membership = memberships.find(({ id }) => id === project.organization.organizationId);
      return membership === undefined
        ? Effect.succeed({
            kind: "failed",
            failure: { kind: "malformed", detail: "No round has read this organization." },
          })
        : Effect.succeed(judgeProject(project, options.standing(project), membership));
    },
  };
}
