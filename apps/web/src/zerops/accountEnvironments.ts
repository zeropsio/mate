/**
 * The web's binding to the account runtime's Mate environments (DESIGN §7.3): the post-grant
 * stage the host binds once the epoch's first grant built it, and the hooks surfaces read it
 * through. The stores are the runtime's; nothing here holds a fact of its own.
 *
 * Closing the account lifetime unbinds it at once: a reader after sign-out sees no environments.
 */
import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import type { IdentityExchangeReason } from "@t3tools/client-runtime/zerops/diagnostics";
import {
  reachabilityPhrase,
  type ConnectOutcome,
  type ContainerMachine,
  type DescriptorIndex,
  type EnvironmentMachine,
  type TargetKey,
} from "@t3tools/client-runtime/zerops/environments";
import type { ZeropsIdentityExchangeResult } from "@t3tools/client-runtime/zerops/identityExchange";
import { useCallback, useSyncExternalStore } from "react";

import { onAccountLifetimeClose } from "./accountLifetime";
import { inventoryCandidates } from "./inventoryContext";
import { useZeropsInventory } from "./ZeropsInventoryProvider";

// ── The binding ──────────────────────────────────────────────────────────────────────────────

let bound: AccountEnvironments | null = null;
const listeners = new Set<() => void>();
/** Readers waiting for the stage, answered when one is bound. */
let waiting: Array<(environments: AccountEnvironments) => void> = [];

function publish(next: AccountEnvironments | null): void {
  bound = next;
  if (next !== null) {
    const answered = waiting;
    waiting = [];
    for (const answer of answered) answer(next);
  }
  for (const listener of listeners) listener();
}

onAccountLifetimeClose(() => {
  waiting = [];
  if (bound !== null) publish(null);
});

/**
 * Makes `environments` — the open account's post-grant stage — the one surfaces read. Returns the
 * way to unbind it, which leaves a newer binding alone.
 */
export function bindAccountEnvironments(environments: AccountEnvironments): () => void {
  publish(environments);
  return () => {
    if (bound === environments) publish(null);
  };
}

/** The bound stage; null before the epoch's first grant and after sign-out. */
export function currentAccountEnvironments(): AccountEnvironments | null {
  return bound;
}

/** The bound stage, once there is one. */
export function accountEnvironmentsReady(): Promise<AccountEnvironments> {
  if (bound !== null) return Promise.resolve(bound);
  return new Promise((resolve) => {
    waiting.push(resolve);
  });
}

function subscribeBinding(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The bound stage, re-read when it is bound or unbound. */
export function useAccountEnvironments(): AccountEnvironments | null {
  return useSyncExternalStore(
    subscribeBinding,
    currentAccountEnvironments,
    currentAccountEnvironments,
  );
}

/** One snapshot of the bound stage, re-read on its every publication; `empty` while none is. */
export function useAccountEnvironmentsSnapshot<T>(
  read: (environments: AccountEnvironments) => T,
  empty: T,
): T {
  const environments = useAccountEnvironments();
  const subscribe = useCallback(
    (listener: () => void) => environments?.subscribe(listener) ?? (() => undefined),
    [environments],
  );
  const snapshot = useCallback(
    () => (environments === null ? empty : read(environments)),
    [empty, environments, read],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// ── What surfaces read ───────────────────────────────────────────────────────────────────────

const NO_MACHINES: ReadonlyMap<TargetKey, EnvironmentMachine> = new Map();
const NO_CONTAINERS: ReadonlyMap<TargetKey, ContainerMachine> = new Map();
const NO_INDEX: DescriptorIndex = {
  serving: new Map(),
  reported: new Map(),
  unanswered: [],
  failed: [],
};
const machinesOf = (environments: AccountEnvironments) => environments.machines();
const containersOf = (environments: AccountEnvironments) => environments.containers();
const indexOf = (environments: AccountEnvironments) => environments.index();

/** Every Mate target's environment machine (§4.4). */
export function useEnvironmentMachines(): ReadonlyMap<TargetKey, EnvironmentMachine> {
  return useAccountEnvironmentsSnapshot(machinesOf, NO_MACHINES);
}

/** Every Mate target's container machine (§4.5). */
export function useContainerMachines(): ReadonlyMap<TargetKey, ContainerMachine> {
  return useAccountEnvironmentsSnapshot(containersOf, NO_CONTAINERS);
}

/** The descriptor index over every present target (§4.8). */
export function useDescriptorIndex(): DescriptorIndex {
  return useAccountEnvironmentsSnapshot(indexOf, NO_INDEX);
}

// ── The user's Connect ───────────────────────────────────────────────────────────────────────

/** The verdicts a retry of the same Connect does not change. */
const TERMINAL_CONNECT: ReadonlySet<string> = new Set([
  "gone",
  "replaced",
  "refused-role",
  "refused-configuration",
  "update-required",
  "update-unavailable",
  "no-address",
]);

/** A settled Connect as the projects page reads it. */
export function connectResult(outcome: ConnectOutcome): ZeropsIdentityExchangeResult {
  switch (outcome._tag) {
    case "Connected":
      return { _tag: "Success", environmentId: outcome.environmentId };
    case "Closed":
      return { _tag: "Failure", error: "This account session has ended.", retryable: false };
    case "NotConnected": {
      const verdict = outcome.reachability;
      const text = reachabilityPhrase(verdict, { nowMs: Date.now(), mateName: "This Mate" }).text;
      const upgrade = verdict.kind === "update-required" || verdict.kind === "update-unavailable";
      return {
        _tag: "Failure",
        error: `Could not connect to this container. ${text ?? ""}`.trim(),
        retryable: !TERMINAL_CONNECT.has(verdict.kind),
        ...(upgrade
          ? {
              upgradeRequired: true,
              ...(outcome.descriptor === null
                ? {}
                : { serverVersion: outcome.descriptor.serverVersion }),
            }
          : {}),
      };
    }
  }
}

/**
 * The user's Connect on a container, by its origin: a demand on the account's exchange driver,
 * which runs the exchange, installs the credential and answers with the environment — or with why
 * it did not. `reason` names the exchange in diagnostics.
 */
export function useConnectMate(reason: IdentityExchangeReason) {
  const environments = useAccountEnvironments();
  const inventory = useZeropsInventory();

  return useCallback(
    async (containerOrigin: string): Promise<ZeropsIdentityExchangeResult> => {
      const candidate = inventoryCandidates(inventory).find(
        (entry) =>
          entry.containerOrigin &&
          normalizeOrigin(entry.containerOrigin) === normalizeOrigin(containerOrigin),
      );
      if (candidate === undefined) {
        return {
          _tag: "Failure",
          error: "This environment is not in your verified Zerops projects.",
          retryable: false,
        };
      }
      if (environments === null) return connectResult({ _tag: "Closed" });
      return connectResult(await environments.connect(candidate.key, reason));
    },
    [environments, inventory, reason],
  );
}
