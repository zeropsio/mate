/**
 * The read side of `zeropsMatesAtom`: who lives in each connected environment
 * (`mateIdentities.ts`), for the chat header, an empty conversation and a
 * draft's headline. Empty until the candidate list has been read once.
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";

import { zeropsMatesAtom } from "../state/zerops";
import type { ZeropsMateIdentity } from "./mateIdentities";

export function useZeropsMates(): ReadonlyMap<EnvironmentId, ZeropsMateIdentity> {
  return useAtomValue(zeropsMatesAtom);
}
