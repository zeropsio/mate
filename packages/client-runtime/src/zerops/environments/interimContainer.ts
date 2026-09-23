/**
 * The interim container region C (DESIGN §4.4, slice 0.9a): a verdict derived from what the
 * client already reads today — the candidate's platform statuses, `useZeropsCandidateHealth`'s
 * probe verdict and the Mate flag read for a `predates-mate` container. The container machine
 * with its probe store and persisted intents (3.2) replaces this module; until then it cannot
 * know our own restarts or updates, so it never says `restarting(you)`, `updating`,
 * `needs-update` or `not-yet-available`.
 */
import type { ZeropsCandidate } from "../candidates.ts";
import type { ZeropsContainerHealth } from "../provisioning.ts";
import type { ContainerVerdict } from "./environmentMachine.ts";

/** `ZCP_MATE_ENABLED` as read for a `predates-mate` container; undefined before the read. */
export type InterimMateFlag = boolean | "unknown";

const PROJECT_CREATING = new Set(["NEW", "CREATING"]);
const SERVICE_PROVISIONING = new Set(["NEW", "CREATING", "STARTING"]);
const SERVICE_RESTARTING = new Set(["RESTARTING", "UPGRADING", "RELOADING"]);

export function interimContainerVerdict(input: {
  readonly candidate: ZeropsCandidate;
  readonly health: ZeropsContainerHealth | undefined;
  readonly mateFlag: InterimMateFlag | undefined;
}): ContainerVerdict {
  const projectStatus = input.candidate.project.status;
  if (PROJECT_CREATING.has(projectStatus)) return { level: "creating", overdue: false };
  if (projectStatus === "STARTING") return { level: "provisioning", overdue: false };
  if (projectStatus !== "ACTIVE") return { level: "inactive", status: projectStatus };

  const serviceStatus = input.candidate.service?.status;
  if (serviceStatus === undefined) return { level: "unknown" };
  if (SERVICE_PROVISIONING.has(serviceStatus)) return { level: "provisioning", overdue: false };
  if (SERVICE_RESTARTING.has(serviceStatus)) {
    return { level: "restarting", by: "platform", overdue: false };
  }
  if (serviceStatus !== "ACTIVE") return { level: "inactive", status: serviceStatus };

  switch (input.health) {
    case undefined:
      return { level: "unknown" };
    case "ready":
      return { level: "ready" };
    case "initializing":
    case "unreachable":
      return { level: "booting", overdue: false };
    case "stalled":
      return { level: "booting", overdue: true };
    case "predates-mate":
      // Only the flag read as off means Enable; unread, unreadable or on is a boot still going.
      return input.mateFlag === false
        ? { level: "needs-enable" }
        : { level: "booting", overdue: false };
  }
}
