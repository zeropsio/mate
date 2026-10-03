/**
 * The conversation the home (`/`) landed on last, so its next cold load shows that Mate's opening
 * stage while it works out where to land (`homeLanding.logic.ts`). Kept per account, like the
 * Mates' identities, and forgotten when the account closes; a Mate this browser no longer knows is
 * not offered.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";

import { accountLocalStorage, onAccountLifetimeClose } from "./accountLifetime";
import { readHomeLanding, writeHomeLanding } from "./homeLanding.logic";
import { rememberedMateIdentity } from "./mateIdentityMemory";

export const HOME_LANDING_MEMORY_KEY = "mate:zerops:home-landing";

onAccountLifetimeClose(() => {
  try {
    accountLocalStorage.removeItem(HOME_LANDING_MEMORY_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});

/** The conversation the home landed on last, while this browser still knows its Mate. */
export function rememberedHomeLanding(): ScopedThreadRef | null {
  let text: string | null = null;
  try {
    text = accountLocalStorage.getItem(HOME_LANDING_MEMORY_KEY);
  } catch {
    return null;
  }
  const ref = readHomeLanding(text);
  if (ref === null || rememberedMateIdentity(ref.environmentId) === undefined) return null;
  return ref;
}

export function rememberHomeLanding(ref: ScopedThreadRef): void {
  try {
    accountLocalStorage.setItem(HOME_LANDING_MEMORY_KEY, writeHomeLanding(ref));
  } catch {
    // A full or blocked storage remembers nothing; the home waits with its line instead.
  }
}
