/**
 * Restarting a Mate's container, whatever state it is in. The platform refuses to restart a
 * service that has failed — `serviceStackIsFailed`, "Try to stop the stack and then start it
 * again" (measured on three Mates after a platform outage, 2026-10-01) — so a FAILED container is
 * stopped, its stop waited out, and started: the same *Restart* and *Try now* to the person.
 */
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import { ZeropsServiceId, type ServiceRef } from "@t3tools/client-runtime/zerops/data";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useCallback } from "react";

import { useZeropsCandidates } from "./useZeropsCandidates";
import { intendContainer } from "./zeropsContainers";
import { runZeropsCommand, useZeropsData, type ZeropsDataContextValue } from "./zeropsDataContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** How a container is brought back from the status the listing reads for it. */
export type RestartWay = "restart" | "stop-then-start";

const SERVICE_STATUS_PREFIX = "SERVICE_";

export function restartWay(status: string | undefined): RestartWay {
  const normalized = status?.startsWith(SERVICE_STATUS_PREFIX)
    ? status.slice(SERVICE_STATUS_PREFIX.length)
    : status;
  return normalized !== undefined && normalized.endsWith("FAILED") ? "stop-then-start" : "restart";
}

/** Between reads of the stop's process. */
export const STOP_POLL_MS = 2_000;
/** Past this the start is asked for anyway: a stop still running is the platform's to finish. */
export const STOP_WAIT_CAP_MS = 120_000;

const DONE_PROCESS_STATUSES: ReadonlySet<string> = new Set(["FINISHED", "FAILED", "CANCELED"]);

export interface MateRestartPorts {
  readonly restart: () => Promise<void>;
  readonly stop: () => Promise<{ readonly processId: string | undefined }>;
  readonly processStatus: (processId: string) => Promise<string | undefined>;
  readonly start: () => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
}

export async function restartMateContainer(
  status: string | undefined,
  ports: MateRestartPorts,
): Promise<void> {
  if (restartWay(status) === "restart") {
    await ports.restart();
    return;
  }
  const { processId } = await ports.stop();
  if (processId !== undefined) {
    for (let waited = 0; waited < STOP_WAIT_CAP_MS; waited += STOP_POLL_MS) {
      const stopped = await ports.processStatus(processId);
      if (stopped !== undefined && DONE_PROCESS_STATUSES.has(stopped)) break;
      await ports.sleep(STOP_POLL_MS);
    }
  }
  await ports.start();
}

/** The ports of a Mate's container restart, through the account's command layer. */
export function mateRestartPorts(input: {
  readonly client: Pick<ZeropsApiClient, "stopService" | "readProcessStatus">;
  readonly runtime: ZeropsDataContextValue["runtime"];
  readonly service: ServiceRef;
}): MateRestartPorts {
  const { client, runtime, service } = input;
  return {
    restart: async () => {
      await runZeropsCommand(runtime.commands.restartService(service));
    },
    stop: () => client.stopService(service.serviceId),
    processStatus: (processId) => client.readProcessStatus(processId),
    start: async () => {
      await runZeropsCommand(runtime.commands.startService(service));
    },
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}

/**
 * Brings back a Mate whose container failed, by its service: stopped and started, its container
 * then intended to come up as a restart's is (`intendContainer`). Answers false for a container
 * that has not failed — its *Try now* is the link's own retry — and for one the listing does not
 * hold.
 */
export function useReviveFailedMate(): (serviceId: string | undefined) => boolean {
  const { activeOrganization, client } = useZeropsSession();
  const { projectRef, runtime } = useZeropsData();
  const { listing } = useZeropsCandidates();
  return useCallback(
    (serviceId) => {
      if (serviceId === undefined || activeOrganization === null) return false;
      const candidate = heldCandidates(listing).rows.find((row) => row.service?.id === serviceId);
      if (candidate?.service === undefined) return false;
      if (restartWay(candidate.service.status) !== "stop-then-start") return false;
      const service: ServiceRef = {
        kind: "service",
        project: projectRef(activeOrganization.id, candidate.project.id),
        serviceId: ZeropsServiceId.make(serviceId),
      };
      intendContainer(candidate.key, { kind: "restart" });
      void restartMateContainer(
        candidate.service.status,
        mateRestartPorts({ client, runtime, service }),
      ).catch(() => {
        // Said by its row and its link once the listing reads it again.
      });
      return true;
    },
    [activeOrganization, client, listing, projectRef, runtime],
  );
}
