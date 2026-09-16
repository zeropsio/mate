/**
 * The model behind the Zerops project picker: every zcp container the signed-in
 * account can reach in the active organization, sorted into `connected` (a registered
 * environment with a live session), `ready` (reachable, one click away) and
 * `unavailable` (with a reason the user can act on).
 *
 * This file is pure — it takes already-fetched projects and services and does
 * all the branching. The fetching shell lives in `useZeropsCandidates.ts`, so
 * the decisions are testable without a network.
 */

export { isZcpService } from "./api.ts";
import {
  buildZeropsContainerUrl,
  isZcpService,
  zeropsRegionFromPublicZone,
  type ZeropsProject,
  type ZeropsService,
} from "./api.ts";
import { projectCreationOutcome, type ZeropsProjectCreation } from "./projectCreation.ts";
import type { EnvironmentId } from "@t3tools/contracts";
import { normalizeBasePath } from "@t3tools/shared/basePath";

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
  /**
   * The project is fine; it simply has no zcp container. Structural rather
   * than a reason string, because it is the one unavailable case with an
   * action — Set up Mate — and a caller must not parse prose to find it.
   */
  readonly missingContainer?: true;
  /**
   * The platform failed to make this project: its `project.create` process
   * is FAILED or CANCELED and the project sits in NEW for good
   * (`projectCreation.ts`). Structural for the same reason as
   * `missingContainer` — this is the unavailable case whose verb is Remove,
   * and whose line carries the platform's own words when it gave any.
   */
  readonly creationFailed?: { readonly message: string | undefined };
  readonly service?: ZeropsCandidateService;
  readonly containerOrigin?: string;
  readonly environmentId?: EnvironmentId;
}

/**
 * A zcp container is identified by its service *type*, never its hostname:
 * `zcp` is only the default name, and matching on it reports "no container"
 * for a project that demonstrably has one.
 */

/**
 * The container's single public port. Zerops Mate rides on it under `/mate/`,
 * beside code-server — it does not declare a port of its own.
 */
export const ZCP_HTTP_PORT = 8080;

/**
 * Zerops Mate is proxied under this prefix on the container's single port,
 * beside code-server — it does not have an origin or a port of its own.
 */
export const ZEROPS_MATE_BASE_PATH = "/mate";

/** The mate server's base URL for a container origin, prefix included. */
export function zeropsMateBaseUrl(
  containerOrigin: string,
  servedApp?: {
    readonly origin: string;
    readonly basePath: string;
  },
): string {
  const normalizedContainerOrigin = containerOrigin.replace(/\/+$/, "");
  const candidateOrigin = normalizeOrigin(normalizedContainerOrigin);
  const servedAppOrigin = servedApp === undefined ? null : normalizeOrigin(servedApp.origin);
  const basePath =
    servedApp !== undefined && candidateOrigin !== null && candidateOrigin === servedAppOrigin
      ? normalizeBasePath(servedApp.basePath)
      : ZEROPS_MATE_BASE_PATH;
  return `${normalizedContainerOrigin}${basePath}`;
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
 * A project on its way up, read against the platform's verdict on its
 * creation when the caller has one. NEW is a boot until `project.create`
 * says otherwise; once that process has FAILED or been CANCELED the project
 * will never leave NEW, and a row calling it "coming up" would say so
 * forever (measured 2026-09-16). No verdict, or one still running, changes
 * nothing.
 */
export function applyProjectCreationVerdict<Candidate extends ZeropsCandidate>(
  candidate: Candidate,
  creation: ZeropsProjectCreation | undefined,
): Candidate {
  if (candidate.group !== "provisioning") return candidate;
  if (!PROJECT_PROVISIONING_STATUSES.has(candidate.project.status)) return candidate;
  const outcome = projectCreationOutcome(creation);
  if (outcome.kind !== "failed") return candidate;
  const {
    service: _service,
    containerOrigin: _origin,
    environmentId: _environment,
    ...rest
  } = candidate;
  return {
    ...rest,
    group: "unavailable",
    reason: "creation failed",
    creationFailed: { message: outcome.message },
  } as Candidate;
}

/**
 * Every candidate one project contributes — one per zcp container, so a project
 * holding two of them offers both rather than collapsing into "ambiguous".
 * `services` is null when the project's service list could not be read; that is
 * a different statement from "this project has no container".
 * `creation` is the platform's verdict on the project's creation when the
 * caller has read one (`applyProjectCreationVerdict`).
 */
export function deriveZeropsCandidates(
  project: ZeropsProject,
  services: ReadonlyArray<ZeropsService> | null,
  connectedOrigins: ReadonlyMap<string, EnvironmentId>,
  creation?: ZeropsProjectCreation | undefined,
): ReadonlyArray<ZeropsCandidate> {
  if (project.status !== "ACTIVE") {
    if (PROJECT_PROVISIONING_STATUSES.has(project.status)) {
      return [
        applyProjectCreationVerdict(
          provisioningProject(project, "project is being created"),
          creation,
        ),
      ];
    }
    return [unavailable(project, `project is ${project.status}`)];
  }
  if (services === null) {
    return [unavailable(project, "this project's services could not be read")];
  }

  const containers = services.filter(isZcpService);
  if (containers.length === 0) {
    return [
      {
        ...unavailable(project, "no Zerops Mate container in this project"),
        missingContainer: true,
      },
    ];
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
