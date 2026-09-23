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
  const exchange = useZeropsIdentityExchange("restore");
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

  // The exact candidate keys a fresh inventory read still produces — a zcp
  // service reporting `RESTARTING`, or any other still-provisioning status,
  // keeps the same `project:service` key, so this alone already answers "is
  // this remembered registration's container still there" without reading
  // its group.
  const candidateKeys = useMemo(
    () => new Set(candidates.map((candidate) => candidate.key)),
    [candidates],
  );
  // A project whose services could not be read at all falls back to a
  // project-level candidate with no service in its key (candidates.ts), so a
  // remembered `project:service` key never matches it by equality — that is
  // exactly the transient read H10 warns about, not proof the service is
  // gone, so it is checked by project id instead.
  const projectsWithUnreadServices = useMemo(
    () =>
      new Set(
        candidates
          .filter(
            (candidate) =>
              candidate.group === "unavailable" &&
              candidate.reason === "this project's services could not be read",
          )
          .map((candidate) => candidate.project.id),
      ),
    [candidates],
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
      const remembered = readRememberedEnvironments().find(
        (entry) => entry.environmentId === String(environment.environmentId),
      );
      if (remembered) {
        // E12/H10: a restarting container, or services the inventory has
        // not read yet, must not eject a working registration — and a read
        // still in flight, or one that failed, proves nothing about
        // whether the project is actually gone.
        const projectId = remembered.key.split(":")[0];
        const stillThere =
          candidateKeys.has(remembered.key) ||
          (projectId !== undefined && projectsWithUnreadServices.has(projectId));
        if (stillThere) continue;
        if (inventory.isLoading || inventory.error !== null) continue;
      }
      // Local disposal must run even when an unrelated scope has blocked writes.
      void runAtomCommand(registry, environmentCatalog.remove, environment.environmentId, {
        reportFailure: false,
      });
    }
  }, [
    allowed,
    availableEnvironmentIds,
    candidateKeys,
    candidates,
    environments,
    inventory.error,
    inventory.isLoading,
    identityVersion,
    projectsWithUnreadServices,
    registry,
  ]);

  return (
    <RestoreContext value={restoring}>
      <AvailableContext value={availableEnvironmentIds}>{children}</AvailableContext>
    </RestoreContext>
  );
}
