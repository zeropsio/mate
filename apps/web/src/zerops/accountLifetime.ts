/** One verified account owns one renderer lifetime. Network results from a closed
 * lifetime must never publish into a later account's stores. */
let accountId: string | null = null;
let generation = 0;
let actionsAllowed = false;
export function setAccountActionsAllowed(allowed: boolean): void {
  actionsAllowed = allowed;
}
export function accountActionsAllowed(): boolean {
  return accountId !== null && actionsAllowed;
}
const onClose = new Set<() => void>();

export function currentAccountId(): string | null {
  return accountId;
}

export function accountStorageKey(key: string): string | null {
  return accountId === null ? null : `mate:account:${encodeURIComponent(accountId)}:${key}`;
}

export function openAccountLifetime(userId: string): void {
  if (accountId === userId) return;
  closeAccountLifetime();
  accountId = userId;
  actionsAllowed = true;
  for (const open of onOpen) open();
}

export function closeAccountLifetime(): void {
  generation += 1;
  actionsAllowed = false;
  // Writers flush while their original account still owns the keys. Every
  // cleanup must run even if a storage policy rejects one writer.
  for (const close of [...onClose].toReversed()) {
    try {
      close();
    } catch (cause) {
      console.error("Account cleanup failed", cause);
    }
  }
  accountId = null;
}

export function onAccountLifetimeClose(close: () => void): () => void {
  onClose.add(close);
  return () => onClose.delete(close);
}

export function captureAccountLifetime(): () => boolean {
  const captured = generation;
  const owner = accountId;
  return () => owner !== null && owner === accountId && captured === generation;
}

const onOpen = new Set<() => void>();
export function onAccountLifetimeOpen(open: () => void): () => void {
  onOpen.add(open);
  return () => onOpen.delete(open);
}

/** No historical unowned value can be read into an account. */
export const accountLocalStorage = {
  getItem(key: string): string | null {
    const scoped = accountStorageKey(key);
    return scoped === null ? null : window.localStorage.getItem(scoped);
  },
  setItem(key: string, value: string): void {
    const scoped = accountStorageKey(key);
    if (scoped !== null) window.localStorage.setItem(scoped, value);
  },
  removeItem(key: string): void {
    const scoped = accountStorageKey(key);
    if (scoped !== null) window.localStorage.removeItem(scoped);
  },
};
