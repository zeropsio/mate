import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import type { EnvironmentId } from "@t3tools/contracts";

export function connectedZeropsOrigins(
  environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly displayUrl: string | null;
    readonly connection: { readonly phase: string };
  }>,
): ReadonlyMap<string, EnvironmentId> {
  const byOrigin = new Map<string, EnvironmentId>();
  for (const environment of environments) {
    if (environment.connection.phase !== "connected" || !environment.displayUrl) continue;
    const origin = normalizeOrigin(environment.displayUrl);
    if (origin) byOrigin.set(origin, environment.environmentId);
  }
  return byOrigin;
}
