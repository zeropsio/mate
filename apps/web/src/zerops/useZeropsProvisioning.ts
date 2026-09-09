/**
 * Drives the provisioning state machine: polls at a fixed cadence while it is
 * waiting on something, and stops the moment it settles.
 *
 * Every decision lives in `provisioning.ts`; this is only the clock and the
 * I/O around it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { probeZeropsContainerHealth } from "@t3tools/client-runtime/zerops/containerHealth";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { ZeropsServiceId } from "@t3tools/client-runtime/zerops/data";
import {
  advanceProvisioning,
  isProvisioningWaiting,
  readProvisioning,
  startProvisioning,
  startProvisioningForContainer,
  startProvisioningForProject,
  type ProvisioningEvent,
  type ProvisioningState,
} from "@t3tools/client-runtime/zerops/provisioning";
import { findInventoryProjectRef, useZeropsInventory } from "./inventoryContext";
import {
  runZeropsCommand,
  useZeropsAtomSelections,
  useZeropsData,
  useZeropsDataInterest,
} from "./zeropsDataContext";

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
  /** Waits on a project that exists but whose container may not yet. */
  readonly startForProject: (input: { readonly projectId: string }) => void;
  readonly cancel: () => void;
  readonly retry: () => void;
  readonly enable: () => void;
} {
  const { runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const [state, setState] = useState<ProvisioningState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The poll reads the live state without making the effect depend on every
  // field it touches, which would restart the interval on each tick.
  const stateRef = useRef<ProvisioningState | null>(null);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // Same reason: a native inventory push must not restart or re-run the poll
  // loop early. The tick reads whatever inventory is current through this ref.
  const inventoryRef = useRef(inventory);
  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  const dispatch = useCallback((event: ProvisioningEvent) => {
    setState((current) => (current ? advanceProvisioning(current, event, Date.now()) : current));
  }, []);

  const phase = state?.phase ?? null;
  const containerServiceId = state?.containerServiceId ?? null;

  // The `awaiting-health` cap must not elapse while the platform is still
  // running the restart/start that got us here — its own process knowledge
  // is the ground truth, not a fixed clock started at an arbitrary moment.
  const projectRef =
    phase === "awaiting-health" && state?.projectId
      ? findInventoryProjectRef(inventory, state.projectId, clientId ?? undefined)
      : null;
  useZeropsDataInterest(projectRef ? { kind: "project-activity", project: projectRef } : null);
  const activityEntries = useMemo(
    () =>
      projectRef ? ([["provisioning-activity", runtime.reads.activity(projectRef)]] as const) : [],
    [projectRef, runtime.reads],
  );
  const activitySelections = useZeropsAtomSelections(activityEntries);
  const activity = activitySelections.get("provisioning-activity");

  useEffect(() => {
    if (phase !== "awaiting-health" || !activity) return;
    const running = activity.running.value.some((entry) => {
      if (entry.knowledge !== "observed") return false;
      const identity = entry.record.identity;
      if (identity.knowledge !== "observed") return false;
      return (
        containerServiceId === null ||
        (identity.fields.serviceIds ?? []).includes(ZeropsServiceId.make(containerServiceId))
      );
    });
    dispatch({ kind: "process", running });
  }, [phase, activity, containerServiceId, dispatch]);

  useEffect(() => {
    const current = stateRef.current;
    if (!current || !clientId || !isProvisioningWaiting(current)) return;

    let cancelled = false;
    const poll = async () => {
      const live = stateRef.current;
      if (cancelled || !live) return;
      const liveInventory = inventoryRef.current;
      const services =
        live.projectId === null ? undefined : liveInventory.services.get(live.projectId);
      try {
        const event = await readProvisioning({
          state: live,
          projects: liveInventory.projects,
          project:
            live.projectId === null
              ? undefined
              : liveInventory.projects.find((project) => project.id === live.projectId),
          services: services?.status === "resolved" ? services.services : undefined,
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
    // Polls on `clientId`/`phase` transitions and the fixed interval only; a
    // native inventory push must not trigger an extra health probe. Latest
    // inventory is read through `inventoryRef` inside the tick.
  }, [clientId, dispatch, phase]);

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
    startForProject: (input) => {
      setError(null);
      setState(startProvisioningForProject({ ...input, nowMs: Date.now() }));
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
      const projectId = stateRef.current?.projectId;
      const project =
        projectId === null || projectId === undefined
          ? null
          : findInventoryProjectRef(inventory, projectId, clientId ?? undefined);
      if (!serviceId || project === null) return;
      setBusy(true);
      setError(null);
      // Writes ZCP_MATE_ENABLED and then restarts. The restart alone cannot
      // turn Zerops Mate on: zcp installs nothing mate-shaped without the flag.
      void runZeropsCommand(
        runtime.commands.enableZeropsMate({
          kind: "service",
          project,
          serviceId: ZeropsServiceId.make(serviceId),
        }),
      )
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
