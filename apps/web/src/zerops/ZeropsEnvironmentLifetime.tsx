import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { deriveZeropsCandidates, normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import { environmentCatalog } from "../connection/catalog";
import { RegistryContext } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { useEnvironments } from "../state/environments";
import { captureAccountLifetime } from "./accountLifetime";
import { isCurrentEnvironmentTarget, readRememberedEnvironments } from "./rememberedEnvironments";
import { useZeropsIdentityExchange } from "./useZeropsIdentityExchange";
import { useZeropsInventory } from "./ZeropsInventoryProvider";

const RestoreContext = createContext(false);
const AvailableContext = createContext<ReadonlySet<string>>(new Set());
export const useEnvironmentRestorePending = () => useContext(RestoreContext);
export const useAvailableEnvironmentIds = () => useContext(AvailableContext);

/** Only stable project/service records validated by today's inventory can be
 * reconnected. URL and server identity are observations, never project IDs. */
export function ZeropsEnvironmentLifetime({ children }: { readonly children: ReactNode }) {
  const inventory = useZeropsInventory();
  const { environments } = useEnvironments();
  const exchange = useZeropsIdentityExchange();
  const registry = useContext(RegistryContext);
  const [restoring, setRestoring] = useState(true);
  const connectedTargets = useRef(new Map<string, string>());
  const candidates = useMemo(
    () =>
      inventory.projects.flatMap((project) => {
        const outcome = inventory.services.get(project.id);
        return deriveZeropsCandidates(
          project,
          outcome?.status === "resolved" ? outcome.services : null,
          new Map(),
        );
      }),
    [inventory.projects, inventory.services],
  );

  const allowed = useMemo(
    () =>
      new Set(
        candidates.flatMap((candidate) =>
          candidate.containerOrigin &&
          candidate.group !== "unavailable" &&
          candidate.group !== "provisioning"
            ? [normalizeOrigin(candidate.containerOrigin)]
            : [],
        ),
      ),
    [candidates],
  );
  const availableEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter(
            (environment) =>
              environment.displayUrl &&
              allowed.has(normalizeOrigin(environment.displayUrl)) &&
              isCurrentEnvironmentTarget(environment, readRememberedEnvironments(), candidates),
          )
          .map((environment) => String(environment.environmentId)),
      ),
    [allowed, candidates, environments],
  );

  useEffect(() => {
    const alive = captureAccountLifetime();
    let cancelled = false;
    void (async () => {
      for (const remembered of readRememberedEnvironments()) {
        if (cancelled || !alive()) return;
        const candidate = candidates.find((entry) => entry.key === remembered.key);
        if (
          !candidate?.containerOrigin ||
          candidate.group === "unavailable" ||
          candidate.group === "provisioning"
        )
          continue;
        if (connectedTargets.current.get(candidate.key) === candidate.containerOrigin) continue;
        const result = await exchange(candidate.containerOrigin);
        if (result._tag === "Success" && alive())
          connectedTargets.current.set(candidate.key, candidate.containerOrigin);
      }
      if (!cancelled && alive()) setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [candidates, exchange]);

  useEffect(() => {
    if (inventory.isLoading) return;
    for (const [key, origin] of connectedTargets.current) {
      if (!allowed.has(normalizeOrigin(origin))) connectedTargets.current.delete(key);
    }
    for (const environment of environments) {
      if (availableEnvironmentIds.has(String(environment.environmentId))) continue;
      // Local disposal must run even when an unrelated scope has blocked writes.
      void runAtomCommand(registry, environmentCatalog.remove, environment.environmentId, {
        reportFailure: false,
      });
    }
  }, [
    allowed,
    availableEnvironmentIds,
    environments,
    inventory.error,
    inventory.isLoading,
    registry,
  ]);

  return (
    <RestoreContext value={restoring}>
      <AvailableContext value={availableEnvironmentIds}>{children}</AvailableContext>
    </RestoreContext>
  );
}
