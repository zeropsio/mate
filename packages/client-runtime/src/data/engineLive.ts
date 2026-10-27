/**
 * An engine conversation's streamed text, never a fact: the words an item is still being written
 * with, held per item and stream (`text`, `reasoning`, `output`) in memory only, until the item's
 * boundary record arrives and replaces it. Only the leaf drawing a streaming item reads it, so a
 * delta re-renders that one leaf, never a projection. Bounded per item and per conversation;
 * readers hear at most once per coalescing window; a conversation's text goes when it is
 * forgotten, reset or withheld.
 *
 * @module data/engineLive
 */
import type { EngineConversationKey } from "./families/mateEngine.ts";

export interface EngineLivePolicy {
  /** A `text` or `reasoning` stream's budget: its head is held, the record carries the rest. */
  readonly textChars: number;
  /** An `output` stream's budget: its tail is held. */
  readonly outputChars: number;
  readonly itemsPerConversation: number;
  readonly publicationCoalescingMs: number;
}

export const ENGINE_LIVE_POLICY: EngineLivePolicy = {
  textChars: 64 * 1024,
  outputChars: 4 * 1024,
  itemsPerConversation: 8,
  publicationCoalescingMs: 50,
};

interface Stream {
  /** Every code unit the stream has carried, held or not: where the next append must land. */
  length: number;
  text: string;
}

interface Entry {
  readonly conversation: string;
  readonly streams: Map<string, Stream>;
}

export interface EngineLiveText {
  /** The item's stream so far, replacing what was held of it. */
  open(key: EngineConversationKey, itemId: string, stream: string, text: string): void;
  /** More of the item's stream at `offset`; any other offset than its end drops the item's text. */
  append(
    key: EngineConversationKey,
    itemId: string,
    stream: string,
    offset: number,
    text: string,
  ): void;
  /** The item's record is whole: its streamed text goes. */
  settle(key: EngineConversationKey, itemId: string): void;
  /** The conversation's streamed text goes (forgotten, reset, withheld). */
  forget(key: EngineConversationKey): void;
  read(environmentId: string, itemId: string, stream: string): string | null;
  /** Hears the item's text change, at most once per coalescing window. */
  watch(environmentId: string, itemId: string, listener: () => void): () => void;
  close(): void;
}

const itemKey = (environmentId: string, itemId: string) => `${environmentId}\u0000${itemId}`;
const conversationKey = (key: EngineConversationKey) =>
  `${key.environmentId}\u0000${key.conversationId}`;

export function makeEngineLiveText(options: {
  readonly policy: EngineLivePolicy;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}): EngineLiveText {
  const { policy } = options;
  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  const pending = new Set<string>();
  let timer: unknown = null;
  let closed = false;

  const publish = (key: string) => {
    if (!listeners.has(key)) return;
    pending.add(key);
    if (timer !== null) return;
    timer = options.setTimer(() => {
      timer = null;
      const keys = [...pending];
      pending.clear();
      for (const key of keys) for (const listener of [...(listeners.get(key) ?? [])]) listener();
    }, policy.publicationCoalescingMs);
  };

  const drop = (key: string) => {
    if (entries.delete(key)) publish(key);
  };

  const held = (stream: string, text: string) => {
    if (stream === "output")
      return text.length > policy.outputChars ? text.slice(-policy.outputChars) : text;
    return text.length > policy.textChars ? text.slice(0, policy.textChars) : text;
  };

  const entryFor = (key: EngineConversationKey, itemId: string): Entry => {
    const id = itemKey(key.environmentId, itemId);
    const existing = entries.get(id);
    if (existing !== undefined) return existing;
    const conversation = conversationKey(key);
    const siblings = [...entries].filter(([, entry]) => entry.conversation === conversation);
    // Maps keep insertion order: the first sibling is the oldest.
    if (siblings.length >= policy.itemsPerConversation) drop(siblings[0]![0]);
    const entry: Entry = { conversation, streams: new Map() };
    entries.set(id, entry);
    return entry;
  };

  return {
    open(key, itemId, stream, text) {
      if (closed) return;
      entryFor(key, itemId).streams.set(stream, { length: text.length, text: held(stream, text) });
      publish(itemKey(key.environmentId, itemId));
    },
    append(key, itemId, stream, offset, text) {
      if (closed) return;
      const id = itemKey(key.environmentId, itemId);
      const current = entries.get(id)?.streams.get(stream);
      if (current === undefined ? offset !== 0 : offset !== current.length) {
        drop(id);
        return;
      }
      const entry = entryFor(key, itemId);
      const before = current ?? { length: 0, text: "" };
      entry.streams.set(stream, {
        length: before.length + text.length,
        text: held(stream, before.text + text),
      });
      publish(id);
    },
    settle(key, itemId) {
      if (closed) return;
      drop(itemKey(key.environmentId, itemId));
    },
    forget(key) {
      const conversation = conversationKey(key);
      for (const [id, entry] of [...entries]) if (entry.conversation === conversation) drop(id);
    },
    read(environmentId, itemId, stream) {
      return entries.get(itemKey(environmentId, itemId))?.streams.get(stream)?.text ?? null;
    },
    watch(environmentId, itemId, listener) {
      if (closed) return () => {};
      const key = itemKey(environmentId, itemId);
      let set = listeners.get(key);
      if (set === undefined) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        const current = listeners.get(key);
        current?.delete(listener);
        if (current?.size === 0) listeners.delete(key);
      };
    },
    close() {
      closed = true;
      entries.clear();
      listeners.clear();
      pending.clear();
      if (timer !== null) options.clearTimer(timer);
      timer = null;
    },
  };
}
