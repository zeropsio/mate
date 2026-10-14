/** The personal header reads HQ's Chief record from the shared account data layer. */
import { useAtomValue } from "@effect/atom-react";
import { shownHqMateDirectoryAtom } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
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
