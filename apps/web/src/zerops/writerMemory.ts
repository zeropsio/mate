/**
 * Who wrote in each environment's conversation, as this browser last knew it
 * (`resolveConversationWriter`'s known answers), so a conversation that opens before its agents'
 * sign-in is read paints its footer as it last stood — the composer for the viewer's own, the
 * read-only strip for someone else's — instead of a composer it may take back. Beside the
 * identity memory (`mateIdentityMemory`): kept per account, bounded, and forgotten when the
 * account closes.
 */
import type { RememberedWriter } from "@t3tools/client-runtime/zerops/conversationWriter";
import type { EnvironmentId } from "@t3tools/contracts";

import { accountLocalStorage, currentAccountId, onAccountLifetimeClose } from "./accountLifetime";

export const WRITER_MEMORY_KEY = "mate:zerops:conversation-writers";
/** Environments remembered at most; the one answered longest ago goes first. */
export const WRITER_MEMORY_CAP = 200;

/** Environment → its last known answer, the newest last. */
export type WriterMemory = Readonly<Record<string, RememberedWriter>>;

const ANSWERS: ReadonlySet<string> = new Set<RememberedWriter>(["you", "someone", "nobody-yet"]);

/** The memory with `writer` as the newest answer for `environmentId`, within its cap. */
export function withWriter(
  memory: WriterMemory,
  environmentId: EnvironmentId,
  writer: RememberedWriter,
): WriterMemory {
  const keys = Object.keys(memory);
  if (memory[environmentId] === writer && keys.at(-1) === environmentId) return memory;
  const next: Record<string, RememberedWriter> = { ...memory };
  delete next[environmentId];
  next[environmentId] = writer;
  const kept = Object.keys(next);
  for (const key of kept.slice(0, Math.max(0, kept.length - WRITER_MEMORY_CAP))) delete next[key];
  return next;
}

/** The memory as stored; anything unreadable remembers nothing. */
export function readWriterMemory(text: string | null): WriterMemory {
  if (text === null) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const memory: Record<string, RememberedWriter> = {};
    for (const [environmentId, value] of Object.entries(parsed)) {
      if (typeof value === "string" && ANSWERS.has(value)) {
        memory[environmentId] = value as RememberedWriter;
      }
    }
    return memory;
  } catch {
    return {};
  }
}

export function writeWriterMemory(memory: WriterMemory): string {
  return JSON.stringify(memory);
}

let held: { readonly account: string; memory: WriterMemory } | null = null;
// A closed account's memory is gone with it, like the identity memory.
onAccountLifetimeClose(() => {
  held = null;
  try {
    accountLocalStorage.removeItem(WRITER_MEMORY_KEY);
  } catch {
    // Storage refused: nothing more can be done from here.
  }
});

function memoryNow(): WriterMemory {
  const account = typeof window === "undefined" ? null : currentAccountId();
  if (account === null) return {};
  if (held?.account !== account) {
    let text: string | null = null;
    try {
      text = accountLocalStorage.getItem(WRITER_MEMORY_KEY);
    } catch {
      text = null;
    }
    held = { account, memory: readWriterMemory(text) };
  }
  return held.memory;
}

/** The last known answer for `environmentId` in this browser, for this person. */
export function rememberedWriter(environmentId: EnvironmentId): RememberedWriter | undefined {
  return memoryNow()[environmentId];
}

/** Remembers a known answer, written at once only when it changed something. */
export function rememberWriter(environmentId: EnvironmentId, writer: RememberedWriter): void {
  const before = memoryNow();
  if (held === null) return;
  const next = withWriter(before, environmentId, writer);
  if (next === before) return;
  held.memory = next;
  try {
    accountLocalStorage.setItem(WRITER_MEMORY_KEY, writeWriterMemory(next));
  } catch {
    // A full or blocked storage remembers nothing; the live answer still paints.
  }
}
