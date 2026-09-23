/**
 * Hosts the exchange driver (DESIGN §4.4) inside today's account tree: one driver per account
 * epoch, fed the targets the inventory and the remembered records name, the account's guards
 * and the tab's visibility. Restore is the records' demand on it; auto-connect, repair and the
 * user's Connect are demand from their own emitters. Region C of every target is the container
 * store's verdict (§4.5), which this shell feeds the platform's statuses and processes. The
 * account's births (§4.5) run here too, so none of them waits for a page to be open.
 *
 * An interim shell: the account runtime replaces it (3.4).
 */
import { RegistryContext } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  bindContainerStore,
  makeExchangeDriver,
  type ContainerStore,
  type ExchangeDriver,
  type ExchangeTarget,
  type Presence,
  type ServiceTransition,
} from "@t3tools/client-runtime/zerops/environments";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { environmentCatalog } from "../connection/catalog";
import { useEnvironments } from "../state/environments";
import { onZeropsInvalidation } from "./accountInvalidations";
import { currentAccountEpoch, onAccountLifetimeClose } from "./accountLifetime";
import { inventoryCandidates, type Inventory } from "./inventoryContext";
import {
  hasPendingEnvironmentIdentityExchange,
  readRegistrationRecords,
  useRegistrationVersion,
} from "./registrationRecords";
import {
  ExchangeDriverContext,
  webExchangePorts,
  type ExchangeInputs,
} from "./useZeropsIdentityExchange";
import { useZeropsInventory } from "./ZeropsInventoryProvider";
import { useZeropsSession } from "./ZeropsSessionProvider";
import { bindBirthInputs } from "./zeropsBirths";
import {
  bindContainerInputs,
  containerTargetsOf,
  hostContainerStore,
  useContainerProcesses,
} from "./zeropsContainers";
import { useZeropsData } from "./zeropsDataContext";

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
  readonly containers: ContainerStore;
}): ReadonlyArray<ExchangeTarget> {
  const records = readRegistrationRecords();
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
    ...records.map((record) => record.targetKey),
  ]);
  return [...keys].map((key) => {
    const candidate = input.candidates.find((entry) => entry.key === key);
    const record = records.find((entry) => entry.targetKey === key);
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
      container: input.containers.verdict(key),
      record: record?.environmentId ?? null,
    };
  });
}

// ── The shell ────────────────────────────────────────────────────────────────────────────────

/** Only stable project/service records validated by today's inventory can be
 * reconnected. URL and server identity are observations, never project IDs. */
export function ZeropsEnvironmentLifetime({ children }: { readonly children: ReactNode }) {
  const inventory = useZeropsInventory();
  const { environments } = useEnvironments();
  const { client, activeOrganization } = useZeropsSession();
  const { organizationRef, projectRef, runtime, signals } = useZeropsData();
  const registry = useContext(RegistryContext);
  const recordsVersion = useRegistrationVersion();
  const candidates = useMemo(
    () => inventoryCandidates(inventory),
    [inventory.projects, inventory.services],
  );
  const [driver] = useState(hostExchangeDriver);
  const [containers] = useState(hostContainerStore);
  useEffect(() => bindContainerStore(containers, driver), [containers, driver]);
  useEffect(() => {
    bindContainerInputs({ runtime, inventory, clientId: activeOrganization?.id });
  }, [activeOrganization?.id, inventory, runtime]);
  useEffect(() => {
    containers.setTargets(containerTargetsOf(candidates));
  }, [candidates, containers]);
  useContainerProcesses(containers, candidates, inventory, activeOrganization?.id);
  useEffect(() => {
    bindBirthInputs({ client, runtime, organizationRef, projectRef, atoms: registry });
  }, [client, organizationRef, projectRef, registry, runtime]);
  // A container intent reads its target again (DESIGN §6.2).
  useEffect(
    () =>
      onZeropsInvalidation((invalidation) => {
        if (invalidation.topic === "container") containers.request(invalidation.target);
      }),
    [containers],
  );

  useEffect(() => {
    bindExchangeInputs({
      registry,
      client,
      activeOrganizationId: activeOrganization?.id,
      organizationRef,
      candidates,
    });
  }, [activeOrganization?.id, candidates, client, organizationRef, registry]);

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

  // The tab, as the account hears it (§6.4): retries wait while hidden and fire on a visible wake.
  useEffect(() => {
    driver.setVisible(!signals.hidden());
    containers.setVisible(!signals.hidden());
    return signals.listen((signal) => {
      switch (signal.type) {
        case "visibility":
          driver.setVisible(!signal.hidden);
          containers.setVisible(!signal.hidden);
          return;
        case "network":
          if (signal.online) driver.online();
          return;
        case "wake":
          driver.wake(signal.visible);
          containers.wake(signal.visible);
      }
    });
  }, [containers, driver, signals]);

  useEffect(() => {
    driver.setTargets(targetsOf({ inventory, candidates, containers }));
    driver.setDemand(
      "record",
      readRegistrationRecords().map((record) => record.targetKey),
    );
  }, [candidates, containers, driver, inventory, recordsVersion]);

  // A registration no target owns — nothing remembers it and no install is writing its record —
  // is released; a remembered one leaves only when its target retires.
  useEffect(() => {
    const remembered = new Set(readRegistrationRecords().map((record) => record.environmentId));
    for (const environment of environments) {
      if (remembered.has(environment.environmentId)) continue;
      if (environment.displayUrl && hasPendingEnvironmentIdentityExchange(environment.displayUrl)) {
        continue;
      }
      void runAtomCommand(registry, environmentCatalog.remove, environment.environmentId, {
        reportFailure: false,
      });
    }
  }, [environments, recordsVersion, registry]);

  return <ExchangeDriverContext value={driver}>{children}</ExchangeDriverContext>;
}
