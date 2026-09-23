/**
 * Where a candidate row meets a registered environment: by the origin its
 * container serves. Pure, so the derived atoms (`state/zerops.ts`) and who
 * lives where (`mateIdentities.ts`) join rows the same way.
 */
import { normalizeOrigin, type ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";

/** Every registered environment keyed by origin, socket up or not — who lives where is known before it connects. */
export function registeredZeropsOrigins(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly displayUrl: string | null;
  }>,
): ReadonlyMap<string, EnvironmentId> {
  const byOrigin = new Map<string, EnvironmentId>();
  for (const environment of environments) {
    if (!environment.displayUrl) continue;
    const origin = normalizeOrigin(environment.displayUrl);
    if (origin) byOrigin.set(origin, environment.environmentId);
  }
  return byOrigin;
}

/** The environment a row reaches: the one it is connected to, else the one registered at its origin. */
export function rowEnvironment(
  row: ZeropsCandidate,
  registeredOrigins: ReadonlyMap<string, EnvironmentId>,
): EnvironmentId | undefined {
  if (row.environmentId !== undefined) return row.environmentId;
  const origin = row.containerOrigin;
  if (origin === undefined) return undefined;
  return registeredOrigins.get(normalizeOrigin(origin) ?? origin);
}
