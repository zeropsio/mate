/**
 * The workspace chip of a conversation bound to a lease: when its workspace was last active and
 * what a release would lose there, idle once nothing happened in it for 24 h (`workspaceChip`).
 * Its Release asks first (`zeropsReleaseAsk`): only the person's Release in that question sends the
 * conversation's agent the request to release the lease. Mate releases nothing itself.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { workspaceChipOf, zeropsReleaseAsk } from "@t3tools/client-runtime/zerops";
import type {
  EnvironmentId,
  OrchestrationLatestTurn,
  ThreadId,
  ThreadLease,
} from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { useThreadShell } from "../../state/entities";
import { useNowMs } from "../../zerops/useNowMs";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { useZeropsReleaseRequest } from "../../zerops/useZeropsReleaseRequest";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

interface BoundConversation {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The lease the conversation is bound to. */
  readonly lease: ThreadLease;
  readonly latestTurn: OrchestrationLatestTurn | null;
}

export function ZeropsWorkspaceChip({
  environmentId,
  threadId,
  lease,
  latestTurn,
}: BoundConversation) {
  const chip = workspaceChipOf({
    binding: lease,
    lifecycle: useZeropsLifecycle(environmentId, threadId),
    lastTurn: latestTurn,
    now: useNowMs(),
  });
  const [asking, setAsking] = useState(false);
  if (chip === undefined) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Badge data-zerops-workspace-chip="" tone={chip.idle ? "warning" : "neutral"}>
        {chip.words}
      </Badge>
      <Popover onOpenChange={setAsking} open={asking}>
        <PopoverTrigger
          render={<Button data-zerops-workspace-release="" size="sm" variant="ghost" />}
        >
          Release
        </PopoverTrigger>
        <PopoverPopup align="end" width="md">
          <ReleaseQuestionHost
            environmentId={environmentId}
            latestTurn={latestTurn}
            lease={lease}
            onClose={() => setAsking(false)}
            threadId={threadId}
          />
        </PopoverPopup>
      </Popover>
    </span>
  );
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
}: BoundConversation & {
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
function ReleaseQuestionHost({
  onClose,
  ...conversation
}: BoundConversation & { readonly onClose: () => void }) {
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
      archived: shell.archivedAt !== null,
      unarchive: () => unarchiveThread(threadRef),
    }).finally(onClose);
  };
  return (
    <ZeropsReleaseQuestion
      {...conversation}
      onDismiss={onClose}
      onRelease={release}
      releasing={releasing}
    />
  );
}
