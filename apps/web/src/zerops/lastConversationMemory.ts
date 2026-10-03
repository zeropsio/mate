/**
 * The conversation the person had open last, on whichever route, so the home's next cold load
 * guesses its landing by it — the Mate's face, name and opening line, nothing that takes input —
 * while it works out where to land (`homeLanding.logic.ts`). Kept per account, like the Mates'
 * identities, and forgotten when the account closes; a Mate this browser no longer knows is not
 * offered.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";

import { accountLocalStorage, onAccountLifetimeClose } from "./accountLifetime";
import { readHomeLanding, writeHomeLanding } from "./homeLanding.logic";
import { rememberedMateIdentity } from "./mateIdentityMemory";

export const LAST_CONVERSATION_MEMORY_KEY = "mate:zerops:last-conversation";

onAccountLifetimeClose(() => {
  try {
    accountLocalStorage.removeItem(LAST_CONVERSATION_MEMORY_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});

/** The conversation open last, while this browser still knows its Mate. */
export function rememberedLastConversation(): ScopedThreadRef | null {
  let text: string | null = null;
  try {
    text = accountLocalStorage.getItem(LAST_CONVERSATION_MEMORY_KEY);
  } catch {
    return null;
  }
  const ref = readHomeLanding(text);
  if (ref === null || rememberedMateIdentity(ref.environmentId) === undefined) return null;
  return ref;
}

export function rememberLastConversation(ref: ScopedThreadRef): void {
  try {
    accountLocalStorage.setItem(LAST_CONVERSATION_MEMORY_KEY, writeHomeLanding(ref));
  } catch {
    // A full or blocked storage remembers nothing; the home waits with its line instead.
  }
}
