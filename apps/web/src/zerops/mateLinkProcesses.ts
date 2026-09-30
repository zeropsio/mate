/**
 * What a Mate's slow first connect lists under its line (`mateVoice`'s `processes`): the Mate's
 * own container first while the platform works on it — a restart, an update — then each of the
 * project's own services as the platform has it — its runtimes and its data, never the platform's
 * build containers, its core or another tool's container — one name and one dot each, as the
 * arrival draws them (`ArrivalServices`). Pure.
 */
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import type { ZeropsService } from "@t3tools/client-runtime/zerops";
import { isManagedDataService, isRuntimeService } from "@t3tools/client-runtime/zerops/topology";

import type { ArrivalService } from "./mateArrival";

const LIVE_PROCESS: ReadonlySet<string> = new Set([
  "PENDING",
  "RUNNING",
  "ROLLBACKING",
  "CANCELING",
]);

/** A service's own status, where no process is working on it. */
function serviceState(status: string): ArrivalService["state"] {
  if (status === "ACTIVE") return "ok";
  if (status === "READY_TO_DEPLOY" || status === "NEW" || status === "CREATING") return "waiting";
  if (status.includes("FAIL")) return "failed";
  if (status === "STOPPED" || status === "DISABLED") return "empty";
  return "busy";
}

export function mateLinkProcesses(input: {
  readonly services: ReadonlyArray<ZeropsService> | undefined;
  /** Its project's processes; undefined while not read, when no service reads as busy for one. */
  readonly processes: ReadonlyArray<ActivityProcess> | undefined;
  /** The Mate's own container (its `zcp` service). */
  readonly mateServiceId: string | undefined;
}): ReadonlyArray<ArrivalService> {
  const services = input.services ?? [];
  const working = new Set(
    (input.processes ?? [])
      .filter((process) => LIVE_PROCESS.has(process.status))
      .flatMap((process) => process.serviceStackIds),
  );
  const mate = services.find((service) => service.id === input.mateServiceId);
  const lead: ReadonlyArray<ArrivalService> =
    mate !== undefined && working.has(mate.id) ? [{ name: mate.name, state: "busy" }] : [];
  return [
    ...lead,
    ...services
      .filter(
        (service) =>
          service.id !== input.mateServiceId &&
          (isRuntimeService(service) || isManagedDataService(service)),
      )
      .map((service) => ({
        name: service.name,
        state: working.has(service.id) ? "busy" : serviceState(service.status),
      })),
  ];
}
