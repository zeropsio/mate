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
   * A young container ACTIVE before its address landed (`addressWaitEnds`): on its way, from when
   * its reader first saw it so until its wait ends, wall ms. Its reader derives it again then.
   */
  readonly addressAwaited?: { readonly since: number; readonly until: number };
  /**
   * A young container whose reader watched it wait for its address, and saw it land: its Mate on
   * its way to answering, on the same clock (`addressWaitEnds`) — from when its reader first saw
   * it ACTIVE until that wait ends, wall ms. Whether it answers yet is its link's to say. Its
   * reader derives it again at its end.
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
 * How long a first build nothing says is running stays on its way at all: past it, it failed or
 * is stuck for good, and reads as the platform leaves it.
 */
export const FIRST_BUILD_GIVE_UP_MS = 30 * 60_000;

/**
 * A container waiting for its first build past {@link FIRST_BUILD_GIVE_UP_MS}, where no process
 * read says its build still runs: unavailable, naming its status, so its row offers what removes
 * it — never "taking longer" for good. A creation time not known keeps it on its way.
 */
export function applyFirstBuildGiveUp<Candidate extends ZeropsCandidate>(
  candidate: Candidate,
  nowMs: number,
): Candidate {
  if (candidate.group !== "provisioning" || candidate.service?.status !== "READY_TO_DEPLOY") {
    return candidate;
  }
  const created = Date.parse(candidate.service.created ?? "");
  if (Number.isNaN(created) || nowMs - created < FIRST_BUILD_GIVE_UP_MS) return candidate;
  return { ...candidate, group: "unavailable", reason: "container is READY_TO_DEPLOY" };
}

/**
 * How long a container ACTIVE without its address stays on its way to it, from when its reader
 * first saw it so. The platform enables a new Mate's address a second or two after its first build
 * makes it ACTIVE, and the push of that lands seconds later (measured 2026-10-02: 5.6 s from
 * ACTIVE to the address in the tab, under 20 s in the REST record; 2026-09-22: 3 s): two minutes
 * is ample for both, and short enough that an address that will not come says so soon.
 */
export const ADDRESS_GRACE_MS = 120_000;

/**
 * When a container's wait for its address ends, wall ms, given when its reader first saw it ACTIVE
 * without one; null when it is not waiting. Only a young container waits: a Mate turns ACTIVE at
 * the end of its first build, which is given up {@link FIRST_BUILD_GIVE_UP_MS} after its creation,
 * so one ACTIVE without an address past that and the grace is not being born — its access is off,
 * and a reload never paints it "coming up". A creation time not known says nothing young.
 */
export function addressWaitEnds(
  service: Pick<ZeropsService, "status" | "created">,
  sinceMs: number,
): number | null {
  if (service.status !== "ACTIVE") return null;
  const created = Date.parse(service.created ?? "");
  if (Number.isNaN(created)) return null;
  return Math.min(sinceMs, created + FIRST_BUILD_GIVE_UP_MS) + ADDRESS_GRACE_MS;
}

/**
 * What a reader holds of a container's address: that it saw the container with one — and, where
 * it watched it come up, when it first saw it ACTIVE — when it first saw it ACTIVE without one, or
 * that it saw it in its first build, before it was ACTIVE at all. Kept for as long as the reader
 * lives (`addressSeenAfter`).
 */
export type AddressSeen =
  | { readonly addressed: true; readonly since?: number }
  | { readonly addressed: false; readonly since: number }
  | { readonly addressed: false; readonly since?: undefined; readonly building: true };

/**
 * A container's first build, as its statuses say it: made, or waiting for the build its import
 * started. A start or a restart is a container already made, never its arrival.
 */
const FIRST_BUILD_STATUSES: ReadonlySet<string> = new Set(["NEW", "CREATING", "READY_TO_DEPLOY"]);

/** The clock a reader judges an address wait by (`addressWaitEnds`). */
export interface AddressClock {
  readonly nowMs: number;
  /** What this reader holds of the container's address, by service id; none: first seen now. */
  readonly addressSeen?: (serviceId: string) => AddressSeen | undefined;
}

/**
 * What a reader keeps of a candidate's address once it derived it, from what it held. A container
 * seen with its address is seen with it for good: one whose access is switched off later has no
 * public address, never a wait. Its address landing keeps the moment it was first seen ACTIVE, the
 * clock its arrival is judged by (`ZeropsCandidate.arriving`) — the moment its wait began, or, seen
 * in its first build and next with its address at once, that moment. A wait keeps its first
 * moment, past its end too, so a wait that ended never begins again. A container seen in its first
 * build is kept so until it is ACTIVE. A container never seen with its address, never waiting for
 * it and never seen building — old, or its creation not known — leaves nothing to keep.
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
    const since = held?.since ?? candidate.arriving?.since;
    return since === undefined ? { addressed: true } : { addressed: true, since };
  }
  if (candidate.addressAwaited !== undefined && held?.since === undefined) {
    return { addressed: false, since: candidate.addressAwaited.since };
  }
  if (held !== undefined) return held;
  return candidate.group === "provisioning" &&
    FIRST_BUILD_STATUSES.has(candidate.service?.status ?? "")
    ? { addressed: false, building: true }
    : undefined;
}

/**
 * A young container's arrival, where its reader watched it come up — in its first build, or
 * waiting for its address: its Mate on its way to answering until the end of the wait for its
 * address, from when its reader first saw it ACTIVE (`addressWaitEnds`). The platform enables a new Mate's
 * address seconds after its first build makes it ACTIVE, and its server answers seconds after
 * that (measured 2026-10-02: ACTIVE at +265 s, the Mate answering at about +280 s), so the same
 * two minutes from first seen ACTIVE are ample for both; past them a Mate that does not answer
 * reads as any other, so a broken one is never on its way for good. A reader that first sees it
 * with its address — a reload — did not see it come and never says it is coming: a reload paints
 * nothing it takes back.
 */
function arrivingOf(
  service: Pick<ZeropsService, "id" | "status" | "created">,
  clock: AddressClock | undefined,
): { readonly since: number; readonly until: number } | undefined {
  if (clock === undefined) return undefined;
  const seen = clock.addressSeen?.(service.id);
  // Seen building and ACTIVE now for the first time: its arrival's clock starts here.
  const since = seen?.since ?? (seen !== undefined && "building" in seen ? clock.nowMs : undefined);
  if (since === undefined) return undefined;
  const until = addressWaitEnds(service, since);
  return until !== null && clock.nowMs < until ? { since, until } : undefined;
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
  clock?: AddressClock | undefined,
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
      // A young container ACTIVE before its address landed is on its way to it, never without one
      // — unless its reader saw it with its address: its access is off.
      const seen = clock?.addressSeen?.(service.id);
      if (clock !== undefined && seen?.addressed !== true) {
        const since = seen?.since ?? clock.nowMs;
        const until = addressWaitEnds(service, since);
        if (until !== null && clock.nowMs < until) {
          return {
            key,
            project,
            group: "provisioning",
            reason: "its address is on its way",
            service: candidateService,
            addressAwaited: { since, until },
          };
        }
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
    const arriving = arrivingOf(service, clock);
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
