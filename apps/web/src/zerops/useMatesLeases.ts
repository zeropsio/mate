/**
 * zcp's leases for each Mate a Sites list shows, as a conversation of that Mate last read them
 * (`leases[]` on its lifecycle's envelope). zcp keeps one set for the whole Mate, and every
 * conversation's lifecycle carries it as the latest Zerops call read it, whichever conversation
 * made it — so the Mate's conversation the person last visited (`threadKey`) is enough.
 *
 * A Mate with no such conversation, whose lifecycle is not read yet, or whose conversation has
 * made no Zerops call reads `undefined`: not read, never none. The lifecycles are demanded only
 * while a list that shows them is drawn, and the answer keeps one value while the leases stay the
 * same, so a Zerops call that changes nothing of them draws nothing again.
 */
import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { lifecycleLeases } from "@t3tools/client-runtime/zerops/serviceMap";
import type { ZeropsLease } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { sameValue } from "../lib/sameValue";
import { zeropsFeeds } from "./feeds";

/** Each Mate's leases by its Zerops project; a Mate whose leases are not read is absent or `undefined`. */
export type MatesLeases = Readonly<Record<string, ReadonlyArray<ZeropsLease> | undefined>>;

const matesLeasesAtom = Atom.family((key: string) => {
  const threads = JSON.parse(key) as ReadonlyArray<readonly [projectId: string, threadKey: string]>;
  return Atom.make((get): MatesLeases => {
    const read: Record<string, ReadonlyArray<ZeropsLease> | undefined> = {};
    for (const [projectId, threadKey] of threads) {
      const thread = parseScopedThreadKey(threadKey);
      if (thread === null) continue;
      const lifecycle = get(
        zeropsFeeds.lifecycle({
          environmentId: thread.environmentId,
          input: { threadId: thread.threadId },
        }),
      );
      read[projectId] = lifecycleLeases(lifecycle);
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
