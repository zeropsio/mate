/** One verified account owns one renderer lifetime. Network results from a closed
 * lifetime must never publish into a later account's stores. */
let accountId: string | null = null;
let generation = 0;
/** When the evidence behind account actions runs out, on `Date.now()` and `performance.now()`. */
export interface AccountActionsDeadline {
  readonly wallMs: number;
  readonly monoMs: number;
}
let actionsDeadline: AccountActionsDeadline | null = null;
/** Opens account actions until `deadline`, or closes them with `null`. */
export function setAccountActionsAllowed(deadline: AccountActionsDeadline | null): void {
  actionsDeadline = deadline;
}
/** Allowed only before the deadline on both clocks (DESIGN G5). */
export function accountActionsAllowed(): boolean {
  return (
    accountId !== null &&
    actionsDeadline !== null &&
    Date.now() < actionsDeadline.wallMs &&
    performance.now() < actionsDeadline.monoMs
  );
}
const onClose = new Set<() => void>();

export function currentAccountId(): string | null {
  return accountId;
}

/** Monotonic renderer-local fence for account-scoped async work. */
export function currentAccountEpoch(): number {
  return generation;
}

export function accountStorageKey(key: string): string | null {
  return accountId === null ? null : `mate:account:${encodeURIComponent(accountId)}:${key}`;
}

export function openAccountLifetime(userId: string): void {
  if (accountId === userId) return;
  closeAccountLifetime();
  accountId = userId;
  actionsDeadline = null;
  for (const open of onOpen) open();
}

export function closeAccountLifetime(): void {
  generation += 1;
  actionsDeadline = null;
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
