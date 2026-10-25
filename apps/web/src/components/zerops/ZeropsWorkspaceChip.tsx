/**
 * The workspace chip of a conversation bound to a lease: its workspace by name, when it was last
 * active and what a release would lose there, idle once nothing happened in it for 24 h, and how
 * many other workspaces the Mate holds (`workspaceChip`). Pressed, it lists every workspace of the
 * Mate (`mateWorkspaceList`). Every Release asks first (`zeropsReleaseAsk`): only the person's
 * Release in that question sends the conversation's agent the request to release that lease. Mate
 * releases nothing itself.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type CheckoutLease,
  type MateWorkspace,
  mateWorkspaceList,
  workspaceChipOf,
  zeropsReleaseAsk,
} from "@t3tools/client-runtime/zerops";
import type { EnvironmentId, OrchestrationLatestTurn, ThreadId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { useThreadShell } from "../../state/entities";
import { useNowMs } from "../../zerops/useNowMs";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { useZeropsReleaseRequest } from "../../zerops/useZeropsReleaseRequest";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import type { ChipDot } from "./SidebarProductionChip.logic";
import { EnvDot } from "./SidebarProductionChip";

interface BoundConversation {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The lease the conversation is bound to. */
  readonly lease: CheckoutLease;
  readonly latestTurn: OrchestrationLatestTurn | null;
}

export function ZeropsWorkspaceChip({
  mateName,
  ...conversation
}: BoundConversation & {
  /** The Mate whose conversation it is, by name; none where the conversation is no Mate's. */
  readonly mateName?: string | undefined;
}) {
  const { environmentId, threadId, lease, latestTurn } = conversation;
  const chip = workspaceChipOf({
    binding: lease,
    lifecycle: useZeropsLifecycle(environmentId, threadId),
    lastTurn: latestTurn,
    now: useNowMs(),
  });
  const [listing, setListing] = useState(false);
  const [asking, setAsking] = useState(false);
  if (chip === undefined) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Popover onOpenChange={setListing} open={listing}>
        <PopoverTrigger
          render={
            <button
              className="inline-flex cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              type="button"
            />
          }
        >
          <Badge data-zerops-workspace-chip="" tone={chip.idle ? "warning" : "neutral"}>
            {chip.words}
          </Badge>
        </PopoverTrigger>
        <PopoverPopup align="end" width="lg">
          <ZeropsWorkspaceList
            {...conversation}
            mateName={mateName}
            onClose={() => setListing(false)}
          />
        </PopoverPopup>
      </Popover>
      <Popover onOpenChange={setAsking} open={asking}>
        <PopoverTrigger
          render={<Button data-zerops-workspace-release="" size="sm" variant="ghost" />}
        >
          Release
        </PopoverTrigger>
        <PopoverPopup align="end" width="md">
          <ReleaseQuestionHost
            {...conversation}
            onDismiss={() => setAsking(false)}
            onDone={() => setAsking(false)}
          />
        </PopoverPopup>
      </Popover>
    </span>
  );
}

/** A workspace's state, as its dot: held ok, parked hollow, not answering red, another quiet. */
const stateDot = (workspace: MateWorkspace): ChipDot => {
  if (workspace.notAnswering !== undefined) return "failed";
  if (workspace.state === "held") return "ok";
  if (workspace.state === "parked") return "hollow";
  return "off";
};

/**
 * Every workspace of the Mate, as the chip lists it: each by name and alias, its state, what is
 * known of it, the conversation's own marked; and each its own Release, whose question takes the
 * list's place — Not now brings the list back, a sent request closes it.
 */
export function ZeropsWorkspaceList({
  mateName,
  onClose,
  ...conversation
}: BoundConversation & {
  readonly mateName: string | undefined;
  readonly onClose: () => void;
}) {
  const { environmentId, threadId, lease, latestTurn } = conversation;
  const workspaces = mateWorkspaceList({
    binding: lease,
    lifecycle: useZeropsLifecycle(environmentId, threadId),
    lastTurn: latestTurn,
    now: useNowMs(),
  });
  const [asking, setAsking] = useState<MateWorkspace | undefined>(undefined);
  if (asking !== undefined) {
    return (
      <ReleaseQuestionHost
        environmentId={environmentId}
        latestTurn={asking.bound ? latestTurn : null}
        lease={asking.lease}
        onDismiss={() => setAsking(undefined)}
        onDone={onClose}
        threadId={threadId}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2" data-zerops-workspace-list="">
      <p className="font-medium text-sm">
        {mateName === undefined ? "Workspaces" : `${mateName}'s workspaces`}
      </p>
      <ul className="flex flex-col gap-1">
        {workspaces.map((workspace) => (
          <li
            className="flex flex-col gap-0.5"
            data-bound={workspace.bound ? "" : undefined}
            data-zerops-workspace={workspace.lease.alias}
            key={workspace.lease.alias}
          >
            <div className="flex min-w-0 items-center gap-2">
              <EnvDot dot={stateDot(workspace)} />
              <span className="zerops-sites-service">{workspace.name}</span>
              {workspace.alias === undefined ? null : (
                <span className="zerops-sites-alias">{workspace.alias}</span>
              )}
              {workspace.state === undefined ? null : (
                <span
                  className="zerops-sites-role"
                  data-tone={workspace.notAnswering === undefined ? undefined : "red"}
                >
                  {workspace.state}
                </span>
              )}
              {workspace.bound ? <Badge>this chat</Badge> : null}
              <span className="ms-auto">
                <Button
                  data-zerops-workspace-release=""
                  onClick={() => setAsking(workspace)}
                  size="sm"
                  variant="ghost"
                >
                  Release
                </Button>
              </span>
            </div>
            {workspace.notAnswering === undefined ? null : (
              <p className="ps-4 text-muted-foreground text-xs">{workspace.notAnswering}</p>
            )}
            {workspace.facts === undefined ? null : (
              <p className="ps-4 text-muted-foreground text-xs">{workspace.facts}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
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
  onDismiss,
  onDone,
  ...conversation
}: BoundConversation & {
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
