/**
 * The access grant's REST reads (DESIGN §4.2 G1), run for the grant reducer:
 * `fetchUser`, each organization's project list, then one `fetchProject` per
 * project a few at a time. Each answer goes back to the reducer as its own
 * event, so one project's failure is that project's alone.
 *
 * Access verification reads are admission evidence only; platform records are
 * published exclusively by ZeropsDataRuntime.
 */
import {
  canCreateProjectsInOrganization,
  ZeropsApiError,
  zeropsClientsFromUser,
  type ZeropsApiClient,
  type ZeropsOrganization,
  type ZeropsProject,
  type ZeropsUser,
} from "@t3tools/client-runtime/zerops";
import type {
  GrantEvent,
  GrantFailure,
  OrganizationRef,
  ProjectOutcome,
  ProjectRef,
} from "@t3tools/client-runtime/zerops/data";

import { operableProjectAccess } from "./projectAccess";

export type AccessRoundClient = Pick<
  ZeropsApiClient,
  "fetchUser" | "listAccessibleClientProjects" | "fetchProject"
>;

/** Why a read did not answer, as the reducer tells failures apart. */
export function grantFailure(cause: unknown): GrantFailure {
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

/**
 * One project's read, judged against the viewer's membership. A hidden project
 * is verified with no access; a 403/404 is that project's denial (G6).
 */
export async function readProjectAccess(
  client: Pick<ZeropsApiClient, "fetchProject">,
  project: ProjectRef,
  membership: ZeropsOrganization,
  onRead: (project: ZeropsProject) => void,
): Promise<ProjectOutcome> {
  try {
    const read = await client.fetchProject(project.projectId);
    onRead(read);
    const access = operableProjectAccess(read, membership);
    return {
      kind: "verified",
      access:
        access === null
          ? { project, role: "NO_ACCESS", mutationsAllowed: false }
          : { project, role: access.role, mutationsAllowed: access.visibility === "open" },
    };
  } catch (cause) {
    if (cause instanceof ZeropsApiError && cause.kind === "forbidden") {
      return { kind: "denied", evidence: "direct-forbidden" };
    }
    if (cause instanceof ZeropsApiError && cause.kind === "not-found") {
      return { kind: "denied", evidence: "direct-not-found" };
    }
    return { kind: "failed", failure: grantFailure(cause) };
  }
}

export interface AccessRound {
  readonly client: AccessRoundClient;
  readonly round: number;
  /** Projects the grant holds, read even when a listing omits them. */
  readonly carried: ReadonlyArray<ProjectRef>;
  readonly concurrency: number;
  readonly organizationRef: (organizationId: string) => OrganizationRef;
  readonly projectRef: (organizationId: string, projectId: string) => ProjectRef;
  readonly onUser: (user: ZeropsUser) => void;
  readonly onProject: (project: ZeropsProject) => void;
  readonly dispatch: (event: GrantEvent) => void;
}

/**
 * Runs one round and reports its reads. It rejects only when `fetchUser` or
 * an organization list fails: the round's own failure (G1).
 */
export async function runAccessRound(input: AccessRound): Promise<{ readonly reads: number }> {
  let reads = 1;
  const user = await input.client.fetchUser();
  input.onUser(user);
  const organizations = zeropsClientsFromUser(user);
  const listed = await Promise.all(
    organizations.map(async (organization) => {
      reads++;
      return {
        organization,
        projects: await input.client.listAccessibleClientProjects(organization.id),
      };
    }),
  );
  const targets = new Map<
    string,
    { readonly ref: ProjectRef; readonly membership: ZeropsOrganization }
  >();
  for (const { organization, projects } of listed) {
    for (const project of projects) {
      targets.set(project.id, {
        ref: input.projectRef(organization.id, project.id),
        membership: organization,
      });
    }
    for (const ref of input.carried) {
      if (ref.organization.organizationId === organization.id && !targets.has(ref.projectId)) {
        targets.set(ref.projectId, { ref, membership: organization });
      }
    }
  }
  const queue = [...targets.values()];
  input.dispatch({
    type: "ROUND_ACCOUNT",
    round: input.round,
    organizations: organizations.map((organization) => ({
      organization: input.organizationRef(organization.id),
      // One creation rule for the whole app (guide 0.8): the shared role function.
      mutationsAllowed: canCreateProjectsInOrganization(organization),
    })),
    projects: queue.map(({ ref }) => ref),
  });
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(input.concurrency, queue.length) }, async () => {
      while (cursor < queue.length) {
        const { ref, membership } = queue[cursor++]!;
        reads++;
        const outcome = await readProjectAccess(input.client, ref, membership, input.onProject);
        input.dispatch({ type: "ROUND_PROJECT", round: input.round, project: ref, outcome });
      }
    }),
  );
  return { reads };
}
