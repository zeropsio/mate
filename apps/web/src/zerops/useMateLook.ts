import { useAtomValue } from "@effect/atom-react";
import { shownHqMateIdentitiesAtom } from "@t3tools/client-runtime/data";

/** A Mate's face and hue as the menu wears them; a neutral one where this account names none. */
export function useMateLook(projectId: string) {
  const identity = useAtomValue(shownHqMateIdentitiesAtom)[projectId];
  return {
    tint: identity?.tint ?? "slate",
    ...(identity === undefined ? {} : { shape: identity.shape }),
  };
}
