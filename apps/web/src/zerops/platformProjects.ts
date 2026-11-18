/**
 * The organization's projects only Platform holds — imported or made at app.zerops.io, never
 * through Mate. A zcp container in one does not make it a Mate: HQ holds no record of it, and the
 * left menu leaves them out.
 */
import { Atom } from "effect/reactivity";

import { hqPlacementsAtom } from "../state/zerops";

/** HQ's placements are read: only then does a project without one say HQ places it nowhere. */
export const hqPlacementKnownAtom = Atom.make((get) => get(hqPlacementsAtom) !== null);

/**
 * A project only Platform holds: HQ's structure is read and places it nowhere, as a Mate or
 * otherwise. While HQ's word is unread every project looks unplaced, so none is one then; and the
 * project whose conversation is open is never one.
 */
export function isPlatformProject(
  project: { readonly hq?: unknown },
  input: { readonly placementKnown: boolean; readonly active: boolean },
): boolean {
  return input.placementKnown && project.hq === undefined && !input.active;
}
