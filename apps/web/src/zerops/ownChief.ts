/** The personal header reads HQ's Chief record from the shared account data layer. */
import { useAtomValue } from "@effect/atom-react";
import { shownHqMateDirectoryAtom } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import type { HqChiefToken } from "@t3tools/shared/hqStream";
import type { OwnChief } from "./chief";

export const ownChiefAtom = Atom.make((get): OwnChief => {
  const { myChief } = get(shownHqMateDirectoryAtom);
  return myChief.kind === "present"
    ? myChief.projectId
    : myChief.kind === "absent"
      ? null
      : undefined;
});

export function useOwnChief(): OwnChief {
  return useAtomValue(ownChiefAtom);
}

/** Setup and the header share current source evidence; browser memory grants no Chief. */
export const useHqOwnChief = useOwnChief;

/**
 * The personal token HQ keeps for the viewer's own Chief to read with (`chiefToken`); undefined
 * while they have no Chief, or HQ does not say.
 */
export const ownChiefTokenAtom = Atom.make((get): HqChiefToken | undefined => {
  const { myChief } = get(shownHqMateDirectoryAtom);
  return myChief.kind === "present" ? myChief.placement.person?.chiefToken : undefined;
});

export function useOwnChiefToken(): HqChiefToken | undefined {
  return useAtomValue(ownChiefTokenAtom);
}
