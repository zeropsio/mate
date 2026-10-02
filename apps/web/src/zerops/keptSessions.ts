/**
 * The account's kept Mate sessions on the web (`keptSessions.ts` in the client runtime), under the
 * account's scoped `localStorage`: the door's exchange presents them again (`environmentPorts.ts`)
 * and the account's close ends them at their Mates (`connection/storage.ts`).
 */
import { makeKeptSessions } from "@t3tools/client-runtime/zerops/keptSessions";

import { accountLocalStorage } from "./accountLifetime";

export const keptSessions = makeKeptSessions(accountLocalStorage, () => Date.now());
