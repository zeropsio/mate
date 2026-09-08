import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import { environmentCatalog } from "../connection/catalog";
import { RegistryContext } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { useEnvironments } from "../state/environments";
import { captureAccountLifetime } from "./accountLifetime";
import {
  isCurrentEnvironmentTarget,
  readRememberedEnvironments,
  hasPendingEnvironmentIdentityExchange,
  useEnvironmentIdentityVersion,
} from "./rememberedEnvironments";
import { useZeropsIdentityExchange } from "./useZeropsIdentityExchange";
import { inventoryCandidates } from "./inventoryContext";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsCandidatesVersion } from "./candidatesRefresh";

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
  const restoreAttempts = useRef(new Map<string, string>());
  const pendingRestores = useRef(0);
  const refreshVersion = useZeropsCandidatesVersion();
  const identityVersion = useEnvironmentIdentityVersion();
  const candidates = useMemo(
    () => inventoryCandidates(inventory),
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
    [allowed, candidates, environments, identityVersion],
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
        // Registration may already belong to auto-connect or an explicit Connect.
        if (availableEnvironmentIds.has(remembered.environmentId)) continue;
        const attempt = `${refreshVersion}:${candidate.containerOrigin}`;
        if (restoreAttempts.current.get(candidate.key) === attempt) continue;
        // Claim before awaiting: inventory updates and StrictMode can restart
        // this effect while the exchange is pending, or after it has failed.
        restoreAttempts.current.set(candidate.key, attempt);
        pendingRestores.current += 1;
        setRestoring(true);
        try {
          await exchange(candidate.containerOrigin);
        } finally {
          pendingRestores.current -= 1;
          if (alive()) setRestoring(pendingRestores.current > 0);
        }
      }
      if (!cancelled && alive()) setRestoring(pendingRestores.current > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [availableEnvironmentIds, candidates, exchange, refreshVersion]);

  useEffect(() => {
    if (inventory.isLoading) return;
    for (const key of restoreAttempts.current.keys()) {
      if (!candidates.some((candidate) => candidate.key === key))
        restoreAttempts.current.delete(key);
    }
    for (const environment of environments) {
      if (availableEnvironmentIds.has(String(environment.environmentId))) continue;
      // The catalog publishes registration before the exchange caller can
      // remember its identity. Keep that new target while its origin is still
      // allowed; it is not exposed to routes until the identity is remembered.
      if (
        environment.displayUrl &&
        allowed.has(normalizeOrigin(environment.displayUrl)) &&
        hasPendingEnvironmentIdentityExchange(environment.displayUrl)
      )
        continue;
      // Local disposal must run even when an unrelated scope has blocked writes.
      void runAtomCommand(registry, environmentCatalog.remove, environment.environmentId, {
        reportFailure: false,
      });
    }
  }, [
    allowed,
    availableEnvironmentIds,
    candidates,
    environments,
    inventory.error,
    inventory.isLoading,
    identityVersion,
    registry,
  ]);

  return (
    <RestoreContext value={restoring}>
      <AvailableContext value={availableEnvironmentIds}>{children}</AvailableContext>
    </RestoreContext>
  );
}
