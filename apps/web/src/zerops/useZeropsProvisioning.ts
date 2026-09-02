/**
 * Drives the provisioning state machine: polls at a fixed cadence while it is
 * waiting on something, and stops the moment it settles.
 *
 * Every decision lives in `provisioning.ts`; this is only the clock and the
 * I/O around it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { probeZeropsContainerHealth } from "@t3tools/client-runtime/zerops/containerHealth";
import {
  advanceProvisioning,
  isProvisioningWaiting,
  readProvisioning,
  startProvisioning,
  startProvisioningForContainer,
  type ProvisioningEvent,
  type ProvisioningState,
} from "@t3tools/client-runtime/zerops/provisioning";
import { useZeropsSession, zeropsErrorMessage } from "./ZeropsSessionProvider";

const POLL_INTERVAL_MS = 2000;

export function useZeropsProvisioning(clientId: string | null): {
  readonly state: ProvisioningState | null;
  readonly error: string | null;
  readonly busy: boolean;
  readonly start: (input: { readonly zcpClaimed?: boolean }) => void;
  readonly startForContainer: (input: {
    readonly projectId: string;
    readonly serviceId: string | null;
    readonly containerOrigin: string;
  }) => void;
  readonly cancel: () => void;
  readonly retry: () => void;
  readonly enable: () => void;
} {
  const { client } = useZeropsSession();
  const [state, setState] = useState<ProvisioningState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The poll reads the live state without making the effect depend on every
  // field it touches, which would restart the interval on each tick.
  const stateRef = useRef<ProvisioningState | null>(null);
  stateRef.current = state;

  const dispatch = useCallback((event: ProvisioningEvent) => {
    setState((current) => (current ? advanceProvisioning(current, event, Date.now()) : current));
  }, []);

  const phase = state?.phase ?? null;

  useEffect(() => {
    const current = stateRef.current;
    if (!current || !clientId || !isProvisioningWaiting(current)) return;

    let cancelled = false;
    const poll = async () => {
      const live = stateRef.current;
      if (cancelled || !live) return;
      try {
        const event = await readProvisioning({
          client,
          clientId,
          state: live,
          probeHealth: (origin) => probeZeropsContainerHealth(origin),
        });
        if (cancelled) return;
        dispatch(event);
      } catch (cause) {
        if (cancelled) return;
        // A read that fails is not a verdict: the tick still runs the cap, so
        // the wait ends in its retryable timeout rather than an error.
        setError(zeropsErrorMessage(cause));
      }
      if (!cancelled) dispatch({ kind: "tick" });
    };

    void poll();
    const timer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, clientId, dispatch, phase]);

  return {
    state,
    error,
    busy,
    start: (input) => {
      setError(null);
      setState(startProvisioning({ ...input, nowMs: Date.now() }));
    },
    startForContainer: (input) => {
      setError(null);
      setState(startProvisioningForContainer({ ...input, nowMs: Date.now() }));
    },
    cancel: () => {
      setState(null);
      setError(null);
    },
    retry: () => {
      setError(null);
      dispatch({ kind: "retry" });
    },
    enable: () => {
      const serviceId = stateRef.current?.containerServiceId;
      if (!serviceId) return;
      setBusy(true);
      setError(null);
      // Writes ZCP_MATE_ENABLED and then restarts. The restart alone cannot
      // turn Zerops Mate on: zcp installs nothing mate-shaped without the flag.
      void client
        .enableZeropsMate(serviceId)
        .then(() => {
          dispatch({ kind: "enable" });
        })
        .catch((cause: unknown) => {
          setError(zeropsErrorMessage(cause));
        })
        .finally(() => {
          setBusy(false);
        });
    },
  };
}
