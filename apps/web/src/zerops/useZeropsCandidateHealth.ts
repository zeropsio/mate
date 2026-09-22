import { useZeropsCandidatesVersion } from "./candidatesRefresh";
/**
 * Probes each reachable candidate's container so the picker can say, per row,
 * whether Zerops Mate is actually there — rather than making the user click
 * Connect to find out.
 *
 * Capped and incremental: an account with a dozen containers gets four
 * requests in flight and rows that settle as answers arrive.
 *
 * A verdict of `initializing` (the container answers, but Mate's own
 * descriptor does not yet) is not the end of the story: this hook keeps
 * probing it every `REPROBE_INTERVAL_MS` rather than treating one read as
 * final. The wait is bounded using the runtime's own knowledge of whether a
 * process (a restart or a start) is still running against the candidate: the
 * bound's clock only starts once no such process is known to be running, and
 * a wait that outlasts `STALL_BOUND_MS` from there reports `"stalled"`
 * instead of polling forever.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { probeZeropsContainerHealth } from "@t3tools/client-runtime/zerops/containerHealth";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { ZeropsServiceId, type ProjectRef } from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { onAccountLifetimeClose } from "./accountLifetime";
import { findInventoryProjectRef, useZeropsInventory } from "./inventoryContext";
import { readZeropsResourceOnce } from "./useZeropsDeployedVersion";
import { useZeropsAtomSelections, useZeropsData } from "./zeropsDataContext";

const PROBE_CONCURRENCY = 4;
const REPROBE_INTERVAL_MS = 5_000;
const STALL_BOUND_MS = 90_000;

async function readCandidateHealth(origin: string) {
  let serverVersion: string | undefined;
  let update: ExecutionEnvironmentUpdate | undefined;
  const health = await probeZeropsContainerHealth(
    origin,
    undefined,
    (version, descriptorUpdate) => {
      serverVersion = version;
      update = descriptorUpdate;
    },
  );
  return {
    health,
    ...(serverVersion === undefined ? {} : { serverVersion }),
    ...(update === undefined ? {} : { update }),
  };
}

// The sidebar and project picker inspect the same containers. Keep both pending
// and completed probes for this account's explicit inventory refresh cycle.
const probes = new Map<string, ReturnType<typeof readCandidateHealth>>();
let probeVersion: number | undefined;
onAccountLifetimeClose(() => {
  probes.clear();
  probeVersion = undefined;
});

export function probeCandidateHealth(origin: string, refreshVersion: number, targetKey = origin) {
  if (probeVersion !== refreshVersion) {
    probes.clear();
    probeVersion = refreshVersion;
  }
  const normalizedOrigin = origin.replace(/\/+$/, "");
  const key = JSON.stringify([targetKey.replace(/\/+$/, ""), normalizedOrigin]);
  const existing = probes.get(key);
  if (existing !== undefined) return existing;
  const result = readCandidateHealth(normalizedOrigin);
  probes.set(key, result);
  return result;
}

/** A verdict this hook keeps polling rather than accepting as final. */
function isPending(health: ZeropsContainerHealth): boolean {
  return health === "initializing" || health === "unreachable";
}

/** A verdict that ends the poll for good — nothing more to learn by asking again. */
function isSettled(health: ZeropsContainerHealth): boolean {
  return health === "ready" || health === "predates-mate";
}

export interface PollTimers {
  readonly setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

const REAL_TIMERS: PollTimers = { setTimeout, clearTimeout };

function delay(
  ms: number,
  timers: PollTimers,
): { readonly promise: Promise<void>; cancel(): void } {
  let handle: ReturnType<typeof setTimeout>;
  let resolveFn: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
    handle = timers.setTimeout(resolve, ms);
  });
  return {
    promise,
    cancel() {
      timers.clearTimeout(handle);
      resolveFn();
    },
  };
}

/**
 * Drives one candidate's poll loop: an initial read, then repeated reads
 * every `REPROBE_INTERVAL_MS` for as long as the verdict stays pending,
 * bounded by `STALL_BOUND_MS` measured from the moment no process is known
 * to be running against it. Pure aside from its injected effects, so it is
 * testable against a fake clock and a fake probe.
 */
export async function pollCandidateHealth(input: {
  readonly firstProbe: () => Promise<{
    health: ZeropsContainerHealth;
    serverVersion?: string;
    update?: ExecutionEnvironmentUpdate;
  }>;
  readonly reprobe: () => Promise<{
    health: ZeropsContainerHealth;
    serverVersion?: string;
    update?: ExecutionEnvironmentUpdate;
  }>;
  readonly isProcessRunning: () => boolean;
  readonly now: () => number;
  readonly timers?: PollTimers;
  readonly isCancelled: () => boolean;
  readonly onVerdict: (
    health: ZeropsContainerHealth,
    serverVersion: string | undefined,
    update: ExecutionEnvironmentUpdate | undefined,
  ) => void;
}): Promise<void> {
  const timers = input.timers ?? REAL_TIMERS;
  let waitingSinceMs: number | null = null;
  let result = await input.firstProbe();
  for (;;) {
    if (input.isCancelled()) return;
    const raw = result.health;
    const pending = isPending(raw);
    let displayed: ZeropsContainerHealth = raw;
    if (pending) {
      if (input.isProcessRunning()) {
        waitingSinceMs = null;
      } else {
        waitingSinceMs ??= input.now();
        if (input.now() - waitingSinceMs > STALL_BOUND_MS) {
          displayed = "stalled";
        }
      }
    }
    input.onVerdict(displayed, result.serverVersion, result.update);
    if (isSettled(raw)) return;
    if (!pending) {
      // A verdict this hook does not recognize as pending or settled (there
      // is none today) is treated like settled: nothing to keep asking.
      return;
    }
    const wait = delay(REPROBE_INTERVAL_MS, timers);
    if (input.isCancelled()) {
      wait.cancel();
      return;
    }
    await wait.promise;
    if (input.isCancelled()) return;
    result = await input.reprobe();
  }
}

export interface HealthSnapshot {
  readonly health: ReadonlyMap<string, ZeropsContainerHealth>;
  readonly serverVersions: ReadonlyMap<string, string>;
  readonly updates: ReadonlyMap<string, ExecutionEnvironmentUpdate>;
}

/**
 * Reconciles the previous verdict snapshot against the new set of probe
 * targets: a key whose target left the set is dropped, a key whose origin
 * changed is reset (it needs a fresh probe, not a stale verdict for a
 * different origin), and every other key survives untouched so a refresh
 * or an incremental target-set change does not flicker a settled row back
 * to "Checking".
 */
export function reconcileHealthSnapshot(
  previous: HealthSnapshot,
  prevOrigins: ReadonlyMap<string, string>,
  targets: ReadonlyArray<{ readonly key: string; readonly origin: string }>,
): HealthSnapshot {
  const currentKeys = new Set(targets.map((target) => target.key));
  const changedKeys = new Set(
    targets
      .filter((target) => {
        const prevOrigin = prevOrigins.get(target.key);
        return prevOrigin !== undefined && prevOrigin !== target.origin;
      })
      .map((target) => target.key),
  );
  const keep = <V>(map: ReadonlyMap<string, V>): ReadonlyMap<string, V> => {
    const next = new Map<string, V>();
    for (const [key, value] of map) {
      if (currentKeys.has(key) && !changedKeys.has(key)) next.set(key, value);
    }
    return next;
  };
  return {
    health: keep(previous.health),
    serverVersions: keep(previous.serverVersions),
    updates: keep(previous.updates),
  };
}

export function useZeropsCandidateHealth(
  candidates: ReadonlyArray<ZeropsCandidate>,
  options: { readonly isProcessRunning?: (candidateKey: string) => boolean } = {},
): HealthSnapshot {
  const refreshVersion = useZeropsCandidatesVersion();
  const [snapshot, setSnapshot] = useState<HealthSnapshot>({
    health: new Map(),
    serverVersions: new Map(),
    updates: new Map(),
  });

  // Only the rows that have an origin to probe, keyed so the effect re-runs
  // when the set changes rather than on every re-render.
  const targets = useMemo(
    () =>
      candidates
        .filter((candidate) => candidate.containerOrigin)
        .map((candidate) => ({ key: candidate.key, origin: candidate.containerOrigin ?? "" })),
    [candidates],
  );
  const targetKey = targets.map((target) => `${target.key}=${target.origin}`).join(",");
  const isProcessRunning = options.isProcessRunning;
  const prevOriginsRef = useRef<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    setSnapshot((current) => reconcileHealthSnapshot(current, prevOriginsRef.current, targets));
    prevOriginsRef.current = new Map(targets.map((target) => [target.key, target.origin]));
    if (targets.length === 0) return;
    let cancelled = false;
    let cursor = 0;

    const setVerdict = (
      key: string,
      health: ZeropsContainerHealth,
      serverVersion?: string,
      update?: ExecutionEnvironmentUpdate,
    ) => {
      setSnapshot((current) => ({
        health: new Map(current.health).set(key, health),
        serverVersions:
          serverVersion === undefined
            ? current.serverVersions
            : new Map(current.serverVersions).set(key, serverVersion),
        updates: update === undefined ? current.updates : new Map(current.updates).set(key, update),
      }));
    };

    const worker = async (): Promise<void> => {
      for (;;) {
        if (cancelled) return;
        const target = targets[cursor];
        cursor += 1;
        if (!target) return;
        await pollCandidateHealth({
          firstProbe: () => probeCandidateHealth(target.origin, refreshVersion, target.key),
          reprobe: () => readCandidateHealth(target.origin),
          isProcessRunning: () => isProcessRunning?.(target.key) ?? false,
          now: () => Date.now(),
          isCancelled: () => cancelled,
          onVerdict: (health, serverVersion, update) => {
            setVerdict(target.key, health, serverVersion, update);
          },
        });
      }
    };

    void Promise.all(
      Array.from({ length: Math.min(PROBE_CONCURRENCY, targets.length) }, () => worker()),
    );
    const unsubscribe = onAccountLifetimeClose(() => {
      cancelled = true;
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // `targetKey` is the identity of `targets`; depending on the array itself
    // would restart every probe on each incremental render.
  }, [targetKey, refreshVersion, isProcessRunning]);

  return snapshot;
}

/**
 * The same ground truth `provisioning.ts`'s `awaiting-health` wait uses to
 * keep its own 90 s cap from elapsing mid-restart (`useZeropsProvisioning`'s
 * activity effect), given here to the projects page's row probes as well
 * (H7/R9): two callers reading one platform-process fact instead of one
 * knowing it and the other guessing from a bare clock.
 *
 * Subscribes to the account's project-activity feed for every project a
 * probeable candidate belongs to — the same set `useZeropsCandidateHealth`
 * probes — for as long as this candidate list is passed in; a caller with a
 * large picker may want to narrow that to candidates whose health is still
 * pending, at the cost of the subscription flapping as rows settle and
 * un-settle.
 */
export function useZeropsCandidateProcessRunning(
  candidates: ReadonlyArray<ZeropsCandidate>,
  clientId: string | undefined,
): (candidateKey: string) => boolean {
  const { runtime } = useZeropsData();
  const inventory = useZeropsInventory();

  const projectRefs = useMemo(() => {
    const byProjectId = new Map<string, ProjectRef>();
    for (const candidate of candidates) {
      if (!candidate.containerOrigin || byProjectId.has(candidate.project.id)) continue;
      const ref = findInventoryProjectRef(inventory, candidate.project.id, clientId);
      if (ref) byProjectId.set(candidate.project.id, ref);
    }
    return byProjectId;
  }, [candidates, inventory, clientId]);
  const projectIdsKey = [...projectRefs.keys()].sort().join(",");

  // One subscription per distinct project, opened and closed exactly like
  // `useZeropsDataInterest` does for a single one — there is no plural form
  // of that hook to call in a loop over a list whose length changes between
  // renders.
  useEffect(() => {
    const controllers = [...projectRefs.values()].map((project) => {
      const controller = new AbortController();
      void Effect.runPromise(
        Effect.scoped(
          runtime.acquire({ kind: "project-activity", project }).pipe(Effect.andThen(Effect.never)),
        ),
        { signal: controller.signal },
      ).catch(() => undefined);
      return controller;
    });
    return () => {
      for (const controller of controllers) controller.abort();
    };
    // `projectIdsKey` is `projectRefs`'s identity; depending on the map
    // itself would tear the subscriptions down and rebuild them every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdsKey, runtime]);

  const activityEntries = useMemo(
    () =>
      [...projectRefs.entries()].map(
        ([projectId, ref]) => [projectId, runtime.reads.activity(ref)] as const,
      ),
    [projectRefs, runtime.reads],
  );
  const activitySelections = useZeropsAtomSelections(activityEntries);

  return useMemo(() => {
    const running = new Set<string>();
    for (const candidate of candidates) {
      const activity = activitySelections.get(candidate.project.id);
      if (!activity) continue;
      const isRunning = activity.running.value.some((entry) => {
        if (entry.knowledge !== "observed") return false;
        const identity = entry.record.identity;
        if (identity.knowledge !== "observed") return false;
        return (
          candidate.service === undefined ||
          (identity.fields.serviceIds ?? []).includes(ZeropsServiceId.make(candidate.service.id))
        );
      });
      if (isRunning) running.add(candidate.key);
    }
    return (candidateKey: string) => running.has(candidateKey);
  }, [candidates, activitySelections]);
}

/**
 * `ZCP_MATE_ENABLED`'s own read, for every candidate whose health has
 * answered `predates-mate` — never inferred from `health` alone, which
 * cannot tell that container apart from one merely away (spec-mate §4.5,
 * H9). Read once per candidate while it stays `predates-mate`; a candidate
 * that leaves and returns to it (a re-probe) is read again.
 */
export function useZeropsCandidateMateFlags(
  candidates: ReadonlyArray<ZeropsCandidate>,
  health: ReadonlyMap<string, ZeropsContainerHealth>,
  clientId: string | undefined,
): ReadonlyMap<string, boolean | "unknown"> {
  const { runtime } = useZeropsData();
  const inventory = useZeropsInventory();
  const [flags, setFlags] = useState<ReadonlyMap<string, boolean | "unknown">>(new Map());
  const requestedRef = useRef<Set<string>>(new Set());

  const predatesMateKey = candidates
    .filter((candidate) => health.get(candidate.key) === "predates-mate")
    .map((candidate) => candidate.key)
    .sort()
    .join(",");

  useEffect(() => {
    // A candidate that left `predates-mate` gets a fresh read if it ever
    // returns to it — its answer may no longer hold.
    for (const key of [...requestedRef.current]) {
      if (health.get(key) !== "predates-mate") requestedRef.current.delete(key);
    }
    let cancelled = false;
    for (const candidate of candidates) {
      if (health.get(candidate.key) !== "predates-mate") continue;
      if (requestedRef.current.has(candidate.key) || !candidate.service) continue;
      const project = findInventoryProjectRef(inventory, candidate.project.id, clientId);
      if (!project) continue;
      requestedRef.current.add(candidate.key);
      const candidateKey = candidate.key;
      void readZeropsResourceOnce(runtime.resources, {
        kind: "service-mate-flag",
        account: runtime.scope,
        service: {
          kind: "service",
          project,
          serviceId: ZeropsServiceId.make(candidate.service.id),
        },
      }).then((value) => {
        if (cancelled) return;
        setFlags((current) =>
          new Map(current).set(candidateKey, value === undefined ? "unknown" : value.enabled),
        );
      });
    }
    return () => {
      cancelled = true;
    };
    // `predatesMateKey` is the identity of which candidates are (still)
    // `predates-mate`; depending on `candidates`/`health` directly would
    // re-run this on every incremental render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predatesMateKey, clientId, runtime]);

  return flags;
}
