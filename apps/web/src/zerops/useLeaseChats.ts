/**
 * The chats of one Mate's environment that are bound to a pool lease, each with its title: a dev
 * pool's workspace on the service map goes by the chat working in it (`poolWorkspaces`). Unarchived
 * chats only, and the answer keeps one value while their titles and bindings stay the same, so a
 * streamed turn redraws nothing.
 */
import { useAtomValue } from "@effect/atom-react";
import type { LeaseChat } from "@t3tools/client-runtime/zerops/serviceMap";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { sameValue } from "../lib/sameValue";
import { environmentThreadShells } from "../state/threads";

const NO_CHATS: ReadonlyArray<LeaseChat> = Object.freeze([]);

const NO_CHATS_ATOM = Atom.make(NO_CHATS).pipe(Atom.withLabel("zerops:lease-chats:none"));

const leaseChatsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<LeaseChat> =>
    get(environmentThreadShells.threadShellsAtom).flatMap((shell) =>
      shell.environmentId !== environmentId ||
      shell.archivedAt !== null ||
      shell.lease === null ||
      shell.lease === undefined
        ? []
        : [
            {
              title: shell.title,
              lease: {
                alias: shell.lease.alias,
                ...(shell.lease.acquiredAt === undefined
                  ? {}
                  : { acquiredAt: shell.lease.acquiredAt }),
              },
            },
          ],
    ),
  ).pipe(Atom.withEquality(sameValue), Atom.withLabel("zerops:lease-chats")),
);

export function useLeaseChats(environmentId: EnvironmentId | null): ReadonlyArray<LeaseChat> {
  return useAtomValue(environmentId === null ? NO_CHATS_ATOM : leaseChatsAtom(environmentId));
}
