/**
 * What each conversation's composer top last showed — its Mate's change,
 * waiting for the person's review — remembered in this browser, so a reload
 * paints the composer as it stood. Without it the strip arrived with HQ's
 * answer, seconds after the page had settled, and the composer grew under a
 * conversation pinned to its end, taking back 61 px the reload had painted
 * (the owner: "a reload paints nothing it takes back"). HQ's answer
 * confirms what is remembered, updates its words, or takes it away.
 *
 * Kept per account and per conversation, and forgotten when the account closes: it quotes a
 * change's title.
 */
import { MATE_SHAPE_IDS, MATE_TINT_IDS } from "@t3tools/shared/brand";
import * as Schema from "effect/Schema";

import { accountLocalStorage, currentAccountId, onAccountLifetimeClose } from "./accountLifetime";

export const COMPOSER_TOP_MEMORY_STORAGE_KEY = "mate:zerops:composer-top-memory";

/** How many conversations' tops are kept; the least recently shown go first. */
export const COMPOSER_TOP_MEMORY_THREADS = 64;

const StripSchema = Schema.Struct({
  groupId: Schema.String,
  repository: Schema.String,
  number: Schema.Number,
  /** The change's own title. */
  title: Schema.String,
  /** What the strip said of it: `Nova is waiting for your review of #2`. */
  words: Schema.String,
  tint: Schema.Literals(MATE_TINT_IDS),
  /** The shape its person picked; absent from a memory kept before a face could be picked. */
  shape: Schema.optionalKey(Schema.Literals(MATE_SHAPE_IDS)),
  /** Where more than one change waits, the lines it listed: `apidev #1 Rebuild the API`. */
  lines: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({ repository: Schema.String, number: Schema.Number, label: Schema.String }),
    ),
  ),
  /** How many more waited past the lines. */
  more: Schema.optionalKey(Schema.Number),
  /** The person put the strip away: it stays away until another change waits. */
  dismissed: Schema.optionalKey(Schema.Literal(true)),
});

const MemorySchema = Schema.Record(Schema.String, StripSchema);

export type RememberedComposerTop = typeof StripSchema.Type;
export type ComposerTopMemory = typeof MemorySchema.Type;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `memory` with `threadKey`'s top as shown now — `null` when nothing waits —
 * and at most {@link COMPOSER_TOP_MEMORY_THREADS} conversations, the one just
 * shown last.
 */
export function withComposerTop(
  memory: ComposerTopMemory,
  threadKey: string,
  top: RememberedComposerTop | null,
): ComposerTopMemory {
  const current = memory[threadKey];
  if (top === null ? current === undefined : current !== undefined && same(current, top)) {
    return memory;
  }
  const next: Record<string, RememberedComposerTop> = {};
  for (const [key, value] of Object.entries(memory)) {
    if (key !== threadKey) next[key] = value;
  }
  if (top !== null) next[threadKey] = top;
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - COMPOSER_TOP_MEMORY_THREADS))) {
    delete next[key];
  }
  return next;
}

const readMemory = Schema.decodeUnknownSync(Schema.fromJsonString(MemorySchema));
const writeMemory = Schema.encodeSync(Schema.fromJsonString(MemorySchema));

const EMPTY: ComposerTopMemory = {};

let held: { readonly account: string; memory: ComposerTopMemory } | null = null;
let writing: ReturnType<typeof setTimeout> | null = null;

function readStored(): ComposerTopMemory {
  try {
    const stored = accountLocalStorage.getItem(COMPOSER_TOP_MEMORY_STORAGE_KEY);
    return stored === null ? EMPTY : readMemory(stored);
  } catch {
    // Unreadable, or from a shape before this one: nothing remembered.
    return EMPTY;
  }
}

function composerTopMemory(): ComposerTopMemory {
  const account = typeof window === "undefined" ? null : currentAccountId();
  if (account === null) return EMPTY;
  if (held?.account !== account) held = { account, memory: readStored() };
  return held.memory;
}

/** What this conversation's composer top showed last, for the account signed in now. */
export function rememberedComposerTop(threadKey: string): RememberedComposerTop | undefined {
  return composerTopMemory()[threadKey];
}

/** Remembers `threadKey`'s top as shown now, written once the page settles a moment. */
export function rememberComposerTop(threadKey: string, top: RememberedComposerTop | null): void {
  const before = composerTopMemory();
  if (held === null) return;
  const next = withComposerTop(before, threadKey, top);
  if (next === before) return;
  held.memory = next;
  if (writing !== null) clearTimeout(writing);
  writing = setTimeout(() => {
    writing = null;
    try {
      if (held !== null) {
        accountLocalStorage.setItem(COMPOSER_TOP_MEMORY_STORAGE_KEY, writeMemory(held.memory));
      }
    } catch {
      // A full or blocked storage keeps nothing: the next reload grows the strip as before.
    }
  }, 400);
}

// A closed account's memory is gone with it: it quotes its changes.
onAccountLifetimeClose(() => {
  if (writing !== null) clearTimeout(writing);
  writing = null;
  held = null;
  try {
    accountLocalStorage.removeItem(COMPOSER_TOP_MEMORY_STORAGE_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});
