/**
 * Each Mate's backoff cap, kept across loads (E2E 2026-10-03): until when, wall ms, the background
 * asks its Mate nothing (the exchange driver's `capped`), by target (`projectId:serviceId`), in
 * the account's own storage. Without it every load started each ladder over, and an old Mate whose
 * door answered 500 cost five exchanges in each load's first minute.
 *
 * A cap past its end reads as none and is dropped at the next write. Text that is not its shape,
 * or a storage that refuses, holds no cap: every load starts its ladders over, as before.
 *
 * @module doorCaps
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { KeptSessionStorage } from "@t3tools/client-runtime/zerops/keptSessions";

/** The account-scoped storage key the caps live under. */
export const DOOR_CAPS_KEY = "mate-door-caps.v1";

export interface DoorCaps {
  /** Until when this target's cap holds, wall ms; null when it holds none now. */
  readonly until: (key: string) => number | null;
  /** Keeps the target's cap until `until`, or forgets it. */
  readonly remember: (key: string, until: number | null) => void;
}

const decodeCaps = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number)),
);

export function makeDoorCaps(storage: KeptSessionStorage, nowEpochMs: () => number): DoorCaps {
  /** The caps that have not ended. */
  const load = (): Map<string, number> => {
    let text: string | null;
    try {
      text = storage.getItem(DOOR_CAPS_KEY);
    } catch {
      return new Map();
    }
    const now = nowEpochMs();
    return new Map(
      Object.entries(Option.getOrElse(decodeCaps(text ?? "{}"), () => ({}))).filter(
        ([, until]) => until > now,
      ),
    );
  };
  return {
    until: (key) => load().get(key) ?? null,
    remember: (key, until) => {
      const caps = load();
      if (until === null || until <= nowEpochMs()) caps.delete(key);
      else caps.set(key, until);
      try {
        if (caps.size === 0) storage.removeItem(DOOR_CAPS_KEY);
        else storage.setItem(DOOR_CAPS_KEY, JSON.stringify(Object.fromEntries(caps)));
      } catch {
        // A storage that refuses keeps no cap: the next load starts its ladder over.
      }
    },
  };
}
