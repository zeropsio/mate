/**
 * "Restart to install" for the server-version notice: on a Zerops
 * environment, restarts the project's `zcp` service through the platform
 * with the user's own token (`ZeropsApiClient.restartService`, the same
 * `PUT /service-stack/{id}/restart` the projects page already uses). A
 * restart re-runs `zcp init` at boot, which installs the release zcp pins
 * (spec-mate §2, MD-15).
 *
 * `available` needs both an environment that resolves to a Zerops project
 * (`environmentProjectRef`) AND a topology view naming an infrastructure
 * `zcp` service (`zcpServiceIdFor`) — either missing keeps the caller's
 * notice exactly as it renders off Zerops.
 *
 * `confirm` fires the restart and settles into `"restarting"` — no polling,
 * no probe: the connection layer's own unavailable/reconnect notice takes
 * over once the socket drops.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { lookupEnvironmentProjectRef } from "@t3tools/client-runtime/zerops/environmentProjectRef";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { zcpServiceIdFor } from "@t3tools/client-runtime/zerops/topology";
import type { EnvironmentId } from "@t3tools/contracts";

import { browserZeropsStorage } from "./storage.ts";
import { useZeropsTopology } from "./useZeropsFeeds.ts";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

export type ZcpRestartState = "idle" | "confirm" | "restarting" | "failed";

export interface ZcpRestart {
  readonly available: boolean;
  readonly state: ZcpRestartState;
  readonly error: string | undefined;
  /** idle or failed → confirm. */
  readonly request: () => void;
  /** confirm → restarting; fires the platform restart. */
  readonly confirm: () => void;
  /** confirm → idle. */
  readonly cancel: () => void;
}

export function useZcpRestart(environmentId: EnvironmentId | null): ZcpRestart {
  const session = useZeropsSessionOptional();
  const topology = useZeropsTopology(environmentId);
  const [hasProjectRef, setHasProjectRef] = useState(false);
  const [state, setState] = useState<ZcpRestartState>("idle");
  const [error, setError] = useState<string | undefined>(undefined);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setHasProjectRef(false);
    setState("idle");
    setError(undefined);
    if (environmentId === null) return;
    void lookupEnvironmentProjectRef(browserZeropsStorage, environmentId).then((ref) => {
      if (generationRef.current !== generation) return;
      setHasProjectRef(ref !== undefined);
    });
  }, [environmentId]);

  const zcpServiceId = topology === undefined ? undefined : zcpServiceIdFor(topology);
  const available = hasProjectRef && zcpServiceId !== undefined;

  const request = useCallback(() => {
    setState((current) => (current === "idle" || current === "failed" ? "confirm" : current));
  }, []);

  const cancel = useCallback(() => {
    setState((current) => (current === "confirm" ? "idle" : current));
  }, []);

  const confirm = useCallback(() => {
    if (zcpServiceId === undefined || session === null) return;
    setError(undefined);
    setState("restarting");
    void session.client.restartService(zcpServiceId).catch((cause: unknown) => {
      setState("failed");
      setError(zeropsErrorMessage(cause));
    });
  }, [session, zcpServiceId]);

  return { available, state, error, request, confirm, cancel };
}
