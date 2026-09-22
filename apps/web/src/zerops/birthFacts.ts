/**
 * Pure adapter from what the projects page already holds about a birth — a
 * `ZeropsCandidate`, its project's activity, its health probe, its
 * provisioning wait and the page's own connection judgement — into
 * `BirthFacts`, the shape `deriveBirthProgress`
 * (`@t3tools/client-runtime/zerops/birthProgress`) reads. No I/O, no React:
 * the birth-line hook builds these facts every render from whatever it
 * already has in hand.
 */
import type {
  ActivityAppVersion,
  ActivityProcess,
} from "@t3tools/client-runtime/zerops/activity/dto";
import type { BirthFacts, BirthProcessFact } from "@t3tools/client-runtime/zerops/birthProgress";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { KnownProcessStatus, ProcessStatus } from "@t3tools/client-runtime/zerops/data";
import type {
  ProvisioningPhase,
  ZeropsContainerHealth,
} from "@t3tools/client-runtime/zerops/provisioning";

export interface BirthFactsInput {
  readonly candidate: ZeropsCandidate;
  /** Every process this client has seen for the candidate's project — filtered here to just this project's own. */
  readonly processes: ReadonlyArray<ActivityProcess> | undefined;
  readonly health: ZeropsContainerHealth | undefined;
  readonly provisioningPhase: ProvisioningPhase | null;
  readonly hardenError?: string | undefined;
  /** The page's own connection judgement — "connecting" while the identity exchange is in flight. */
  readonly connecting?: boolean | undefined;
  /** A connect verdict the page reached, distinct from "not yet connected". */
  readonly connectionFailed?: boolean | undefined;
  readonly requestedAt?: string | undefined;
}

/**
 * `ActivityProcess.status` (`activity/dto.ts`) is read off the wire as a
 * plain string; `BirthProcessFact.status` is the client-runtime data layer's
 * typed `ProcessStatus` (`zerops/data/types.ts`). This is the one place that
 * bridges them, mirroring the same seven literals `ActivityProcess`'s own
 * doc comment names.
 */
const KNOWN_PROCESS_STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "RUNNING",
  "ROLLBACKING",
  "CANCELING",
  "FINISHED",
  "FAILED",
  "CANCELED",
]);

function toProcessStatus(status: string): ProcessStatus {
  return KNOWN_PROCESS_STATUSES.has(status)
    ? (status as KnownProcessStatus)
    : { kind: "unknown", raw: status };
}

function toBirthProcessFact(process: ActivityProcess): BirthProcessFact {
  const appVersion: ActivityAppVersion | undefined = process.appVersion;
  return {
    actionName: process.actionName,
    status: toProcessStatus(process.status),
    createdAt: process.created,
    startedAt: process.started ?? null,
    finishedAt: process.finished ?? null,
    serviceIds: process.serviceStackIds,
    appVersion,
    // The platform's process read carries no failure-reason field
    // (`activity/dto.ts`'s `ActivityProcess` has none) — `birthProgress.ts`'s
    // own fallback text ("Could not be created.") stands in its place.
    failReason: undefined,
  };
}

function toCreationFailed(
  creationFailed: NonNullable<ZeropsCandidate["creationFailed"]>,
): NonNullable<BirthFacts["creationFailed"]> {
  return creationFailed.message === undefined ? {} : { message: creationFailed.message };
}

function deriveConnection(input: BirthFactsInput): BirthFacts["connection"] {
  if (input.candidate.group === "connected") return "connected";
  if (input.connectionFailed === true) return "failed";
  if (input.connecting === true) return "connecting";
  return "none";
}

export function deriveBirthFacts(input: BirthFactsInput): BirthFacts {
  const { candidate } = input;
  const project = candidate.project;
  const service = candidate.service;

  return {
    project: {
      status: project.status,
      ...(project.created === undefined ? {} : { createdAt: project.created }),
    },
    ...(candidate.creationFailed === undefined
      ? {}
      : { creationFailed: toCreationFailed(candidate.creationFailed) }),
    container:
      service === undefined
        ? undefined
        : {
            serviceId: service.id,
            status: service.status,
            hasOrigin: candidate.containerOrigin !== undefined,
          },
    processes: (input.processes ?? [])
      .filter((process) => process.projectId === project.id)
      .map(toBirthProcessFact),
    health: input.health,
    provisioningPhase: input.provisioningPhase,
    ...(input.hardenError === undefined ? {} : { hardenError: input.hardenError }),
    connection: deriveConnection(input),
    ...(input.requestedAt === undefined ? {} : { requestedAt: input.requestedAt }),
  };
}
