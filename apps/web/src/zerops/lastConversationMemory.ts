/**
 * The conversation the person had open last, on whichever route: the home's next cold load guesses
 * its landing by it where nothing better is remembered (`homeGuess`) — the Mate's face, name and
 * opening line, nothing that takes input — while it works out where to land. Kept per account, like the Mates'
 * identities, and forgotten when the account closes; a Mate this browser no longer knows is not
 * offered.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";

import { accountLocalStorage, onAccountLifetimeClose } from "./accountLifetime";
import { homeGuess, readHomeLanding, writeHomeLanding } from "./homeLanding.logic";
import { rememberedMateIdentities } from "./mateIdentityMemory";
import { menuMemory } from "./menuMemory";

export const LAST_CONVERSATION_MEMORY_KEY = "mate:zerops:last-conversation";

onAccountLifetimeClose(() => {
  try {
    accountLocalStorage.removeItem(LAST_CONVERSATION_MEMORY_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});

/** Where the home will land, as this browser remembers it (`homeGuess`). */
export function rememberedHomeLanding(): ScopedThreadRef | null {
  let text: string | null = null;
  try {
    text = accountLocalStorage.getItem(LAST_CONVERSATION_MEMORY_KEY);
  } catch {
    text = null;
  }
  return homeGuess({
    mates: rememberedMateIdentities(),
    rows: menuMemory().rows,
    lastOpen: readHomeLanding(text),
  });
}

export function rememberLastConversation(ref: ScopedThreadRef): void {
  try {
    accountLocalStorage.setItem(LAST_CONVERSATION_MEMORY_KEY, writeHomeLanding(ref));
  } catch {
    // A full or blocked storage remembers nothing; the home waits with its line instead.
  }
}
