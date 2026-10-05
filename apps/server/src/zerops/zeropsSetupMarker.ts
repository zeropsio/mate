/**
 * Whether the new press made this Mate, and so whether its server stands it
 * up: the press always sets the tier's runtimes plan on zcp
 * (`MATE_SETUP_RUNTIMES`), empty or not; a Mate made before carries none.
 *
 * Read off this process's environment and the platform's live env store
 * (`/etc/zerops-zembed/env.json`, rewritten seconds after a service variable
 * changes, no restart): local reads, never a Zerops call.
 *
 * @module zeropsSetupMarker
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { MATE_LIVE_ENV_STORE_PATH } from "./ZeropsMateKey.ts";

export const SETUP_MARKER_VARIABLE = "MATE_SETUP_RUNTIMES";

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The zcp service's variable names as they stand now: this process's, and the live store's. */
export const readServiceVariableKeys = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const store = yield* fs.readFileString(MATE_LIVE_ENV_STORE_PATH).pipe(
    Effect.map(parseJson),
    Effect.catch(() => Effect.succeed(undefined)),
  );
  return [
    ...Object.keys(process.env),
    ...(typeof store === "object" && store !== null && !Array.isArray(store)
      ? Object.keys(store)
      : []),
  ];
});

export const hasSetupMarker = (keys: ReadonlyArray<string>): boolean =>
  keys.includes(SETUP_MARKER_VARIABLE);
