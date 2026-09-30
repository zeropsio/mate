/**
 * Where a candidate row meets a registered environment: by the origin its
 * container serves. Pure, so the derived atoms (`state/zerops.ts`) and who
 * lives where (`mateIdentities.ts`) join rows the same way.
 */
import { normalizeOrigin, type ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";

/** The join key of an environment by the Zerops project its descriptor names; never an origin. */
const projectKey = (projectId: string) => `zerops-project:${projectId}`;

/**
 * Every registered environment keyed by origin, socket up or not — who lives where is known before
 * it connects — and by the Zerops project its own descriptor names, for a row that has no origin
 * while its container restarts.
 */
export function registeredZeropsOrigins(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly displayUrl: string | null;
    readonly zeropsProjectId?: string | null | undefined;
  }>,
): ReadonlyMap<string, EnvironmentId> {
  const byOrigin = new Map<string, EnvironmentId>();
  for (const environment of environments) {
    if (typeof environment.zeropsProjectId === "string") {
      const key = projectKey(environment.zeropsProjectId);
      if (!byOrigin.has(key)) byOrigin.set(key, environment.environmentId);
    }
    if (!environment.displayUrl) continue;
    const origin = normalizeOrigin(environment.displayUrl);
    if (origin) byOrigin.set(origin, environment.environmentId);
  }
  return byOrigin;
}

/**
 * The environment a row reaches: the one it is connected to, else the one registered at its
 * origin, else — a container the platform is restarting or updating has no origin in the listing
 * — the one whose descriptor names its project, so the Mate stays who it is through the restart.
 */
export function rowEnvironment(
  row: ZeropsCandidate,
  registeredOrigins: ReadonlyMap<string, EnvironmentId>,
): EnvironmentId | undefined {
  if (row.environmentId !== undefined) return row.environmentId;
  const origin = row.containerOrigin;
  if (origin === undefined) return registeredOrigins.get(projectKey(row.project.id));
  return registeredOrigins.get(normalizeOrigin(origin) ?? origin);
}
