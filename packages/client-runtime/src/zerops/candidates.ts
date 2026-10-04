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

export { isZcpService } from "./containerAddress.ts";
import type { ZeropsProject, ZeropsService } from "./api.ts";
import {
  buildZeropsContainerUrl,
  isZcpService,
  zeropsRegionFromPublicZone,
} from "./containerAddress.ts";
import { projectCreationOutcome, type ZeropsProjectCreation } from "./projectCreation.ts";
import type { EnvironmentId } from "@t3tools/contracts";
import { normalizeBasePath } from "@t3tools/shared/basePath";

export type ZeropsCandidateGroup = "connected" | "ready" | "provisioning" | "unavailable";

/**
 * Whether a candidate's container runs, as a face wears it: connected, or ready — ACTIVE with its
 * address — while this browser's socket to it is not open yet. That wait is the browser's, not the
 * Mate's sleep, so a reload never shows every face asleep before it wakes them.
 */
export function candidateContainerRuns(candidate: Pick<ZeropsCandidate, "group">): boolean {
  return candidate.group === "connected" || candidate.group === "ready";
}

export interface ZeropsCandidateService {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  /** When the platform made it: a young one may still be in its press's hands. */
  readonly created?: string;
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
  /**
   * A container ACTIVE before its address landed, while the platform turns its address on
   * (`subdomainEnableOf`): on its way to it, for as long as that process says so — no clock ends it.
   */
  readonly addressAwaited?: true;
  /**
   * A young container whose reader watched it come up, and saw its address land: its Mate on its
   * way to answering, from then until {@link ARRIVAL_MS} on, wall ms. A face's pose: whether it
   * answers is its link's to say. Its reader derives it again at its end.
   */
  readonly arriving?: { readonly since: number; readonly until: number };
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
  // A Mate's container is never deployed by hand: one ready to deploy waits for the first build
  // its import started.
  "READY_TO_DEPLOY",
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
 * How long a Mate's container may wait for its first build (`READY_TO_DEPLOY`) before it is
 * taking longer than usual: the build takes about a minute (measured 2026-10-02).
 */
export const FIRST_BUILD_GRACE_MS = 300_000;

/**
 * A container waiting for its first build past its grace: still on its way — a slow or queued
 * build looks the same from its status as one that failed, so only its build's own process says
 * which (`firstBuildState`) — and taking longer than usual. A creation time not known, or one
 * ahead of this browser's clock, is not overdue.
 */
export function firstBuildOverdue(
  candidate: Pick<ZeropsCandidate, "service">,
  nowMs: number,
): boolean {
  if (candidate.service?.status !== "READY_TO_DEPLOY") return false;
  const created = Date.parse(candidate.service.created ?? "");
  return !Number.isNaN(created) && nowMs - created >= FIRST_BUILD_GRACE_MS;
}

/**
 * A container waiting for its first build, read against its build's own process where the caller
 * read one: failed or cancelled, it never comes — unavailable, in the platform's words, so its row
 * offers what removes it. Queued, running, or not known, it stays on its way: a clock never says a
 * build that still runs has failed.
 */
export function applyFirstBuildVerdict<Candidate extends ZeropsCandidate>(
  candidate: Candidate,
  build:
    | { readonly kind: "running" }
    | { readonly kind: "failed"; readonly why: string }
    | undefined,
): Candidate {
  if (candidate.group !== "provisioning" || candidate.service?.status !== "READY_TO_DEPLOY") {
    return candidate;
  }
  if (build?.kind !== "failed") return candidate;
  return { ...candidate, group: "unavailable", reason: build.why };
}

/** Where the platform stands on turning a container's address on (`subdomainEnableOf`). */
export type SubdomainEnable = "on" | "off";

const SUBDOMAIN_ACTIONS: ReadonlySet<string> = new Set([
  "stack.enableSubdomainAccess",
  "stack.disableSubdomainAccess",
]);
const ENABLE_HOLDS: ReadonlySet<string> = new Set(["PENDING", "RUNNING", "FINISHED"]);

/**
 * Where the platform stands on turning a container's address on, as its project's processes say
 * it: `on` while its newest `stack.enableSubdomainAccess` is queued or running, or finished with no
 * `stack.disableSubdomainAccess` after it — the service's record follows the process seconds later
 * (measured 2026-10-02: 5.6 s from ACTIVE to the address in the tab, under 20 s in the REST
 * record) — and `off` where it failed, a disable is newer, or none is held. `undefined` while the
 * processes are not read: running ones and the newest history both.
 */
export function subdomainEnableOf(
  processes:
    | ReadonlyArray<{
        readonly actionName: string;
        readonly serviceStackIds: ReadonlyArray<string>;
        readonly status: string;
        readonly created: string;
      }>
    | undefined,
  serviceId: string,
): SubdomainEnable | undefined {
  if (processes === undefined) return undefined;
  const newest = processes
    .filter(
      (process) =>
        SUBDOMAIN_ACTIONS.has(process.actionName) && process.serviceStackIds.includes(serviceId),
    )
    .sort((left, right) => Date.parse(right.created) - Date.parse(left.created))[0];
  return newest?.actionName === "stack.enableSubdomainAccess" && ENABLE_HOLDS.has(newest.status)
    ? "on"
    : "off";
}

/**
 * How long a young container's arrival is shown once its address landed where its reader watched
 * it come up: its server answers seconds after (measured 2026-10-02: ACTIVE at +265 s, the Mate
 * answering at about +280 s), so two minutes are ample. A pose, never a verdict: past it a Mate
 * that does not answer reads as any other.
 */
export const ARRIVAL_MS = 120_000;

/**
 * What a reader holds of a container's address: that it saw the container with one — and, where
 * it watched it come up, when the address landed — or that it watched it come up — in its first
 * build, or ACTIVE while its address was turned on — before the address landed. Kept for as long
 * as the reader lives (`addressSeenAfter`).
 */
export type AddressSeen =
  | { readonly addressed: true; readonly since?: number }
  | { readonly addressed: false; readonly building: true };

/**
 * A container's first build, as its statuses say it: made, or waiting for the build its import
 * started. A start or a restart is a container already made, never its arrival.
 */
const FIRST_BUILD_STATUSES: ReadonlySet<string> = new Set(["NEW", "CREATING", "READY_TO_DEPLOY"]);

/** What a reader judges a container's address by, beside what the listing reads. */
export interface AddressFacts {
  readonly nowMs: number;
  /** What this reader holds of the container's address, by service id; none: first seen now. */
  readonly addressSeen?: (serviceId: string) => AddressSeen | undefined;
  /** Where the platform stands on turning its address on (`subdomainEnableOf`), by service. */
  readonly subdomainEnable?: (projectId: string, serviceId: string) => SubdomainEnable | undefined;
}

/**
 * What a reader keeps of a candidate's address once it derived it, from what it held. A container
 * seen with its address is seen with it for good: one whose access is switched off later has no
 * public address, never a wait. Its address landing, where its reader watched it come up, keeps
 * that moment — the clock its arrival pose runs by (`ZeropsCandidate.arriving`). A container seen
 * in its first build, or while its address was turned on, is kept so until its address lands. A
 * container never seen with its address and never seen coming up leaves nothing to keep.
 */
export function addressSeenAfter(
  candidate: Pick<
    ZeropsCandidate,
    "containerOrigin" | "addressAwaited" | "arriving" | "group" | "service"
  >,
  held: AddressSeen | undefined,
): AddressSeen | undefined {
  if (held?.addressed === true) return held;
  if (candidate.containerOrigin !== undefined) {
    const since = candidate.arriving?.since;
    return since === undefined ? { addressed: true } : { addressed: true, since };
  }
  if (held !== undefined) return held;
  return candidate.addressAwaited === true ||
    (candidate.group === "provisioning" &&
      FIRST_BUILD_STATUSES.has(candidate.service?.status ?? ""))
    ? { addressed: false, building: true }
    : undefined;
}

/**
 * A young container's arrival, where its reader watched it come up — in its first build, or while
 * its address was turned on — and saw its address land: its Mate on its way to answering for
 * {@link ARRIVAL_MS} from then. A reader that first sees it with its address — a reload — did not
 * see it come and never says it is coming: a reload paints nothing it takes back.
 */
function arrivingOf(
  service: Pick<ZeropsService, "id">,
  facts: AddressFacts | undefined,
): { readonly since: number; readonly until: number } | undefined {
  if (facts === undefined) return undefined;
  const seen = facts.addressSeen?.(service.id);
  // Watched coming up, and its address here now for the first time: its arrival starts now.
  const since = seen === undefined ? undefined : seen.addressed ? seen.since : facts.nowMs;
  if (since === undefined) return undefined;
  const until = since + ARRIVAL_MS;
  return facts.nowMs < until ? { since, until } : undefined;
}

/**
 * Every candidate one project contributes — one per zcp container, so a project
 * holding two of them offers both rather than collapsing into "ambiguous".
 * `services` is null when the project's service list could not be read; that is
 * a different statement from "this project has no container".
 * `creation` is the platform's verdict on the project's creation when the
 * caller has read one (`applyProjectCreationVerdict`); `facts`, what the caller's reader knows of
 * its containers' addresses (`AddressFacts`).
 */
export function deriveZeropsCandidates(
  project: ZeropsProject,
  services: ReadonlyArray<ZeropsService> | null,
  connectedOrigins: ReadonlyMap<string, EnvironmentId>,
  creation?: ZeropsProjectCreation | undefined,
  facts?: AddressFacts | undefined,
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
      ...(service.created === undefined ? {} : { created: service.created }),
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
      // A container whose access the platform is turning on is on its way to its address, for as
      // long as that process says so — or, its processes not read yet, where its reader watched it
      // come up. One its reader saw with its address has its access off.
      const seen = facts?.addressSeen?.(service.id);
      const enable = facts?.subdomainEnable?.(project.id, service.id);
      if (
        seen?.addressed !== true &&
        (enable === "on" || (enable === undefined && seen?.addressed === false))
      ) {
        return {
          key,
          project,
          group: "provisioning",
          reason: "its address is on its way",
          service: candidateService,
          addressAwaited: true,
        };
      }
      return {
        key,
        project,
        group: "unavailable",
        reason: origin.reason,
        service: candidateService,
      };
    }

    const environmentId = connectedOrigins.get(normalizeOrigin(origin.origin) ?? origin.origin);
    if (environmentId) {
      return {
        key,
        project,
        group: "connected",
        service: candidateService,
        containerOrigin: origin.origin,
        environmentId,
      };
    }
    const arriving = arrivingOf(service, facts);
    return {
      key,
      project,
      group: "ready",
      service: candidateService,
      containerOrigin: origin.origin,
      ...(arriving === undefined ? {} : { arriving }),
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
