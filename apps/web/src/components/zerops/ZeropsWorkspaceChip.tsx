/**
 * The workspace chip of a conversation bound to a lease: when its workspace was last active and
 * what a release would lose there, idle once nothing happened in it for 24 h (`workspaceChip`).
 * A label only: it releases nothing and offers nothing to press.
 */
import { workspaceChipOf } from "@t3tools/client-runtime/zerops";
import type {
  EnvironmentId,
  OrchestrationLatestTurn,
  ThreadId,
  ThreadLease,
} from "@t3tools/contracts";

import { useNowMs } from "../../zerops/useNowMs";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { Badge } from "../ui/badge";

export function ZeropsWorkspaceChip({
  environmentId,
  threadId,
  lease,
  latestTurn,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  /** The lease the conversation is bound to. */
  readonly lease: ThreadLease;
  readonly latestTurn: OrchestrationLatestTurn | null;
}) {
  const chip = workspaceChipOf({
    binding: lease,
    lifecycle: useZeropsLifecycle(environmentId, threadId),
    lastTurn: latestTurn,
    now: useNowMs(),
  });
  if (chip === undefined) return null;
  return (
    <Badge data-zerops-workspace-chip="" tone={chip.idle ? "warning" : "neutral"}>
      {chip.words}
    </Badge>
  );
}
