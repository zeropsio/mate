/**
 * The account's personal context as mobile hands it to the account runtime (DESIGN §7.5): its
 * registration records over the device's storage adapter, its container intents in memory, and
 * HQ's word, which the device does not read.
 * Plain values, no React Native: the device's adapter is
 * the one the session is stored through.
 */
import type { ZeropsStorageAdapter } from "@t3tools/client-runtime/zerops";
import type { AccountEnvironmentPorts } from "@t3tools/client-runtime/zerops/account/runtime";
import { REGISTRATION_RECORDS_KEY } from "@t3tools/client-runtime/zerops/environments";

/** One account's key: the device's keychain takes letters, digits, `.`, `-` and `_` only. */
const accountKey = (userId: string, key: string): string =>
  `mate.account.${userId.replace(/[^A-Za-z0-9._-]/gu, "_")}.${key}`;

/**
 * The account's records, read once from the device before the account runtime starts and held in
 * memory from then on: the runtime reads them synchronously. Each write is kept in memory at once
 * and stored in order; a device that refuses one leaves it in memory only, so a Mate this app
 * could not remember reconnects on the person's Connect.
 */
export async function loadAccountRecords(
  storage: ZeropsStorageAdapter,
  userId: string,
): Promise<AccountEnvironmentPorts["records"]> {
  const held = new Map<string, string>();
  const stored = await storage.get(accountKey(userId, REGISTRATION_RECORDS_KEY)).catch(() => null);
  if (stored !== null) held.set(REGISTRATION_RECORDS_KEY, stored);
  let writing = Promise.resolve();
  return {
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
      writing = writing
        .then(() => storage.set(accountKey(userId, key), value))
        .catch(() => undefined);
    },
    // One app, one account runtime: nothing else writes them.
    listen: () => () => undefined,
  };
}

/** The account's container intents (C8), kept for as long as the app runs. */
export function memoryIntents(): AccountEnvironmentPorts["intents"] {
  let held: string | null = null;
  return {
    read: () => held,
    write: (value) => {
      held = value;
    },
  };
}

/**
 * HQ as the device sees it: unavailable. The device runs no HQ flow, so HQ's word is never
 * current — no environment's project named, no Mate held online, no organization spoken for —
 * and the runtime reads the listing's containers as it does through any HQ outage.
 */
export function hqUnavailable(): Pick<
  AccountEnvironmentPorts,
  "hqIndex" | "online" | "hqOrganization"
> {
  const quiet = () => () => undefined;
  return {
    hqIndex: { projectOf: () => null, subscribe: quiet },
    online: { read: () => null, subscribe: quiet },
    hqOrganization: { read: () => null, subscribe: quiet },
  };
}
