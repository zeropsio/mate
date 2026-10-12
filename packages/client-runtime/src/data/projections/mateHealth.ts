import { type MateHealth } from "@t3tools/contracts";
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
    const health = attention.kind === "known" ? attention.value : null;
    const directLive =
      attention.kind === "known" &&
      attention.scope === mateHealthScope(projectId) &&
      read.stream(linkKeys.mateHealth(projectId)).phase === "live" &&
      read.stream(mateHealthScope(projectId)).phase === "live";
    const storedLive =
      attention.kind === "known" &&
      attention.scope === hqMateHealthScope(orgId, projectId) &&
      attention.revision.kind === "mate-attention" &&
      attention.revision.live &&
      read.stream(linkKeys.hq(orgId)).phase === "live" &&
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
  if (!live || health === null || health.evidence.status !== "strained") return null;
  const { evidence } = health;
  if (evidence.resources.length === 0) return null;
  const messages = evidence.resources.map((resource) =>
    resource === "memory"
      ? evidence.memory?.oomKilledAt != null
        ? `${name} ran out of memory and the system stopped a process.`
        : `${name} has been swapping to disk for 5 minutes — work is slow.`
      : resource === "disk"
        ? `${name}'s state disk is full.`
        : resource === "io"
          ? `${name} has been waiting on disk for 5 minutes.`
          : `${name} is near its process limit — likely leftover browsers.`,
  );
  const hints = evidence.resources.includes("memory")
    ? "Close unused browsers or raise minRam in Zerops."
    : "";
  return {
    severity: evidence.severity,
    title: messages[0]!,
    description: [...messages.slice(1), hints].filter(Boolean).join(" "),
  };
}
