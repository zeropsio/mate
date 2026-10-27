/**
 * Each Mate's conversations bound to a lease (`ThreadLease` on their shells), for the Sites list
 * that says which chat holds each of its workspaces. A Mate's conversations live in its own
 * environment, which the conversation the list reads its leases from (`threadKey`) names.
 *
 * A Mate whose environment's conversations are not read yet reads `undefined`: not read, never
 * none. The answer keeps one value while its bindings, titles and last turns stay the same, so a
 * conversation's streaming draws nothing again.
 */
import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { SitesConversation } from "../components/zerops/SidebarProjectSites.logic";
import { sameValue } from "../lib/sameValue";
import { environmentsWithSnapshotAtom } from "../state/shell";
import { environmentThreadShells } from "../state/threads";

/** Each Mate's bound conversations by its Zerops project; a Mate whose are not read is `undefined`. */
export type MatesBoundConversations = Readonly<
  Record<string, ReadonlyArray<SitesConversation> | undefined>
>;

const boundConversationsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): ReadonlyArray<SitesConversation> | undefined => {
    if (!get(environmentsWithSnapshotAtom).has(environmentId)) return undefined;
    return get(environmentThreadShells.environmentThreadRefsAtom(environmentId)).flatMap((ref) => {
      const shell = get(environmentThreadShells.threadShellAtom(ref));
      if (shell?.lease == null) return [];
      const { alias, pool, branch, repo, acquiredAt } = shell.lease;
      const turn = shell.latestTurn;
      return [
        {
          key: scopedThreadKey(ref),
          title: shell.title,
          lease: {
            alias,
            pool,
            branch,
            ...(repo === undefined ? {} : { repo }),
            ...(acquiredAt === undefined ? {} : { acquiredAt }),
          },
          lastTurn:
            turn === null
              ? null
              : {
                  state: turn.state,
                  requestedAt: turn.requestedAt,
                  startedAt: turn.startedAt,
                  completedAt: turn.completedAt,
                },
        },
      ];
    });
  }).pipe(Atom.withEquality(sameValue), Atom.withLabel("zerops:sites-bound-conversations")),
);

const matesBoundConversationsAtom = Atom.family((key: string) => {
  const mates = JSON.parse(key) as ReadonlyArray<readonly [projectId: string, threadKey: string]>;
  return Atom.make((get): MatesBoundConversations => {
    const read: Record<string, ReadonlyArray<SitesConversation> | undefined> = {};
    for (const [projectId, threadKey] of mates) {
      const thread = parseScopedThreadKey(threadKey);
      if (thread !== null) read[projectId] = get(boundConversationsAtom(thread.environmentId));
    }
    return read;
  }).pipe(Atom.withEquality(sameValue), Atom.withLabel("zerops:sites-mates-bound-conversations"));
});

export function useMatesBoundConversations(
  mates: ReadonlyArray<{ readonly projectId: string; readonly threadKey: string | undefined }>,
): MatesBoundConversations {
  const key = JSON.stringify(
    mates.flatMap(({ projectId, threadKey }) =>
      threadKey === undefined ? [] : [[projectId, threadKey] as const],
    ),
  );
  return useAtomValue(matesBoundConversationsAtom(key));
}
