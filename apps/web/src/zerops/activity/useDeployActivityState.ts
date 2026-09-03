/**
 * Composes the platform-activity read for one pending/resolved `zerops_deploy`
 * card: session + topology (attribution inputs) + the shared per-project poll
 * + the pure attribution/reducer layers from `client-runtime`.
 *
 * `../../../../zcp/plans/mate-live-activity-2026-09-02.md` §3, §5, §6.
 */
import { useRef } from "react";

import {
  attributeActivity,
  type AttributionResult,
} from "@t3tools/client-runtime/zerops/activity/attribution";
import {
  RESULT_STATUSES_WITH_PLATFORM_CONTINUATION,
  pipelineOutcomeFor,
  reduceActivityState,
  type ActivityState,
} from "@t3tools/client-runtime/zerops/activity/reducer";
import { getPipelineState } from "@t3tools/client-runtime/zerops/activity/pipelineState";
import type { EnvironmentId } from "@t3tools/contracts";

import { useZeropsSessionOptional } from "../ZeropsSessionProvider";
import { useZeropsTopology } from "../useZeropsFeeds";
import { readPendingDeployCall } from "./pendingDeployCall.ts";
import { useProjectActivity } from "./useProjectActivity.ts";

/** §6 per-call ceiling, shared with the caller so it can avoid activating this hook at all on a historical card. */
export const DEPLOY_ACTIVITY_CEILING_MS = 30 * 60 * 1000;

export interface DeployActivityQuery {
  readonly environmentId: EnvironmentId | null;
  /** The entry's Codex-shaped raw MCP item, when present — see `pendingDeployCall.ts`. */
  readonly toolData?: unknown;
  /** The entry's Claude-shaped flat call arguments, when present — see `pendingDeployCall.ts`. */
  readonly toolInput?: unknown;
  /** The entry's own server-stamped timestamp (last-updated). */
  readonly createdAt: string;
  /** The entry's first-observed server-stamped timestamp, when known. */
  readonly startedAt?: string | undefined;
  /** True once the tool call's own result has landed. */
  readonly hasResult: boolean;
  /** The decoded deploy result's `status`, when `hasResult`. */
  readonly resultStatus?: string | undefined;
}

/** Reads the current platform-activity state for one deploy card. */
export function useDeployActivityState(query: DeployActivityQuery): ActivityState {
  const session = useZeropsSessionOptional();
  const topology = useZeropsTopology(query.environmentId);
  const call = readPendingDeployCall({
    toolData: query.toolData,
    toolInput: query.toolInput,
    createdAt: query.createdAt,
    startedAt: query.startedAt,
  });

  const targetServiceId =
    call === undefined
      ? undefined
      : topology?.services.find((service) => service.hostname === call.targetService)?.serviceId;
  const projectId = topology?.project?.id;

  const nowMs = Date.now();
  const ceilingExceeded =
    call !== undefined && nowMs - call.toolStartedAtMs > DEPLOY_ACTIVITY_CEILING_MS;

  const identifiable =
    session !== null &&
    session.status === "signed-in" &&
    topology?.available === true &&
    call !== undefined &&
    targetServiceId !== undefined &&
    projectId !== undefined;

  // §5's `idle` guard applies only to the still-pending path; a resolved
  // BUILD_TRIGGERED continuation is never `idle` — either it has a
  // continuation to show, or `reduceActivityState` renders bare `resolved`.
  const attributableForPending = !query.hasResult && identifiable;

  const isAllowedContinuationStatus =
    query.hasResult &&
    query.resultStatus !== undefined &&
    RESULT_STATUSES_WITH_PLATFORM_CONTINUATION.has(query.resultStatus);

  // Once a BUILD_TRIGGERED continuation's own platform pipeline has settled,
  // there is nothing left to poll for on that card — remembered across
  // renders so the subscription stops even though the caller may still be
  // willing to keep this hook active (it does not know the pipeline settled
  // until this hook tells it, via the state this hook returns).
  const continuationSettledRef = useRef(false);
  if (!query.hasResult) {
    continuationSettledRef.current = false;
  }

  const wantsPoll = query.hasResult
    ? identifiable &&
      isAllowedContinuationStatus &&
      !ceilingExceeded &&
      !continuationSettledRef.current
    : attributableForPending;

  const snapshot = useProjectActivity(
    wantsPoll && projectId ? projectId : null,
    session?.client ?? null,
  );

  // The last successful attribution — remembered across polls so a stale or
  // errored tick does not erase what was already observed (§5's closing
  // paragraph: derivable from one read, but that one read has to survive
  // until a newer one replaces it).
  const lastObservationRef = useRef<{ attribution: AttributionResult; atMs: number } | undefined>(
    undefined,
  );

  let projectMismatch = false;

  if (wantsPoll && call !== undefined && targetServiceId !== undefined && projectId !== undefined) {
    if (snapshot.processes !== undefined && snapshot.atMs !== undefined) {
      const attribution = attributeActivity({
        processes: snapshot.processes,
        projectId,
        serviceIds: [targetServiceId],
        startedAtMs: call.toolStartedAtMs,
        kind: "deploy",
      });
      projectMismatch = attribution.projectMismatch;
      if (attribution.stepSource !== undefined) {
        lastObservationRef.current = { attribution, atMs: snapshot.atMs };
        if (
          query.hasResult &&
          pipelineOutcomeFor(
            attribution.stepSource,
            getPipelineState(attribution.stepSource.appVersion),
          ) !== undefined
        ) {
          continuationSettledRef.current = true;
        }
      }
    }
  } else if (!query.hasResult) {
    lastObservationRef.current = undefined;
  }

  return reduceActivityState(
    {
      hasResult: query.hasResult,
      resultStatus: query.resultStatus,
      attributable: attributableForPending,
      toolStartedAtMs: call?.toolStartedAtMs ?? nowMs,
      ceilingExceeded,
      unavailableReason: projectMismatch ? "project-mismatch" : snapshot.unavailableReason,
      lastObservation: lastObservationRef.current,
    },
    nowMs,
  );
}
