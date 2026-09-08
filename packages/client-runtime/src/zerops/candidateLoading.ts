/** Pure candidate projection over the central platform-data read model. */

import type { EnvironmentId } from "@t3tools/contracts";

import type { ZeropsService } from "./api.ts";
import { projectRecordToZeropsProject, serviceRecordToZeropsService } from "./data/dto.ts";
import { deriveZeropsCandidates, type ZeropsCandidate } from "./candidates.ts";
import type {
  CollectionRead,
  EntityKnowledge,
  ProjectRecord,
  ServiceRecord,
} from "./data/types.ts";

export interface ZeropsCandidateProjection {
  /** Preserve collection readiness, coverage and access; an empty value alone is ambiguous. */
  readonly projects: CollectionRead<ProjectRecord>;
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  /** Projects whose required identity or lifecycle facets are not observed yet. */
  readonly unresolvedProjects: ReadonlyArray<EntityKnowledge<ProjectRecord>>;
  /** Active projects whose service membership or required service facets are incomplete. */
  readonly unresolvedServiceProjects: ReadonlyArray<ProjectRecord>;
}

/**
 * Pure candidate projection over central runtime reads. It performs no platform
 * I/O: unresolved membership or facets remain explicit so clients can render
 * progress without starting a second inventory owner.
 */
export function projectZeropsCandidates(
  projects: CollectionRead<ProjectRecord>,
  servicesOf: (project: ProjectRecord) => CollectionRead<ServiceRecord>,
  connectedOrigins: ReadonlyMap<string, EnvironmentId>,
): ZeropsCandidateProjection {
  const candidates: ZeropsCandidate[] = [];
  const unresolvedProjects: Array<EntityKnowledge<ProjectRecord>> = [];
  const unresolvedServiceProjects: ProjectRecord[] = [];

  for (const projectKnowledge of projects.value) {
    if (projectKnowledge.knowledge !== "observed") {
      unresolvedProjects.push(projectKnowledge);
      continue;
    }
    const project = projectRecordToZeropsProject(projectKnowledge.record);
    if (project === null) {
      unresolvedProjects.push(projectKnowledge);
      continue;
    }
    if (project.status !== "ACTIVE") {
      candidates.push(...deriveZeropsCandidates(project, [], connectedOrigins));
      continue;
    }

    const services = servicesOf(projectKnowledge.record);
    if (services.query.status !== "observed") {
      unresolvedServiceProjects.push(projectKnowledge.record);
      candidates.push(...deriveZeropsCandidates(project, null, connectedOrigins));
      continue;
    }
    const decoded: ZeropsService[] = [];
    let incomplete = false;
    for (const serviceKnowledge of services.value) {
      if (serviceKnowledge.knowledge !== "observed") {
        incomplete = true;
        continue;
      }
      const service = serviceRecordToZeropsService(serviceKnowledge.record);
      if (service === null) incomplete = true;
      else decoded.push(service);
    }
    if (incomplete) unresolvedServiceProjects.push(projectKnowledge.record);
    candidates.push(
      ...deriveZeropsCandidates(project, incomplete ? null : decoded, connectedOrigins),
    );
  }

  return { projects, candidates, unresolvedProjects, unresolvedServiceProjects };
}
