/**
 * Who lives in each environment (`mateIdentities.ts`), for the chat header,
 * the timeline, a draft's headline and the Zerops panel. Each answer is a
 * Mate, nobody, or unknown, and a surface renders the unknown one as a
 * placeholder, never as nobody (DESIGN M5).
 *
 * Derived from the candidate listing and the registered environments, with no
 * writer: an environment a known listing row reaches is decided by it; one
 * whose own server runs outside Zerops holds nobody without waiting on the
 * list (`withEnvironmentsOutsideZerops`); every other one — another
 * organization's, or one no row reaches yet — is unknown. It reads the
 * account's registry, which starts over when the account closes.
 */
import { useAtomValue } from "@effect/atom-react";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { zeropsEnvironmentsAtom } from "../state/zerops";
import { registeredZeropsOrigins } from "./environmentOrigins";
import {
  withEnvironmentsOutsideZerops,
  zeropsMateAt,
  zeropsMateDecisions,
  type ZeropsMateAt,
  type ZeropsMateDirectory,
} from "./mateIdentities";
import { candidateListingAtom } from "./useZeropsCandidates";

export const zeropsMatesAtom = Atom.make((get): ZeropsMateDirectory => {
  const environments = get(zeropsEnvironmentsAtom);
  const rows = heldCandidates(get(candidateListingAtom)).rows;
  return withEnvironmentsOutsideZerops(
    zeropsMateDecisions(rows, registeredZeropsOrigins(environments)),
    environments,
  );
}).pipe(Atom.withLabel("zerops:mates"));

/** Every environment's answer, for a surface that names several (a picker). */
export function useZeropsMateDirectory(): ZeropsMateDirectory {
  return useAtomValue(zeropsMatesAtom);
}

export function useZeropsMate(environmentId: EnvironmentId): ZeropsMateAt {
  return zeropsMateAt(useZeropsMateDirectory(), environmentId);
}

/**
 * Whether a Mate lives in `environmentId`: null while that is not known, for
 * a surface that must not guess either way meanwhile.
 */
export function useZeropsMateEnvironment(environmentId: EnvironmentId): boolean | null {
  const mate = useZeropsMate(environmentId);
  return mate.kind === "unknown" ? null : mate.kind === "mate";
}
