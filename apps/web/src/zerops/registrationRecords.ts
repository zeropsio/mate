/**
 * The account's registration records (DESIGN §2.C C1) over its scoped `localStorage`, and the
 * exchanges whose records are still being written.
 */
import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import {
  makeRegistrationRecords,
  type RegistrationRecord,
} from "@t3tools/client-runtime/zerops/environments";
import { useMemo, useSyncExternalStore } from "react";

import {
  accountLocalStorage,
  captureAccountLifetime,
  onAccountLifetimeClose,
  onAccountLifetimeOpen,
} from "./accountLifetime";

const records = makeRegistrationRecords({
  getItem: (key) => {
    try {
      return accountLocalStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      accountLocalStorage.setItem(key, value);
    } catch {
      // Records are personal context: a Mate this tab could not remember reconnects on demand.
    }
  },
});

const listeners = new Set<() => void>();
let version = 0;
function notify() {
  version += 1;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const versionSnapshot = () => version;

/** Exchanges whose credential is being installed, by container origin. */
const pendingExchanges = new Map<string, number>();
onAccountLifetimeOpen(notify);
onAccountLifetimeClose(() => {
  pendingExchanges.clear();
  notify();
});

export function readRegistrationRecords(): ReadonlyArray<RegistrationRecord> {
  return records.list();
}

export function rememberRegistration(record: RegistrationRecord): void {
  if (records.remember(record)) notify();
}

/** The records, re-read when they change. */
export function useRegistrationRecords(): ReadonlyArray<RegistrationRecord> {
  return useSyncExternalStore(subscribe, readRegistrationRecords, readRegistrationRecords);
}

/** The record of the target that registered this environment. */
export function useRegistrationRecord(
  environmentId: string | null | undefined,
): RegistrationRecord | undefined {
  const current = useRegistrationRecords();
  return useMemo(
    () => current.find((record) => record.environmentId === environmentId),
    [current, environmentId],
  );
}

/** Changes whenever a record or a pending exchange does. */
export function useRegistrationVersion(): number {
  return useSyncExternalStore(subscribe, versionSnapshot, versionSnapshot);
}

/** Bridges the catalog's publication of a registration to the write of its record. */
export function beginEnvironmentIdentityExchange(origin: string): () => void {
  const key = normalizeOrigin(origin);
  const alive = captureAccountLifetime();
  if (key === null || !alive()) return () => undefined;
  pendingExchanges.set(key, (pendingExchanges.get(key) ?? 0) + 1);
  let finished = false;
  return () => {
    if (finished || !alive()) return;
    finished = true;
    const remaining = (pendingExchanges.get(key) ?? 1) - 1;
    if (remaining === 0) pendingExchanges.delete(key);
    else pendingExchanges.set(key, remaining);
    notify();
  };
}

export function hasPendingEnvironmentIdentityExchange(origin: string): boolean {
  const key = normalizeOrigin(origin);
  return key !== null && pendingExchanges.has(key);
}
