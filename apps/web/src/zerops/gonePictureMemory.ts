/**
 * The result pictures each conversation found gone — a file the server says is not there —
 * remembered in this browser, so a reload never paints a tile and then takes it back: the result
 * leaves a remembered one out before its read answers (`TurnReport`). One that loads again is
 * forgotten.
 *
 * Kept per account and per conversation, like the composer top's memory (`composerTopMemory.ts`),
 * and forgotten when the account closes: it names files in the Mate's workspace.
 */
import * as Schema from "effect/Schema";

import { accountLocalStorage, currentAccountId, onAccountLifetimeClose } from "./accountLifetime";

export const GONE_PICTURE_MEMORY_STORAGE_KEY = "mate:zerops:gone-picture-memory";

/** How many conversations are kept; the least recently changed go first. */
export const GONE_PICTURE_MEMORY_THREADS = 64;
/** How many paths a conversation keeps; the oldest go first. */
export const GONE_PICTURE_MEMORY_PATHS = 64;

const MemorySchema = Schema.Record(Schema.String, Schema.Array(Schema.String));

export type GonePictureMemory = typeof MemorySchema.Type;

/** `memory` with `path` of `threadKey` remembered as gone, or forgotten where it loads again. */
export function withGonePicture(
  memory: GonePictureMemory,
  threadKey: string,
  path: string,
  gone: boolean,
): GonePictureMemory {
  const current = memory[threadKey] ?? [];
  if (current.includes(path) === gone) return memory;
  const paths = gone
    ? [...current, path].slice(-GONE_PICTURE_MEMORY_PATHS)
    : current.filter((entry) => entry !== path);
  const next: Record<string, ReadonlyArray<string>> = {};
  for (const [key, value] of Object.entries(memory)) {
    if (key !== threadKey) next[key] = value;
  }
  if (paths.length > 0) next[threadKey] = paths;
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - GONE_PICTURE_MEMORY_THREADS))) {
    delete next[key];
  }
  return next;
}

const readMemory = Schema.decodeUnknownSync(Schema.fromJsonString(MemorySchema));
const writeMemory = Schema.encodeSync(Schema.fromJsonString(MemorySchema));

const EMPTY: GonePictureMemory = {};
const NONE: ReadonlySet<string> = new Set();

let held: { readonly account: string; memory: GonePictureMemory } | null = null;
let writing: ReturnType<typeof setTimeout> | null = null;

function readStored(): GonePictureMemory {
  try {
    const stored = accountLocalStorage.getItem(GONE_PICTURE_MEMORY_STORAGE_KEY);
    return stored === null ? EMPTY : readMemory(stored);
  } catch {
    // Unreadable, or from a shape before this one: nothing remembered.
    return EMPTY;
  }
}

function gonePictureMemory(): GonePictureMemory {
  const account = typeof window === "undefined" ? null : currentAccountId();
  if (account === null) return EMPTY;
  if (held?.account !== account) held = { account, memory: readStored() };
  return held.memory;
}

/** The result pictures this conversation found gone, for the account signed in now. */
export function rememberedGonePictures(threadKey: string): ReadonlySet<string> {
  const paths = gonePictureMemory()[threadKey];
  return paths === undefined ? NONE : new Set(paths);
}

/** Remembers `path` of `threadKey` as gone, or forgets it; written once the page settles a moment. */
export function rememberGonePicture(threadKey: string, path: string, gone: boolean): void {
  const before = gonePictureMemory();
  if (held === null) return;
  const next = withGonePicture(before, threadKey, path, gone);
  if (next === before) return;
  held.memory = next;
  if (writing !== null) clearTimeout(writing);
  writing = setTimeout(() => {
    writing = null;
    try {
      if (held !== null) {
        accountLocalStorage.setItem(GONE_PICTURE_MEMORY_STORAGE_KEY, writeMemory(held.memory));
      }
    } catch {
      // A full or blocked storage keeps nothing: the next reload reads each picture again.
    }
  }, 400);
}

// A closed account's memory is gone with it: it names its files.
onAccountLifetimeClose(() => {
  if (writing !== null) clearTimeout(writing);
  writing = null;
  held = null;
  try {
    accountLocalStorage.removeItem(GONE_PICTURE_MEMORY_STORAGE_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});
