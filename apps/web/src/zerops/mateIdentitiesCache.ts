/**
 * Who lived where the last time the candidate list was read, kept in local
 * storage so a reload's first frame already knows a Mate's conversation from
 * anyone else's: the header names Fen, the git toolbar stays away, nothing is
 * painted that the list, half a second later, replaces. The fresh list always
 * overwrites; an entry for an environment that is gone is never asked for.
 */
import { EnvironmentId } from "@t3tools/contracts";
import { MATE_TINT_IDS } from "@t3tools/shared/brand";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import type { ZeropsMateIdentity } from "./mateIdentities";

export const ZEROPS_MATES_STORAGE_KEY = "zerops:mates";

const CachedZeropsMates = Schema.Record(
  Schema.String,
  Schema.Struct({
    name: Schema.String,
    tint: Schema.Literals(MATE_TINT_IDS),
    project: Schema.optional(Schema.String),
    projectUrl: Schema.String,
  }),
);

export function readCachedZeropsMates(): ReadonlyMap<EnvironmentId, ZeropsMateIdentity> | null {
  let cached: typeof CachedZeropsMates.Type | null;
  try {
    cached = getLocalStorageItem(ZEROPS_MATES_STORAGE_KEY, CachedZeropsMates);
  } catch {
    return null;
  }
  if (cached === null) return null;
  const mates = new Map<EnvironmentId, ZeropsMateIdentity>();
  for (const [environmentId, mate] of Object.entries(cached)) {
    mates.set(EnvironmentId.make(environmentId), {
      name: mate.name,
      tint: mate.tint,
      project: mate.project,
      projectUrl: mate.projectUrl,
      // A remembered Mate is remembered from another session: its container is
      // not connected until this one's socket registers, and a face drawn from
      // the cache says so by sleeping.
      connected: false,
    });
  }
  return mates;
}

export function writeCachedZeropsMates(
  mates: ReadonlyMap<EnvironmentId, ZeropsMateIdentity>,
): void {
  const cached: Record<string, (typeof CachedZeropsMates.Type)[string]> = {};
  for (const [environmentId, mate] of mates) {
    cached[environmentId] = {
      name: mate.name,
      tint: mate.tint,
      projectUrl: mate.projectUrl,
      ...(mate.project === undefined ? {} : { project: mate.project }),
    };
  }
  try {
    setLocalStorageItem(ZEROPS_MATES_STORAGE_KEY, cached, CachedZeropsMates);
  } catch {
    // Storage full or unavailable: the next reload learns the slow way.
  }
}
