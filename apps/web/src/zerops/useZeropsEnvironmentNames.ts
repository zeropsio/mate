/** The draft picker names Mates from the same HQ directory as its headline. */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { zeropsEnvironmentNames } from "./environmentNames";
import { zeropsMatesAtom } from "./useZeropsMates";

export const zeropsEnvironmentNamesAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, string> | null => {
    const names = zeropsEnvironmentNames(get(zeropsMatesAtom));
    return names.size === 0 ? null : names;
  },
).pipe(Atom.withLabel("zerops:environment-names"));

export function useZeropsEnvironmentNames(): ReadonlyMap<EnvironmentId, string> | null {
  return useAtomValue(zeropsEnvironmentNamesAtom);
}
