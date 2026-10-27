/**
 * A workspace's Release, which asks first (`zeropsReleaseAsk`): the workspace named, what is known
 * of it, Release and Not now. Only the person's Release in that question sends a conversation of
 * the Mate the request to release that lease; Mate releases nothing itself. The Mate's Sites offer
 * it on each workspace's row, and archiving the conversation bound to a lease asks it too
 * (`releaseAskNotice`).
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type CheckoutLease, zeropsReleaseAsk } from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, OrchestrationLatestTurn, ThreadId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { useThreadShell } from "../../state/entities";
import { useNowMs } from "../../zerops/useNowMs";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { useZeropsReleaseRequest } from "../../zerops/useZeropsReleaseRequest";
import { Button } from "../ui/button";

interface ReleaseTarget {
  /** The conversation the request goes to: the Mate's, where the person asked. */
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The workspace's lease. */
  readonly lease: CheckoutLease;
  /** The last turn of the conversation holding it, which dates it; null where none does. */
  readonly latestTurn: Pick<
    OrchestrationLatestTurn,
    "state" | "requestedAt" | "startedAt" | "completedAt"
  > | null;
}

/**
 * The release question: the workspace named, what is known of it from the conversation's own
 * lifecycle, Release and Not now. Once a read no longer holds the lease, it only says so.
 */
export function ZeropsReleaseQuestion({
  environmentId,
  threadId,
  lease,
  latestTurn,
  releasing,
  onRelease,
  onDismiss,
}: ReleaseTarget & {
  /** The request is on its way: Release waits for its answer. */
  readonly releasing: boolean;
  readonly onRelease: () => void;
  readonly onDismiss: () => void;
}) {
  const ask = zeropsReleaseAsk({
    binding: lease,
    lifecycle: useZeropsLifecycle(environmentId, threadId),
    lastTurn: latestTurn,
    now: useNowMs(),
  });
  return (
    <div className="flex flex-col gap-3" data-zerops-release-question="">
      <p className="font-medium text-sm">{ask?.question ?? `${lease.alias} is no longer held.`}</p>
      {ask?.facts === undefined ? null : (
        <p className="text-muted-foreground text-xs">{ask.facts}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onDismiss} size="sm" variant="ghost">
          Not now
        </Button>
        {ask === undefined ? null : (
          <Button disabled={releasing} onClick={onRelease} size="sm">
            Release
          </Button>
        )}
      </div>
    </div>
  );
}

/** The question with its send: mounted only while it is open. */
export function ZeropsWorkspaceRelease({
  onDismiss,
  onDone,
  bound = true,
  ...conversation
}: ReleaseTarget & {
  /** False for another of the Mate's workspaces, which the conversation is not bound to. */
  readonly bound?: boolean;
  /** Not now. */
  readonly onDismiss: () => void;
  /** The request was sent, or failed to be. */
  readonly onDone: () => void;
}) {
  const { environmentId, threadId, lease } = conversation;
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const shell = useThreadShell(threadRef);
  const { unarchiveThread } = useThreadActions();
  const requestRelease = useZeropsReleaseRequest();
  const [releasing, setReleasing] = useState(false);
  const release = () => {
    if (shell === null || releasing) return;
    setReleasing(true);
    void requestRelease({
      threadRef,
      conversation: shell,
      alias: lease.alias,
      bound,
      archived: shell.archivedAt !== null,
      unarchive: () => unarchiveThread(threadRef),
    }).finally(onDone);
  };
  return (
    <ZeropsReleaseQuestion
      {...conversation}
      onDismiss={onDismiss}
      onRelease={release}
      releasing={releasing}
    />
  );
}
