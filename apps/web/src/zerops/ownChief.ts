/** The personal header reads HQ's Chief record from the shared account data layer. */
import { useAtomValue } from "@effect/atom-react";
import { shownHqMateDirectoryAtom } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import type { HqChiefToken } from "@t3tools/shared/hqStream";
import { useEffect } from "react";
import type { OwnChief } from "./chief";
import { hqNavigationAtom } from "../state/zerops";
import { forgetOrganizationMemory, readChiefMemory, writeChiefMemory } from "./mateIdentityMemory";
import { useZeropsSessionOptional } from "./sessionContext";

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

/**
 * The Chief the menu's top row paints: HQ's word once it has said, and until then the one the last
 * visit had it say for this organization, so a reload's first frame names the row it will keep.
 * A remembered Chief is a label only: it offers no setup, opens nothing of its own and grants
 * nothing (`useHqOwnChief` stays the evidence).
 *
 * It is written under the organization the data account answered for (HQ's navigation says whose
 * it is, read from the same account as the Chief), never
 * the session's: on a switch the session moves a commit before the data does, and the previous
 * organization's Chief would be stored under the new one. An organization HQ refuses is forgotten.
 */
export function usePaintedOwnChief(): OwnChief {
  const own = useOwnChief();
  const answered = useAtomValue(hqNavigationAtom, (navigation) => navigation.orgId);
  const shown = useZeropsSessionOptional()?.activeOrganization?.id;
  const refused = useAtomValue(hqNavigationAtom, (navigation) => navigation.refusal !== null);
  useEffect(() => {
    if (answered === null) return;
    if (refused) forgetOrganizationMemory(answered);
    else if (own !== undefined) writeChiefMemory(answered, own);
  }, [answered, own, refused]);
  // The data account is this organization's and has said: its word. Otherwise memory's, for the
  // organization the session shows.
  if (shown === undefined) return own;
  if (answered === shown && own !== undefined) return own;
  return readChiefMemory(shown);
}
