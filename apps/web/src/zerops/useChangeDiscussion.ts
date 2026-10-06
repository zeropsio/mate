/**
 * What has been said on one change, and the way to say something back (SPEC §3.2a: HQ keeps a
 * change's comments, and `comment_change` decides who may write one).
 *
 * The conversation is HQ's `discussion` scope, held while the review is drawn and read from the
 * account's store: a conversation nobody has open costs nothing, and one opened again shows what
 * was said at once. Saying something is the account's `change-comment` operation: HQ executes it,
 * and HQ's conversation holding the comment ends it — the box clears as the words appear in the
 * list, never before, since a box that clears and then shows nothing reads as a comment lost.
 *
 * A conversation that cannot be read says why, because this is the whole of what the surface shows
 * before a first read. *Try again* (`retry`) is the account's own. Until the organization's
 * official HQ is known, it is still being read.
 */
import {
  changeDiscussion,
  discussionDemand,
  type ChangeDiscussionRead,
} from "@t3tools/client-runtime/data";
import { HQ_NOT_OPEN } from "@t3tools/client-runtime/zerops/hq";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAccountOperations, type AccountOperations } from "./accountOperations";
import { commentRefusal } from "./changeDiscussion.logic";
import { useAccountDataOptional, useProjection } from "./ZeropsAccountData";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

export interface ChangeDiscussion {
  readonly state: ChangeDiscussionRead;
  /** Says it, and answers the refusal rather than throwing at the surface. */
  readonly say: (body: string) => Promise<string | null>;
  /** True while one is in flight; the box takes no second press. */
  readonly saying: boolean;
  /** Reads the conversation again, after it could not be read. */
  readonly retry: () => void;
}

const READING = Atom.make<ChangeDiscussionRead>({ kind: "reading" });

/**
 * Says it as the account's operation: what HQ did not take is answered at once; what it took,
 * once its conversation holds it, or no longer follows it.
 */
async function sayOn(
  operations: AccountOperations,
  intent: Extract<Parameters<AccountOperations["submit"]>[0], { readonly kind: "change-comment" }>,
): Promise<string | null> {
  const { requestId, progress } = await operations.submit(intent);
  const refusal = commentRefusal(progress);
  if (refusal !== null) return refusal;
  await operations.untilEnd(requestId, intent.orgId);
  return null;
}

export function useChangeDiscussion(link: ChangeLink | null): ChangeDiscussion {
  const account = useAccountDataOptional();
  const operations = useAccountOperations();
  const authorUserId = useZeropsSessionOptional()?.user?.id ?? null;
  const orgId = account?.orgId ?? null;
  const demandDetail = account?.demandDetail;
  const appId = link?.appId;
  const repo = link?.repo;
  const number = link?.number;
  const change = useMemo<ChangeLink | null>(
    () =>
      appId === undefined || repo === undefined || number === undefined
        ? null
        : { appId, repo, number },
    [appId, number, repo],
  );
  const key = useMemo(
    () => (orgId === null || change === null ? null : { orgId, link: change }),
    [change, orgId],
  );
  useEffect(() => {
    if (demandDetail === undefined || change === null) return;
    return demandDetail(discussionDemand(change));
  }, [change, demandDetail]);
  const state = useProjection(changeDiscussion, key, READING);
  const [saying, setSaying] = useState(false);

  const say = useCallback(
    (body: string): Promise<string | null> => {
      if (orgId === null || change === null) return Promise.resolve(HQ_NOT_OPEN);
      setSaying(true);
      const intent = { kind: "change-comment", orgId, link: change, body, authorUserId } as const;
      return sayOn(operations, intent).finally(() => {
        setSaying(false);
      });
    },
    [authorUserId, change, operations, orgId],
  );
  const retry = account?.retry;
  const again = useCallback(() => retry?.(), [retry]);

  return { state, say, saying, retry: again };
}
