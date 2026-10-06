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
import { useQueuedMessages } from "../../queuedMessageStore";
import {
  createMessageAttachmentPreviewProjector,
  deriveActiveWorkStartedAt,
  derivePhase,
  deriveTimelineEntriesWithState,
  deriveTurnPlans,
  deriveWorkLogEntries,
  selectHandoffImageResources,
} from "../../session-logic";
import type { EnvironmentThread } from "@t3tools/client-runtime/state/models";

import { HELD_READ_EVERY_MS, useHeld } from "./heldRead";
import { useThread, useThreadDetail, useThreadShell, useThreadStatus } from "../../state/entities";
import { useEnvironmentThread } from "../../state/threads";
import { deriveZeropsThreadModel } from "../../state/zerops";
import { resolveThreadSyncPhase } from "../../threadSync";
import {
  useZeropsChangeLandedEvents,
  useZeropsConversationLandings,
} from "../../zerops/useZeropsChangeLandedEvents";
import { useZeropsLifecycle } from "../../zerops/useZeropsFeeds";
import { useDeployBuilds, useRunningBuildDemand } from "../../zerops/activity/useDeployBuilds";
import { deriveDock, foldBackgroundTasks, latestUsagePause } from "./conversationDock.logic";
import { readTimelinePosition } from "./timelineScrollAnchoring";
import { crewChatEntries } from "../zerops/crew/crewChatSeams";
import type { MessagesTimeline } from "./MessagesTimeline";

type TimelineProps = ComponentProps<typeof MessagesTimeline>;

/**
 * What of the list is the conversation's own — its own values, or nothing
 * where only the open conversation has any (a message on its way, an
 * anchor); the rest is the pane's.
 */
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
  | "afterTurnWork"
  | "workingStepLabel"
  | "isCompacting"
  | "activeTurnStartedAt"
  | "agentPanelModel"
  | "queuedMessages"
  | "anchorMessageId"
  | "liveFollowEnabled"
  | "hideEmptyPlaceholder"
  | "loading"
  | "syncing"
  | "usagePause"
  | "loadEarlier"
>;

const NO_ACTIVITIES: [] = [];
const NO_ATTACHMENT_HANDOFF = {};
const NO_AGENTS = emptyAgentPanelModel();

/**
 * Where a held read takes its conversation anew (`useHeld`): a turn starting,
 * ending or failing, the session changing state.
 */
export function warmReadBeat(thread: EnvironmentThread | null): string {
  if (thread === null) return "";
  const turn = thread.latestTurn;
  return [
    turn?.turnId ?? "",
    turn?.state ?? "",
    turn?.completedAt ?? "",
    thread.session?.status ?? "",
    thread.session?.activeTurnId ?? "",
  ].join("|");
}

/**
 * `openEnvironmentId` stands in for its pictures' environment until its key
 * is read. `hold`: a list out of sight that nobody is about to open reads its
 * conversation at once as a turn starts or ends (`warmReadBeat`), and what
 * streams there about once a second (`HELD_READ_EVERY_MS`), never on every
 * word; let go, it reads live at once.
 */
export function useWarmTimeline(
  threadKey: string | null,
  openEnvironmentId: EnvironmentId,
  hold = false,
): WarmTimelineProps | null {
  const ref = useMemo(
    () => (threadKey === null ? null : parseScopedThreadKey(threadKey)),
    [threadKey],
  );
  const liveThread = useThread(ref);
  const liveDetail = useThreadDetail(ref);
  const liveShell = useThreadShell(ref);
  const liveStatus = useThreadStatus(ref);
  const live = useMemo(
    () => ({ thread: liveThread, detail: liveDetail, shell: liveShell, status: liveStatus }),
    [liveThread, liveDetail, liveShell, liveStatus],
  );
  const read = useHeld(
    live,
    // Until its conversation has loaded, it reads every change: it fills.
    hold && liveThread?.checkpoints !== undefined,
    warmReadBeat(liveThread),
    HELD_READ_EVERY_MS,
  );
  const { thread, detail, shell, status } = read;
  const environmentId = ref?.environmentId ?? null;
  const threadId = ref?.threadId ?? null;
  const activities = thread?.activities ?? NO_ACTIVITIES;
  const latestTurn = thread?.latestTurn ?? null;
  const session = thread?.session ?? null;
  const runningTurnId =
    (session?.status === "running" ? session.activeTurnId : null) ??
    (latestTurn?.state === "running" ? latestTurn.turnId : null);
  const lifecycle = useZeropsLifecycle(environmentId, threadId);
  const { builds, projectId } = useDeployBuilds(lifecycle);
  const zerops = useMemo(
    () => deriveZeropsThreadModel({ activities, lifecycle, runningTurnId, builds }),
    [activities, lifecycle, runningTurnId, builds],
  );
  useRunningBuildDemand(projectId, zerops.running);
  const zeropsActivityIds = zerops.zeropsActivityIds;
  const zeropsEntries = zerops.entries;
  const workLog = useMemo(
    () => deriveWorkLogEntries(activities, { exclude: zeropsActivityIds }),
    [activities, zeropsActivityIds],
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
  const proposedPlans = thread?.proposedPlans;
  const entries = useMemo(
    () =>
      deriveTimelineEntriesWithState(
        messages,
        proposedPlans ?? [],
        workLog,
        null,
        turnPlans,
        zeropsEntries,
        landings,
      ).entries,
    [landings, messages, proposedPlans, turnPlans, workLog, zeropsEntries],
  );
  const phase = derivePhase(session);
  const isWorking = phase === "running" || phase === "connecting";
  const latestUserMessageAt = shell?.latestUserMessageAt ?? null;
  const activeTurnStartedAt = deriveActiveWorkStartedAt(
    latestTurn,
    session,
    null,
    latestUserMessageAt,
  );
  const usagePause = shell?.usagePause ?? null;
  const working = useMemo(
    () =>
      deriveDock({
        timelineEntries: entries,
        isWorking,
        runningTurnId,
        turnStartedAt: activeTurnStartedAt,
        agentPanelModel: NO_AGENTS,
        plan: null,
        backgroundTasks: foldBackgroundTasks(activities),
        pause: usagePause ? { resetsAt: usagePause.resetsAt } : latestUsagePause(entries),
      }),
    [activeTurnStartedAt, activities, entries, isWorking, runningTurnId, usagePause],
  );
  const queuedMessages = useQueuedMessages(threadKey ?? "");
  const pageState = useEnvironmentThread(environmentId, threadId);
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
  const checkpoints = thread?.checkpoints;
  // A crewmate's chat opens on its own rows, as the pane draws it.
  const inCrewChat = shell?.crew != null;
  const conversationEntries = useMemo(
    () => (inCrewChat ? crewChatEntries(entries, loadEarlier === null) : entries),
    [entries, inCrewChat, loadEarlier],
  );
  return useMemo((): WarmTimelineProps | null => {
    if (ref === null || checkpoints === undefined) return null;
    const detailLoading = syncPhase === "loading";
    return {
      timelineEntries: conversationEntries,
      latestTurn,
      runningTurnId,
      turnDiffSummaries: checkpoints,
      activeThreadEnvironmentId: ref.environmentId,
      routeThreadKey: scopedThreadKey(ref),
      isWorking,
      working,
      afterTurnWork: null,
      workingStepLabel: null,
      isCompacting: false,
      activeTurnStartedAt,
      agentPanelModel: NO_AGENTS,
      queuedMessages,
      anchorMessageId: null,
      // As the pane opens it: where the person left it, else its end.
      liveFollowEnabled: readTimelinePosition(scopedThreadKey(ref))?.atEnd !== false,
      hideEmptyPlaceholder: detailLoading,
      loading: detailLoading,
      syncing: syncPhase !== null,
      usagePause,
      loadEarlier,
    };
  }, [
    activeTurnStartedAt,
    checkpoints,
    conversationEntries,
    isWorking,
    latestTurn,
    loadEarlier,
    queuedMessages,
    ref,
    runningTurnId,
    syncPhase,
    usagePause,
    working,
  ]);
}
