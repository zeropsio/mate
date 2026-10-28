/**
 * zcp's leases for each Mate a Sites list shows, as a conversation of that Mate last read them
 * (`leases[]` on its lifecycle's envelope), and the pairs it keys by a dev pool (`poolPairsOf`: each
 * pool's stages, with the part they serve). zcp keeps one set for the whole Mate, and every conversation's lifecycle
 * carries it as the latest Zerops call read it, whichever conversation made it — so the Mate's
 * conversation the person last visited (`threadKey`) is enough.
 *
 * A Mate with no such conversation, whose lifecycle is not read yet, or whose conversation has
 * made no Zerops call reads `undefined` leases: not read, never none. The lifecycles are demanded
 * only while a list that shows them is drawn, and the answer keeps one value while the leases stay
 * the same, so a Zerops call that changes nothing of them draws nothing again.
 *
 * Each Mate's chats bound to a lease (`ThreadLease`) say, by their titles, what each workspace is
 * for (`leaseChats`).
 */
import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { lifecycleLeases, poolPairsOf } from "@t3tools/client-runtime/zerops/serviceMap";
import type { MatePartLeaseChat } from "@t3tools/client-runtime/zerops/mateParts";
import type { PoolPair } from "@t3tools/client-runtime/zerops/servicePairs";
import type { ZeropsLease } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { sameValue } from "../lib/sameValue";
import { environmentThreadShells } from "../state/threads";
import { zeropsFeeds } from "./feeds";

/** A Mate's leases as read, the pairs its envelope keys by a dev pool, and its chats on leases. */
export interface MateLeasesRead {
  readonly leases: ReadonlyArray<ZeropsLease> | undefined;
  readonly poolPairs: ReadonlyArray<PoolPair>;
  readonly leaseChats: ReadonlyArray<MatePartLeaseChat>;
}

/** Each Mate's read by its Zerops project; a Mate with no conversation to read is absent. */
export type MatesLeases = Readonly<Record<string, MateLeasesRead | undefined>>;

const matesLeasesAtom = Atom.family((key: string) => {
  const threads = JSON.parse(key) as ReadonlyArray<readonly [projectId: string, threadKey: string]>;
  return Atom.make((get): MatesLeases => {
    const read: Record<string, MateLeasesRead | undefined> = {};
    for (const [projectId, threadKey] of threads) {
      const thread = parseScopedThreadKey(threadKey);
      if (thread === null) continue;
      const lifecycle = get(
        zeropsFeeds.lifecycle({
          environmentId: thread.environmentId,
          input: { threadId: thread.threadId },
        }),
      );
      const leaseChats = get(
        environmentThreadShells.environmentThreadRefsAtom(thread.environmentId),
      ).flatMap((ref): ReadonlyArray<MatePartLeaseChat> => {
        const shell = get(environmentThreadShells.threadShellAtom(ref));
        const lease = shell?.archivedAt === null ? shell.lease : undefined;
        return shell === null || lease === undefined || lease === null
          ? []
          : [{ alias: lease.alias, acquiredAt: lease.acquiredAt, title: shell.title }];
      });
      read[projectId] = {
        leases: lifecycleLeases(lifecycle),
        poolPairs: poolPairsOf(lifecycle),
        leaseChats,
      };
    }
    return read;
  }).pipe(Atom.withEquality(sameValue), Atom.withLabel("zerops:sites-leases"));
});

export function useMatesLeases(
  mates: ReadonlyArray<{ readonly projectId: string; readonly threadKey: string | undefined }>,
): MatesLeases {
  const key = JSON.stringify(
    mates.flatMap(({ projectId, threadKey }) =>
      threadKey === undefined ? [] : [[projectId, threadKey] as const],
    ),
  );
  return useAtomValue(matesLeasesAtom(key));
}
