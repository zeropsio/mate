/**
 * The model behind the Zerops project picker: every zcp container the signed-in
 * account can reach, across every org, sorted into `connected` (already
 * registered as an environment), `ready` (reachable, one click away) and
 * `unavailable` (with a reason the user can act on).
 *
 * This file is pure — it takes already-fetched projects and services and does
 * all the branching. The fetching shell lives in `useZeropsCandidates.ts`, so
 * the decisions are testable without a network.
 */

import {
  buildZeropsContainerUrl,
  zeropsRegionFromPublicZone,
  type ZeropsProject,
  type ZeropsService,
} from "./api.ts";
import type { EnvironmentId } from "@t3tools/contracts";

export type ZeropsCandidateGroup = "connected" | "ready" | "provisioning" | "unavailable";

export interface ZeropsCandidateService {
  readonly id: string;
  readonly name: string;
  readonly status: string;
}

export interface ZeropsCandidate {
  /** Stable list key: a project can hold several containers. */
  readonly key: string;
  readonly project: ZeropsProject;
  readonly group: ZeropsCandidateGroup;
  readonly reason?: string;
  readonly service?: ZeropsCandidateService;
  readonly containerOrigin?: string;
  readonly environmentId?: EnvironmentId;
}

/**
 * A zcp container is identified by its service *type*, never its hostname:
 * `zcp` is only the default name, and matching on it reports "no container"
 * for a project that demonstrably has one.
 */
const ZCP_SERVICE_TYPE_PREFIX = "zcp@";

/**
 * The container's single public port. Zerops Code rides on it under `/z3/`,
 * beside code-server — it does not declare a port of its own.
 */
export const ZCP_HTTP_PORT = 8080;

/**
 * Zerops Code is proxied under this prefix on the container's single port,
 * beside code-server — it does not have an origin or a port of its own.
 */
export const ZEROPS_CODE_BASE_PATH = "/z3";

/** The z3 server's base URL for a container origin, prefix included. */
export function zeropsCodeBaseUrl(containerOrigin: string): string {
  return `${containerOrigin.replace(/\/+$/, "")}${ZEROPS_CODE_BASE_PATH}`;
}

function isZcpService(service: ZeropsService): boolean {
  return (service.serviceStackTypeInfo?.serviceStackTypeVersionName ?? "").startsWith(
    ZCP_SERVICE_TYPE_PREFIX,
  );
}

/** `https://…` → its origin, lowercased, for comparing against a registered environment's URL. */
export function normalizeOrigin(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

type OriginOutcome =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly reason: string };

function containerOrigin(project: ZeropsProject, service: ZeropsService): OriginOutcome {
  if (service.subdomainAccess === false) {
    return { ok: false, reason: "public access is off for this container" };
  }
  if (!service.ports?.some((port) => port.port === ZCP_HTTP_PORT)) {
    return { ok: false, reason: `this container does not expose port ${ZCP_HTTP_PORT}` };
  }
  const region = project.publicZone ? zeropsRegionFromPublicZone(project.publicZone) : null;
  if (!region || !project.zeropsSubdomainHost) {
    return { ok: false, reason: "this project has no public subdomain" };
  }
  return {
    ok: true,
    origin: buildZeropsContainerUrl(
      service.name,
      project.zeropsSubdomainHost,
      ZCP_HTTP_PORT,
      region,
    ),
  };
}

function unavailable(project: ZeropsProject, reason: string, key = project.id): ZeropsCandidate {
  return { key, project, group: "unavailable", reason };
}

function provisioningProject(project: ZeropsProject, reason: string): ZeropsCandidate {
  return { key: project.id, project, group: "provisioning", reason };
}

/**
 * `ZeropsProject.status` / `ZeropsService.status` are plain `string`s in
 * `packages/client-runtime/src/zerops/api.ts` — there is no status union to
 * derive this from, so these sets are curated from the known Zerops status
 * values that mean "still on its way up", not "wrong" or "gone".
 */
const PROJECT_PROVISIONING_STATUSES = new Set(["NEW", "CREATING"]);
const SERVICE_PROVISIONING_STATUSES = new Set([
  "NEW",
  "CREATING",
  "STARTING",
  "RESTARTING",
  "UPGRADING",
]);

/**
 * Every candidate one project contributes — one per zcp container, so a project
 * holding two of them offers both rather than collapsing into "ambiguous".
 * `services` is null when the project's service list could not be read; that is
 * a different statement from "this project has no container".
 */
export function deriveZeropsCandidates(
  project: ZeropsProject,
  services: ReadonlyArray<ZeropsService> | null,
  connectedOrigins: ReadonlyMap<string, EnvironmentId>,
): ReadonlyArray<ZeropsCandidate> {
  if (project.status !== "ACTIVE") {
    if (PROJECT_PROVISIONING_STATUSES.has(project.status)) {
      return [provisioningProject(project, "project is being created")];
    }
    return [unavailable(project, `project is ${project.status}`)];
  }
  if (services === null) {
    return [unavailable(project, "this project's services could not be read")];
  }

  const containers = services.filter(isZcpService);
  if (containers.length === 0) {
    return [unavailable(project, "no Zerops Code container in this project")];
  }

  return containers.map((service) => {
    const key = `${project.id}:${service.id}`;
    const candidateService: ZeropsCandidateService = {
      id: service.id,
      name: service.name,
      status: service.status,
    };
    if (service.status !== "ACTIVE") {
      if (SERVICE_PROVISIONING_STATUSES.has(service.status)) {
        return {
          key,
          project,
          group: "provisioning",
          reason: `container is starting (${service.status})`,
          service: candidateService,
        };
      }
      return {
        key,
        project,
        group: "unavailable",
        reason: `container is ${service.status}`,
        service: candidateService,
      };
    }

    const origin = containerOrigin(project, service);
    if (!origin.ok) {
      return {
        key,
        project,
        group: "unavailable",
        reason: origin.reason,
        service: candidateService,
      };
    }

    const environmentId = connectedOrigins.get(normalizeOrigin(origin.origin) ?? origin.origin);
    return environmentId
      ? {
          key,
          project,
          group: "connected",
          service: candidateService,
          containerOrigin: origin.origin,
          environmentId,
        }
      : {
          key,
          project,
          group: "ready",
          service: candidateService,
          containerOrigin: origin.origin,
        };
  });
}

/** Buckets already-derived candidates by group, preserving order inside each. */
export function groupZeropsCandidates(candidates: ReadonlyArray<ZeropsCandidate>): {
  readonly connected: ReadonlyArray<ZeropsCandidate>;
  readonly ready: ReadonlyArray<ZeropsCandidate>;
  readonly provisioning: ReadonlyArray<ZeropsCandidate>;
  readonly unavailable: ReadonlyArray<ZeropsCandidate>;
} {
  const connected: ZeropsCandidate[] = [];
  const ready: ZeropsCandidate[] = [];
  const provisioning: ZeropsCandidate[] = [];
  const unavailable: ZeropsCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.group === "connected") connected.push(candidate);
    else if (candidate.group === "ready") ready.push(candidate);
    else if (candidate.group === "provisioning") provisioning.push(candidate);
    else unavailable.push(candidate);
  }
  return { connected, ready, provisioning, unavailable };
}
