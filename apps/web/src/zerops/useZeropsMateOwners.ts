/**
 * Whose each Mate is, and who a surface names, as HQ names them.
 *
 * A Mate's owner is HQ's (`hqProjectPeople`): HQ decides who owns it and sends their name and
 * picture, so a load reads no member list for "Jan's Mate — you have Read access" (D5). Whoever else a
 * surface names — a login's signer, a remark's author — HQ's people name too. Somebody HQ names no
 * record of goes without a name, and a face without a badge.
 */

import { useAtomValue } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  shownHqProjectPeopleAtom,
  hqProjectPersonAtom,
  type HqMateOwner,
  type HqProjectPeople,
} from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { shareEqual } from "@t3tools/shared/structuralSharing";
import { useCallback } from "react";

import { zeropsInitials } from "~/components/zerops/landing/ZeropsAccountControl.logic";

import { hqNavigationAtom, hqPeopleAtom } from "../state/zerops";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** A Mate's owner, as a face in the corner of the Mate's own draws them. */
export interface ZeropsMateOwner {
  readonly name: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
  /** The owner is the person looking: "You asked", and *Mine* keeps this Mate. */
  readonly isViewer: boolean;
}

/**
 * Somebody of the organization `clientId` by their Zerops user id, by name — a login's signer, a
 * remark's author — as HQ's people name them for the organization in view; its last word stands
 * while HQ does not answer. Nobody of another organization.
 */
export function useHqPersonNames(
  clientId: string | undefined,
): (userId: string) => string | undefined {
  const navigation = useAtomValue(hqNavigationAtom);
  const people = useAtomValue(hqPeopleAtom);
  const shown = clientId !== undefined && navigation.orgId === clientId;
  return useCallback(
    (userId: string) => (shown ? people?.[userId]?.name : undefined),
    [people, shown],
  );
}

/**
 * A Mate's owner as HQ names them (`HqMateOwner`), as a face in the corner of the Mate's own draws
 * them: their name and its initials, and the platform's picture of them HQ sends.
 */
export function zeropsMateOwnerOf(
  owner: HqMateOwner | null | undefined,
  viewerUserId?: string | null,
): ZeropsMateOwner | undefined {
  if (owner === null || owner === undefined) return undefined;
  return {
    name: owner.name,
    initials: zeropsInitials(owner.name),
    avatarUrl: owner.avatarUrl ?? null,
    isViewer: viewerUserId !== undefined && viewerUserId !== null && owner.userId === viewerUserId,
  };
}

const mateOwnersAtom = Atom.make((get) =>
  Object.fromEntries(
    Object.entries(get(shownHqProjectPeopleAtom)).map(([id, person]) => [id, person.owner]),
  ),
).pipe(Atom.withEquality((a, b) => shareEqual(a, b) === a));
const matesWaitOnViewerAtom = Atom.make((get) =>
  Object.fromEntries(
    Object.entries(get(shownHqProjectPeopleAtom)).map(([id, person]) => [
      id,
      person.waitsOnViewer === true,
    ]),
  ),
).pipe(Atom.withEquality((a, b) => shareEqual(a, b) === a));

/** Each Mate's owner, for the organization shown, as HQ names them (`hqProjectPeople`). */
export function useZeropsMateOwners(): (candidate: ZeropsCandidate) => ZeropsMateOwner | undefined {
  const { user } = useZeropsSession();
  const owners = useAtomValue(mateOwnersAtom);
  const viewerUserId = user?.id;
  return useCallback(
    (candidate: ZeropsCandidate) => zeropsMateOwnerOf(owners[candidate.project.id], viewerUserId),
    [owners, viewerUserId],
  );
}

/**
 * Whether a project's Mate waits on the viewer, by its id, as HQ says it (`waitsOnViewer`): they
 * signed its agent in. Only what one's own Mate waits on waits on them — its question, its
 * change's review; a colleague's waits on its owner. Nobody's, before HQ says.
 */
export function useWaitsOnViewer(): (projectId: string) => boolean {
  const waits = useAtomValue(matesWaitOnViewerAtom);
  return useCallback((projectId: string) => waits[projectId] === true, [waits]);
}

/**
 * What HQ computed of the reader for a project, by its id (`hqProjectPeople`): whether it names an
 * owner, who ever signed its agents in; `undefined` while HQ has not said of the project.
 */
export function useHqProjectPeopleOf(): (projectId: string) => HqProjectPeople | undefined {
  const people = useAtomValue(shownHqProjectPeopleAtom);
  return useCallback((projectId: string) => people[projectId], [people]);
}

/** A row's own owner/login facts: other projects cannot invalidate it. */
export function useHqProjectPerson(projectId: string): HqProjectPeople | undefined {
  return useAtomValue(hqProjectPersonAtom(projectId));
}
