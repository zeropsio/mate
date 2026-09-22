/**
 * Drives the provisioning state machine: polls at a fixed cadence while it is
 * waiting on something, and stops the moment it settles.
 *
 * Every decision lives in `provisioning.ts`; this is only the clock and the
 * I/O around it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ZeropsApiError } from "@t3tools/client-runtime/zerops";
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

/**
 * A command refused because the account is mid-verification — not because it
 * may not run.
 *
 * The platform never sees such a command: the runtime holds it back while a
 * verification round is in flight, and a round is started by anything that
 * asks for the account to be read again. The reason is a "not yet", and a
 * caller that treats it as an answer gives up on a write it was allowed to
 * make (`commands.ts`).
 */
export function isAccessNotYetVerified(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "ZeropsCommandAdmissionError" &&
    "reason" in cause &&
    cause.reason === "access-unverified"
  );
}

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
  // `awaiting-settled` reads the same feed: it is what tells the wait the
  // container's own boot process has finished, which is what lets it move
  // on to hardening at all (R1).
  const projectRef =
    (phase === "awaiting-health" || phase === "awaiting-settled") && state?.projectId
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
    if ((phase !== "awaiting-health" && phase !== "awaiting-settled") || !activity) return;
    const running = activity.running.value.some((entry) => {
      if (entry.knowledge !== "observed") return false;
      const identity = entry.record.identity;
      if (identity.knowledge !== "observed") return false;
      return (
        containerServiceId === null ||
        (identity.fields.serviceIds ?? []).includes(ZeropsServiceId.make(containerServiceId))
      );
    });
    // The activity feed answered, so this reading is backed by it — never a
    // guess from its mere absence, which `awaiting-settled` must not accept
    // as proof the boot is over.
    dispatch({ kind: "process", running, observed: true });
  }, [phase, activity, containerServiceId, dispatch]);

  // Runs the birth's one restart (`projectIsolation.ts`, spec-mate §3
  // B-1/B-2/B-3): guarded by a ref so an overlapping poll tick never starts a
  // second attempt, and left to retry on the next tick — never dispatching
  // anything — for the two refusals that mean "not yet" rather than "no":
  // the project's own variables not having caught up yet
  // (`ZeropsApiError` kind `uncertain`) and the account being mid a
  // verification round (`isAccessNotYetVerified`).
  const hardenBusyRef = useRef(false);
  const runHarden = useCallback(async (): Promise<void> => {
    const live = stateRef.current;
    if (!live || live.phase !== "hardening" || hardenBusyRef.current) return;
    const project =
      live.projectId === null
        ? null
        : findInventoryProjectRef(inventoryRef.current, live.projectId, clientId ?? undefined);
    if (project === null) return;
    hardenBusyRef.current = true;
    try {
      const result = await runZeropsCommand(runtime.commands.isolateProjectEnv(project));
      dispatch({ kind: "hardened", restarted: result.restarted, atMs: Date.now() });
    } catch (cause) {
      const uncertain = cause instanceof ZeropsApiError && cause.kind === "uncertain";
      if (!uncertain && !isAccessNotYetVerified(cause)) {
        dispatch({ kind: "harden-failed", message: zeropsErrorMessage(cause) });
      }
    } finally {
      hardenBusyRef.current = false;
    }
  }, [clientId, dispatch, runtime.commands]);

  useEffect(() => {
    const current = stateRef.current;
    if (!current || !clientId || !isProvisioningWaiting(current)) return;

    let cancelled = false;
    const poll = async () => {
      const live = stateRef.current;
      if (cancelled || !live) return;
      // `hardening` reads nothing through `readProvisioning` — it acts,
      // through a command this hook runs itself, and every poll tick is
      // another chance to retry a "not yet" refusal (`runHarden`).
      if (live.phase === "hardening") {
        await runHarden();
        return;
      }
      const liveInventory = inventoryRef.current;
      const services =
        live.projectId === null ? undefined : liveInventory.services.get(live.projectId);
      try {
        let initAt: string | undefined;
        const event = await readProvisioning({
          state: live,
          projects: liveInventory.projects,
          project:
            live.projectId === null
              ? undefined
              : liveInventory.projects.find((project) => project.id === live.projectId),
          services: services?.status === "resolved" ? services.services : undefined,
          probeHealth: (origin) =>
            probeZeropsContainerHealth(origin, undefined, undefined, (value) => {
              initAt = value;
            }),
        });
        if (cancelled) return;
        dispatch(event.kind === "health" && initAt !== undefined ? { ...event, initAt } : event);
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
  }, [clientId, dispatch, phase, runHarden]);

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
