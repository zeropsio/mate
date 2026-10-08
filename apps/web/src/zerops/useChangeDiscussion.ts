/**
 * What has been said on one change, and the way to say something back (SPEC §3.2a: HQ keeps a
 * change's comments, and `comment_change` decides who may write one).
 *
 * The conversation is HQ's `discussion` scope, held while the review is drawn and read from the
 * account's store: a conversation nobody has open costs nothing, and one opened again shows what
 * was said at once. Saying something is the account's `change-comment` operation
 * (`sayOnChange`): sent once the conversation is read, executed by HQ, and ended by HQ's
 * conversation holding the comment. A press waiting for that read says so under the box, and is let
 * go with its review, organization or account; the same words pressed again join it.
 *
 * Once HQ took the words they are the change's, not a draft: the box keeps showing them, off, until
 * the conversation holds them — also in a review closed and opened again meanwhile, so the same
 * words are never pressed twice. While HQ's link reconnects that wait says so. Words whose answer
 * was lost stay the person's draft until HQ's conversation shows them as theirs (`landed`).
 *
 * A conversation that cannot be read says why, because this is the whole of what the surface shows
 * before a first read. *Try again* (`retry`) is the account's own. Until the organization's
 * official HQ is known, it is still being read.
 */
import { RegistryContext } from "@effect/atom-react";
import {
  changeDiscussion,
  discussionDemand,
  discussionGate,
  operationProgress,
  operationWait,
  type ChangeDiscussionRead,
  type OperationProgress,
  type OperationWait,
} from "@t3tools/client-runtime/data";
import { HQ_NOT_OPEN } from "@t3tools/client-runtime/zerops/hq";
import type { ChangeLink } from "@t3tools/shared/hqChanges";
import { Atom } from "effect/reactivity";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useAccountOperations } from "./accountOperations";
import { landedAfterLoss, makeCommentSends, sayOnChange } from "./changeDiscussion.logic";
import { useAccountDataOptional, useProjection } from "./ZeropsAccountData";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/** Words HQ took for the change, until its conversation holds them. */
export interface PendingComment {
  readonly body: string;
  /** HQ's link is reconnecting meanwhile: the wait is a long one. */
  readonly reconnecting: boolean;
}

export interface ChangeDiscussion {
  readonly state: ChangeDiscussionRead;
  /** Says it; answers the refusal once HQ answered, `null` once HQ took it. */
  readonly say: (body: string) => Promise<string | null>;
  /** True while one is in flight or HQ's conversation does not hold it yet: no second press. */
  readonly saying: boolean;
  /** A press waits for the conversation's first read before it is sent. */
  readonly waiting: boolean;
  readonly pending: PendingComment | null;
  /** Words whose answer was lost, once HQ's conversation shows them as the person's. */
  readonly landed: string | null;
  /** Reads the conversation again, after it could not be read. */
  readonly retry: () => void;
}

const READING = Atom.make<ChangeDiscussionRead>({ kind: "reading" });
const ENDED = Atom.make<OperationWait>({ kind: "ended" });
const UNKNOWN = Atom.make<OperationProgress>({ stage: "unknown" });

/** What each change was told while the tab is open: its words and their operation. */
const taken = new Map<string, { readonly requestId: string; readonly body: string }>();
/** Each change's words whose answer was lost, until HQ's conversation shows them or not. */
const unsure = new Map<string, { readonly requestId: string; readonly body: string }>();
const sends = makeCommentSends();

const keyOfChange = (link: ChangeLink) => JSON.stringify([link.appId, link.repo, link.number]);

export function useChangeDiscussion(link: ChangeLink | null): ChangeDiscussion {
  const account = useAccountDataOptional();
  const registry = useContext(RegistryContext);
  const operations = useAccountOperations();
  const authorUserId = useZeropsSessionOptional()?.user?.id ?? null;
  const orgId = account?.orgId ?? null;
  const data = account?.data;
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

  const changeKey = change === null ? null : keyOfChange(change);
  const scope = orgId === null || changeKey === null ? null : `${orgId}|${changeKey}`;
  // A press still waiting for the conversation goes with its review and organization (an account
  // ends with its organization shown).
  useEffect(() => (scope === null ? undefined : () => sends.cancel(scope)), [scope]);

  const [, setMoved] = useState(0);
  const held = changeKey === null ? undefined : taken.get(changeKey);
  const wait = useProjection(
    operationWait,
    held === undefined || orgId === null ? null : { requestId: held.requestId, orgId },
    ENDED,
  );
  // Its end read, the words are the conversation's: the box is the person's again.
  useEffect(() => {
    if (changeKey !== null && held !== undefined && wait.kind === "ended") taken.delete(changeKey);
  }, [changeKey, held, wait.kind]);
  const pending =
    held === undefined || wait.kind === "ended"
      ? null
      : { body: held.body, reconnecting: wait.reconnecting };

  const lost = changeKey === null ? undefined : unsure.get(changeKey);
  const lostProgress = useProjection(operationProgress, lost?.requestId ?? null, UNKNOWN);
  const landed = lost !== undefined && landedAfterLoss(lostProgress) ? lost.body : null;
  // Each new word of the conversation asks HQ's facts again whether the lost words are there.
  const { askAgain } = operations;
  useEffect(() => {
    if (lost === undefined || state.kind !== "read" || landed !== null) return;
    if (lostProgress.stage === "uncertain" && lostProgress.next === "ask-owner-again")
      void askAgain(lost.requestId);
  }, [askAgain, landed, lost, lostProgress, state]);

  const [pressing, setPressing] = useState(0);
  const say = useCallback(
    async (body: string): Promise<string | null> => {
      if (orgId === null || change === null || data === undefined) return HQ_NOT_OPEN;
      const changeAt = keyOfChange(change);
      setPressing((count) => count + 1);
      const gate = data.project(discussionGate, { orgId, link: change });
      const said = await sends
        .say(
          JSON.stringify([orgId, changeAt, authorUserId, body]),
          `${orgId}|${changeAt}`,
          (signal) =>
            sayOnChange(
              {
                untilRead: (aborted) =>
                  new Promise((resolve) => {
                    let cancel: () => void = () => {};
                    const settle = (value: Parameters<typeof resolve>[0]) => {
                      aborted.removeEventListener("abort", stop);
                      cancel();
                      resolve(value);
                    };
                    const stop = () =>
                      settle({ kind: "failed", reason: "HQ is not answering right now." });
                    aborted.addEventListener("abort", stop);
                    cancel = registry.subscribe(
                      gate,
                      (value) => {
                        if (value.kind !== "reading") settle(value);
                      },
                      { immediate: true },
                    );
                  }),
                submit: operations.submit,
              },
              { kind: "change-comment", orgId, link: change, body, authorUserId },
              signal,
            ),
        )
        .finally(() => {
          setPressing((count) => count - 1);
        });
      if (said.kind === "refused") return said.reason;
      if (said.kind === "uncertain") {
        unsure.set(changeAt, { requestId: said.requestId, body });
        setMoved((count) => count + 1);
        return said.reason;
      }
      unsure.delete(changeAt);
      taken.set(changeAt, { requestId: said.requestId, body });
      setMoved((count) => count + 1);
      return null;
    },
    [authorUserId, change, data, operations, orgId, registry, setMoved],
  );
  const retry = account?.retry;
  const again = useCallback(() => retry?.(), [retry]);

  return {
    state,
    say,
    saying: pressing > 0 || pending !== null,
    waiting: pressing > 0 && state.kind === "reading",
    pending,
    landed,
    retry: again,
  };
}
