/**
 * The read side of `zeropsMatesAtom`: who lives in each connected environment
 * (`mateIdentities.ts`), for the chat header, an empty conversation and a
 * draft's headline. Empty until the candidate list has been read once;
 * `useZeropsMateEnvironment` tells "not yet known" apart from "nobody".
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { zeropsMatesAtom } from "../state/zerops";
import type { ZeropsMateIdentity } from "./mateIdentities";

const NO_MATES: ReadonlyMap<EnvironmentId, ZeropsMateIdentity> = new Map();

export function useZeropsMates(): ReadonlyMap<EnvironmentId, ZeropsMateIdentity> {
  return useAtomValue(zeropsMatesAtom) ?? NO_MATES;
}

/**
 * Whether a Mate lives in `environmentId`: null while the candidate list is
 * still being read, for a surface that must not guess either way meanwhile.
 */
export function useZeropsMateEnvironment(environmentId: EnvironmentId): boolean | null {
  const mates = useAtomValue(zeropsMatesAtom);
  return mates === null ? null : mates.has(environmentId);
}
