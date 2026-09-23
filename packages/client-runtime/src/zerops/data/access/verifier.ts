/**
 * The access grant's verification reads (DESIGN §4.2 G1), behind the `AccessVerifier` port the
 * grant's interpreter in the data runtime runs: `fetchUser`, each organization's project list,
 * then one `fetchProject` per project a few at a time. Each answer reaches the grant as its own
 * event, so one project's failure is that project's alone.
 *
 * Verification reads are admission evidence only; platform records are published exclusively by
 * the data runtime.
 */
import * as Effect from "effect/Effect";

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
  ZeropsProjectId,
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
  /** Projects the grant holds, read even when a listing omits them. */
  readonly carried: ReadonlyArray<ProjectRef>;
  readonly report: (event: AccessRoundEvent) => Effect.Effect<void>;
}

/** `fetchUser` or an organization list failed: the round's own failure (G1). */
export interface AccessRoundFailure {
  readonly failure: GrantFailure;
  /** What went wrong, in the platform's words. */
  readonly message: string;
}

/** The port the grant's interpreter verifies through. */
export interface AccessVerifier {
  /** Runs one round, reporting each answer as it arrives; fails only as a round (G1). */
  readonly verifyRound: (request: AccessRoundRequest) => Effect.Effect<void, AccessRoundFailure>;
  /** Reads one project between rounds: a per-project retry, or a denial's confirmation (G6). */
  readonly verifyProject: (project: ProjectRef) => Effect.Effect<ProjectOutcome>;
}

export type AccessVerifierClient = Pick<
  ZeropsApiClient,
  "fetchUser" | "listAccessibleClientProjects" | "fetchProject"
>;

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

/**
 * One project's read, judged against the viewer's membership. A hidden project
 * is verified with no access; a 403/404 is that project's denial (G6).
 */
const readProjectAccess = (
  client: Pick<AccessVerifierClient, "fetchProject">,
  project: ProjectRef,
  membership: ZeropsOrganization,
): Effect.Effect<ProjectOutcome> =>
  readPlatform((signal) => client.fetchProject(project.projectId, signal)).pipe(
    Effect.map((read): ProjectOutcome => {
      const access = operableProjectAccess(read, membership);
      return {
        kind: "verified",
        access:
          access === null
            ? { project, role: "NO_ACCESS", mutationsAllowed: false }
            : { project, role: access.role, mutationsAllowed: access.visibility === "open" },
      };
    }),
    Effect.catch(({ cause }) =>
      Effect.succeed<ProjectOutcome>(
        cause instanceof ZeropsApiError && cause.kind === "forbidden"
          ? { kind: "denied", evidence: "direct-forbidden" }
          : cause instanceof ZeropsApiError && cause.kind === "not-found"
            ? { kind: "denied", evidence: "direct-not-found" }
            : { kind: "failed", failure: grantFailure(cause) },
      ),
    ),
  );

export interface RestAccessVerifierOptions {
  readonly client: AccessVerifierClient;
  readonly account: AccountRef;
  /** `fetchProject` reads a round runs at once. */
  readonly concurrency: number;
  /** Told each user a round reads, so the session's memberships stay current. */
  readonly onUser: (user: ZeropsUser) => void;
}

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
  const projectRef = (organizationId: string, projectId: string): ProjectRef => ({
    kind: "project",
    organization: organizationRef(organizationId),
    projectId: ZeropsProjectId.make(projectId),
  });

  return {
    verifyRound: ({ round, carried, report }) => {
      const span = mateDiagnostics.span("access-round", { round });
      // The user read, then each organization's listing and each project read.
      let reads = 1;
      return Effect.gen(function* () {
        const user = yield* readPlatform(() => client.fetchUser());
        options.onUser(user);
        const organizations = zeropsClientsFromUser(user);
        memberships = organizations;
        const listed = yield* Effect.forEach(
          organizations,
          (organization) => {
            reads++;
            return readPlatform(() => client.listAccessibleClientProjects(organization.id)).pipe(
              Effect.map((projects) => ({ organization, projects })),
            );
          },
          { concurrency: "unbounded" },
        );
        const targets = new Map<
          string,
          { readonly ref: ProjectRef; readonly membership: ZeropsOrganization }
        >();
        for (const { organization, projects } of listed) {
          for (const project of projects) {
            targets.set(project.id, {
              ref: projectRef(organization.id, project.id),
              membership: organization,
            });
          }
          for (const ref of carried) {
            if (
              ref.organization.organizationId === organization.id &&
              !targets.has(ref.projectId)
            ) {
              targets.set(ref.projectId, { ref, membership: organization });
            }
          }
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
          ({ ref, membership }) => {
            reads++;
            return readProjectAccess(client, ref, membership).pipe(
              Effect.flatMap((outcome) =>
                report({ type: "ROUND_PROJECT", round, project: ref, outcome }),
              ),
            );
          },
          { concurrency: options.concurrency, discard: true },
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
        : readProjectAccess(client, project, membership);
    },
  };
}
