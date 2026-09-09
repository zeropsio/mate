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

import { useEffect, useMemo, useState } from "react";

import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { probeZeropsContainerHealth } from "@t3tools/client-runtime/zerops/containerHealth";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { onAccountLifetimeClose } from "./accountLifetime";

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

export function useZeropsCandidateHealth(
  candidates: ReadonlyArray<ZeropsCandidate>,
  options: { readonly isProcessRunning?: (candidateKey: string) => boolean } = {},
): {
  readonly health: ReadonlyMap<string, ZeropsContainerHealth>;
  readonly serverVersions: ReadonlyMap<string, string>;
  readonly updates: ReadonlyMap<string, ExecutionEnvironmentUpdate>;
} {
  const refreshVersion = useZeropsCandidatesVersion();
  const [snapshot, setSnapshot] = useState<{
    health: ReadonlyMap<string, ZeropsContainerHealth>;
    serverVersions: ReadonlyMap<string, string>;
    updates: ReadonlyMap<string, ExecutionEnvironmentUpdate>;
  }>({ health: new Map(), serverVersions: new Map(), updates: new Map() });

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

  useEffect(() => {
    setSnapshot({ health: new Map(), serverVersions: new Map(), updates: new Map() });
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
