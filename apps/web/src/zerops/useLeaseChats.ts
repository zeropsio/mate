/**
 * The chats of one Mate's environment that are bound to a pool lease (`ThreadLease`), each by its
 * title: a dev pool's workspace goes by the chat working in it (`leaseLabel`), on the Zerops
 * panel, in Sites and on the Browser page. Unarchived chats only. It reads that environment's chats
 * alone, and keeps one value while their titles and bindings stay the same, so a streamed turn
 * redraws nothing.
 */
import { useAtomValue } from "@effect/atom-react";
import type { MatePartLeaseChat } from "@t3tools/client-runtime/zerops/mateParts";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { sameValue } from "../lib/sameValue";
import { environmentThreadShells } from "../state/threads";

export const leaseChatsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<MatePartLeaseChat> =>
    get(environmentThreadShells.environmentThreadRefsAtom(environmentId)).flatMap(
      (ref): ReadonlyArray<MatePartLeaseChat> => {
        const shell = get(environmentThreadShells.threadShellAtom(ref));
        const lease = shell?.archivedAt === null ? shell.lease : undefined;
        return shell === null || lease === undefined || lease === null
          ? []
          : [
              {
                alias: lease.alias,
                ...(lease.acquiredAt === undefined ? {} : { acquiredAt: lease.acquiredAt }),
                title: shell.title,
              },
            ];
      },
    ),
  ).pipe(Atom.withEquality(sameValue), Atom.withLabel("zerops:lease-chats")),
);

const NO_CHATS_ATOM = Atom.make<ReadonlyArray<MatePartLeaseChat>>([]).pipe(
  Atom.withLabel("zerops:lease-chats:none"),
);

/** A Mate's chats bound to a lease, by title; none without an environment. */
export function useLeaseChats(
  environmentId: EnvironmentId | null,
): ReadonlyArray<MatePartLeaseChat> {
  return useAtomValue(environmentId === null ? NO_CHATS_ATOM : leaseChatsAtom(environmentId));
}
