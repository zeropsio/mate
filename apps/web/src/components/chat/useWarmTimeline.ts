/**
 * A conversation's list props, read on their own for a conversation not open
 * yet (`KeptTimelines` warms it): what `ChatView` gives the list of the open
 * one, from the same derivations, for a conversation nobody has sent from in
 * this tab — no message on its way, no picture handed over, no anchor. Its
 * rows are placed out of sight; when it opens, `ChatView`'s own props take
 * over the same list.
 */
import type { EnvironmentId } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { useMemo, useState } from "react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { emptyAgentPanelModel } from "@t3tools/client-runtime/state/subagentRuntime";
import {
  requestOlderThreadTurns,
  threadHasOlderTurns,
} from "@t3tools/client-runtime/state/threads";

import { useAssetUrls } from "../../assets/assetUrls";
import {
  createMessageAttachmentPreviewProjector,
  derivePhase,
  deriveTimelineEntriesWithState,
  deriveTurnPlans,
  deriveWorkLogEntries,
  selectHandoffImageResources,
} from "../../session-logic";
import { useThread, useThreadDetail, useThreadShell, useThreadStatus } from "../../state/entities";
import { useEnvironmentThread } from "../../state/threads";
import { deriveZeropsThreadModel } from "../../state/zerops";
import { resolveThreadSyncPhase } from "../../threadSync";
import {
  useZeropsChangeLandedEvents,
  useZeropsConversationLandings,
} from "../../zerops/useZeropsChangeLandedEvents";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { useNowMs } from "../../zerops/useNowMs";
import { deriveDock, foldBackgroundTasks, latestUsagePause } from "./conversationDock.logic";
import type { MessagesTimeline } from "./MessagesTimeline";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;

/** What of the list is the conversation's own; the rest is the pane's. */
export type WarmTimelineProps = Pick<
  TimelineProps,
  | "timelineEntries"
  | "latestTurn"
  | "runningTurnId"
  | "turnDiffSummaries"
  | "activeThreadEnvironmentId"
  | "routeThreadKey"
  | "isWorking"
  | "working"
  | "hideEmptyPlaceholder"
  | "loading"
  | "syncing"
  | "usagePause"
  | "loadEarlier"
>;

const NO_ACTIVITIES: [] = [];
const NO_ATTACHMENT_HANDOFF = {};

/** `openEnvironmentId` stands in for its pictures' environment until its key is read. */
export function useWarmTimeline(
  threadKey: string | null,
  openEnvironmentId: EnvironmentId,
): WarmTimelineProps | null {
  const ref = useMemo(
    () => (threadKey === null ? null : parseScopedThreadKey(threadKey)),
    [threadKey],
  );
  const thread = useThread(ref);
  const detail = useThreadDetail(ref);
  const shell = useThreadShell(ref);
  const status = useThreadStatus(ref);
  const environmentId = ref?.environmentId ?? null;
  const activities = thread?.activities ?? NO_ACTIVITIES;
  const latestTurn = thread?.latestTurn ?? null;
  const runningTurnId =
    (thread?.session?.status === "running" ? thread.session.activeTurnId : null) ??
    (latestTurn?.state === "running" ? latestTurn.turnId : null);
  const lifecycle = useZeropsLifecycle(environmentId, ref?.threadId ?? null);
  const nowMs = useNowMs();
  const zerops = useMemo(
    () => deriveZeropsThreadModel({ activities, lifecycle, runningTurnId, nowMs }),
    [activities, lifecycle, runningTurnId, nowMs],
  );
  const workLog = useMemo(
    () => deriveWorkLogEntries(activities, { exclude: zerops.zeropsActivityIds }),
    [activities, zerops.zeropsActivityIds],
  );
  const turnPlans = useMemo(() => deriveTurnPlans(activities), [activities]);
  // Its pictures as the open conversation shows them.
  const serverMessages = thread?.messages;
  const [project] = useState(createMessageAttachmentPreviewProjector);
  const resources = useMemo(
    () => selectHandoffImageResources(serverMessages, NO_ATTACHMENT_HANDOFF),
    [serverMessages],
  );
  const urls = useAssetUrls(environmentId ?? openEnvironmentId, resources);
  const messages = useMemo(() => {
    if (!serverMessages) return [];
    const urlById = new Map(
      resources.flatMap((resource, index) => {
        const url = urls[index];
        return url ? [[resource.attachmentId, url] as const] : [];
      }),
    );
    return serverMessages.map((message) =>
      project(message, (attachment) => urlById.get(attachment.id)),
    );
  }, [project, resources, serverMessages, urls]);
  const landed = useZeropsChangeLandedEvents(environmentId);
  const landings = useZeropsConversationLandings(landed, messages);
  const entries = useMemo(
    () =>
      deriveTimelineEntriesWithState(
        messages,
        thread?.proposedPlans ?? [],
        workLog,
        null,
        turnPlans,
        zerops.entries,
        landings,
      ).entries,
    [landings, messages, thread?.proposedPlans, turnPlans, workLog, zerops.entries],
  );
  const phase = derivePhase(thread?.session ?? null);
  const isWorking = phase === "running" || phase === "connecting";
  const working = useMemo(
    () =>
      deriveDock({
        timelineEntries: entries,
        isWorking,
        runningTurnId,
        agentPanelModel: emptyAgentPanelModel(),
        plan: null,
        backgroundTasks: foldBackgroundTasks(activities),
        pause: shell?.usagePause
          ? { resetsAt: shell.usagePause.resetsAt }
          : latestUsagePause(entries),
      }),
    [activities, entries, isWorking, runningTurnId, shell?.usagePause],
  );
  const pageState = useEnvironmentThread(environmentId, ref?.threadId ?? null);
  const loadEarlier = useMemo(() => {
    if (ref === null || !threadHasOlderTurns(pageState)) return null;
    return {
      loading: pageState.page._tag === "Some" && pageState.page.value.loadingOlder,
      onLoadEarlier: () => requestOlderThreadTurns(ref.environmentId, ref.threadId),
    };
  }, [pageState, ref]);
  const syncPhase = resolveThreadSyncPhase({
    detailExists: detail !== null,
    shellExists: shell !== null,
    status,
  });
  if (ref === null || thread === null) return null;
  const detailLoading = syncPhase === "loading";
  return {
    timelineEntries: entries,
    latestTurn,
    runningTurnId,
    turnDiffSummaries: thread.checkpoints,
    activeThreadEnvironmentId: ref.environmentId,
    routeThreadKey: scopedThreadKey(ref),
    isWorking,
    working,
    hideEmptyPlaceholder: detailLoading,
    loading: detailLoading,
    syncing: syncPhase !== null,
    usagePause: shell?.usagePause ?? null,
    loadEarlier,
  };
}
