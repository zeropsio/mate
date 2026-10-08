import { sustainedPressureLevel, type MateHealth } from "@t3tools/contracts";
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
  if (health === null || health.evidence.status !== "strained") return null;
  const evidence = health.evidence;
  const memory = evidence.memory;
  // Raw sampler flags also describe routine autoscaling signals. Notices require
  // sustained work stalls or a new OOM kill, including when reading older reports.
  const memoryStrained =
    memory !== null && (memory.growth.oomKill > 0 || sustainedPressureLevel(memory.pressure) >= 1);
  const resources: Array<"memory" | "disk" | "io" | "cpu"> = [];
  if (memoryStrained) resources.push("memory");
  if (evidence.disk?.free === 0) resources.push("disk");
  if (sustainedPressureLevel(evidence.io) >= 1) resources.push("io");
  if (evidence.cpu?.window?.saturated === true && sustainedPressureLevel(evidence.cpu) >= 1)
    resources.push("cpu");
  const severity =
    evidence.disk?.free === 0 || (memory?.growth.oomKill ?? 0) > 0 ? "critical" : "warning";
  if (resources.length === 0) return null;
  const prefix = live ? name : `${name} · last-known health`;
  const resource = resources[0];
  const title =
    resource === "memory"
      ? `${prefix} is short of memory — work may be slow`
      : resource === "disk"
        ? `${prefix} has no free space on its state disk`
        : resource === "io"
          ? `${prefix} is slowed by I/O stalls`
          : `${prefix} is under CPU pressure`;
  const actions = resources.flatMap((resource) =>
    resource === "memory"
      ? [
          "Close idle terminal agents or the IDE in the container, or raise the RAM limit in Zerops.",
        ]
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
  return { severity, title, description: actions.join(" ") };
}
