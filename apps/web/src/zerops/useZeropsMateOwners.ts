/**
 * Whose each Mate is, and who a surface names.
 *
 * A Mate's owner is HQ's (`hqProjectPeople`): HQ decides who owns it and names them by Zerops user
 * id; the organization's member list, read with the viewer's own token, names and pictures them.
 * Whoever else a surface names — a login's signer, a remark's author — the member list names too.
 * Somebody it does not hold goes without a name, and a face without a badge.
 */

import { useAtomValue } from "@effect/atom-react";
import { zeropsUserIdOf } from "@t3tools/contracts";
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

import {
  zeropsAccountDisplay,
  zeropsInitials,
} from "~/components/zerops/landing/ZeropsAccountControl.logic";

import { hqNavigationAtom, hqPeopleAtom } from "../state/zerops";

type ZeropsAccountSource = Parameters<typeof zeropsAccountDisplay>[0] & object;
import { useZeropsSessionOptional } from "./sessionContext";
import { useZeropsSession } from "./ZeropsSessionProvider";

/** A Mate's owner, as a face in the corner of the Mate's own draws them. */
export interface ZeropsMateOwner {
  readonly name: string;
  /** What every surface calls them (`HqMateOwner.called`). */
  readonly called: string;
  readonly initials: string;
  readonly avatarUrl: string | null;
  /** The owner is the person looking: "You asked", and *Mine* keeps this Mate. */
  readonly isViewer: boolean;
}

/**
 * Somebody of the organization `clientId` by their Zerops user id, by what every surface calls them
 * (`ZeropsPerson.called`) — a login's signer, a remark's author — as the member list of the
 * organization in view names them; its last answer stands while Zerops does not answer. Nobody of
 * another organization.
 */
export function useHqPersonNames(
  clientId: string | undefined,
): (userId: string) => string | undefined {
  const navigation = useAtomValue(hqNavigationAtom);
  const people = useAtomValue(hqPeopleAtom);
  const shown = clientId !== undefined && navigation.orgId === clientId;
  return useCallback(
    (userId: string) => (shown ? people?.[userId]?.called : undefined),
    [people, shown],
  );
}

/**
 * Who a record names by their Zerops user id, or by the subject the engine records a person's
 * answer under: as the member list calls them, and the person looking by their own account where
 * the list does not hold them.
 */
export function personNameOf(
  subject: string,
  viewer: (ZeropsAccountSource & { readonly id?: string }) | null | undefined,
  people: (userId: string) => string | undefined,
): string | undefined {
  const userId = zeropsUserIdOf(subject);
  return people(userId) ?? (viewer?.id === userId ? zeropsAccountDisplay(viewer).name : undefined);
}

/**
 * What every surface calls the person looking (`ZeropsPerson.called`), as the member list of the
 * organization in view holds them; `undefined` while it does not.
 */
export function useViewerCalled(): string | undefined {
  const viewerId = useZeropsSessionOptional()?.user?.id;
  const people = useAtomValue(hqPeopleAtom);
  return viewerId === undefined ? undefined : people?.[viewerId]?.called;
}

/** `personNameOf` for the organization `clientId`, as a surface names who answered its ask. */
export function usePersonNames(
  clientId: string | undefined,
): (userId: string) => string | undefined {
  const people = useHqPersonNames(clientId);
  const viewer = useZeropsSessionOptional()?.user;
  return useCallback((subject: string) => personNameOf(subject, viewer, people), [people, viewer]);
}

/**
 * A Mate's owner (`HqMateOwner`), as a face in the corner of the Mate's own draws them: their name
 * and its initials, and the platform's picture of them.
 */
export function zeropsMateOwnerOf(
  owner: HqMateOwner | null | undefined,
  viewerUserId?: string | null,
): ZeropsMateOwner | undefined {
  if (owner === null || owner === undefined) return undefined;
  return {
    name: owner.name,
    called: owner.called,
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
