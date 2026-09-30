/**
 * A stand-up call's reading (`@t3tools/client-runtime/zerops/activity/standupReading`):
 * while it runs, from the Mate's own project — its services off the topology,
 * its builds off the platform socket (`useProjectActivity`), watched for as
 * long as the call runs and no longer (the tool's own limit is the bound);
 * once settled, from what its report said of each service.
 *
 * `StandupReadings` gives a reading by operation key in place of the live one
 * — the design harness's made-up builds.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import {
  type StandupHalf,
  type StandupReading,
  type StandupServiceRow,
  readStandup,
} from "@t3tools/client-runtime/zerops/activity/standupReading";
import { standupStepRole, type ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { createContext, use, useMemo } from "react";

import { useNowMs } from "../useNowMs";
import { useZeropsTopology } from "../useZeropsFeeds";
import { useProjectActivity } from "./useProjectActivity";

export const StandupReadings = createContext<ReadonlyMap<string, StandupReading> | null>(null);

const SETTLED_STATE: Record<string, StandupServiceRow["state"]> = {
  done: "built",
  failed: "failed",
  running: "building",
};

/** What the report said of each service, once the call settled. */
export function settledStandupReading(operation: ZeropsOperation): StandupReading {
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
    return [{ hostname: step.label, state: SETTLED_STATE[step.state] ?? "built" }];
  });
  return {
    rows,
    building: rows.filter((row) => row.state === "building").length,
    built: rows.filter((row) => row.state === "built").length,
    failed: rows.filter((row) => row.state === "failed").length,
  };
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
  const half: StandupHalf = operation.subject === "stage" ? "stage" : "development";
  const live = useMemo(() => {
    if (!running) return settledStandupReading(operation);
    // Not read yet: the bar says it is getting ready, never that nothing builds.
    if (topology === undefined || processes === undefined) return null;
    const expected = standupExpected(operation);
    return readStandup({
      half,
      ...(expected === undefined ? {} : { expected }),
      services: topology.services.map((service) => ({
        hostname: service.hostname,
        serviceId: service.serviceId,
        runtime: service.group === "runtimes",
        runsCode: service.deploy !== undefined,
      })),
      processes,
      since: operation.anchorAt,
      nowMs,
    });
  }, [half, nowMs, operation, processes, running, topology]);
  return fixtures?.get(operation.key) ?? live;
}
