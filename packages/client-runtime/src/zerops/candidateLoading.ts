/**
 * The fetching shell behind the Zerops project picker, shared by every
 * client: list projects across one or more organizations (partial failures
 * tolerated, never dropping what did load), resolve each active project's
 * services with bounded concurrency, then derive candidates.
 *
 * Which organizations to look across — one active scope, or every
 * organization the account belongs to — is the caller's call, carried in
 * `organizationIds`; this module has no notion of either policy. Likewise
 * `connectedOrigins` arrives pre-resolved — how a client tracks a
 * registered, authenticated environment is its own concern (`useEnvironments`
 * on web, `connectedZeropsOrigins` on mobile).
 *
 * Pure over an injected client, so the network never has to run to prove the
 * concurrency cap or the partial-failure bookkeeping.
 */

import type { EnvironmentId } from "@t3tools/contracts";

import type { ZeropsProject, ZeropsService } from "./api.ts";
import { deriveZeropsCandidates, type ZeropsCandidate } from "./candidates.ts";

/** The two client reads this shell needs; the real `ZeropsApiClient` satisfies it. */
export interface ZeropsCandidateClient {
  listAccessibleClientProjects(organizationId: string): Promise<ReadonlyArray<ZeropsProject>>;
  listProjectServices(projectId: string): Promise<ReadonlyArray<ZeropsService>>;
}

export interface ZeropsCandidateLoadFailure {
  readonly organizationId: string;
  readonly cause: unknown;
}

export type ZeropsCandidateServiceOutcome =
  | { readonly status: "resolved"; readonly services: ReadonlyArray<ZeropsService> }
  | { readonly status: "failed" };

export interface LoadZeropsCandidatesResult {
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly failures: ReadonlyArray<ZeropsCandidateLoadFailure>;
}

export interface LoadZeropsCandidatesOptions {
  readonly organizationIds: ReadonlyArray<string>;
  readonly connectedOrigins: ReadonlyMap<string, EnvironmentId>;
  /** In-flight `listProjectServices` calls at once. */
  readonly concurrency?: number;
  readonly isCancelled?: () => boolean;
  /** Fires once, as soon as every organization's projects have settled. */
  readonly onProjectsLoaded?: (projects: ReadonlyArray<ZeropsProject>) => void;
  /** Fires per active project, as its services settle, for progressive rendering. */
  readonly onServiceOutcome?: (
    project: ZeropsProject,
    outcome: ZeropsCandidateServiceOutcome,
  ) => void;
}

/**
 * Loads every organization's projects in parallel, keeping the projects from
 * the organizations that answered even when another organization's read
 * rejects.
 */
export async function loadOrganizationProjects(
  organizationIds: ReadonlyArray<string>,
  load: (organizationId: string) => Promise<ReadonlyArray<ZeropsProject>>,
): Promise<{
  readonly projects: ReadonlyArray<ZeropsProject>;
  readonly failures: ReadonlyArray<ZeropsCandidateLoadFailure>;
}> {
  const outcomes = await Promise.allSettled(
    organizationIds.map(async (organizationId) => ({
      organizationId,
      projects: await load(organizationId),
    })),
  );
  const projects: ZeropsProject[] = [];
  const failures: ZeropsCandidateLoadFailure[] = [];
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      projects.push(...outcome.value.projects);
      return;
    }
    failures.push({ organizationId: organizationIds[index] ?? "unknown", cause: outcome.reason });
  });
  return { projects, failures };
}

async function resolveWithConcurrency<T>(
  items: ReadonlyArray<T>,
  limit: number,
  isCancelled: () => boolean,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (isCancelled()) return;
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

export async function loadZeropsCandidates(
  client: ZeropsCandidateClient,
  options: LoadZeropsCandidatesOptions,
): Promise<LoadZeropsCandidatesResult> {
  const concurrency = options.concurrency ?? 4;
  const isCancelled = options.isCancelled ?? (() => false);

  const { projects, failures } = await loadOrganizationProjects(
    options.organizationIds,
    (organizationId) => client.listAccessibleClientProjects(organizationId),
  );
  if (isCancelled()) return { projects, candidates: [], failures };
  options.onProjectsLoaded?.(projects);

  const services = new Map<string, ZeropsCandidateServiceOutcome>();
  await resolveWithConcurrency(
    projects.filter((project) => project.status === "ACTIVE"),
    concurrency,
    isCancelled,
    async (project) => {
      const outcome: ZeropsCandidateServiceOutcome = await client
        .listProjectServices(project.id)
        .then((resolved) => ({ status: "resolved" as const, services: resolved }))
        .catch(() => ({ status: "failed" as const }));
      if (isCancelled()) return;
      services.set(project.id, outcome);
      options.onServiceOutcome?.(project, outcome);
    },
  );
  if (isCancelled()) return { projects, candidates: [], failures };

  const candidates: ZeropsCandidate[] = [];
  for (const project of projects) {
    if (project.status !== "ACTIVE") {
      candidates.push(...deriveZeropsCandidates(project, null, options.connectedOrigins));
      continue;
    }
    const outcome = services.get(project.id);
    candidates.push(
      ...deriveZeropsCandidates(
        project,
        outcome?.status === "resolved" ? outcome.services : null,
        options.connectedOrigins,
      ),
    );
  }

  return { projects, candidates, failures };
}
