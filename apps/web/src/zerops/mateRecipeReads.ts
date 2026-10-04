/**
 * The Mate tier of an application's recipe, read on its own from HQ as the person
 * (`HqApi.mateRecipe`), where HQ's stream cannot be acted on for it: a Core from before its
 * stream carried the tier, or one that could not read it, and any Core while its stream is down
 * (`useZeropsGroupRecipe`).
 *
 * One read per demand: when the first reader comes — the New Mate dialog opening — and on *Try
 * again*, never on a clock, and never while the tab is hidden (`whenShown`). What the last read
 * said stays to be said while the next one is on its way; only an answer read for the readers
 * there now is `fresh`, and only a fresh one is acted on.
 */
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import { useCallback, useSyncExternalStore } from "react";

import { onAccountLifetimeClose } from "./accountLifetime";
import { whenShown } from "./whenShown";

/** What the last read answered: the tier as `main` holds it, or that it could not be read. */
export type MateRecipeAnswer =
  | { readonly kind: "read"; readonly tier: RecipeTierResponse }
  | { readonly kind: "failed" };

export interface MateRecipeRead {
  readonly last: MateRecipeAnswer | undefined;
  /** `last` was read for the readers there now: what may be acted on. */
  readonly fresh: boolean;
  /** A read is on its way, or waits for the tab to be shown. */
  readonly reading: boolean;
}

/** Reads the tier, as the person, for whoever asks. */
export type ReadMateRecipe = (signal: AbortSignal) => Promise<RecipeTierResponse>;

interface Entry {
  read: MateRecipeRead;
  readonly listeners: Set<() => void>;
  reader: ReadMateRecipe;
  stop: (() => void) | undefined;
}

const NOTHING: MateRecipeRead = { last: undefined, fresh: false, reading: false };
const entries = new Map<string, Entry>();

function entryAt(key: string, reader: ReadMateRecipe): Entry {
  let entry = entries.get(key);
  if (entry === undefined) {
    entry = { read: NOTHING, listeners: new Set(), reader, stop: undefined };
    entries.set(key, entry);
  }
  entry.reader = reader;
  return entry;
}

function settle(entry: Entry, read: MateRecipeRead): void {
  entry.read = read;
  for (const listener of entry.listeners) listener();
}

function halt(entry: Entry): void {
  entry.stop?.();
  entry.stop = undefined;
}

/** Reads it anew: what was read before stays said, and is no longer acted on. */
function readAnew(entry: Entry): void {
  halt(entry);
  settle(entry, { last: entry.read.last, fresh: false, reading: true });
  const controller = new AbortController();
  const unwait = whenShown(() => {
    void entry.reader(controller.signal).then(
      (tier) => {
        if (!controller.signal.aborted)
          settle(entry, { last: { kind: "read", tier }, fresh: true, reading: false });
      },
      () => {
        if (!controller.signal.aborted)
          settle(entry, { last: { kind: "failed" }, fresh: true, reading: false });
      },
    );
  });
  entry.stop = () => {
    unwait();
    controller.abort();
  };
}

/** Reads the application's Mate tier again: *Try again*. */
export function rereadMateRecipe(key: string): void {
  const entry = entries.get(key);
  if (entry !== undefined && entry.listeners.size > 0) readAnew(entry);
}

/**
 * The Mate tier under `key` (its HQ and application), read once per demand while `key` is set:
 * `undefined` asks nothing.
 */
export function useMateRecipeRead(
  key: string | undefined,
  reader: ReadMateRecipe | undefined,
): MateRecipeRead {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (key === undefined || reader === undefined) return () => undefined;
      const entry = entryAt(key, reader);
      entry.listeners.add(listener);
      if (entry.listeners.size === 1) readAnew(entry);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size > 0) return;
        halt(entry);
        entry.read = { last: entry.read.last, fresh: false, reading: false };
      };
    },
    [key, reader],
  );
  const snapshot = useCallback(
    () => (key === undefined ? NOTHING : (entries.get(key)?.read ?? NOTHING)),
    [key],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

onAccountLifetimeClose(() => {
  for (const entry of entries.values()) halt(entry);
  entries.clear();
});
