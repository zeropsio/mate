/**
 * The Zerops project's name per environment (`zeropsEnvironmentNames`), for
 * anything that must call an environment by name — the draft headline's
 * picker, where six containers would otherwise all be "www". Derived from the
 * candidate listing, so it holds nothing of its own: null while the listing is
 * not known, including after the account that read it closed.
 */
import { useAtomValue } from "@effect/atom-react";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { zeropsEnvironmentNames } from "./environmentNames";
import { candidateListingAtom } from "./useZeropsCandidates";

export const zeropsEnvironmentNamesAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, string> | null => {
    const listing = get(candidateListingAtom);
    return listing.state === "known" ? zeropsEnvironmentNames(heldCandidates(listing).rows) : null;
  },
).pipe(Atom.withLabel("zerops:environment-names"));

export function useZeropsEnvironmentNames(): ReadonlyMap<EnvironmentId, string> | null {
  return useAtomValue(zeropsEnvironmentNamesAtom);
}
