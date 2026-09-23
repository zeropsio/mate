/**
 * Hosts the exchange driver (DESIGN §4.4) inside today's account tree: one driver per account
 * epoch, fed the targets the inventory and the remembered records name, the account's guards
 * and the tab's visibility. Restore is the records' demand on it; auto-connect, repair and the
 * user's Connect are demand from their own emitters.
 *
 * An interim shell: the account runtime replaces it (3.4).
 */
import { RegistryContext } from "@effect/atom-react";
import { normalizeOrigin, type ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  interimContainerVerdict,
  makeExchangeDriver,
  type ExchangeDriver,
  type ExchangeTarget,
  type EnvironmentMachine,
  type Presence,
  type ServiceTransition,
} from "@t3tools/client-runtime/zerops/environments";
import type { ZeropsContainerHealth } from "@t3tools/client-runtime/zerops/provisioning";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { EnvironmentId } from "@t3tools/contracts";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { environmentCatalog } from "../connection/catalog";
import { useEnvironments } from "../state/environments";
import { currentAccountEpoch, onAccountLifetimeClose } from "./accountLifetime";
import { inventoryCandidates, type Inventory } from "./inventoryContext";
import {
  hasPendingEnvironmentIdentityExchange,
  isCurrentEnvironmentTarget,
  readRememberedEnvironments,
  useEnvironmentIdentityVersion,
} from "./rememberedEnvironments";
import { useZeropsCandidateHealth } from "./useZeropsCandidateHealth";
import {
  ExchangeDriverContext,
  webExchangePorts,
  type ExchangeInputs,
} from "./useZeropsIdentityExchange";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";

const RestoreContext = createContext(false);
const AvailableContext = createContext<ReadonlySet<string>>(new Set());
export const useEnvironmentRestorePending = () => useContext(RestoreContext);
export const useAvailableEnvironmentIds = () => useContext(AvailableContext);

/** A tab hidden at least this long wakes its retries when it is shown again (§6.4). */
const WAKE_AFTER_HIDDEN_MS = 30_000;

// ── One driver per account epoch ─────────────────────────────────────────────────────────────

/**
 * The epoch's driver outlives this shell's mounts: a lapse unmounts the tree until the next
 * grant, and the machines it holds — a credential held, a retry scheduled — must be there when
 * it comes back. Its ports read the inputs the newest mount committed.
 */
let hosted: {
  readonly epoch: number;
  readonly driver: ExchangeDriver;
  inputs: ExchangeInputs | null;
} | null = null;

onAccountLifetimeClose(() => {
  hosted?.driver.dispose();
  hosted = null;
});

function hostExchangeDriver(): ExchangeDriver {
  const epoch = currentAccountEpoch();
  if (hosted !== null && hosted.epoch === epoch) return hosted.driver;
  hosted?.driver.dispose();
  const host: NonNullable<typeof hosted> = {
    epoch,
    inputs: null,
    driver: makeExchangeDriver(
      webExchangePorts(() => {
        // Bound by the mount's first effect, before any event reaches the driver.
        if (host.inputs === null) throw new Error("The exchange driver has no account inputs.");
        return host.inputs;
      }),
    ),
  };
  hosted = host;
  return host.driver;
}

function bindExchangeInputs(inputs: ExchangeInputs): void {
  if (hosted !== null) hosted.inputs = inputs;
}

// ── Targets from the inventory and the records ───────────────────────────────────────────────

const SERVICE_TRANSITIONS: ReadonlySet<string> = new Set<ServiceTransition>([
  "NEW",
  "CREATING",
  "STARTING",
  "RESTARTING",
  "UPGRADING",
]);

/** Region P for a target the inventory names (§4.4). */
function candidatePresence(candidate: ZeropsCandidate): Presence {
  if (candidate.containerOrigin !== undefined) {
    return { kind: "present", origin: candidate.containerOrigin };
  }
  const status = candidate.service?.status ?? candidate.project.status;
  if (SERVICE_TRANSITIONS.has(status)) {
    return { kind: "transitioning", status: status as ServiceTransition };
  }
  if (status === "ACTIVE") return { kind: "no-origin", reason: "no-subdomain" };
  return { kind: "inactive", status };
}

/**
 * Region P for every target: what the inventory names now; for a target it no longer names,
 * `unknown` while its project's services are unread, the last value while the inventory is
 * loading or failing, and `gone` once a settled read lacks it (the confirming direct read of
 * C19 arrives in 3.9).
 */
function targetsOf(input: {
  readonly inventory: Inventory;
  readonly candidates: ReadonlyArray<ZeropsCandidate>;
  readonly health: ReadonlyMap<string, ZeropsContainerHealth>;
}): ReadonlyArray<ExchangeTarget> {
  const records = readRememberedEnvironments();
  const unread = new Set(
    input.candidates
      .filter(
        (candidate) =>
          candidate.group === "unavailable" &&
          candidate.reason === "this project's services could not be read",
      )
      .map((candidate) => candidate.project.id),
  );
  const settled = !input.inventory.isLoading && input.inventory.error === null;
  const keys = new Set([
    ...input.candidates.map((candidate) => candidate.key),
    ...records.map((record) => record.key),
  ]);
  return [...keys].map((key) => {
    const candidate = input.candidates.find((entry) => entry.key === key);
    const record = records.find((entry) => entry.key === key);
    const projectId = key.split(":")[0] ?? key;
    const presence: Presence | null =
      candidate !== undefined
        ? candidatePresence(candidate)
        : unread.has(projectId)
          ? { kind: "unknown" }
          : settled
            ? { kind: "gone", evidence: "complete-scope-omits-verified" }
            : null;
    return {
      key,
      presence,
      container:
        candidate === undefined
          ? { level: "unknown" }
          : interimContainerVerdict({
              candidate,
              health: input.health.get(key),
              mateFlag: undefined,
            }),
      record: record === undefined ? null : EnvironmentId.make(record.environmentId),
    };
  });
}

/**
 * A remembered target whose credential is on its way: not yet judged, exchanging, waiting for
 * a slot or the grant, or on a presence not read yet (the inventory's read ends it). A target
 * whose presence was read and is not there, that waits on its container, or backs off, has no
 * end the route gate could wait for — its reachability says why (the gate reads it in 0.9c).
 */
const restoring = (machine: EnvironmentMachine | undefined): boolean => {
  if (machine === undefined) return true;
  const credential = machine.credential;
  switch (credential.kind) {
    case "none":
    case "exchanging":
      return true;
    case "waiting":
      return (
        credential.on === "budget" ||
        credential.on === "access" ||
        (credential.on === "presence" && machine.presence.kind === "unknown")
      );
    case "backoff":
    case "refused":
    case "held":
    case "retired":
      return false;
  }
};

/** The route's remembered target once the driver knows it, otherwise every remembered target. */
function restorePendingOf(machines: ReadonlyMap<string, EnvironmentMachine>): boolean {
  const records = readRememberedEnvironments().map((record) => record.key);
  const routed = records.filter((key) => machines.get(key)?.guards.routeTarget === true);
  return (routed.length > 0 ? routed : records).some((key) => restoring(machines.get(key)));
}

// ── The shell ────────────────────────────────────────────────────────────────────────────────

/** Only stable project/service records validated by today's inventory can be
 * reconnected. URL and server identity are observations, never project IDs. */
export function ZeropsEnvironmentLifetime({ children }: { readonly children: ReactNode }) {
  const inventory = useZeropsInventory();
  const { environments } = useEnvironments();
  const { client, activeOrganization } = useZeropsSession();
  const registry = useContext(RegistryContext);
  const identityVersion = useEnvironmentIdentityVersion();
  const candidates = useMemo(
    () => inventoryCandidates(inventory),
    [inventory.projects, inventory.services],
  );
  const { health } = useZeropsCandidateHealth(candidates);

  const [driver] = useState(hostExchangeDriver);

  useEffect(() => {
    bindExchangeInputs({
      registry,
      client,
      activeOrganizationId: activeOrganization?.id,
      candidates,
    });
  }, [activeOrganization?.id, candidates, client, registry]);

  // Mounted means granted: this tree renders only inside an admitted grant, and a lapse
  // unmounts it until the next one. Exchanges wait on access meanwhile, and resume on their own.
  useEffect(() => {
    driver.setAccount({
      postGrant: true,
      identityMint: { allowed: true },
      zeropsFailing: false,
      grantVerifiedAtMs: null,
    });
    return () =>
      driver.setAccount({
        postGrant: true,
        identityMint: { allowed: false, reason: "access-lapsed", waitable: true },
        zeropsFailing: false,
        grantVerifiedAtMs: null,
      });
  }, [driver]);

  useEffect(() => {
    let hiddenSince: number | null = null;
    const visibility = () => {
      const visible = document.visibilityState === "visible";
      driver.setVisible(visible);
      if (!visible) {
        hiddenSince ??= performance.now();
        return;
      }
      if (hiddenSince !== null && performance.now() - hiddenSince >= WAKE_AFTER_HIDDEN_MS) {
        driver.wake(true);
      }
      hiddenSince = null;
    };
    const online = () => driver.online();
    visibility();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
    };
  }, [driver]);

  useEffect(() => {
    driver.setTargets(targetsOf({ inventory, candidates, health }));
    driver.setDemand(
      "record",
      readRememberedEnvironments().map((record) => record.key),
    );
  }, [candidates, driver, health, identityVersion, inventory]);

  // A registration no target owns — nothing remembers it and no install is writing its record —
  // is released; a remembered one leaves only when its target retires.
  useEffect(() => {
    const remembered = new Set(readRememberedEnvironments().map((record) => record.environmentId));
    for (const environment of environments) {
      if (remembered.has(String(environment.environmentId))) continue;
      if (environment.displayUrl && hasPendingEnvironmentIdentityExchange(environment.displayUrl)) {
        continue;
      }
      void runAtomCommand(registry, environmentCatalog.remove, environment.environmentId, {
        reportFailure: false,
      });
    }
  }, [environments, identityVersion, registry]);

  const machines = useSyncExternalStore(driver.subscribe, driver.machines);
  const restorePending = useMemo(() => restorePendingOf(machines), [machines, identityVersion]);

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

  return (
    <ExchangeDriverContext value={driver}>
      <RestoreContext value={restorePending}>
        <AvailableContext value={availableEnvironmentIds}>{children}</AvailableContext>
      </RestoreContext>
    </ExchangeDriverContext>
  );
}
