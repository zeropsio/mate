import type { MateHealth } from "@t3tools/contracts";
import { serviceFamily } from "../families/service.ts";
import { scopeOf } from "../families/spec.ts";
import { hqMateScope } from "../families/hqMate.ts";
import { hqMateHealthScope, mateHealthScope } from "../families/mateHealth.ts";
import { linkKeys } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import type { MateProjectKey } from "./mateAttention.ts";

export interface MateHealthRead {
  readonly health: MateHealth | null;
  readonly live: boolean;
  readonly configuredMinimumBytes: number | null;
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
    const minimums = (
      read.stream(scopeOf(serviceFamily, orgId)).phase === "live"
        ? [...read.index("serviceProject", projectId)]
        : []
    ).flatMap((key) => {
      const service = read.fact("service", key);
      if (service.kind !== "known" || service.value.name !== "zcp") return [];
      const minimum =
        service.value.currentAutoscaling?.verticalAutoscaling?.minResource?.memoryGBytes;
      return typeof minimum === "number" && Number.isFinite(minimum) && minimum >= 0
        ? [minimum * 1024 ** 3]
        : [];
    });
    return {
      health,
      live: health !== null && live,
      configuredMinimumBytes: minimums.length === 1 ? minimums[0]! : null,
    };
  },
  equals: sameValue,
};

const gigabytes = (bytes: number) => `${Number((bytes / 1024 ** 3).toFixed(2))} GB`;

/** Presentation names only measured constraints; configuration is separate Zerops evidence. */
export function mateHealthCopy(
  name: string,
  read: MateHealthRead,
): {
  readonly severity: "warning" | "critical";
  readonly title: string;
  readonly description: string;
} | null {
  const { health, live, configuredMinimumBytes } = read;
  if (health === null) return null;
  const evidence = {
    ...health.evidence,
    // Old avg10-only reports cannot establish current CPU exhaustion, even over a live link.
    resources: health.evidence.resources.filter(
      (resource) => resource !== "cpu" || health.evidence.cpu?.window?.saturated === true,
    ),
  };
  const strained = evidence.resources.length > 0;
  const cap =
    evidence.memory === null
      ? null
      : Math.min(evidence.memory.high ?? Infinity, evidence.memory.max ?? Infinity);
  const limited = cap !== null && Number.isFinite(cap);
  const mismatch =
    live && limited && configuredMinimumBytes !== null && configuredMinimumBytes > cap;
  if (!strained && !mismatch && (live || !limited)) return null;
  const prefix = live ? name : `${name} · last-known health`;
  const resource = evidence.resources[0];
  const title = !strained
    ? `${prefix} — the container ${live ? "is" : "was"} capped at ${gigabytes(cap ?? 0)}`
    : resource === "memory" || mismatch
      ? `${prefix} is short on memory${limited ? ` — the container is capped at ${gigabytes(cap)}` : ""}`
      : resource === "disk"
        ? `${prefix} is short on disk resources`
        : `${prefix} is under CPU pressure`;
  const actions = evidence.resources.flatMap((resource) =>
    resource === "memory"
      ? ["Close idle terminal agents or the IDE in the container, or raise RAM in Zerops."]
      : resource === "disk"
        ? [
            evidence.disk?.free === 0
              ? "Free space on the Mate's state disk."
              : "Reduce container disk activity; the kernel reports I/O stalls.",
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
  if (mismatch)
    actions.push(
      `Zerops is configured for at least ${gigabytes(configuredMinimumBytes)}; that increase hasn't reached the container.`,
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
