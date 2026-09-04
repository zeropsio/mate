import { probeZeropsContainerHealth } from "@t3tools/client-runtime/zerops/containerHealth";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";

export { loadOrganizationProjects } from "@t3tools/client-runtime/zerops/candidateLoading";

export const MOBILE_ZEROPS_HEALTH_TIMEOUT_MS = 8_000;

export function candidateAfterHealthProbe(
  candidate: ZeropsCandidate,
  health: ZeropsContainerHealth | undefined,
): ZeropsCandidate {
  if (candidate.group !== "ready") return candidate;
  switch (health) {
    case "ready":
      return candidate;
    case "initializing":
      return { ...candidate, group: "provisioning", reason: "Zerops Mate is starting" };
    case "predates-mate":
      return {
        ...candidate,
        group: "unavailable",
        reason: "Zerops Mate is not enabled for this container",
      };
    case "unreachable":
      return { ...candidate, group: "unavailable", reason: "container is not answering" };
    case undefined:
      return {
        ...candidate,
        group: "provisioning",
        reason: "checking Zerops Mate readiness",
      };
  }
}

export async function probeCandidateHealth(
  origin: string,
  options: {
    readonly probe?: (origin: string) => Promise<ZeropsContainerHealth>;
    readonly timeoutMs?: number;
  } = {},
): Promise<ZeropsContainerHealth> {
  const timeoutMs = options.timeoutMs ?? MOBILE_ZEROPS_HEALTH_TIMEOUT_MS;
  const probe = options.probe ?? probeZeropsContainerHealth;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<ZeropsContainerHealth>((resolve) => {
    timeout = setTimeout(() => resolve("unreachable"), timeoutMs);
  });
  try {
    return await Promise.race([probe(origin).catch(() => "unreachable" as const), timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
