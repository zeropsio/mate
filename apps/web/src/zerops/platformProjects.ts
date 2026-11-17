/**
 * The organization's projects only Platform holds — imported or made at app.zerops.io, never
 * through Mate — and whether the left menu lists them, as this browser remembers it beside *Mine*
 * / *Everyone*. A zcp container in one does not make it a Mate: HQ holds no record of it. Hidden,
 * the menu leaves them out; shown, each is a plain row to its page in Platform, without a face.
 */
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { hqPlacementsAtom } from "../state/zerops";

/** HQ's placements are read: only then does a project without one say HQ places it nowhere. */
export const hqPlacementKnownAtom = Atom.make((get) => get(hqPlacementsAtom) !== null);

export const PLATFORM_PROJECTS_STORAGE_KEY = "mate:zerops:platform-projects";
export const PlatformProjectsSchema = Schema.Literals(["hidden", "shown"]);
export type PlatformProjects = typeof PlatformProjectsSchema.Type;

export function usePlatformProjects(): readonly [
  PlatformProjects,
  (next: PlatformProjects) => void,
] {
  return useLocalStorage(PLATFORM_PROJECTS_STORAGE_KEY, "hidden", PlatformProjectsSchema);
}

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
