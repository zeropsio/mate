/**
 * A stand-up call's reading (`@t3tools/client-runtime/zerops/activity/standupReading`):
 * while it runs, from the Mate's own project — its services and their
 * statuses off the topology, its builds off the platform socket
 * (`useProjectActivity`), watched for as long as the call runs and no longer
 * (the tool's own limit is the bound); once settled, as the call left it:
 * its report's rows in the environment that was there when it ended.
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
import { standupReadingFromProgress } from "@t3tools/client-runtime/zerops/activity/standupProgress";
import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
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
 * What a settled call's report said of each service it built, as the call
 * left them — in the environment it stood up, given the project's services
 * (`services`): every one there when it ended, up where it succeeded, not
 * checked where it failed; never as the project stands today.
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
  const endedAt = operation.settledAt;
  return settleStandup({
    half: halfOf(operation),
    rows,
    succeeded: operation.phase === "done",
    ...(endedAt === undefined ? {} : { endedAt }),
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
    ...(service.createdAt === undefined ? {} : { createdAt: service.createdAt }),
  }));
}

/** The services a running call builds, when the report before it named them (the stages it queued). */
export function standupExpected(operation: ZeropsOperation): ReadonlyArray<string> | undefined {
  const next = operation.steps.filter((step) => standupStepRole(step) === "next");
  return next.length === 0 ? undefined : next.map((step) => step.label);
}

/**
 * A call's reading: a running one from the project as it stands (not read
 * yet: null — the bar says it is getting ready); a settled one as the call
 * left it (`settledStandupReading`).
 */
export function standupReadingFor(
  operation: ZeropsOperation,
  read: {
    readonly services?: ReadonlyArray<StandupService>;
    readonly processes?: ReadonlyArray<ActivityProcess>;
    readonly nowMs: number;
  },
): StandupReading | null {
  if (operation.phase !== "running") return settledStandupReading(operation, read.services);
  // zcp's own word, relayed by its Mate, before anything pieced together here.
  if (operation.standUpProgress !== undefined) {
    return standupReadingFromProgress(operation.standUpProgress, {
      ...(read.processes === undefined ? {} : { processes: read.processes }),
      nowMs: read.nowMs,
    });
  }
  if (read.services === undefined || read.processes === undefined) return null;
  const expected = standupExpected(operation);
  return readStandup({
    half: halfOf(operation),
    ...(expected === undefined ? {} : { expected }),
    services: read.services,
    processes: read.processes,
    since: operation.anchorAt,
    nowMs: read.nowMs,
  });
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
  const live = useMemo(
    () =>
      standupReadingFor(operation, {
        ...(topology === undefined ? {} : { services: standupServices(topology.services) }),
        ...(processes === undefined ? {} : { processes }),
        nowMs,
      }),
    [nowMs, operation, processes, topology],
  );
  return fixtures?.get(operation.key) ?? live;
}
