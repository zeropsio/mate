import type { MateHealth } from "@t3tools/contracts";
import { hqMateScope } from "../families/hqMate.ts";
import { hqMateHealthScope, mateHealthScope } from "../families/mateHealth.ts";
import { linkKeys } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import type { MateProjectKey } from "./mateAttention.ts";

export interface MateHealthRead {
  readonly health: MateHealth | null;
  readonly live: boolean;
}

/** Health uses source ordering on both its direct subscription and independent HQ relay. */
export const mateHealth: Projection<MateProjectKey, MateHealthRead> = {
  name: "mateHealth",
  keyOf: ({ orgId, projectId }) => `${orgId}/${projectId}`,
  derive: (read, { orgId, projectId }) => {
    const attention = read.fact("mateHealth", projectId);
    const relay = read.fact("hqMate", projectId);
    const health = attention.kind === "known" ? attention.value : null;
    const directLive =
      attention.kind === "known" &&
      attention.scope === mateHealthScope(projectId) &&
      read.stream(linkKeys.mateHealth(projectId)).phase === "live" &&
      read.stream(mateHealthScope(projectId)).phase === "live";
    const storedLive =
      health !== null &&
      relay.kind === "known" &&
      relay.value.healthState === "live" &&
      sameValue(relay.value.health?.source, health.source) &&
      read.stream(linkKeys.hq(orgId)).phase === "live" &&
      read.stream(hqMateScope(orgId, projectId)).phase === "live" &&
      read.stream(hqMateHealthScope(orgId, projectId)).phase === "live";
    const live = directLive || storedLive;
    return {
      health,
      live: health !== null && live,
    };
  },
  equals: sameValue,
};

const gigabytes = (bytes: number) => `${Number((bytes / 1024 ** 3).toFixed(2))} GB`;

/** Presentation names measured pressure and constraints, never an inferred allocation failure. */
export function mateHealthCopy(
  name: string,
  read: MateHealthRead,
): {
  readonly severity: "warning" | "critical";
  readonly title: string;
  readonly description: string;
} | null {
  const { health, live } = read;
  if (health === null) return null;
  const evidence = {
    ...health.evidence,
    // Older Mates inferred memory strain from usage/high and called I/O stalls disk
    // shortage. Retained reports need the same evidence rules as current reports.
    resources: health.evidence.resources.flatMap((resource) => {
      const memory = health.evidence.memory;
      if (resource === "memory")
        return memory !== null &&
          (memory.growth.high > 0 ||
            (memory.growth.max ?? 0) > 0 ||
            memory.growth.oom > 0 ||
            memory.growth.oomKill > 0 ||
            (memory.swapGrowth ?? 0) > 0 ||
            (memory.pressure?.some.avg10 ?? 0) > 0)
          ? [resource]
          : [];
      if (resource === "cpu")
        return health.evidence.cpu?.window?.saturated === true ? [resource] : [];
      if (resource === "disk" && health.evidence.disk?.free !== 0)
        return (health.evidence.io?.some.avg10 ?? 0) > 0 ? ["io" as const] : [];
      return [resource];
    }),
  };
  if (evidence.resources.length === 0) return null;
  const cap = evidence.memory?.max ?? null;
  const prefix = live ? name : `${name} · last-known health`;
  const resource = evidence.resources[0];
  const title =
    resource === "memory"
      ? `${prefix} is under memory pressure${cap !== null ? ` — the container is capped at ${gigabytes(cap)}` : ""}`
      : resource === "disk"
        ? `${prefix} has no free space on its state disk`
        : resource === "io"
          ? `${prefix} is slowed by I/O stalls`
          : `${prefix} is under CPU pressure`;
  const actions = evidence.resources.flatMap((resource) =>
    resource === "memory"
      ? (() => {
          const memory = evidence.memory!;
          return [
            ...(memory.high !== null
              ? [`Memory reclaim threshold: ${gigabytes(memory.high)}.`]
              : []),
            ...(memory.growth.high > 0
              ? ["The container hit its memory reclaim threshold since the preceding sample."]
              : []),
            ...((memory.growth.max ?? 0) > 0
              ? ["The container hit its hard memory limit since the preceding sample."]
              : []),
            ...((memory.pressure?.some.avg10 ?? 0) > 0
              ? ["The kernel reports recent memory stalls."]
              : []),
            ...((memory.swapGrowth ?? 0) > 0 ? ["Container swap use is growing."] : []),
            ...(memory.growth.oom > 0
              ? ["The kernel reported an out-of-memory allocation since the preceding sample."]
              : []),
            "Close idle terminal agents or the IDE in the container, or raise RAM in Zerops.",
          ];
        })()
      : resource === "disk"
        ? ["Free space on the Mate's state disk."]
        : resource === "io"
          ? [
              "The kernel reports I/O stalls slowing container work. Reduce container disk activity.",
            ]
          : (() => {
              const window = evidence.cpu?.window;
              if (window == null) return [];
              const cores = (value: number) => Number(value.toFixed(2));
              const usage = cores(window.usageUsec / window.elapsedUsec);
              const capacity = cores(window.capacityCpus);
              const measured = `Measured ${usage} CPU cores used out of a limit of ${capacity} over ${cores(window.elapsedUsec / 1_000_000)} seconds.`;
              const consumer = window.consumer;
              return [
                measured,
                consumer === null
                  ? "The kernel reports runnable work waiting for CPU. No current process could be attributed; inspect container workloads in Zerops."
                  : `Top measured process: ${consumer.name} (PID ${consumer.pid}) used ${cores(consumer.cpuCores)} CPU cores. Check its workload before changing CPU in Zerops.`,
              ];
            })(),
  );
  if (!live)
    actions.push(`Last measured ${health.sampledAt}. The Mate's current resources are unknown.`);
  if (evidence.memory?.growth.oomKill)
    actions.push("The kernel killed a process for lack of memory since the preceding sample.");
  if (
    evidence.memory?.swapMax &&
    evidence.memory.swapCurrent !== null &&
    evidence.memory.swapCurrent >= evidence.memory.swapMax
  )
    actions.push("Container swap is full.");
  return { severity: evidence.severity, title, description: actions.join(" ") };
}
