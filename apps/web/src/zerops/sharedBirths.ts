import {
  birthPresentation,
  sharedBirthsAtom,
  type MateComing,
  type SharedBirth,
  type SharedBirthState,
} from "@t3tools/client-runtime/data";
import { readMateFace, type ZeropsPlacedBirth } from "@t3tools/client-runtime/zerops";
import { useAtomValue } from "@effect/atom-react";
import { useZeropsSession } from "./ZeropsSessionProvider";

export { birthPresentation as sharedBirthPresentation } from "@t3tools/client-runtime/data";

/**
 * A Mate's coming while HQ's birth of it is open, from the press to its hello, as its listed row
 * says it: the birth's row line and HQ's clock of it (`startedAt`, when HQ accepted its
 * operation) — never a clock of the tab that pressed, so every device draws one line and one time.
 */
export function comingOfBirth(birth: SharedBirth): MateComing {
  const shown = birthPresentation(birth);
  return {
    kind: "coming",
    line: shown.row,
    birth: { attention: shown.attention, ...(shown.waitsOnMaker ? { waitsOnMaker: true } : {}) },
    since: birth.startedAt,
  };
}

/** The organization's births, proven by the account data layer for this person. */
export function useSharedBirthState(): SharedBirthState {
  const { user } = useZeropsSession();
  return useAtomValue(sharedBirthsAtom(user?.id ?? ""));
}

export function useSharedBirths(): ReadonlyArray<SharedBirth> {
  return useSharedBirthState().open;
}

/** A person's Chief remains visible during its shared birth, including after a reload. */
export function useOwnChiefBirth(): SharedBirth | undefined {
  const { user } = useZeropsSession();
  const { open } = useSharedBirthState();
  return user == null
    ? undefined
    : open.find((birth) => birth.chief === true && birth.madeBy === user.id);
}

/** Where a shared birth's Mate is drawn: its application, its kind, its name and face. */
export function birthPlacement(birth: SharedBirth): ZeropsPlacedBirth["placement"] {
  const face = readMateFace(birth.face);
  return {
    groupId: birth.appId,
    groupName: birth.appName,
    kind:
      birth.intent?.placement.role === "stage" || birth.intent?.placement.role === "devstage"
        ? "devstage"
        : "mate",
    displayName: birth.intent?.placement.name ?? "Mate",
    ...(face?.tint === undefined || face.shape === undefined
      ? {}
      : { face: { tint: face.tint, shape: face.shape } }),
  };
}
