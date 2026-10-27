/**
 * The Mates whose notifications this viewer turned off, by environment — a
 * Mate is one environment, and the notification coordinator speaks per
 * environment. Kept in this browser, under the signed-in account's key, like
 * the project order: a per-viewer convenience, never sent anywhere, so a
 * mute on one device leaves the others ringing.
 */
import * as Schema from "effect/Schema";
import { useCallback } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";

export const MUTED_MATES_STORAGE_KEY = "mate:zerops:muted-mates";
export const MutedMatesSchema = Schema.Array(Schema.String);

const NOBODY_MUTED: ReadonlyArray<string> = [];

/** `muted` with `environmentId` muted if it was not, and unmuted if it was. */
export function withMuteToggled(
  muted: ReadonlyArray<string>,
  environmentId: string,
): ReadonlyArray<string> {
  return muted.includes(environmentId)
    ? muted.filter((entry) => entry !== environmentId)
    : [...muted, environmentId];
}

export function useMutedMates(): {
  readonly muted: ReadonlyArray<string>;
  readonly toggle: (environmentId: string) => void;
} {
  const [muted, setMuted] = useLocalStorage(
    MUTED_MATES_STORAGE_KEY,
    NOBODY_MUTED,
    MutedMatesSchema,
  );
  const toggle = useCallback(
    (environmentId: string) => {
      setMuted((current) => [...withMuteToggled(current, environmentId)]);
    },
    [setMuted],
  );
  return { muted, toggle };
}
