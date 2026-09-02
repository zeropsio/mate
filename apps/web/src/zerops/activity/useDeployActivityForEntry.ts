/**
 * The single decision of "does this work-log entry get a platform-activity
 * overlay, and what state is it in right now" — shared by every timeline row
 * shape that can show a `zerops_deploy` call, so a call rendered through the
 * live "work-live" summary row (an in-progress tool during the active turn,
 * `MessagesTimeline.tsx`'s `LiveWorkEntryTimelineRow`) gets exactly the same
 * overlay as one rendered through the ordinary grouped `SimpleWorkEntryRow`.
 *
 * Before this was extracted, the decision lived inline in `SimpleWorkEntryRow`
 * only — `LiveWorkEntryTimelineRow` never called it, so a deploy that was
 * still running (and therefore always shown as the live summary row for its
 * whole active-turn lifetime) never got an overlay at all.
 */
import {
  RESULT_STATUSES_WITH_PLATFORM_CONTINUATION,
  type ActivityState,
} from "@t3tools/client-runtime/zerops/activity/reducer";
import { readZeropsCardSource } from "@t3tools/client-runtime/zerops/cards/decode";
import { decodeZeropsCard } from "@t3tools/client-runtime/zerops/cards/payloads";
import type { EnvironmentId } from "@t3tools/contracts";

import type { WorkLogEntry } from "../../session-logic";
import { readPendingDeployCall, type PendingDeployCall } from "./pendingDeployCall.ts";
import { DEPLOY_ACTIVITY_CEILING_MS, useDeployActivityState } from "./useDeployActivityState.ts";

export interface DeployActivityForEntry {
  /** This entry's own `zerops_deploy` target + start time, when decodable. */
  readonly deployCall: PendingDeployCall | undefined;
  /** `zerops_deploy`, still `toolLifecycleStatus === "inProgress"`. */
  readonly isPendingDeploy: boolean;
  /** A resolved `deploy` card whose status is the §4 BUILD_TRIGGERED exception. */
  readonly buildTriggeredResult: boolean;
  readonly activityState: ActivityState;
}

export function useDeployActivityForEntry(
  workEntry: WorkLogEntry,
  environmentId: EnvironmentId,
): DeployActivityForEntry {
  // A zerops_* result this build can read renders as a card — read here only
  // to classify the entry (deploy? BUILD_TRIGGERED?); the card itself is the
  // caller's concern.
  const zeropsCard = decodeZeropsCard(
    readZeropsCardSource(workEntry.zeropsResult, {
      failed: workEntry.toolLifecycleStatus === "failed",
    }),
  );

  const isDeployTool = workEntry.zeropsResult?.toolName === "zerops_deploy";
  const deployCall = isDeployTool
    ? readPendingDeployCall({
        toolData: workEntry.toolData,
        toolInput: workEntry.toolInput,
        createdAt: workEntry.createdAt,
        startedAt: workEntry.startedAt,
      })
    : undefined;
  const isPendingDeploy = isDeployTool && workEntry.toolLifecycleStatus === "inProgress";
  const buildTriggeredResult =
    zeropsCard !== undefined &&
    zeropsCard.kind === "deploy" &&
    RESULT_STATUSES_WITH_PLATFORM_CONTINUATION.has(zeropsCard.status);
  // A historical card — the call started over 30 minutes ago — never
  // activates the hook at all: there is nothing left worth polling for, and
  // the ceiling check inside the hook itself is only a second line of
  // defense once this is already subscribed.
  const ceilingExceeded =
    deployCall !== undefined &&
    Date.now() - deployCall.toolStartedAtMs > DEPLOY_ACTIVITY_CEILING_MS;
  const wantsActivity =
    deployCall !== undefined && !ceilingExceeded && (isPendingDeploy || buildTriggeredResult);

  const activityState = useDeployActivityState({
    environmentId: wantsActivity ? environmentId : null,
    toolData: workEntry.toolData,
    toolInput: workEntry.toolInput,
    createdAt: workEntry.createdAt,
    startedAt: workEntry.startedAt,
    hasResult: workEntry.zeropsResult?.resultText !== undefined,
    resultStatus:
      zeropsCard !== undefined && zeropsCard.kind === "deploy" ? zeropsCard.status : undefined,
  });

  return { deployCall, isPendingDeploy, buildTriggeredResult, activityState };
}
