/**
 * A stand-up call's reading (`@t3tools/client-runtime/zerops/activity/standupReading`):
 * while it runs, from the Mate's own project — its services and their
 * statuses off the topology, its builds off the platform socket
 * (`useProjectActivity`), watched for as long as the call runs and no longer
 * (the tool's own limit is the bound); once settled, from what its report
 * said of each service it built, in the environment the topology draws.
 *
 * `StandupReadings` gives a reading by operation key in place of the live one
 * — the design harness's made-up builds.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type StandupHalf,
  type StandupReading,
  type StandupService,
  type StandupServiceRow,
  readStandup,
  settleStandup,
} from "@t3tools/client-runtime/zerops/activity/standupReading";
import type { ZeropsTopologyService } from "@t3tools/client-runtime/zerops/topology";
import { standupStepRole, type ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { createContext, use, useMemo } from "react";

import { useNowMs } from "../useNowMs";
import { useZeropsTopology } from "../useZeropsFeeds";
import { useProjectActivity } from "./useProjectActivity";

export const StandupReadings = createContext<ReadonlyMap<string, StandupReading> | null>(null);

const SETTLED_STATE: Record<string, StandupServiceRow["state"]> = {
  done: "up",
  failed: "failed",
  running: "building",
};

/** The half a call stands up. */
function halfOf(operation: ZeropsOperation): StandupHalf {
  return operation.subject === "stage" ? "stage" : "development";
}

/**
 * What the report said of each service it built, once the call settled, in
 * the environment it stood up (`services`, the project's) — or alone, before
 * the project is read.
 */
export function settledStandupReading(
  operation: ZeropsOperation,
  services?: ReadonlyArray<StandupService>,
): StandupReading {
  const rows = operation.steps.flatMap((step): StandupServiceRow[] => {
    const role = standupStepRole(step);
    // A stage the call queued is the next call's.
    if (role === "next") return [];
    if (role === "held") {
      return [
        {
          hostname: step.label,
          state: "waits",
          ...(step.note === undefined ? {} : { note: step.note }),
        },
      ];
    }
    return [{ hostname: step.label, state: SETTLED_STATE[step.state] ?? "up" }];
  });
  return settleStandup({
    half: halfOf(operation),
    rows,
    ...(services === undefined ? {} : { services }),
  });
}

/** The project's services as the stand-up reads them. */
function standupServices(
  services: ReadonlyArray<ZeropsTopologyService>,
): ReadonlyArray<StandupService> {
  return services.map((service) => ({
    hostname: service.hostname,
    serviceId: service.serviceId,
    group: service.group,
    runsCode: service.deploy !== undefined,
    status: service.status,
  }));
}

/** The services a running call builds, when the report before it named them (the stages it queued). */
export function standupExpected(operation: ZeropsOperation): ReadonlyArray<string> | undefined {
  const next = operation.steps.filter((step) => standupStepRole(step) === "next");
  return next.length === 0 ? undefined : next.map((step) => step.label);
}

export function useStandupReading(
  operation: ZeropsOperation,
  environmentId: EnvironmentId | null,
): StandupReading | null {
  const fixtures = use(StandupReadings);
  const running = operation.phase === "running";
  const topology = useZeropsTopology(environmentId);
  const { processes } = useProjectActivity(running ? (topology?.project.id ?? null) : null);
  const nowMs = useNowMs();
  const live = useMemo(() => {
    const services = topology === undefined ? undefined : standupServices(topology.services);
    if (!running) return settledStandupReading(operation, services);
    // Not read yet: the bar says it is getting ready, never that nothing builds.
    if (services === undefined || processes === undefined) return null;
    const expected = standupExpected(operation);
    return readStandup({
      half: halfOf(operation),
      ...(expected === undefined ? {} : { expected }),
      services,
      processes,
      since: operation.anchorAt,
      nowMs,
    });
  }, [nowMs, operation, processes, running, topology]);
  return fixtures?.get(operation.key) ?? live;
}
