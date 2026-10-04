/** Cleanup debt survives a renderer crash, scoped to the account that minted it. */
import type { ZeropsApiClient } from "@t3tools/client-runtime/zerops";
import {
  makeThrowawayDebt,
  throwawayDebt,
  type ThrowawayDebt,
} from "@t3tools/client-runtime/zerops/doorThrowaway";
import { currentAccountId } from "./accountLifetime";

const accounts = new Map<string, ThrowawayDebt>();

export function accountThrowawayDebt(client: Pick<ZeropsApiClient, "session">): ThrowawayDebt {
  const userId = client.session?.userId ?? currentAccountId();
  if (userId === null) return throwawayDebt;
  const held = accounts.get(userId);
  if (held !== undefined) return held;
  // Capture the owner: a delete can finish after another account has signed in.
  const keyOf = (key: string) => `mate:account:${encodeURIComponent(userId)}:${key}`;
  const debt = makeThrowawayDebt({
    getItem: (key) => window.localStorage.getItem(keyOf(key)),
    setItem: (key, value) => window.localStorage.setItem(keyOf(key), value),
    removeItem: (key) => window.localStorage.removeItem(keyOf(key)),
  });
  accounts.set(userId, debt);
  return debt;
}
