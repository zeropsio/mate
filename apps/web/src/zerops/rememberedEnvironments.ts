import { normalizeOrigin } from "@t3tools/client-runtime/zerops/candidates";
import { useSyncExternalStore } from "react";
import {
  accountLocalStorage,
  captureAccountLifetime,
  onAccountLifetimeClose,
} from "./accountLifetime";

const pendingExchanges = new Map<string, number>();
const listeners = new Set<() => void>();
let identityVersion = 0;
const identitySnapshot = () => identityVersion;
function notifyIdentityChange() {
  identityVersion += 1;
  for (const listener of listeners) listener();
}
function subscribeIdentity(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
onAccountLifetimeClose(() => {
  pendingExchanges.clear();
  notifyIdentityChange();
});
export function useEnvironmentIdentityVersion() {
  return useSyncExternalStore(subscribeIdentity, identitySnapshot, identitySnapshot);
}

/** Bridge the catalog publication to the caller's remembered identity write. */
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
    notifyIdentityChange();
  };
}
export function hasPendingEnvironmentIdentityExchange(origin: string): boolean {
  const key = normalizeOrigin(origin);
  return key !== null && pendingExchanges.has(key);
}

const KEY = "environment-targets:v1";
export interface RememberedEnvironment {
  readonly key: string;
  readonly environmentId: string;
}
export function readRememberedEnvironments(): ReadonlyArray<RememberedEnvironment> {
  try {
    const parsed: unknown = JSON.parse(accountLocalStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is RememberedEnvironment =>
        typeof value === "object" &&
        value !== null &&
        typeof value.key === "string" &&
        typeof value.environmentId === "string",
    );
  } catch {
    return [];
  }
}
export function rememberEnvironment(value: RememberedEnvironment): void {
  const current = readRememberedEnvironments();
  if (
    current.some((entry) => entry.key === value.key && entry.environmentId === value.environmentId)
  )
    return;
  const values = current.filter((entry) => entry.key !== value.key);
  accountLocalStorage.setItem(KEY, JSON.stringify([...values, value]));
  notifyIdentityChange();
}

/** Names and addresses cannot make a replacement service inherit an old target. */
export function isCurrentEnvironmentTarget(
  environment: { readonly environmentId: string; readonly displayUrl?: string | null },
  remembered: ReadonlyArray<RememberedEnvironment>,
  candidates: ReadonlyArray<{ readonly key: string; readonly containerOrigin?: string | null }>,
): boolean {
  if (!environment.displayUrl) return false;
  const origin = normalizeOrigin(environment.displayUrl);
  return remembered.some(
    (entry) =>
      entry.environmentId === environment.environmentId &&
      candidates.some(
        (candidate) =>
          candidate.key === entry.key &&
          candidate.containerOrigin != null &&
          normalizeOrigin(candidate.containerOrigin) === origin,
      ),
  );
}
