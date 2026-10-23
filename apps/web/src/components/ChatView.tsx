import { usePlatformCapabilities } from "../zerops/usePlatformCapabilities";
import { useBranchAdvice } from "./useBranchAdvice";
import { isUsageLimitError, mateHealthAtom } from "@t3tools/client-runtime/data";
import { zeropsCommands } from "../state/zeropsCommands";
import {
  admissionNeedsSignIn,
  agentAdmission,
  engineCardsShowError,
  engineRunRefusal,
  type AgentRefusalSource,
} from "@t3tools/client-runtime/data";
import { useAgentAdmissionPlacement } from "../zerops/AgentAdmissionComposition";
import { AgentAdmissionExplanation } from "./chat/AgentAdmissionExplanation";
import {
  resolveZeropsProviderAvailability,
  isZeropsInstanceRunnable,
} from "@t3tools/client-runtime/data";
import {
  OrchestrationDispatchCommandError,
  agentIdForDriverKind,
  agentIdForProviderInstance,
} from "@t3tools/contracts";
import { mateDiagnostics } from "@t3tools/client-runtime/zerops/diagnostics";
import { useMateRecoveryAction } from "../zerops/useMateRecoveryAction";
import { useMateRepositories } from "../zerops/useMateRepositories";
import { useThreadLeases } from "../zerops/useThreadLeases";
import { terminalStartCwd } from "../zerops/terminalCwd.logic";
import { useHqProjectPerson, zeropsMateOwnerOf } from "../zerops/useZeropsMateOwners";
import { useEngineRunCards } from "../zerops/useEngineCardPaging";
import { useQuestionAttachments } from "./chat/useQuestionAttachments";
import { agentContext } from "@t3tools/client-runtime/data";
import { Loading } from "./ui/loading";
import { crewCardOf, engineWorkRunsOn, timelineEntryTurnId } from "./chat/conversation.logic";
import { useStandupsDone } from "../zerops/activity/useStandupReading";
import { mateLimitAtom } from "@t3tools/client-runtime/data";
import { useThreadModelSelection } from "../zerops/useThreadModelSelection";
import type {
  ChatAttachment as ContractChatAttachment,
  UploadChatAttachment,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import {
  collectProviderUsageLimits,
  hasProviderUsageLimits,
  isUsageLimitsCommand,
} from "@t3tools/shared/usageLimits";
import { keptAgentPanelModel } from "./chat/keptAgentPanelModel";
import { usageLimitsNotice } from "./chat/UsageLimitsNotice";
import { ServiceBrowserScope } from "./ServiceBrowserLink";
import { feedbackNotice } from "./chat/FeedbackNotice";
import { ComposerPlaceLine, composerPlaceNotice } from "./chat/ComposerPlace";
import { cloneSendBlockReason, ComposerCloneAsk } from "./chat/ComposerCloneAsk";
import {
  branchChangedNotice,
  crewNextConversationNotice,
  noticesHome,
  personNoticeArrived,
  resumeCompactionNotice,
} from "./chat/conversationNotices";
import { NoticesOverComposer } from "./chat/NoticesOverComposer";
import type { ConversationNotice } from "./chat/ConversationRows";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import {
  type ApprovalRequestId,
  DEFAULT_MODEL,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectScript,
  type ProjectId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ProviderApprovalDecision,
  ProviderInstanceId,
  type ServerProvider,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type ThreadId,
  type TurnId,
  type KeybindingCommand,
  OrchestrationThreadActivity,
  ProviderInteractionMode,
  ProviderDriverKind,
  RuntimeMode,
  TerminalOpenInput,
} from "@t3tools/contracts";
import { type EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { wasBootstrapThreadDeleted } from "@t3tools/client-runtime/errors";
import {
  parseCodexFeedbackCommand,
  submitCodexFeedback,
  type CodexFeedbackSubmission,
} from "@t3tools/client-runtime/state/threads";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  applyClaudePromptEffortPrefix,
  createModelSelection,
  resolvePromptInjectedEffort,
} from "@t3tools/shared/model";
import { CHAT_LIST_ANCHOR_OFFSET } from "@t3tools/shared/chatList";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  resolveProjectScripts,
} from "@t3tools/shared/projectScripts";
import { truncate } from "@t3tools/shared/String";
import { IMAGE_ONLY_BOOTSTRAP_PROMPT, isSlashCommand } from "@t3tools/shared/userAsk";
import {
  getTerminalLabel,
  nextTerminalId,
  resolveTerminalSessionLabel,
} from "@t3tools/shared/terminalLabels";
import { Debouncer } from "@tanstack/react-pacer";
import { useAtomValue } from "@effect/atom-react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { Link, useNavigate } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  settlePromise,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { isElectron } from "../env";
import { readLocalApi } from "../localApi";
import { useDiffPanelStore } from "../diffPanelStore";
import {
  collapseExpandedComposerCursor,
  type ComposerSubmissionIntent,
  isStandaloneMcpCommand,
  parseStandaloneComposerSlashCommand,
} from "../composer-logic";
import {
  createMessageAttachmentPreviewProjector,
  derivePhase,
  deriveTimelineEntriesWithState,
  deriveActiveWorkStartedAt,
  deriveActivePlanState,
  deriveTurnPlans,
  findLatestProposedPlan,
  deriveWorkLogEntries,
  hasActionableProposedPlan,
  selectHandoffImageResources,
  type TimelineEntriesProjection,
} from "../session-logic";
import { deriveZeropsThreadModel } from "../state/zerops";
import { isLatestTurnSettled } from "@t3tools/shared/orchestrationTiming";
import { type LegendListRef } from "@legendapp/list/react";
import {
  getAnchoredTurnMetrics,
  readTimelinePosition,
  readDraftTimelineAnchor,
  rememberDraftTimelineAnchor,
  type TimelineScrollMode,
} from "./chat/timelineScrollAnchoring";
import {
  buildPendingUserInputAnswers,
  carryDisplacedCustomAnswerIntoPrompt,
  derivePendingUserInputProgress,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../pendingUserInput";
import { useUiStateStore } from "../uiStateStore";
import {
  buildPlanImplementationThreadTitle,
  buildPlanImplementationPrompt,
  resolvePlanFollowUpSubmission,
} from "../proposedPlan";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ChatMessage,
  isImageAttachment,
  type SessionPhase,
  type Thread,
} from "../types";
import { useTheme } from "../hooks/useTheme";
import { isCommandPaletteOpen } from "../commandPaletteBus";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import {
  isRightPanelSite,
  resolveRightPanelAvailability,
  type RightPanelKind,
} from "../rightPanelKinds";
import {
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectThreadRightPanelState,
  type RightPanelSurface,
  useRightPanelStore,
} from "../rightPanelStore";
import { makeWorkspaceFileDropHandlers } from "./chat/workspaceFileDrop";
import { RightPanelTabs } from "./RightPanelTabs";
import { conversationPanelWidth } from "./chat/conversationPanelStandIn.logic";
import { ServiceBrowserPanels } from "./ServiceBrowserPanel";
import { useMateAddresses } from "../zerops/useMateAddresses";
import { useCrew } from "../zerops/crew/useCrew";
import { useCrewAccess } from "../zerops/crew/useCrewAccess";
import { useOpenZeropsChange } from "../zerops/useOpenZeropsChange";
import { useThreadOnScreen } from "../zerops/threadOnScreen";
import { useZeropsNextStepStrip } from "./zerops/ZeropsNextStepBanner";
import { zeropsMateAt } from "../zerops/mateIdentities";
import { automatedMateEntries, conversationTask } from "../zerops/automatedMate.logic";
import { mateVoiceSpeaks } from "@t3tools/client-runtime/zerops/environments";
import { useMateVoice } from "../zerops/mateVoiceContext";
import { useReviveFailedMate } from "../zerops/mateRestart";
import { useZeropsMate, useZeropsMateDirectory } from "../zerops/useZeropsMates";
import { originAskPlaces, originAskPlacesKey } from "./zerops/origin/originAsk.logic";
import { MateFaceAsMark } from "./zerops/primitives";
import { ComposerRoomHeld } from "./chat/ComposerStandIn";
import {
  nextReadAlongRoom,
  releaseReadAlongRoom,
  type ReadAlongRoom,
} from "./chat/ComposerRoom.logic";
import { ZeropsReadOnlyConversationFooter } from "./zerops/ZeropsReadOnlyConversationFooter";
import { CrewLeadPlan } from "./zerops/crew/CrewLeadPlan";
import { type CrewTimeline } from "./zerops/crew/CrewTaskCard";
import { crewCardOrigin } from "./zerops/crew/CrewTaskCard.logic";
import { crewRunsOn } from "./zerops/crew/CrewEditors.logic";
import { crewChatNotices } from "./zerops/crew/crewChatNotices";
import { crewChatEntries } from "./zerops/crew/crewChatSeams";
import { crewComposerMentions, crewMessageCommand } from "./zerops/crew/crewComposerSend";
import { queuedSendAwaitsServer, turnSendAsk } from "./chat/queuedMessageSender.logic";
import {
  crewMessagePlaceholder,
  crewRunsOnWord,
} from "@t3tools/client-runtime/zerops/crew/phrases";
import { useMateCommand, useTryMateAgain } from "../zerops/accountEnvironments";
import { crewCommands } from "../zerops/crew/crewCommands";
import { openCrewView } from "../zerops/crew/crewTab";
import { crewFailureSentence } from "../zerops/crew/useCrewCommand";
import { resolveZeropsChatChrome } from "../zerops/chatChrome";
import { resolveComposerPlaceholders } from "../composerPlaceholder";
import {
  useEnvironmentProjectRef,
  useZeropsAgentAuth,
  useZeropsLifecycle,
} from "../zerops/useZeropsFeeds";
import { useDeployBuilds, useRunningBuildDemand } from "../zerops/activity/useDeployBuilds";
import {
  useZeropsChangeLandedEvents,
  useZeropsMateAppDetailHold,
  useZeropsConversationLandings,
  useZeropsProductionLive,
} from "../zerops/useZeropsChangeLandedEvents";
import { useVaultTurnNotes } from "../zerops/vaultTurnNotes";
import { vaultChipsOnlyText } from "../zerops/vaultTurnNotes.logic";
import {
  agentLastSpokeAt,
  agentNotesFor,
  agentTurnNotes,
  agentNeedsSignIn,
  productionTurnNotes,
} from "@t3tools/client-runtime/zerops";
import { MATE_READ_ACCESS_LINE } from "@t3tools/client-runtime/zerops/mateAccess";
import { useZeropsSessionOptional } from "../zerops/ZeropsSessionProvider";
import {
  nextTimelineFollow,
  type TimelineScrollDirection,
} from "@t3tools/client-runtime/zerops/timelineFollow";
import { useZeropsTopology } from "../zerops/useZeropsFeeds";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { BranchToolbar, type BranchToolbarHandle } from "./BranchToolbar";
import { resolveShortcutCommand, shortcutLabelForCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { undoLatestThreadAction } from "../hooks/showUndoToast";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";
import { ArrowDownIcon, PaperclipIcon } from "lucide-react";
import { cn, randomHex } from "~/lib/utils";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { decodeProjectScriptKeybindingRule } from "~/lib/projectScriptKeybindings";
import { type NewProjectScriptInput } from "./ProjectScriptsControl";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  projectScriptIdFromCommand,
} from "~/projectScripts";
import { newCommandId, newDraftId, newMessageId, newThreadId } from "~/lib/utils";
import { getProviderModelCapabilities } from "../providerModels";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  NO_PROVIDER_MODEL_SELECTION,
  sortProviderInstanceEntries,
} from "../providerInstances";
import { useClientSettings, useEnvironmentSettings } from "../hooks/useSettings";
import { useNowMinute } from "../hooks/useNowMinute";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useRemoveClonedProject } from "../hooks/useRemoveClonedProject";
import { ThreadArchiveBlockedError, useThreadActions } from "../hooks/useThreadActions";
import {
  composerAdmits,
  tellSendOutcome,
  useComposerSendRequests,
  type ComposerSendResult,
} from "../hooks/useComposerSendRequests";
import { resolveAppModelSelectionForInstance } from "../modelSelection";
import { confirmTerminalClose, isTerminalCloseConfirmPending } from "../lib/terminalCloseConfirm";
import { getTerminalFocusOwner } from "../lib/terminalFocus";
import {
  preventRepeatedTerminalCloseShortcut,
  preventTerminalCloseShortcut,
} from "../lib/terminalCloseShortcut";
import { resolveNewDraftStartFromOrigin } from "../lib/chatThreadActions";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import {
  beginBackgroundDraftSubmissionByRef,
  clearBackgroundDraftSubmissionByRef,
  composerDraftHasUserContent,
  type ComposerImageAttachment,
  type ComposerSendIds,
  type DraftThreadEnvMode,
  finalizePromotedDraftThreadByRef,
  markPromotedDraftThreadByRef,
  useComposerDraftStore,
  type DraftId,
} from "../composerDraftStore";
import { materializePicturePrompt, optimisticPictureAttachments } from "../lib/composerPictures";
import { composerAttachmentCount, optimisticFileAttachments } from "../lib/composerFiles";
import {
  appendTerminalContextsToPrompt,
  formatTerminalContextLabel,
  type TerminalContextDraft,
  type TerminalContextSelection,
} from "../lib/terminalContext";
import {
  beginQueuedSend,
  drainGenerationOf,
  isQueuedMessageDue,
  settleQueuedSend,
  queuedSendAttemptIds,
  latestCompletedToolActivityId,
  type QueuedComposerMessage,
  useQueuedMessages,
  useQueuedMessageStore,
} from "../queuedMessageStore";
import { useStopConversation, useStopPress, useStopPressStore } from "../zerops/conversationStop";
import { conversationStop, STOPPED_WORDS } from "../zerops/conversationStop.logic";
import { appendReviewCommentsToPrompt, type ReviewCommentContext } from "../reviewCommentContext";
import { environmentCatalog } from "../connection/catalog";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { useKnownTerminalSessions, useThreadRunningTerminalIds } from "../state/terminalSessions";
import { useEnvironmentQuery } from "../state/query";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
  primaryServerSettingsAtom,
  serverEnvironment,
} from "../state/server";
import { terminalEnvironment } from "../state/terminal";
import { threadEnvironment, useEnvironmentThread } from "../state/threads";
import {
  requestOlderThreadTurns,
  threadHasOlderTurns,
} from "@t3tools/client-runtime/state/threads";
import { resolveProviderSkillsForCwd } from "@t3tools/client-runtime/providerSkills";
import { vcsEnvironment } from "../state/vcs";
import { sourceControlEnvironment } from "../state/sourceControl";
import { useProjectClone } from "../state/projectClones";
import { useEnvironments, usePrimaryEnvironment } from "../state/environments";
import {
  useEnvironmentProjectRefs,
  useProject,
  useProjects,
  useThread,
  useThreadRefs,
  useThreadShell,
} from "../state/entities";
import { environmentShell } from "../state/shell";
import { ChatComposer, type ChatComposerHandle } from "./chat/ChatComposer";
import { DraftHeroHeadline } from "./chat/DraftHeroHeadline";
import { zeropsAgentAuthView } from "@t3tools/client-runtime/zerops/agentLogin";
import { mateShowsSignIn } from "~/zerops/mateSignIn";
import { useMateStandUp } from "~/zerops/useMateStandUp";
import { useSendTurnReceipts } from "~/zerops/sentAsk";
import { useZeropsAgentSignInDialog } from "~/zerops/useZeropsAgentSignInDialog";
import { ExpandedImageDialog } from "./chat/ExpandedImageDialog";
import { PullRequestThreadDialog } from "./PullRequestThreadDialog";
import { MessagesTimeline, type TimelinePersonInput } from "./chat/MessagesTimeline";
import { KeptTimelines } from "./chat/KeptTimelines";
import { useWarmTimelineAsk } from "./chat/warmTimeline";
import { shouldTypeToFocusComposer } from "./chat/typeToFocus";
import { rememberTimelineInset, rememberedTimelineInset } from "./chat/timelineInsets";
import { resolveTimelineIsAtEnd, type MateAway } from "./chat/MessagesTimeline.logic";
import { ChatHeader } from "./chat/ChatHeader";
import { useAlsoWorkingHint, useMateWorks } from "./chat/ConversationStrip";
import { PanelLayoutControls, RightPanelMaximizeControl } from "./chat/PanelLayoutControls";
import { type ExpandedImagePreview } from "./chat/ExpandedImagePreview";
import { NoActiveThreadState } from "./NoActiveThreadState";
import { WorkspacePageHeader } from "./WorkspacePageHeader";
import { RightPanelPage, RightPanelPageEdgeScope } from "./RightPanelPage";
import {
  resolveEffectiveEnvMode,
  resolveLocalCheckoutBranchMismatch,
  shouldShowComposerContextStrip,
  shouldShowEnvironmentIndicator,
} from "./BranchToolbar.logic";
import {
  dismissThreadError,
  threadErrorDismissalKey,
  threadErrorDismissed,
  threadErrorNotice,
} from "./chat/threadErrorNotice.logic";
import { ComposerBannerStack, type ComposerBannerStackItem } from "./chat/ComposerBannerStack";
import { mateHealthBannerItem } from "./chat/MateHealthBanner";
import { deriveDock, foldBackgroundTasks } from "./chat/conversationDock.logic";
import { liveJobsOf } from "./chat/liveJobs.logic";
import { useLiveJobs } from "./chat/useLiveJobs";
import {
  environmentConnectionBannerItem,
  mateVoiceBannerItem,
  environmentRetryFailureToast,
} from "./chat/EnvironmentConnectionBanner";
import {
  hasAvailableCompactionProvider,
  hasDismissedResumeCompaction,
  shouldOfferResumeCompaction,
} from "./chat/ContextWindowMeter.logic";
import { deriveLatestContextWindowSnapshot } from "../lib/contextWindow";
import { ThreadSyncStatusPill } from "./chat/ThreadSyncStatusPill";
import {
  DRAFT_HERO_TRANSITION_ANIMATION_ID,
  DRAFT_HERO_TRANSITION_DURATION_MS,
  DRAFT_HERO_TRANSITION_EASING,
  MOBILE_COMPOSER_VIEW_TRANSITION_NAME,
  MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME,
  runMobileComposerTransition,
} from "./chat/draftHeroTransition";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  buildExpiredTerminalContextToastCopy,
  buildLocalDraftThread,
  buildLoadingThreadFromShell,
  buildRunningThreadTurnInterruptInput,
  buildThreadTurnInterruptInput,
  collectUserMessageBlobPreviewUrls,
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  projectScriptKeybindingWrites,
  hasEnvironmentReconnectWarningGraceElapsed,
  latestTurnStartFailureId,
  scheduleEnvironmentReconnectWarning,
  hasServerAcknowledgedLocalDispatch,
  shouldDockDraftHeroForSubmission,
  shouldReleaseTimelineAnchorForToolActivity,
  getStartedThreadModelChangeBlockReason,
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
  type LocalDispatchSnapshot,
  PullRequestDialogState,
  cloneComposerImageForRetry,
  deriveLockedProvider,
  readFileAsDataUrl,
  restoreQueuedToComposer,
  reconcileMountedTerminalThreadIds,
  recallCheckoutIsRepo,
  rememberCheckoutIsRepo,
  resolveBackgroundDraftWorkspaceOptions,
  resolveComposerInteractionMode,
  resolveComposerProviderSelection,
  resolveDraftHeroState,
  helpersSessionLive,
  colleagueMateReadOnly,
  composerOpenFocus,
  conversationContentPending,
  localThreadErrorStanding,
  queuedSendOutcome,
  sendStepAfterUploads,
  type QueuedSendFailure,
  newestPersonTurn,
  threadErrorEntryUnchanged,
  peekRememberedThreadTimeline,
  rememberReadyThreadTimeline,
  resolveThreadSwitchTimeline,
  timelineHasEphemeralPreviewUrls,
  resolveThreadMetadataUpdateForNextTurn,
  resolveSendEnvMode,
  revokeBlobPreviewUrl,
  revokeUserMessagePreviewUrls,
  shouldWriteThreadErrorToCurrentServerThread,
  startNewThreadForProject,
  waitForStartedServerThread,
  shouldRefocusComposerOnWindowFocus,
} from "./ChatView.logic";
import type { ThreadSyncPhase } from "../threadSync";
import { useDelayedStatus } from "../hooks/useDelayedStatus";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useComposerHandleContext } from "../composerHandleContext";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseAttachmentUploads,
  startAttachmentUpload,
  startFileUpload,
} from "../lib/attachmentUploadQueue";
import { sanitizeThreadErrorMessage } from "~/rpc/transportError";
import { RightPanelSheet } from "./RightPanelSheet";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { useAssetUrls } from "../assets/assetUrls";
import { appChunk } from "../lib/appChunks";

const EMPTY_ACTIVITIES: OrchestrationThreadActivity[] = [];
const EMPTY_PROVIDERS: ServerProvider[] = [];
const EMPTY_USAGE_LIMIT_SOURCES: UsageLimitSourceSnapshots = [];
const EMPTY_PROVIDER_SKILLS: ServerProvider["skills"] = [];
const EMPTY_CONVERSATION_NOTICES: ReadonlyArray<ConversationNotice> = [];
/**
 * A Stop pressed here ended everything: the conversation's last row says so, calmly, unless the
 * stopped run's card already does.
 */
const STOPPED_NOTICE = { words: STOPPED_WORDS, calm: true, stop: true } as const;
const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {};
function useDraftHeroLayoutTransition(isDraftHeroState: boolean) {
  const transitionGroupRef = useRef<HTMLDivElement | null>(null);
  const composerAnchorRef = useRef<HTMLDivElement | null>(null);
  const previousStateRef = useRef(isDraftHeroState);
  const previousComposerRectRef = useRef<DOMRect | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const attachTransitionGroupRef = (element: HTMLDivElement | null) => {
    transitionGroupRef.current = element;
  };
  const attachComposerAnchorRef = (element: HTMLDivElement | null) => {
    composerAnchorRef.current = element;
  };
  const captureComposerRect = () => {
    previousComposerRectRef.current = composerAnchorRef.current?.getBoundingClientRect() ?? null;
  };

  useLayoutEffect(() => {
    const transitionGroup = transitionGroupRef.current;
    const nextComposerRect = composerAnchorRef.current?.getBoundingClientRect() ?? null;
    const stateChanged = previousStateRef.current !== isDraftHeroState;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const mobileComposerTransitionActive =
      typeof document !== "undefined" &&
      document.documentElement.dataset.mobileComposerRouteTransition === "true";

    animationRef.current?.cancel();
    animationRef.current = null;

    const previousComposerRect = previousComposerRectRef.current;
    if (
      stateChanged &&
      !prefersReducedMotion &&
      !mobileComposerTransitionActive &&
      transitionGroup &&
      previousComposerRect &&
      nextComposerRect &&
      typeof transitionGroup.animate === "function"
    ) {
      const translateX = previousComposerRect.left - nextComposerRect.left;
      const translateY = previousComposerRect.top - nextComposerRect.top;
      if (Math.abs(translateX) >= 0.5 || Math.abs(translateY) >= 0.5) {
        const animation = transitionGroup.animate(
          [
            { transform: `translate3d(${translateX}px, ${translateY}px, 0)` },
            { transform: "translate3d(0, 0, 0)" },
          ],
          {
            duration: DRAFT_HERO_TRANSITION_DURATION_MS,
            easing: DRAFT_HERO_TRANSITION_EASING,
          },
        );
        animation.id = DRAFT_HERO_TRANSITION_ANIMATION_ID;
        animationRef.current = animation;
        void animation.finished
          .catch(() => undefined)
          .then(() => {
            if (animationRef.current !== animation) {
              return;
            }
            animationRef.current = null;
          });
      }
    }

    previousStateRef.current = isDraftHeroState;
    previousComposerRectRef.current = nextComposerRect;
  }, [isDraftHeroState]);

  return [attachTransitionGroupRef, attachComposerAnchorRef, captureComposerRect] as const;
}
const AgentsPanel = lazy(
  appChunk(() => import("./AgentsPanel").then((module) => ({ default: module.AgentsPanel }))),
);
const ZeropsBrowserSurface = lazy(
  appChunk(() =>
    import("./zerops/ZeropsBrowserSurface").then((module) => ({
      default: module.ZeropsBrowserSurface,
    })),
  ),
);
const ZeropsMacSurface = lazy(
  appChunk(() =>
    import("./zerops/ZeropsMacSurface").then((module) => ({
      default: module.ZeropsMacSurface,
    })),
  ),
);
const ZeropsGitSurface = lazy(
  appChunk(() =>
    import("./zerops/ZeropsGitSurface").then((module) => ({ default: module.ZeropsGitSurface })),
  ),
);
const ZeropsDataPanel = lazy(
  appChunk(() =>
    import("./zerops/ZeropsDataPanel").then((module) => ({ default: module.ZeropsDataPanel })),
  ),
);
const ZeropsChangeDetailPage = lazy(
  appChunk(() =>
    import("./zerops/ZeropsGroupDetail").then((module) => ({
      default: module.ZeropsChangeDetailPage,
    })),
  ),
);
const CrewPanel = lazy(
  appChunk(() =>
    import("./zerops/crew/CrewPanel").then((module) => ({ default: module.CrewPanel })),
  ),
);
const ZeropsProjectsPage = lazy(
  appChunk(() =>
    import("./zerops/ZeropsProjectsPage").then((module) => ({
      default: module.ZeropsProjectsPage,
    })),
  ),
);
const McpPanel = lazy(
  appChunk(() => import("./mcp/McpPanel").then((module) => ({ default: module.McpPanel }))),
);
const ZeropsPanel = lazy(
  appChunk(() =>
    import("./zerops/ZeropsPanel").then((module) => ({ default: module.ZeropsPanel })),
  ),
);
const VaultPanelContainer = lazy(
  appChunk(() =>
    import("./zerops/vault/VaultPanelContainer").then((module) => ({
      default: module.VaultPanelContainer,
    })),
  ),
);
const DiffPanel = lazy(appChunk(() => import("./DiffPanel")));
const FilePreviewPanel = lazy(appChunk(() => import("./files/FilePreviewPanel")));
const EMPTY_PENDING_FILE_SURFACE_IDS: ReadonlySet<string> = new Set();
type EnvironmentUnavailableState = {
  readonly environmentId: EnvironmentId;
  readonly connection: EnvironmentConnectionPresentation;
};

/** The effort written into a prompt's text, for the agents that read it there; null where none is. */
function outgoingPromptEffort(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
}): string | null {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider);
  return resolvePromptInjectedEffort(caps, params.effort) ?? null;
}

function formatOutgoingPrompt(params: {
  provider: ProviderDriverKind;
  model: string | null;
  models: ReadonlyArray<ServerProvider["models"][number]>;
  effort: string | null;
  text: string;
}): string {
  return applyClaudePromptEffortPrefix(params.text, outgoingPromptEffort(params));
}
const SCRIPT_TERMINAL_COLS = 120;
const SCRIPT_TERMINAL_ROWS = 30;

function isCompactCommandMessage(message: ChatMessage): boolean {
  // The role first: the Mate's words run long, and are never a command.
  return (
    message.role === "user" &&
    !message.attachments?.length &&
    message.text.trim().toLowerCase() === "/compact"
  );
}

type ChatViewProps =
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      threadSyncPhase?: ThreadSyncPhase | null;
      routeKind: "server";
      draftId?: never;
    }
  | {
      environmentId: EnvironmentId;
      threadId: ThreadId;
      onDiffPanelOpen?: () => void;
      reserveTitleBarControlInset?: boolean;
      forceExpandedMobileComposer?: boolean;
      threadSyncPhase?: never;
      routeKind: "draft";
      draftId: DraftId;
    };

interface TerminalLaunchContext {
  threadId: ThreadId;
  cwd: string;
  worktreePath: string | null;
}

type PersistentTerminalLaunchContext = Pick<TerminalLaunchContext, "cwd" | "worktreePath">;

const isThreadArchiveBlockedError = Schema.is(ThreadArchiveBlockedError);

function useLocalDispatchState(input: {
  activeThread: Thread | undefined;
  activeLatestTurn: Thread["latestTurn"] | null;
  phase: SessionPhase;
  activePendingApproval: ApprovalRequestId | null;
  activePendingUserInput: ApprovalRequestId | null;
  threadError: string | null | undefined;
}) {
  const [localDispatch, setLocalDispatch] = useState<LocalDispatchSnapshot | null>(null);
  const latestUserMessage = input.activeThread?.messages.findLast(
    (message) => message.role === "user",
  );
  const latestUserMessageId = latestUserMessage?.id ?? null;
  const currentTurnStartFailureId =
    localDispatch === null
      ? null
      : latestTurnStartFailureId(input.activeThread, latestUserMessageId);

  const resetLocalDispatch = useCallback(() => {
    setLocalDispatch(null);
  }, []);

  const serverAcknowledgedLocalDispatch = useMemo(
    () =>
      hasServerAcknowledgedLocalDispatch({
        localDispatch,
        phase: input.phase,
        latestTurn: input.activeLatestTurn,
        latestUserMessageId,
        session: input.activeThread?.session ?? null,
        hasPendingApproval: input.activePendingApproval !== null,
        hasPendingUserInput: input.activePendingUserInput !== null,
        latestTurnStartFailureId: currentTurnStartFailureId,
        threadError: input.threadError,
      }),
    [
      input.activeLatestTurn,
      input.activePendingApproval,
      input.activePendingUserInput,
      input.activeThread?.session,
      input.phase,
      input.threadError,
      latestUserMessageId,
      currentTurnStartFailureId,
      localDispatch,
    ],
  );
  const activeLocalDispatch = serverAcknowledgedLocalDispatch ? null : localDispatch;
  const beginLocalDispatch = useCallback(
    (options?: { preparingWorktree?: boolean; submissionIntent?: ComposerSubmissionIntent }) => {
      const preparingWorktree = Boolean(options?.preparingWorktree);
      setLocalDispatch((current) => {
        const active = serverAcknowledgedLocalDispatch ? null : current;
        if (active) {
          const submissionIntent = options?.submissionIntent ?? active.submissionIntent;
          return active.preparingWorktree === preparingWorktree &&
            active.submissionIntent === submissionIntent
            ? active
            : { ...active, preparingWorktree, submissionIntent };
        }
        return createLocalDispatchSnapshot(input.activeThread, options);
      });
    },
    [input.activeThread, serverAcknowledgedLocalDispatch],
  );

  return {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt: activeLocalDispatch?.startedAt ?? null,
    latestUserMessageAt: latestUserMessage?.createdAt ?? null,
    isPreparingWorktree: activeLocalDispatch?.preparingWorktree ?? false,
    isSendBusy: activeLocalDispatch !== null,
    backgroundSubmissionPending: localDispatch?.submissionIntent === "background",
  };
}

/** Same terminal ids (order ignored) — avoids reconcile when only server session ordering differs. */
function terminalIdListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  if (left.length === 0) {
    return true;
  }
  const sortedLeft = left.toSorted((a, b) => a.localeCompare(b));
  const sortedRight = right.toSorted((a, b) => a.localeCompare(b));
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (sortedLeft[index] !== sortedRight[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Server knows about fewer sessions than the client, but every server id still exists locally.
 * Typical right after `terminal.open`: known-session list lags; reconciling would drop the new id
 * and later re-add it as a separate group (no split layout).
 */
function serverTerminalIdsStrictSubsetOfClient(
  serverIds: readonly string[],
  clientIds: readonly string[],
): boolean {
  if (serverIds.length >= clientIds.length || clientIds.length === 0) {
    return false;
  }
  const clientSet = new Set(clientIds);
  for (const id of serverIds) {
    if (!clientSet.has(id)) {
      return false;
    }
  }
  return true;
}

interface PersistentThreadTerminalDrawerProps {
  threadRef: { environmentId: EnvironmentId; threadId: ThreadId };
  threadId: ThreadId;
  visible: boolean;
  launchContext: PersistentTerminalLaunchContext | null;
  focusRequestId: number;
  splitShortcutLabel: string | undefined;
  splitVerticalShortcutLabel: string | undefined;
  newShortcutLabel: string | undefined;
  closeShortcutLabel: string | undefined;
  keybindings: ResolvedKeybindingsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

const PersistentThreadTerminalDrawer = memo(function PersistentThreadTerminalDrawer({
  threadRef,
  threadId,
  visible,
  launchContext,
  focusRequestId,
  splitShortcutLabel,
  splitVerticalShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  keybindings,
  onAddTerminalContext,
}: PersistentThreadTerminalDrawerProps) {
  const openTerminal = useAtomCommand(terminalEnvironment.open, "terminal open");
  const writeTerminal = useAtomCommand(terminalEnvironment.write, "terminal write");
  const closeTerminalMutation = useAtomCommand(terminalEnvironment.close, "terminal close");
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  // Hidden drawers stay mounted (see MAX_HIDDEN_MOUNTED_TERMINAL_THREADS), so they read only
  // the shell: a detail subscription would keep each hidden thread's history in memory. The
  // visible drawer shares ChatView's detail, which also covers archived threads (no shell).
  const activeServerThread = useThread(visible ? threadRef : null, {
    waitForShell: draftThread !== null,
  });
  const serverThreadShell = useThreadShell(threadRef);
  const serverThread = activeServerThread ?? serverThreadShell;
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useProject(projectRef);
  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef),
  );
  const knownTerminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId,
  });
  const panelSurfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );
  const panelTerminalIds = useMemo(
    () =>
      new Set(
        panelSurfaces.flatMap((surface) =>
          surface.kind === "terminal" ? surface.terminalIds : [],
        ),
      ),
    [panelSurfaces],
  );
  const drawerTerminalSessions = useMemo(
    () =>
      knownTerminalSessions.filter((session) => !panelTerminalIds.has(session.target.terminalId)),
    [knownTerminalSessions, panelTerminalIds],
  );
  const terminalLabelsById = useMemo(() => {
    const next = new Map<string, string>();
    for (const session of drawerTerminalSessions) {
      next.set(
        session.target.terminalId,
        resolveTerminalSessionLabel(session.target.terminalId, session.state.summary),
      );
    }
    return next;
  }, [drawerTerminalSessions]);
  const terminalLaunchLocationsById = useMemo(() => {
    const next = new Map<
      string,
      {
        readonly cwd: string;
        readonly worktreePath: string | null;
        readonly runtimeEnv: Record<string, string>;
      }
    >();
    if (!project) {
      return next;
    }

    for (const session of drawerTerminalSessions) {
      const summary = session.state.summary;
      if (!summary) {
        continue;
      }
      const worktreePathForLaunch =
        launchContext !== null ? launchContext.worktreePath : summary.worktreePath;
      next.set(session.target.terminalId, {
        cwd: launchContext?.cwd ?? summary.cwd,
        worktreePath: worktreePathForLaunch,
        runtimeEnv: projectScriptRuntimeEnv({
          project: { cwd: project.workspaceRoot },
          worktreePath: worktreePathForLaunch,
        }),
      });
    }

    return next;
  }, [drawerTerminalSessions, launchContext, project]);
  const serverOrderedTerminalIds = useMemo(
    () => drawerTerminalSessions.map((session) => session.target.terminalId),
    [drawerTerminalSessions],
  );
  // Every client-side id source participates in allocation: the server list
  // lags fresh opens, and panel terminals are filtered out of the drawer's
  // sessions — an id collision attaches two viewports to one PTY session.
  const allocatableTerminalIds = useMemo(
    () => [
      ...new Set([
        ...serverOrderedTerminalIds,
        ...terminalUiState.terminalIds,
        ...panelTerminalIds,
      ]),
    ],
    [panelTerminalIds, serverOrderedTerminalIds, terminalUiState.terminalIds],
  );
  const storeSetTerminalHeight = useTerminalUiStateStore((state) => state.setTerminalHeight);
  const storeSplitTerminal = useTerminalUiStateStore((state) => state.splitTerminal);
  const storeSplitTerminalVertical = useTerminalUiStateStore(
    (state) => state.splitTerminalVertical,
  );
  const storeNewTerminal = useTerminalUiStateStore((state) => state.newTerminal);
  const storeSetActiveTerminal = useTerminalUiStateStore((state) => state.setActiveTerminal);
  const storeCloseTerminal = useTerminalUiStateStore((state) => state.closeTerminal);
  const reconcileTerminalIds = useTerminalUiStateStore((state) => state.reconcileTerminalIds);

  useEffect(() => {
    if (terminalIdListsEqual(serverOrderedTerminalIds, terminalUiState.terminalIds)) {
      return;
    }
    if (
      serverTerminalIdsStrictSubsetOfClient(serverOrderedTerminalIds, terminalUiState.terminalIds)
    ) {
      return;
    }
    reconcileTerminalIds(threadRef, serverOrderedTerminalIds);
  }, [reconcileTerminalIds, serverOrderedTerminalIds, terminalUiState.terminalIds, threadRef]);
  const [localFocusRequestId, setLocalFocusRequestId] = useState(0);
  const worktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const effectiveWorktreePath = useMemo(() => {
    if (launchContext !== null) {
      return launchContext.worktreePath;
    }
    return worktreePath;
  }, [launchContext, worktreePath]);
  // A Mate's terminal starts in its code checkout (`terminalStartCwd`); a hidden drawer reads none.
  // Terminals already open stay on screen while the checkouts are read: they keep their folders.
  const leases = useThreadLeases(
    visible ? threadRef.environmentId : null,
    threadRef.threadId,
    serverThread?.lease ?? null,
  );
  const repositories = useMateRepositories(visible ? threadRef.environmentId : null, leases);
  const hasOpenTerminals = drawerTerminalSessions.length > 0;
  const leaseAlias = serverThread?.lease?.alias ?? null;
  const cwd = useMemo(
    () =>
      project
        ? (terminalStartCwd({
            launchCwd: launchContext?.cwd,
            workspaceRoot: project.workspaceRoot,
            lease: leaseAlias,
            worktreePath: effectiveWorktreePath,
            repositories,
          }) ?? (hasOpenTerminals ? project.workspaceRoot : null))
        : (launchContext?.cwd ?? null),
    [
      effectiveWorktreePath,
      hasOpenTerminals,
      launchContext?.cwd,
      leaseAlias,
      project,
      repositories,
    ],
  );
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({
            project: { cwd: project.workspaceRoot },
            worktreePath: effectiveWorktreePath,
          })
        : {},
    [effectiveWorktreePath, project],
  );

  const bumpFocusRequestId = useCallback(() => {
    if (!visible) {
      return;
    }
    setLocalFocusRequestId((value) => value + 1);
  }, [visible]);

  const setTerminalHeight = useCallback(
    (height: number) => {
      storeSetTerminalHeight(threadRef, height);
    },
    [storeSetTerminalHeight, threadRef],
  );

  const splitTerminal = useCallback(() => {
    if (!cwd) {
      return;
    }
    const terminalId = nextTerminalId(allocatableTerminalIds);
    storeSplitTerminal(threadRef, terminalId);
    bumpFocusRequestId();
    void openTerminal({
      environmentId: threadRef.environmentId,
      input: {
        threadId,
        terminalId,
        cwd,
        ...(effectiveWorktreePath != null ? { worktreePath: effectiveWorktreePath } : {}),
        env: runtimeEnv,
      },
    });
  }, [
    allocatableTerminalIds,
    bumpFocusRequestId,
    cwd,
    effectiveWorktreePath,
    runtimeEnv,
    storeSplitTerminal,
    threadId,
    threadRef,
    openTerminal,
  ]);
  const splitTerminalVertical = useCallback(() => {
    if (!cwd) {
      return;
    }
    const terminalId = nextTerminalId(allocatableTerminalIds);
    storeSplitTerminalVertical(threadRef, terminalId);
    bumpFocusRequestId();
    void openTerminal({
      environmentId: threadRef.environmentId,
      input: {
        threadId,
        terminalId,
        cwd,
        ...(effectiveWorktreePath != null ? { worktreePath: effectiveWorktreePath } : {}),
        env: runtimeEnv,
      },
    });
  }, [
    allocatableTerminalIds,
    bumpFocusRequestId,
    cwd,
    effectiveWorktreePath,
    openTerminal,
    runtimeEnv,
    storeSplitTerminalVertical,
    threadId,
    threadRef,
  ]);

  const createNewTerminal = useCallback(() => {
    if (!cwd) {
      return;
    }
    const terminalId = nextTerminalId(allocatableTerminalIds);
    storeNewTerminal(threadRef, terminalId);
    bumpFocusRequestId();
    void openTerminal({
      environmentId: threadRef.environmentId,
      input: {
        threadId,
        terminalId,
        cwd,
        ...(effectiveWorktreePath != null ? { worktreePath: effectiveWorktreePath } : {}),
        env: runtimeEnv,
      },
    });
  }, [
    bumpFocusRequestId,
    cwd,
    effectiveWorktreePath,
    allocatableTerminalIds,
    runtimeEnv,
    storeNewTerminal,
    threadId,
    threadRef,
    openTerminal,
  ]);

  const activateTerminal = useCallback(
    (terminalId: string) => {
      storeSetActiveTerminal(threadRef, terminalId);
      bumpFocusRequestId();
    },
    [bumpFocusRequestId, storeSetActiveTerminal, threadRef],
  );

  const closeTerminal = useCallback(
    (terminalId: string) => {
      const fallbackExitWrite = () =>
        writeTerminal({
          environmentId: threadRef.environmentId,
          input: { threadId, terminalId, data: "exit\n" },
        });

      void (async () => {
        const closeResult = await closeTerminalMutation({
          environmentId: threadRef.environmentId,
          input: {
            threadId,
            terminalId,
            deleteHistory: true,
          },
        });
        if (closeResult._tag === "Failure" && !isAtomCommandInterrupted(closeResult)) {
          await fallbackExitWrite();
        }
      })();

      storeCloseTerminal(threadRef, terminalId);
      bumpFocusRequestId();
    },
    [
      bumpFocusRequestId,
      storeCloseTerminal,
      threadId,
      threadRef,
      closeTerminalMutation,
      writeTerminal,
    ],
  );

  const handleAddTerminalContext = useCallback(
    (selection: TerminalContextSelection) => {
      if (!visible) {
        return;
      }
      onAddTerminalContext(selection);
    },
    [onAddTerminalContext, visible],
  );

  if (!project || !terminalUiState.terminalOpen || !cwd) {
    return null;
  }

  return (
    <div className={visible ? undefined : "hidden"}>
      <ThreadTerminalDrawer
        threadRef={threadRef}
        threadId={threadId}
        cwd={cwd}
        worktreePath={effectiveWorktreePath}
        runtimeEnv={runtimeEnv}
        visible={visible}
        height={terminalUiState.terminalHeight}
        // Known-session order is MRU and changes on focus; persisted store order keeps sidebar labels stable.
        terminalIds={terminalUiState.terminalIds}
        activeTerminalId={terminalUiState.activeTerminalId}
        terminalGroups={terminalUiState.terminalGroups}
        activeTerminalGroupId={terminalUiState.activeTerminalGroupId}
        focusRequestId={focusRequestId + localFocusRequestId + (visible ? 1 : 0)}
        onSplitTerminal={splitTerminal}
        onSplitTerminalVertical={splitTerminalVertical}
        onNewTerminal={createNewTerminal}
        splitShortcutLabel={visible ? splitShortcutLabel : undefined}
        splitVerticalShortcutLabel={visible ? splitVerticalShortcutLabel : undefined}
        newShortcutLabel={visible ? newShortcutLabel : undefined}
        closeShortcutLabel={visible ? closeShortcutLabel : undefined}
        keybindings={keybindings}
        onActiveTerminalChange={activateTerminal}
        onCloseTerminal={closeTerminal}
        onHeightChange={setTerminalHeight}
        onAddTerminalContext={handleAddTerminalContext}
        terminalLabelsById={terminalLabelsById}
        terminalLaunchLocationsById={terminalLaunchLocationsById}
      />
    </div>
  );
});

interface PersistentThreadTerminalPanelProps {
  visible: boolean;
  threadRef: ScopedThreadRef;
  surface: Extract<RightPanelSurface, { kind: "terminal" }>;
  launchContext: PersistentTerminalLaunchContext | null;
  focusRequestId: number;
  keybindings: ResolvedKeybindingsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  onSplitTerminal: () => void;
  onSplitTerminalVertical: () => void;
  onNewTerminal: () => void;
  onActiveTerminalChange: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  splitShortcutLabel?: string | undefined;
  splitVerticalShortcutLabel?: string | undefined;
  newShortcutLabel?: string | undefined;
  closeShortcutLabel?: string | undefined;
}

const PersistentThreadTerminalPanel = memo(function PersistentThreadTerminalPanel({
  visible,
  threadRef,
  surface,
  launchContext,
  focusRequestId,
  keybindings,
  onAddTerminalContext,
  onSplitTerminal,
  onSplitTerminalVertical,
  onNewTerminal,
  onActiveTerminalChange,
  onCloseTerminal,
  splitShortcutLabel,
  splitVerticalShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
}: PersistentThreadTerminalPanelProps) {
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const serverThread = useThread(threadRef, { waitForShell: draftThread !== null });
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useProject(projectRef);
  const knownTerminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
  });
  const threadWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const threadLease = serverThread?.lease?.alias ?? null;
  const activeSummary =
    knownTerminalSessions.find((session) => session.target.terminalId === surface.activeTerminalId)
      ?.state.summary ?? null;
  const worktreePath =
    launchContext?.worktreePath ?? activeSummary?.worktreePath ?? threadWorktreePath;
  // A Mate's terminal starts in its code checkout (`terminalStartCwd`); a hidden panel reads none.
  const leases = useThreadLeases(
    visible ? threadRef.environmentId : null,
    threadRef.threadId,
    serverThread?.lease ?? null,
  );
  const repositories = useMateRepositories(visible ? threadRef.environmentId : null, leases);
  const cwd = useMemo(
    () =>
      project
        ? terminalStartCwd({
            launchCwd: launchContext?.cwd ?? activeSummary?.cwd,
            workspaceRoot: project.workspaceRoot,
            lease: threadLease,
            worktreePath,
            repositories,
          })
        : (launchContext?.cwd ?? activeSummary?.cwd ?? null),
    [activeSummary?.cwd, launchContext?.cwd, project, repositories, threadLease, worktreePath],
  );
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({
            project: { cwd: project.workspaceRoot },
            worktreePath,
          })
        : {},
    [project, worktreePath],
  );
  const terminalLabelsById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const terminalId of surface.terminalIds) {
      const summary =
        knownTerminalSessions.find((session) => session.target.terminalId === terminalId)?.state
          .summary ?? null;
      labels.set(terminalId, resolveTerminalSessionLabel(terminalId, summary));
    }
    return labels;
  }, [knownTerminalSessions, surface.terminalIds]);
  const terminalLaunchLocationsById = useMemo(() => {
    const locations = new Map<
      string,
      {
        readonly cwd: string;
        readonly worktreePath: string | null;
        readonly runtimeEnv: Record<string, string>;
      }
    >();
    for (const terminalId of surface.terminalIds) {
      const summary =
        knownTerminalSessions.find((session) => session.target.terminalId === terminalId)?.state
          .summary ?? null;
      const terminalWorktreePath =
        launchContext?.worktreePath ?? summary?.worktreePath ?? threadWorktreePath;
      // A terminal not opened yet starts where a new one does: in the Mate's code (`terminalStartCwd`).
      const terminalCwd = project
        ? terminalStartCwd({
            launchCwd: launchContext?.cwd ?? summary?.cwd,
            workspaceRoot: project.workspaceRoot,
            lease: threadLease,
            worktreePath: terminalWorktreePath,
            repositories,
          })
        : null;
      if (!terminalCwd || !project) continue;
      locations.set(terminalId, {
        cwd: terminalCwd,
        worktreePath: terminalWorktreePath,
        runtimeEnv: projectScriptRuntimeEnv({
          project: { cwd: project.workspaceRoot },
          worktreePath: terminalWorktreePath,
        }),
      });
    }
    return locations;
  }, [
    knownTerminalSessions,
    launchContext?.cwd,
    launchContext?.worktreePath,
    project,
    repositories,
    surface.terminalIds,
    threadLease,
    threadWorktreePath,
  ]);

  if (!project || !cwd) return null;

  return (
    <ThreadTerminalDrawer
      mode="panel"
      visible={visible}
      threadRef={threadRef}
      threadId={threadRef.threadId}
      cwd={cwd}
      worktreePath={worktreePath}
      runtimeEnv={runtimeEnv}
      height={0}
      terminalIds={surface.terminalIds}
      activeTerminalId={surface.activeTerminalId}
      terminalGroups={[
        {
          id: surface.id,
          terminalIds: surface.terminalIds,
          ...(surface.splitDirection === "vertical" ? { splitDirection: "vertical" as const } : {}),
        },
      ]}
      activeTerminalGroupId={surface.id}
      focusRequestId={focusRequestId}
      onSplitTerminal={onSplitTerminal}
      onSplitTerminalVertical={onSplitTerminalVertical}
      onNewTerminal={onNewTerminal}
      splitShortcutLabel={splitShortcutLabel}
      splitVerticalShortcutLabel={splitVerticalShortcutLabel}
      newShortcutLabel={newShortcutLabel}
      closeShortcutLabel={closeShortcutLabel}
      onActiveTerminalChange={onActiveTerminalChange}
      onCloseTerminal={onCloseTerminal}
      onHeightChange={() => undefined}
      onAddTerminalContext={onAddTerminalContext}
      terminalLabelsById={terminalLabelsById}
      terminalLaunchLocationsById={terminalLaunchLocationsById}
      keybindings={keybindings}
    />
  );
});

// Errors surface through two maps (draft-keyed and thread-keyed) whose entries
// can race around promotion, so each write carries its time to let the latest
// one win when they collide.
const isDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);

type LocalThreadErrorEntry = {
  readonly message: string | null;
  readonly at: number;
  /** When the person's newest turn was made as it was written (`localThreadErrorStanding`). */
  readonly after?: string | null | undefined;
  readonly refusalSource?: AgentRefusalSource | undefined;
};

function chatActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An error occurred.";
}

/**
 * Drops the send-time anchored end space. That space is what holds a sent
 * message near the top while its turn streams, and it keeps LegendList's
 * maintainScrollAtEnd switched off for as long as it is installed — ChatView
 * drives the streaming scrolls itself, but only in "anchoring-new-turn" mode.
 * So every return to the live edge has to release the anchor too, otherwise the
 * timeline settles into "following-end" with nothing following anything.
 */
function releaseChatTimelineAnchor<T extends { readonly messageId: MessageId | null }>(
  current: T,
): T {
  return current.messageId === null ? current : { ...current, messageId: null };
}

export default function ChatView(props: ChatViewProps) {
  // A Chief's conversation draws its Mate as the product's own mark (`chief.ts`).
  const mate = useZeropsMate(props.environmentId);
  return (
    <MateFaceAsMark.Provider value={mate.kind === "mate" && mate.mate.chief === true}>
      <ConversationView {...props} />
    </MateFaceAsMark.Provider>
  );
}

function ConversationView(props: ChatViewProps) {
  const {
    environmentId,
    threadId,
    routeKind,
    onDiffPanelOpen,
    reserveTitleBarControlInset = true,
    forceExpandedMobileComposer = false,
  } = props;
  const draftId = routeKind === "draft" ? props.draftId : null;
  const threadSyncPhase = routeKind === "server" ? (props.threadSyncPhase ?? null) : null;
  // Opening a running thread resyncs for a few frames. Show the sync pill only
  // when the sync lasts; logic that depends on the real phase keeps reading
  // `threadSyncPhase`.
  const shownThreadSyncPhase = useDelayedStatus(`${environmentId}:${threadId}`, threadSyncPhase);
  const threadDetailLoading = threadSyncPhase === "loading";
  const handleNewThread = useNewThreadHandler();
  const { archiveThread, unarchiveThread } = useThreadActions();
  const routeThreadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const routeThreadKey = useMemo(() => scopedThreadKey(routeThreadRef), [routeThreadRef]);
  // The conversation its own draft just became (the draft's record stands until the promotion
  // is finalized): read as it opens, so it keeps what the draft's frame showed.
  const fromItsDraft = () =>
    routeKind === "server" &&
    useComposerDraftStore.getState().getDraftThreadByRef(routeThreadRef) !== null;
  const [draftArrival, setDraftArrival] = useState(() => ({
    key: routeThreadKey,
    fromItsDraft: fromItsDraft(),
  }));
  if (draftArrival.key !== routeThreadKey)
    setDraftArrival({ key: routeThreadKey, fromItsDraft: fromItsDraft() });
  const updateProjectScriptSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const removeKeybinding = useAtomCommand(serverEnvironment.removeKeybinding, {
    reportFailure: false,
  });
  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, {
    reportFailure: false,
  });
  const openTerminal = useAtomCommand(terminalEnvironment.open, "terminal open");
  const writeTerminal = useAtomCommand(terminalEnvironment.write, "terminal write");
  const closeTerminalMutation = useAtomCommand(terminalEnvironment.close, "terminal close");
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const switchGitRef = useAtomCommand(vcsEnvironment.switchRef, { reportFailure: false });
  const setThreadRuntimeMode = useAtomCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const setThreadInteractionMode = useAtomCommand(threadEnvironment.setInteractionMode, {
    reportFailure: false,
  });
  // A send outlives its route — uploads first, a background draft's fresh composer after — so
  // it holds its Mate until it answers (A9).
  const startThreadTurn = useMateCommand(threadEnvironment.startTurn, { reportFailure: false });
  const sendCrewCommand = useAtomCommand(crewCommands.command, { reportFailure: false });
  const readCrewTaskPage = useAtomCommand(crewCommands.taskPage, { reportFailure: false });
  const uploadThreadFeedback = useAtomCommand(threadEnvironment.uploadFeedback, {
    reportFailure: false,
  });
  const interruptThreadTurn = useAtomCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const continueAfterLimit = useAtomCommand(threadEnvironment.continueAfterLimit);
  const respondToThreadApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToThreadUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const dismissThreadUserInput = useAtomCommand(threadEnvironment.dismissUserInput, {
    reportFailure: false,
  });
  const { environments } = useEnvironments();
  const primaryEnvironment = usePrimaryEnvironment();
  const retryEnvironment = useAtomCommand(environmentCatalog.retryNow);
  const environmentById = useMemo(
    () => new Map(environments.map((environment) => [environment.environmentId, environment])),
    [environments],
  );
  const composerDraftTarget: ScopedThreadRef | DraftId =
    routeKind === "server" ? routeThreadRef : props.draftId;
  const draftThread = useComposerDraftStore((store) =>
    routeKind === "server"
      ? store.getDraftSessionByRef(routeThreadRef)
      : draftId
        ? store.getDraftSession(draftId)
        : null,
  );
  const routeServerThreadShell = useThreadShell(routeKind === "server" ? routeThreadRef : null);
  const serverThread = useThread(routeThreadRef, { waitForShell: draftThread !== null });
  const loadingServerThread = useMemo(
    () =>
      threadDetailLoading && routeServerThreadShell
        ? buildLoadingThreadFromShell(routeServerThreadShell)
        : null,
    [routeServerThreadShell, threadDetailLoading],
  );
  const activeServerThread = serverThread ?? loadingServerThread;
  // One model selection per thread: the composer shows and sends the thread's,
  // and a pick goes to the thread at once.
  const writeThreadModelSelection = useCallback(
    (modelSelection: ModelSelection) => {
      void updateThreadMetadata({
        environmentId,
        input: { threadId: routeThreadRef.threadId, modelSelection },
      });
    },
    [environmentId, routeThreadRef, updateThreadMetadata],
  );
  // Pagination window state for the routed server thread: drives the
  // "load earlier turns" header when the loaded window has older history.
  const routeThreadState = useEnvironmentThread(
    routeKind === "server" ? routeThreadRef.environmentId : null,
    routeKind === "server" ? routeThreadRef.threadId : null,
  );
  const loadEarlierTurns = useMemo(() => {
    if (routeKind !== "server" || !threadHasOlderTurns(routeThreadState)) {
      return null;
    }
    return {
      loading: routeThreadState.page._tag === "Some" && routeThreadState.page.value.loadingOlder,
      onLoadEarlier: () => {
        requestOlderThreadTurns(routeThreadRef.environmentId, routeThreadRef.threadId);
      },
    };
  }, [routeKind, routeThreadRef, routeThreadState]);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const settings = useEnvironmentSettings(environmentId);
  const primaryServerSettings = useAtomValue(primaryServerSettingsAtom);
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const timestampFormat = settings.timestampFormat;
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  // Granular store selectors — avoid subscribing to prompt changes.
  const composerRuntimeMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.runtimeMode ?? null,
  );
  const composerInteractionMode = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.interactionMode ?? null,
  );
  const composerActiveProvider = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.activeProvider ?? null,
  );
  const composerHasUnsentContent = useComposerDraftStore((store) =>
    composerDraftHasUserContent(store.getComposerDraft(composerDraftTarget)),
  );
  // Anything beyond the prompt text: attachments, terminal contexts, annotations.
  const composerHasNonPromptContent = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(composerDraftTarget);
    return draft ? composerDraftHasUserContent({ ...draft, prompt: "" }) : false;
  });
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const setComposerDraftReviewComments = useComposerDraftStore((store) => store.setReviewComments);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const getDraftSessionByLogicalProjectKey = useComposerDraftStore(
    (store) => store.getDraftSessionByLogicalProjectKey,
  );
  const getDraftSession = useComposerDraftStore((store) => store.getDraftSession);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const promptRef = useRef("");
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const localComposerRef = useRef<ChatComposerHandle | null>(null);
  const composerRef = useComposerHandleContext() ?? localComposerRef;
  const branchToolbarRef = useRef<BranchToolbarHandle>(null);
  const [isWorkspaceFileDragActive, setIsWorkspaceFileDragActive] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([]);
  const [feedbackSubmissionsByThreadKey, setFeedbackSubmissionsByThreadKey] = useState<
    Record<string, ReadonlyArray<CodexFeedbackSubmission>>
  >({});
  const feedbackSubmissions = useMemo(
    () => feedbackSubmissionsByThreadKey[routeThreadKey] ?? [],
    [feedbackSubmissionsByThreadKey, routeThreadKey],
  );
  const feedbackUploading = feedbackSubmissions.some(
    (submission) => submission.status === "uploading",
  );
  const optimisticUserMessagesRef = useRef(optimisticUserMessages);
  optimisticUserMessagesRef.current = optimisticUserMessages;
  const [localDraftErrorsByDraftId, setLocalDraftErrorsByDraftId] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const [localServerErrorsByThreadKey, setLocalServerErrorsByThreadKey] = useState<
    Record<string, LocalThreadErrorEntry>
  >({});
  const [isConnecting, _setIsConnecting] = useState(false);
  const [maximizedRightPanelThreadKey, setMaximizedRightPanelThreadKey] = useState<string | null>(
    null,
  );
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([]);
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([]);

  useEffect(() => {
    setIsWorkspaceFileDragActive(false);
  }, [draftId, routeThreadKey]);

  useEffect(() => {
    if (!isWorkspaceFileDragActive) return;
    const clearWorkspaceFileDrag = () => setIsWorkspaceFileDragActive(false);
    window.addEventListener("dragend", clearWorkspaceFileDrag);
    return () => window.removeEventListener("dragend", clearWorkspaceFileDrag);
  }, [isWorkspaceFileDragActive]);
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({});
  const shouldUseRightPanelSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const isMobileViewport = useMediaQuery("max-sm");
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null);
  const [terminalUiLaunchContext, setTerminalUiLaunchContext] =
    useState<TerminalLaunchContext | null>(null);
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({});
  const [pendingServerThreadEnvMode, setPendingServerThreadEnvMode] =
    useState<DraftThreadEnvMode | null>(null);
  const [pendingServerThreadBranch, setPendingServerThreadBranch] = useState<string | null>();
  const [
    pendingServerThreadStartFromOriginByThreadId,
    setPendingServerThreadStartFromOriginByThreadId,
  ] = useState<Record<string, boolean>>({});
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema,
  );
  const legendListRef = useRef<LegendListRef | null>(null);
  const [composerOverlayElement, setComposerOverlayElement] = useState<HTMLDivElement | null>(null);
  const [composerElementHeight, setComposerElementHeight] = useState(0);
  // The whole overlay while the agent asks (a question or an approval over the composer), 0 else.
  const [composerAskingHeight, setComposerAskingHeight] = useState(0);
  // What the composer covers of the list, as each conversation last had it
  // (`timelineInsets.ts`): a list shown in the press frame took the
  // conversation left's inset for that frame, and moved.
  const [composerOverlaySettledFor, setComposerOverlaySettledFor] = useState(routeThreadKey);
  const composerOverlayHeight = composerElementHeight;
  const [readAlongRoomState, setReadAlongRoom] = useState<ReadAlongRoom | null>(null);
  const composerAskRoom =
    composerAskingHeight > 0 ? Math.max(0, composerAskingHeight - composerOverlayHeight) : 0;
  // Its own is measured by the next frame.
  useLayoutEffect(() => {
    if (composerOverlaySettledFor === routeThreadKey) return;
    const frame = requestAnimationFrame(() => setComposerOverlaySettledFor(routeThreadKey));
    return () => cancelAnimationFrame(frame);
  }, [composerOverlaySettledFor, routeThreadKey]);
  useLayoutEffect(() => {
    if (composerOverlaySettledFor !== routeThreadKey) return;
    rememberTimelineInset(routeThreadKey, composerOverlayHeight);
  }, [composerOverlayHeight, composerOverlaySettledFor, routeThreadKey]);
  const isAtEndRef = useRef(true);
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({});
  // Read and set as a ref by every send; the render sees it too (`sendInFlight`), so a requested
  // send waits out a send in flight, a crewmate's round trip among them.
  const [sendInFlight, setSendInFlight] = useState(false);
  const [sendInFlightRef] = useState(() => {
    let current = false;
    return {
      get current() {
        return current;
      },
      set current(next: boolean) {
        current = next;
        setSendInFlight(next);
      },
    };
  });
  const feedbackUploadsInFlightRef = useRef(new Set<string>());
  const terminalUiOpenByThreadRef = useRef<Record<string, boolean>>({});

  useLayoutEffect(() => {
    if (!composerOverlayElement) return;

    const updateHeight = () => {
      const overlay = composerOverlayElement.getBoundingClientRect();
      const nextHeight = Math.ceil(overlay.height);
      if (nextHeight <= 0) return;
      // The conversation thins out beside the floating composer over the composer's own height,
      // from its top edge down (`conversation-scroll-fade`): written where the list reads it,
      // with no render of its own.
      const shell = composerOverlayElement.querySelector<HTMLElement>(
        '[data-slot="composer-shell"]',
      );
      const card =
        shell === null || composerOverlayElement.dataset["chatComposerHero"] === "true"
          ? null
          : shell.getBoundingClientRect();
      const footing = composerOverlayElement.parentElement?.style;
      footing?.setProperty(
        "--composer-fade",
        `${card === null ? 0 : Math.max(0, Math.ceil(overlay.bottom - card.top))}px`,
      );
      // Under the card nothing shows: the fade ends where the card does.
      footing?.setProperty(
        "--composer-foot",
        `${card === null ? 0 : Math.max(0, Math.ceil(overlay.bottom - card.bottom))}px`,
      );
      // A question or an approval the agent asks stands over the conversation's end, the inset held
      // as it was: opening it pushed the conversation up 250 px in one frame and its answer pulled
      // it back down (Milo's stress run). What it covers more is room the person scrolls into.
      if (composerOverlayElement.querySelector("[data-chat-composer-asks]") !== null) {
        setComposerAskingHeight(nextHeight);
        return;
      }
      setComposerAskingHeight(0);
      setComposerElementHeight((currentHeight) =>
        currentHeight === nextHeight ? currentHeight : nextHeight,
      );
    };

    updateHeight();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateHeight);
    observer.observe(composerOverlayElement);
    return () => observer.disconnect();
  }, [composerOverlayElement]);

  const terminalUiState = useTerminalUiStateStore((state) =>
    selectThreadTerminalUiState(state.terminalUiStateByThreadKey, routeThreadRef),
  );
  const openTerminalThreadKeys = useTerminalUiStateStore(
    useShallow((state) =>
      Object.entries(state.terminalUiStateByThreadKey).flatMap(
        ([nextThreadKey, nextTerminalUiState]) =>
          nextTerminalUiState.terminalOpen ? [nextThreadKey] : [],
      ),
    ),
  );
  const storeSetTerminalOpen = useTerminalUiStateStore((s) => s.setTerminalOpen);
  const storeEnsureTerminal = useTerminalUiStateStore((state) => state.ensureTerminal);
  const storeSplitTerminal = useTerminalUiStateStore((s) => s.splitTerminal);
  const storeSplitTerminalVertical = useTerminalUiStateStore((s) => s.splitTerminalVertical);
  const storeNewTerminal = useTerminalUiStateStore((s) => s.newTerminal);
  const storeSetActiveTerminal = useTerminalUiStateStore((s) => s.setActiveTerminal);
  const storeCloseTerminal = useTerminalUiStateStore((s) => s.closeTerminal);
  const serverThreadRefs = useThreadRefs();
  const serverThreadKeys = useMemo(() => serverThreadRefs.map(scopedThreadKey), [serverThreadRefs]);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const draftThreadKeys = useMemo(
    () =>
      Object.values(draftThreadsByThreadKey).map((draftThread) =>
        scopedThreadKey(scopeThreadRef(draftThread.environmentId, draftThread.threadId)),
      ),
    [draftThreadsByThreadKey],
  );
  const [mountedTerminalThreadKeys, setMountedTerminalThreadKeys] = useState<string[]>([]);
  const mountedTerminalThreadRefs = useMemo(
    () =>
      mountedTerminalThreadKeys.flatMap((mountedThreadKey) => {
        const mountedThreadRef = parseScopedThreadKey(mountedThreadKey);
        return mountedThreadRef ? [{ key: mountedThreadKey, threadRef: mountedThreadRef }] : [];
      }),
    [mountedTerminalThreadKeys],
  );

  const fallbackDraftProjectRef = draftThread
    ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
    : null;
  const fallbackDraftProject = useProject(fallbackDraftProjectRef);
  const localDraftError = activeServerThread
    ? null
    : ((draftId ? localDraftErrorsByDraftId[draftId]?.message : null) ?? null);
  const activeServerNewestTurn = newestPersonTurn(activeServerThread?.messages);
  // The newest turn as it stands now, for an error written after an await (`setThreadError`).
  const activeServerNewestTurnRef = useRef(activeServerNewestTurn);
  useLayoutEffect(() => {
    activeServerNewestTurnRef.current = activeServerNewestTurn;
  }, [activeServerNewestTurn]);
  const localServerError = localThreadErrorStanding(
    localServerErrorsByThreadKey[routeThreadKey],
    activeServerNewestTurn,
    activeServerThread?.latestTurn?.completedAt,
  );
  // Draft errors are keyed by draftId while server errors are keyed by thread
  // key, so a pending draft entry must migrate when the server thread loads or
  // a failed send would silently disappear on promotion. When both keys hold
  // an entry, the most recent write wins.
  useEffect(() => {
    if (!activeServerThread || !draftId) {
      return;
    }
    const pendingDraftEntry = localDraftErrorsByDraftId[draftId];
    if (pendingDraftEntry === undefined) {
      return;
    }
    setLocalDraftErrorsByDraftId((existing) => {
      if (existing[draftId] === undefined) {
        return existing;
      }
      const next = { ...existing };
      delete next[draftId];
      return next;
    });
    setLocalServerErrorsByThreadKey((existing) => {
      const currentEntry = existing[routeThreadKey];
      if (
        currentEntry !== undefined &&
        (currentEntry.at > pendingDraftEntry.at ||
          threadErrorEntryUnchanged(currentEntry, pendingDraftEntry))
      ) {
        return existing;
      }
      return {
        ...existing,
        // A draft's error knows no turn: from here, the conversation's own newest stands.
        [routeThreadKey]: {
          ...pendingDraftEntry,
          after: pendingDraftEntry.after ?? activeServerNewestTurn,
        },
      };
    });
  }, [
    activeServerThread,
    activeServerNewestTurn,
    draftId,
    localDraftErrorsByDraftId,
    routeThreadKey,
  ]);
  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackDraftProject?.defaultModelSelection ??
              settings.defaultModelSelection ??
              NO_PROVIDER_MODEL_SELECTION,
          )
        : undefined,
    [
      draftThread,
      fallbackDraftProject?.defaultModelSelection,
      settings.defaultModelSelection,
      threadId,
    ],
  );
  // Promotion is data-driven: the draft route keeps rendering while the
  // server thread (same pre-allocated ref) starts, so live state must not
  // depend on which route is mounted.
  const isServerThread = activeServerThread !== null;
  const activeThread = activeServerThread ?? localDraftThread;
  const threadError = isServerThread
    ? (localServerError ?? activeServerThread?.session?.lastError ?? null)
    : localDraftError;
  // A persisted runtime failure already has its place in the conversation.
  // Keep command refusals in the banner; they have no durable timeline entry.
  const threadErrorInTimeline =
    localServerError == null &&
    activeServerThread?.activities.some(
      (activity) =>
        activity.kind === "runtime.error" &&
        typeof activity.payload === "object" &&
        activity.payload !== null &&
        "turnEnd" in activity.payload &&
        (activity.payload.turnEnd === "crash" || activity.payload.turnEnd === "failed") &&
        activity.turnId === activeServerThread.latestTurn?.turnId &&
        (activity.summary === threadError ||
          (typeof activity.payload === "object" &&
            activity.payload !== null &&
            "message" in activity.payload &&
            activity.payload.message === threadError)),
    );
  const visibleThreadError = threadErrorInTimeline ? null : threadError;
  const runtimeMode = composerRuntimeMode ?? activeThread?.runtimeMode ?? DEFAULT_RUNTIME_MODE;
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined;
  const canCheckoutPullRequestIntoThread = isLocalDraftThread;
  const activeThreadId = activeThread?.id ?? null;
  const activeThreadEnvironmentId = activeThread?.environmentId ?? null;
  const runningTerminalIds = useThreadRunningTerminalIds({
    environmentId: activeThread?.environmentId ?? null,
    threadId: activeThreadId,
  });
  const activeThreadKnownSessionsRaw = useKnownTerminalSessions({
    environmentId: activeThread?.environmentId ?? null,
    threadId: activeThreadId,
  });
  const activeThreadKnownSessions = useMemo(() => {
    if (activeThreadId === null) {
      return [];
    }
    return activeThreadKnownSessionsRaw.filter(
      (session) => session.target.threadId === activeThreadId,
    );
  }, [activeThreadId, activeThreadKnownSessionsRaw]);
  const activeServerOrderedTerminalIds = useMemo(
    () => activeThreadKnownSessions.map((session) => session.target.terminalId),
    [activeThreadKnownSessions],
  );
  const activeKnownTerminalIds = useMemo(
    () => [...new Set([...activeServerOrderedTerminalIds, ...terminalUiState.terminalIds])],
    [activeServerOrderedTerminalIds, terminalUiState.terminalIds],
  );
  const activeTerminalLabelsById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const session of activeThreadKnownSessions) {
      labels.set(
        session.target.terminalId,
        resolveTerminalSessionLabel(session.target.terminalId, session.state.summary),
      );
    }
    return labels;
  }, [activeThreadKnownSessions]);
  const activeThreadRef = useMemo(
    () =>
      activeThreadEnvironmentId && activeThreadId
        ? scopeThreadRef(activeThreadEnvironmentId, activeThreadId)
        : null,
    [activeThreadEnvironmentId, activeThreadId],
  );
  const activeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const [timelineAnchor, setTimelineAnchor] = useState<{
    readonly threadKey: string | null;
    readonly messageId: MessageId | null;
  }>(() => ({ threadKey: activeThreadKey, messageId: readDraftTimelineAnchor(activeThreadKey) }));
  if (timelineAnchor.threadKey !== activeThreadKey) {
    setTimelineAnchor({ threadKey: activeThreadKey, messageId: null });
  }
  const timelineAnchorMessageId = timelineAnchor.messageId;
  const activeRightPanelKind = useRightPanelStore((state) =>
    selectActiveRightPanel(state.byThreadKey, activeThreadRef),
  );
  const diffOpen = activeRightPanelKind === "diff";
  // Every opening of Diff shows what is not on main yet, whatever it showed before.
  useLayoutEffect(() => {
    if (activeThreadRef && diffOpen) useDiffPanelStore.getState().clearSelection(activeThreadRef);
  }, [activeThreadRef, diffOpen]);
  const rightPanelState = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byThreadKey, activeThreadRef),
  );
  const activeRightPanelSurface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, activeThreadRef),
  );
  const activeFileSurface =
    activeRightPanelSurface?.kind === "file" ? activeRightPanelSurface : null;
  const panelTerminalIds = useMemo(
    () =>
      new Set(
        rightPanelState.surfaces.flatMap((surface) =>
          surface.kind === "terminal" ? surface.terminalIds : [],
        ),
      ),
    [rightPanelState.surfaces],
  );
  const allocatableActiveTerminalIds = useMemo(
    () => [...new Set([...activeKnownTerminalIds, ...panelTerminalIds])],
    [activeKnownTerminalIds, panelTerminalIds],
  );
  const rightPanelOpen = rightPanelState.isOpen;
  const canMaximizeRightPanel = rightPanelOpen && !shouldUseRightPanelSheet;
  const rightPanelMaximized =
    canMaximizeRightPanel && maximizedRightPanelThreadKey === routeThreadKey;
  const inlineRightPanelOwnsTitleBar = rightPanelOpen && !shouldUseRightPanelSheet;

  const existingOpenTerminalThreadKeys = useMemo(() => {
    const existingThreadKeys = new Set<string>([...serverThreadKeys, ...draftThreadKeys]);
    return openTerminalThreadKeys.filter((nextThreadKey) => existingThreadKeys.has(nextThreadKey));
  }, [draftThreadKeys, openTerminalThreadKeys, serverThreadKeys]);
  const activeThreadShell = useThreadShell(isServerThread ? activeThreadRef : null);
  const limit = useAtomValue(
    mateLimitAtom(
      activeThreadShell === null
        ? ""
        : scopedThreadKey(scopeThreadRef(activeThreadShell.environmentId, activeThreadShell.id)),
    ),
  );
  const usageRefused = limit.kind !== "none";
  const activeLatestTurn = activeThread?.latestTurn ?? null;
  const activeRunningTurnId = usageRefused
    ? null
    : ((activeThread?.session?.status === "running" ? activeThread.session.activeTurnId : null) ??
      (activeLatestTurn?.state === "running" ? activeLatestTurn.turnId : null));
  // A result landing in the conversation on screen is seen at once, before its visit below.
  useThreadOnScreen(
    serverThread?.id
      ? scopedThreadKey(scopeThreadRef(serverThread.environmentId, serverThread.id))
      : null,
  );
  // Reading a finished thread clears the sidebar's Done badge. The visit is
  // stamped at the turn's completion time — not now/updatedAt — so it clears
  // exactly the completion the user is looking at: a wake or completion that
  // lands later still gets its signal (markThreadVisited never moves the
  // timestamp backwards).
  useEffect(() => {
    const completedAt = serverThread?.latestTurn?.completedAt;
    if (!serverThread?.id || !completedAt) return;
    markThreadVisited(
      scopedThreadKey(scopeThreadRef(serverThread.environmentId, serverThread.id)),
      completedAt,
    );
  }, [
    markThreadVisited,
    serverThread?.environmentId,
    serverThread?.id,
    serverThread?.latestTurn?.completedAt,
  ]);
  useEffect(() => {
    setMountedTerminalThreadKeys((currentThreadIds) => {
      const nextThreadIds = reconcileMountedTerminalThreadIds({
        currentThreadIds,
        openThreadIds: existingOpenTerminalThreadKeys,
        activeThreadId: activeThreadKey,
        activeThreadTerminalOpen: Boolean(activeThreadKey && terminalUiState.terminalOpen),
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
      });
      return currentThreadIds.length === nextThreadIds.length &&
        currentThreadIds.every((nextThreadId, index) => nextThreadId === nextThreadIds[index])
        ? currentThreadIds
        : nextThreadIds;
    });
  }, [activeThreadKey, existingOpenTerminalThreadKeys, terminalUiState.terminalOpen]);
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null);
  const activeProjectRef = useMemo(
    () =>
      activeThread ? scopeProjectRef(activeThread.environmentId, activeThread.projectId) : null,
    [activeThread?.environmentId, activeThread?.projectId],
  );
  const activeProject = useProject(activeProjectRef);
  // A local draft whose project the environment no longer lists — a store
  // migration once rewrote the id to the workspace path (`questions.md`
  // Q-16) — re-attaches to the environment's only project: on Zerops one
  // environment is one project, so there is nothing to choose. The repaired
  // ref is written back, so the send path and the next reload agree with
  // the header.
  const activeEnvironmentProjectRefs = useEnvironmentProjectRefs(
    isLocalDraftThread && activeProject === null ? activeThreadEnvironmentId : null,
  );
  useEffect(() => {
    if (!isLocalDraftThread || activeProject !== null || draftId === null || !draftThread) return;
    const [sole, second] = activeEnvironmentProjectRefs;
    if (sole === undefined || second !== undefined || sole.projectId === draftThread.projectId) {
      return;
    }
    setLogicalProjectDraftThreadId(draftThread.logicalProjectKey, sole, draftId, {
      threadId: draftThread.threadId,
      createdAt: draftThread.createdAt,
      runtimeMode: draftThread.runtimeMode,
      interactionMode: draftThread.interactionMode,
    });
  }, [
    activeEnvironmentProjectRefs,
    activeProject,
    draftId,
    draftThread,
    isLocalDraftThread,
    setLogicalProjectDraftThreadId,
  ]);
  const activeProjectScripts = useMemo(
    () => (activeProject ? resolveProjectScripts(settings, activeProject) : []),
    [activeProject, settings],
  );
  const activeProjectDefaultModelSelection =
    activeProject?.defaultModelSelection ?? settings.defaultModelSelection;
  // A project added by cloning exists before its files do. The draft stays
  // editable throughout; only sending waits for the clone, and a failed
  // clone offers its retry right where the user is looking.
  const activeProjectClone = useProjectClone(activeProjectRef);
  const cancelProjectClone = useAtomCommand(sourceControlEnvironment.cancelProjectClone, {
    reportFailure: false,
  });
  const retryProjectClone = useAtomCommand(sourceControlEnvironment.retryProjectClone, {
    reportFailure: false,
  });
  const removeClonedProject = useRemoveClonedProject();
  // The banner mirrors the server's clone state, so a request that never got
  // there needs its own feedback.
  const runProjectCloneAction = useCallback(
    async (
      title: string,
      action: () => Promise<AtomCommandResult<unknown, unknown>>,
    ): Promise<void> => {
      const result = await action();
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [],
  );
  const handleNewThreadInActiveProject = useCallback(() => {
    startNewThreadForProject(activeProjectRef, handleNewThread);
  }, [activeProjectRef, handleNewThread]);
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const activeDraftLogicalProjectKey =
    !isServerThread && activeProject
      ? deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings)
      : undefined;
  const handleOpenDraftProjectSettings = useCallback(() => {
    if (!activeDraftLogicalProjectKey) return;
    void navigate({
      to: "/projects/$projectKey",
      params: { projectKey: activeDraftLogicalProjectKey },
    });
  }, [activeDraftLogicalProjectKey, navigate]);
  const activeEnvironmentShell = useEnvironmentQuery(
    activeThread ? environmentShell.stateAtom(activeThread.environmentId) : null,
  );
  const activeEnvironmentBootstrapComplete = activeEnvironmentShell.data?.snapshot._tag === "Some";
  const activeProjectKey = activeProject
    ? `${activeProject.environmentId}:${activeProject.workspaceRoot}`
    : null;
  const [pendingFileSurfaceIdsByProject, setPendingFileSurfaceIdsByProject] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(() => new Map());
  const pendingFileSurfaceIds = activeProjectKey
    ? (pendingFileSurfaceIdsByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS)
    : EMPTY_PENDING_FILE_SURFACE_IDS;
  const handleFilePendingChange = useCallback(
    (relativePath: string, pending: boolean) => {
      if (!activeProjectKey) return;
      setPendingFileSurfaceIdsByProject((currentByProject) => {
        const current = currentByProject.get(activeProjectKey) ?? EMPTY_PENDING_FILE_SURFACE_IDS;
        const surfaceId = `file:${relativePath}`;
        if (current.has(surfaceId) === pending) return currentByProject;
        const next = new Set(current);
        if (pending) next.add(surfaceId);
        else next.delete(surfaceId);
        const nextByProject = new Map(currentByProject);
        if (next.size === 0) nextByProject.delete(activeProjectKey);
        else nextByProject.set(activeProjectKey, next);
        return nextByProject;
      });
    },
    [activeProjectKey],
  );
  useEffect(() => {
    if (!activeThreadRef || !activeEnvironmentBootstrapComplete) return;
    useRightPanelStore.getState().reconcileFileSurfaces(activeThreadRef, activeProject !== null);
  }, [activeEnvironmentBootstrapComplete, activeProject, activeThreadRef]);

  // Compute the list of environments this logical project spans, used to
  // drive the environment picker in BranchToolbar.
  const allProjects = useProjects();
  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  const activeEnvironment =
    activeThread == null ? null : (environmentById.get(activeThread.environmentId) ?? null);
  const activeEnvironmentConnectionPhase = activeEnvironment?.connection.phase ?? "available";
  const activeEnvironmentUnavailable =
    activeEnvironment !== null && activeEnvironmentConnectionPhase !== "connected";
  const activeReconnectingEnvironmentId =
    activeEnvironmentConnectionPhase === "connecting" ||
    activeEnvironmentConnectionPhase === "reconnecting"
      ? (activeEnvironment?.environmentId ?? null)
      : null;
  const [reconnectWarningGraceElapsedEnvironmentId, setReconnectWarningGraceElapsedEnvironmentId] =
    useState<EnvironmentId | null>(null);
  const reconnectWarningGraceElapsed = hasEnvironmentReconnectWarningGraceElapsed(
    activeReconnectingEnvironmentId,
    reconnectWarningGraceElapsedEnvironmentId,
  );
  useEffect(() => {
    setReconnectWarningGraceElapsedEnvironmentId(null);
    if (activeReconnectingEnvironmentId === null) return;
    return scheduleEnvironmentReconnectWarning(() =>
      setReconnectWarningGraceElapsedEnvironmentId(activeReconnectingEnvironmentId),
    );
  }, [activeReconnectingEnvironmentId]);
  const activeEnvironmentUnavailableLabel = activeEnvironment?.label ?? null;
  const activeEnvironmentUnavailableState = useMemo<EnvironmentUnavailableState | null>(() => {
    if (!activeEnvironmentUnavailable || !activeEnvironment) return null;
    return {
      environmentId: activeEnvironment.environmentId,
      connection: activeEnvironment.connection,
    };
  }, [activeEnvironment, activeEnvironmentUnavailable]);
  const handleReconnectActiveEnvironment = useCallback(
    async (environmentId: EnvironmentId) => {
      const toast = environmentRetryFailureToast(await retryEnvironment(environmentId));
      if (toast !== null) toastManager.add(stackedThreadToast({ type: "error", ...toast }));
    },
    [retryEnvironment],
  );
  const logicalProjectEnvironments = useMemo(() => {
    if (!activeProject) return [];
    const logicalKey = deriveLogicalProjectKeyFromSettings(activeProject, projectGroupingSettings);
    const memberProjects = allProjects.filter(
      (p) => deriveLogicalProjectKeyFromSettings(p, projectGroupingSettings) === logicalKey,
    );
    const seen = new Set<string>();
    const envs: Array<{
      environmentId: EnvironmentId;
      projectId: ProjectId;
      label: string;
      isPrimary: boolean;
    }> = [];
    for (const p of memberProjects) {
      if (seen.has(p.environmentId)) continue;
      seen.add(p.environmentId);
      const isPrimary = p.environmentId === primaryEnvironmentId;
      const label = environmentById.get(p.environmentId)?.label ?? p.environmentId;
      envs.push({
        environmentId: p.environmentId,
        projectId: p.id,
        label,
        isPrimary,
      });
    }
    // Sort: primary first, then alphabetical
    envs.sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return envs;
  }, [activeProject, allProjects, projectGroupingSettings, primaryEnvironmentId, environmentById]);
  const hasMultipleEnvironments = logicalProjectEnvironments.length > 1;
  const activeEnvironmentOption =
    logicalProjectEnvironments.find(
      (environment) => environment.environmentId === activeThread?.environmentId,
    ) ?? null;
  const showComposerEnvironmentIndicator = shouldShowEnvironmentIndicator({
    activeEnvironment: activeEnvironmentOption,
    canPickEnvironment: hasMultipleEnvironments,
  });

  const openPullRequestDialog = useCallback(
    (reference?: string) => {
      if (!canCheckoutPullRequestIntoThread) {
        return;
      }
      setPullRequestDialogState({
        initialReference: reference ?? null,
        key: Date.now(),
      });
    },
    [canCheckoutPullRequestIntoThread],
  );

  const closePullRequestDialog = useCallback(() => {
    setPullRequestDialogState(null);
  }, []);

  const openOrReuseProjectDraftThread = useCallback(
    async (input: { branch: string; worktreePath: string | null; envMode: DraftThreadEnvMode }) => {
      if (!activeProject) {
        throw new Error("No active project is available for this pull request.");
      }
      const activeProjectRef = scopeProjectRef(activeProject.environmentId, activeProject.id);
      const logicalProjectKey = deriveLogicalProjectKeyFromSettings(
        activeProject,
        projectGroupingSettings,
      );
      const storedDraftSession = getDraftSessionByLogicalProjectKey(logicalProjectKey);
      if (storedDraftSession) {
        setDraftThreadContext(storedDraftSession.draftId, input);
        setLogicalProjectDraftThreadId(
          logicalProjectKey,
          activeProjectRef,
          storedDraftSession.draftId,
          {
            threadId: storedDraftSession.threadId,
            ...input,
          },
        );
        if (routeKind !== "draft" || draftId !== storedDraftSession.draftId) {
          await navigate({
            to: "/draft/$draftId",
            params: buildDraftThreadRouteParams(storedDraftSession.draftId),
          });
        }
        return storedDraftSession.threadId;
      }

      const activeDraftSession = routeKind === "draft" && draftId ? getDraftSession(draftId) : null;
      if (
        !isServerThread &&
        activeDraftSession?.logicalProjectKey === logicalProjectKey &&
        draftId
      ) {
        setDraftThreadContext(draftId, input);
        setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, draftId, {
          threadId: activeDraftSession.threadId,
          createdAt: activeDraftSession.createdAt,
          runtimeMode: activeDraftSession.runtimeMode,
          interactionMode: activeDraftSession.interactionMode,
          ...input,
        });
        return activeDraftSession.threadId;
      }

      const nextDraftId = newDraftId();
      const nextThreadId = newThreadId();
      setLogicalProjectDraftThreadId(logicalProjectKey, activeProjectRef, nextDraftId, {
        threadId: nextThreadId,
        createdAt: new Date().toISOString(),
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_INTERACTION_MODE,
        ...input,
      });
      await navigate({
        to: "/draft/$draftId",
        params: buildDraftThreadRouteParams(nextDraftId),
      });
      return nextThreadId;
    },
    [
      activeProject,
      draftId,
      getDraftSession,
      getDraftSessionByLogicalProjectKey,
      isServerThread,
      navigate,
      projectGroupingSettings,
      routeKind,
      setDraftThreadContext,
      setLogicalProjectDraftThreadId,
    ],
  );

  const handlePreparedPullRequestThread = useCallback(
    async (input: { branch: string; worktreePath: string | null }) => {
      await openOrReuseProjectDraftThread({
        branch: input.branch,
        worktreePath: input.worktreePath,
        envMode: input.worktreePath ? "worktree" : "local",
      });
    },
    [openOrReuseProjectDraftThread],
  );

  // Once a thread selects an environment, never substitute the primary
  // environment's config while the selected environment is still loading.
  const serverConfig = activeThread
    ? (activeEnvironment?.serverConfig ?? null)
    : (primaryEnvironment?.serverConfig ?? null);
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS;
  const threadModelCapabilitiesFor = useCallback(
    (selection: ModelSelection) => {
      const provider = providerStatuses.find(
        (candidate) => candidate.instanceId === selection.instanceId,
      );
      return provider
        ? getProviderModelCapabilities(provider.models, selection.model, provider.driver)
        : null;
    },
    [providerStatuses],
  );
  useThreadModelSelection({
    threadRef: routeKind === "server" ? routeThreadRef : null,
    threadSelection: serverThread?.modelSelection ?? null,
    write: writeThreadModelSelection,
    capabilitiesFor: threadModelCapabilitiesFor,
  });
  const selectedProviderByThreadId = composerActiveProvider ?? null;
  const threadProvider =
    activeThread?.modelSelection.instanceId ??
    activeProjectDefaultModelSelection?.instanceId ??
    null;
  const lockedProvider = deriveLockedProvider({
    thread: activeThread,
    selectedProvider: selectedProviderByThreadId,
    threadProvider,
    providers: providerStatuses,
  });
  const attachmentEnvironmentConfig = environmentById.get(environmentId)?.serverConfig ?? null;
  const attachmentUploadsCapabilityKnown = attachmentEnvironmentConfig !== null;
  const supportsAttachmentUploads =
    attachmentEnvironmentConfig?.environment.capabilities.attachmentUploads === true;
  // The banner names the Mate, never the environment's label: on a Mate that
  // is the container's internal host.
  const zeropsMates = useZeropsMateDirectory();
  // Who lives here as the directory reads it: the composer says nothing until it is known.
  const whoLivesHereKind = useZeropsMate(environmentId).kind;
  const mateLinkVoice = useMateVoice();
  // Out of reach while its link is down and its notice speaks: a live card holds where the Mate
  // was last heard and says what the notice says (Milo's stress run 6: "Thinking", its clock
  // ticking, through a planned restart).
  const mateAwayWords =
    activeEnvironmentUnavailable && mateLinkVoice.surface !== "none"
      ? (mateLinkVoice.headline ?? mateLinkVoice.text ?? null)
      : null;
  const [mateAwaySince, setMateAwaySince] = useState<string | null>(null);
  // When it went out of reach, kept while it stays there: set as the state changes, never later.
  if ((mateAwayWords !== null) !== (mateAwaySince !== null))
    setMateAwaySince(mateAwayWords === null ? null : new Date().toISOString());
  const mateAway = useMemo<MateAway | null>(
    () =>
      mateAwayWords === null || mateAwaySince === null
        ? null
        : { since: mateAwaySince, words: mateAwayWords },
    [mateAwayWords, mateAwaySince],
  );
  const reviveFailedMate = useReviveFailedMate();
  const recoveryMate = zeropsMateAt(zeropsMates, environmentId);
  const mateRecoveryAction = useMateRecoveryAction(
    recoveryMate.kind === "mate" ? (recoveryMate.mate.projectId ?? null) : null,
  );
  const tryMateAgain = useTryMateAgain();
  const healthRead = useAtomValue(
    mateHealthAtom(recoveryMate.kind === "mate" ? (recoveryMate.mate.projectId ?? "") : ""),
  );
  const systemComposerBannerItems = useMemo<ComposerBannerStackItem[]>(() => {
    const items: ComposerBannerStackItem[] = [];
    const unavailableConnection = activeEnvironmentUnavailableState?.connection ?? null;
    const environmentReconnecting =
      unavailableConnection !== null &&
      (unavailableConnection.phase === "connecting" ||
        unavailableConnection.phase === "reconnecting");
    const suppressUnavailableBanner = environmentReconnecting && !reconnectWarningGraceElapsed;
    // A Mate's link speaks with one voice, the route's (`mateVoice`): its banner, not the
    // connection's.
    const routeMateAt = zeropsMateAt(zeropsMates, environmentId);
    if (routeMateAt.kind === "mate") {
      const banner = mateVoiceBannerItem({
        environmentId,
        voice: mateLinkVoice,
        onContainerAction: mateRecoveryAction.act,
        busy: mateRecoveryAction.busy,
        recoveryFeedback: mateRecoveryAction.feedback,
        projectUrl: routeMateAt.mate.projectUrl,
        // A container that failed is stopped and started; any other Mate is asked again, its
        // exchange as well as its link.
        onRetry: () => {
          if (!reviveFailedMate(routeMateAt.mate.serviceId)) tryMateAgain(environmentId);
        },
        projects: <Link to="/zerops" />,
      });
      if (banner !== null) items.push(banner);
      const healthBanner = mateHealthBannerItem({
        name: routeMateAt.mate.name,
        read: healthRead,
        projectUrl: routeMateAt.mate.projectUrl,
      });
      if (healthBanner !== null) items.push(healthBanner);
      return items;
    }
    if (activeEnvironmentUnavailableState && unavailableConnection && !suppressUnavailableBanner) {
      const { environmentId } = activeEnvironmentUnavailableState;
      const mateAt = zeropsMateAt(zeropsMates, environmentId);
      const banner = environmentConnectionBannerItem({
        environmentId,
        connection: unavailableConnection,
        mateName: mateAt.kind === "mate" ? mateAt.mate.name : null,
        onRetry: () => void handleReconnectActiveEnvironment(environmentId),
      });
      if (banner !== null) items.push(banner);
    }
    return items;
  }, [
    activeEnvironmentUnavailableState,
    environmentId,
    mateLinkVoice,
    healthRead,
    mateRecoveryAction.act,
    mateRecoveryAction.busy,
    mateRecoveryAction.feedback,
    reconnectWarningGraceElapsed,
    reviveFailedMate,
    tryMateAgain,
    handleReconnectActiveEnvironment,
    zeropsMates,
  ]);
  // The task this conversation works, on an automated Mate: the header names it.
  const activeThreadMessages = activeThread?.messages;
  const activeThreadTask = useMemo(
    () => conversationTask(activeThreadMessages ?? []),
    [activeThreadMessages],
  );
  // An automated Mate runs on the organization's key: no agent a person signs in is offered.
  const automatedHere =
    activeThreadEnvironmentId !== null &&
    (() => {
      const at = zeropsMateAt(zeropsMates, activeThreadEnvironmentId);
      return at.kind === "mate" && at.mate.automated === true;
    })();
  const providerInstanceEntries = useMemo(
    () =>
      automatedMateEntries(
        sortProviderInstanceEntries(
          applyProviderInstanceSettings(deriveProviderInstanceEntries(providerStatuses), settings),
        ),
        automatedHere,
      ),
    [automatedHere, providerStatuses, settings],
  );
  // The composer and picker read the same scoped authentication facts.
  const zeropsAgentAuthRead = useZeropsAgentAuth(activeThreadEnvironmentId);
  // The sign-in surfaces below act on a snapshot once one is known, kept
  // while stale; until then the agents' region says it is checking.
  const zeropsAgentAuth = useMemo(
    () => zeropsAgentAuthView(zeropsAgentAuthRead),
    [zeropsAgentAuthRead],
  );
  const checkAgentAuth = useAtomCommand(zeropsCommands.agentAuthCheck, "zerops agent auth check");
  const zeropsViewerSubject = useZeropsSessionOptional()?.user?.id;
  // The environment, not the thread: a draft has one before it has the other,
  // and the header names the project either way. It draws topology contents,
  // independently of the listing's transport freshness.
  const zeropsTopology = useZeropsTopology(activeThreadEnvironmentId);
  // The one sign-in dialog, shared with the model picker's per-agent panels
  // and the Crew tab — see `useZeropsAgentSignInDialog`.
  const zeropsSignInDialog = useZeropsAgentSignInDialog(activeThreadEnvironmentId, activeThreadRef);
  const zeropsAgentAvailabilityByInstanceId = useMemo(
    () =>
      resolveZeropsProviderAvailability({
        entries: providerInstanceEntries,
        agentAuth: zeropsAgentAuthRead,
      }),
    [providerInstanceEntries, zeropsAgentAuthRead],
  );
  const zeropsIsAgentRunnable = useCallback(
    (instanceId: ProviderInstanceId) =>
      isZeropsInstanceRunnable(zeropsAgentAvailabilityByInstanceId, instanceId),
    [zeropsAgentAvailabilityByInstanceId],
  );
  const { selectedProviderEntry, requestedDriverKind } = useMemo(
    () =>
      resolveComposerProviderSelection({
        entries: providerInstanceEntries,
        candidateInstanceIds: [
          selectedProviderByThreadId,
          activeThread?.session?.providerInstanceId,
          activeThread?.modelSelection.instanceId,
          activeProjectDefaultModelSelection?.instanceId,
        ],
        lockedProvider,
        lockedInstanceId:
          activeThread?.session?.providerInstanceId ?? activeThread?.modelSelection.instanceId,
        zerops:
          zeropsAgentAvailabilityByInstanceId !== undefined
            ? { available: true, isAgentRunnable: zeropsIsAgentRunnable }
            : undefined,
      }),
    [
      activeProjectDefaultModelSelection?.instanceId,
      activeThread?.modelSelection.instanceId,
      activeThread?.session?.providerInstanceId,
      lockedProvider,
      providerInstanceEntries,
      selectedProviderByThreadId,
      zeropsAgentAvailabilityByInstanceId,
      zeropsIsAgentRunnable,
    ],
  );
  const selectedProvider = selectedProviderEntry?.driverKind ?? requestedDriverKind;
  const activeProviderInstanceId = selectedProviderEntry?.instanceId ?? null;
  const activeProviderStatus = selectedProviderEntry?.snapshot ?? null;
  const { enabled: interactionModeEnabled, interactionMode } = resolveComposerInteractionMode({
    planModeEnabled: settings.planModeEnabled,
    provider: activeProviderStatus,
    interactionMode:
      composerInteractionMode ?? activeThread?.interactionMode ?? DEFAULT_INTERACTION_MODE,
  });
  const conversationProviderStatus =
    providerStatuses.find(
      (status) => status.instanceId === activeThread?.session?.providerInstanceId,
    ) ?? activeProviderStatus;
  const phase = derivePhase(activeThread?.session ?? null);
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES;
  // The origins the engine asked of the person, by run card: a key, so streaming draws nothing.
  const originAskKey = useMemo(() => originAskPlacesKey(threadActivities), [threadActivities]);
  const originAsks = useMemo(() => originAskPlaces(originAskKey), [originAskKey]);
  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(threadActivities),
    [threadActivities],
  );
  const activeZeropsLifecycle = useZeropsLifecycle(activeThreadEnvironmentId, activeThreadId);
  const zeropsBuilds = useDeployBuilds(activeZeropsLifecycle);
  const zeropsThreadModel = useMemo(
    () =>
      deriveZeropsThreadModel({
        activities: threadActivities,
        lifecycle: activeZeropsLifecycle,
        runningTurnId: activeRunningTurnId,
        builds: zeropsBuilds.builds,
        restarts: zeropsBuilds.restarts,
      }),
    [
      threadActivities,
      activeZeropsLifecycle,
      activeRunningTurnId,
      zeropsBuilds.builds,
      zeropsBuilds.restarts,
    ],
  );
  useRunningBuildDemand(zeropsBuilds.projectId, zeropsThreadModel.running);
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(threadActivities, { exclude: zeropsThreadModel.zeropsActivityIds }),
    [threadActivities, zeropsThreadModel.zeropsActivityIds],
  );
  const turnPlans = useMemo(() => deriveTurnPlans(threadActivities), [threadActivities]);
  const backgroundTasks = useMemo(() => foldBackgroundTasks(threadActivities), [threadActivities]);
  // Native subagent fold: memoized by activity-list identity, shared by the
  // Agents surface, live strip, and workflow cards. v2Projection is null
  // until orchestration-v2 lands (source precedence lives in the derive).
  // sessionLive derives interruption for agents orphaned by session death.
  const agentSessionLive = helpersSessionLive({
    phase,
    backgroundLiveness: activeThreadShell?.backgroundLiveness,
  });
  const agentPanelModel = useMemo(
    () =>
      keptAgentPanelModel(
        activeThreadKey,
        deriveAgentPanelModel({
          agents: foldSubagentActivities(threadActivities, { sessionLive: agentSessionLive }),
        }),
      ),
    [activeThreadKey, agentSessionLive, threadActivities],
  );
  const { approvals: pendingApprovals, userInputs: pendingUserInputs } = useMemo(
    () => derivePendingRequests(threadActivities),
    [threadActivities],
  );
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const questionAttachments = useQuestionAttachments({
    scope: activePendingUserInput ? `${activeThreadKey}:${activePendingUserInput.requestId}` : null,
    environmentId,
    questionId:
      activePendingUserInput?.questions[
        pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0
      ]?.id ?? null,
    supported:
      attachmentEnvironmentConfig === null
        ? null
        : supportsAttachmentUploads &&
          attachmentEnvironmentConfig.environment.capabilities.questionAttachments === true,
    onError: (message) => {
      if (activeThreadId) setThreadError(activeThreadId, message);
    },
  });
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? Object.fromEntries(
            activePendingUserInput.questions.map((question) => [
              question.id,
              {
                ...pendingUserInputAnswersByRequestId[activePendingUserInput.requestId]?.[
                  question.id
                ],
                attachmentCount: questionAttachments.entries.filter(
                  (entry) => entry.questionId === question.id,
                ).length,
                attachmentsBlocked: questionAttachments.blocked,
              },
            ]),
          )
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [
      activePendingUserInput,
      pendingUserInputAnswersByRequestId,
      questionAttachments.entries,
      questionAttachments.blocked,
    ],
  );
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0;
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex,
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput],
  );
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput],
  );
  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false;
  const activeProposedPlan = useMemo(() => {
    if (!latestTurnSettled) {
      return null;
    }
    return findLatestProposedPlan(
      activeThread?.proposedPlans ?? [],
      activeLatestTurn?.turnId ?? null,
    );
  }, [activeLatestTurn?.turnId, activeThread?.proposedPlans, latestTurnSettled]);
  const activePlan = useMemo(
    () => deriveActivePlanState(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities],
  );
  // Current step for the in-chat working row: only for the running turn's own
  // plan (deriveActivePlanState falls back to older turns' plans, which must
  // not label fresh work). Falls back to the first pending step so an
  // all-pending freshly written plan labels the row, matching the chip and
  // the server's planProgress.
  const workingStepLabel = useMemo(() => {
    if (!activePlan || activePlan.turnId !== (activeLatestTurn?.turnId ?? null)) {
      return null;
    }
    return (
      activePlan.steps.find((step) => step.status === "inProgress")?.step ??
      activePlan.steps.find((step) => step.status === "pending")?.step ??
      null
    );
  }, [activeLatestTurn?.turnId, activePlan]);
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    interactionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan);
  const activePendingApproval = pendingApprovals[0] ?? null;
  // The open /usage-limits panel for this thread, model and turn. Only the open
  // moment is stored: the rows read live provider data, so a redeemed reset
  // credit or refreshed probe shows through. Anything that spends quota closes
  // it: a new turn from any source, or the agent resuming after an approval or
  // answered question.
  const [usageLimitsPanel, setUsageLimitsPanel] = useState<{
    readonly key: string;
    readonly threadKey: string;
    readonly now: number;
  } | null>(null);
  // Null while the provider list or the thread itself is unavailable, such as
  // during a reconnect; the panel then stays hidden rather than being dropped.
  // A pending approval or question is part of the key: once it is answered,
  // from this client or any other, the agent resumes and spends quota.
  const usageLimitsKey =
    activeProviderInstanceId === null || (isServerThread && activeThread === undefined)
      ? null
      : [
          routeThreadKey,
          activeProviderInstanceId,
          activeThread?.latestTurn?.turnId ?? "",
          activePendingApproval?.requestId ?? activePendingUserInput?.requestId ?? "",
        ].join(":");
  // Drop the snapshot as soon as the thread or model changes so it cannot resurface stale.
  if (
    usageLimitsPanel !== null &&
    usageLimitsKey !== null &&
    usageLimitsPanel.key !== usageLimitsKey
  ) {
    setUsageLimitsPanel(null);
  }
  const usageLimitSources = serverConfig?.usageLimitSources ?? EMPTY_USAGE_LIMIT_SOURCES;
  const usageLimitsReport = useMemo(
    () =>
      usageLimitsPanel !== null &&
      usageLimitsKey !== null &&
      usageLimitsPanel.key === usageLimitsKey &&
      activeProviderInstanceId !== null
        ? collectProviderUsageLimits(
            activeProviderInstanceId,
            providerStatuses,
            usageLimitSources,
            usageLimitsPanel.now,
          )
        : null,
    [
      activeProviderInstanceId,
      providerStatuses,
      usageLimitSources,
      usageLimitsKey,
      usageLimitsPanel,
    ],
  );
  const usageLimitsAnswer = useMemo(
    () =>
      usageLimitsReport !== null && usageLimitsPanel !== null
        ? // A fresh id per opening: each answer is a row of its own.
          usageLimitsNotice(
            `usage-limits:${usageLimitsPanel.key}:${usageLimitsPanel.now}`,
            usageLimitsReport,
            environmentId,
            () => setUsageLimitsPanel(null),
          )
        : null,
    [environmentId, usageLimitsPanel, usageLimitsReport],
  );
  // The client owns /usage-limits only where Limits has data for the selected
  // provider; elsewhere the name stays the provider's own and is sent through untouched.
  const usageLimitsOffered =
    activeProviderStatus !== null &&
    hasProviderUsageLimits(activeProviderStatus.driver, providerStatuses, usageLimitSources);
  // Answered locally from the last Limits snapshot; the agent never sees it.
  const openUsageLimits = useCallback(() => {
    const now = Date.now();
    const report =
      activeProviderInstanceId !== null && usageLimitsKey !== null
        ? collectProviderUsageLimits(
            activeProviderInstanceId,
            providerStatuses,
            usageLimitSources,
            now,
          )
        : null;
    if (report && usageLimitsKey !== null) {
      setUsageLimitsPanel({ key: usageLimitsKey, threadKey: routeThreadKey, now });
      return true;
    }
    setUsageLimitsPanel(null);
    toastManager.add({ type: "info", title: "Usage limits are unavailable for this provider" });
    return false;
  }, [
    activeProviderInstanceId,
    providerStatuses,
    routeThreadKey,
    usageLimitSources,
    usageLimitsKey,
  ]);
  // Responses can resolve after navigating away; only the originating thread's panel clears.
  const clearUsageLimitsFor = useCallback(
    (threadKey: string) =>
      setUsageLimitsPanel((current) =>
        current !== null && current.threadKey === threadKey ? null : current,
      ),
    [],
  );
  const {
    beginLocalDispatch,
    resetLocalDispatch,
    localDispatchStartedAt,
    latestUserMessageAt,
    isPreparingWorktree,
    isSendBusy,
    backgroundSubmissionPending,
  } = useLocalDispatchState({
    activeThread,
    activeLatestTurn,
    phase,
    activePendingApproval: activePendingApproval?.requestId ?? null,
    activePendingUserInput: activePendingUserInput?.requestId ?? null,
    threadError,
  });
  const optimisticCompactionMessage = optimisticUserMessages.at(-1);
  const pendingCompactionMessage =
    isSendBusy &&
    optimisticCompactionMessage !== undefined &&
    isCompactCommandMessage(optimisticCompactionMessage)
      ? optimisticCompactionMessage
      : activeThread?.messages.findLast(isCompactCommandMessage);
  const compactRequestIsActive =
    pendingCompactionMessage !== undefined &&
    (pendingCompactionMessage.createdAt >
      (activeLatestTurn?.requestedAt ?? pendingCompactionMessage.createdAt) ||
      (activeLatestTurn?.state === "running" &&
        pendingCompactionMessage.createdAt === activeLatestTurn.requestedAt));
  const compactionSettled =
    pendingCompactionMessage !== undefined &&
    (latestTurnStartFailureId(activeThread, pendingCompactionMessage.id) !== null ||
      activeThread?.activities.some((activity) => {
        if (activity.kind !== "context-compaction") return false;
        const payload = activity.payload as { readonly requestId?: unknown } | null | undefined;
        return payload?.requestId === pendingCompactionMessage.id;
      }));
  const isCompacting =
    (isSendBusy || phase === "connecting" || phase === "running") &&
    compactRequestIsActive &&
    !compactionSettled;
  const isWorking =
    (phase === "running" && !usageRefused) ||
    phase === "connecting" ||
    isSendBusy ||
    isConnecting ||
    isCompacting;
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    localDispatchStartedAt,
    latestUserMessageAt,
  );
  useEffect(() => {
    attachmentPreviewHandoffByMessageIdRef.current = attachmentPreviewHandoffByMessageId;
  }, [attachmentPreviewHandoffByMessageId]);
  const clearAttachmentPreviewHandoff = useCallback(
    (messageId: MessageId, previewUrls?: ReadonlyArray<string>) => {
      const currentPreviewUrls =
        previewUrls ?? attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
      setAttachmentPreviewHandoffByMessageId((existing) => {
        if (!(messageId in existing)) {
          return existing;
        }
        const next = { ...existing };
        delete next[messageId];
        attachmentPreviewHandoffByMessageIdRef.current = next;
        return next;
      });
      for (const previewUrl of currentPreviewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    },
    [],
  );
  const clearAttachmentPreviewHandoffs = useCallback(() => {
    for (const previewUrls of Object.values(attachmentPreviewHandoffByMessageIdRef.current)) {
      for (const previewUrl of previewUrls) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    attachmentPreviewHandoffByMessageIdRef.current = {};
    setAttachmentPreviewHandoffByMessageId({});
  }, []);
  useEffect(() => {
    return () => {
      clearAttachmentPreviewHandoffs();
      for (const message of optimisticUserMessagesRef.current) {
        revokeUserMessagePreviewUrls(message);
      }
    };
  }, [clearAttachmentPreviewHandoffs]);
  const handoffAttachmentPreviews = useCallback((messageId: MessageId, previewUrls: string[]) => {
    if (previewUrls.length === 0) return;

    const previousPreviewUrls = attachmentPreviewHandoffByMessageIdRef.current[messageId] ?? [];
    const nextPreviewUrlSet = new Set(previewUrls);
    for (const previewUrl of previousPreviewUrls) {
      if (!nextPreviewUrlSet.has(previewUrl)) {
        revokeBlobPreviewUrl(previewUrl);
      }
    }
    setAttachmentPreviewHandoffByMessageId((existing) => {
      const next = {
        ...existing,
        [messageId]: previewUrls,
      };
      attachmentPreviewHandoffByMessageIdRef.current = next;
      return next;
    });
  }, []);
  const sendTurnReceipts = useSendTurnReceipts();
  const serverMessages = activeThread?.messages;

  const [projectServerMessagePreviews] = useState(createMessageAttachmentPreviewProjector);
  const [projectHandoffMessagePreviews] = useState(createMessageAttachmentPreviewProjector);
  const serverAttachmentResources = useMemo(
    () => selectHandoffImageResources(serverMessages, attachmentPreviewHandoffByMessageId),
    [serverMessages, attachmentPreviewHandoffByMessageId],
  );
  const serverAttachmentUrls = useAssetUrls(environmentId, serverAttachmentResources);
  const serverAttachmentUrlById = useMemo(
    () =>
      new Map(
        serverAttachmentResources.flatMap((resource, index) => {
          const url = serverAttachmentUrls[index];
          return url ? [[resource.attachmentId, url] as const] : [];
        }),
      ),
    [serverAttachmentResources, serverAttachmentUrls],
  );
  const displayServerMessages = useMemo<ReadonlyArray<ChatMessage>>(() => {
    if (!serverMessages) return [];
    return serverMessages.map((message) =>
      projectServerMessagePreviews(message, (attachment) =>
        serverAttachmentUrlById.get(attachment.id),
      ),
    );
  }, [projectServerMessagePreviews, serverAttachmentUrlById, serverMessages]);
  useEffect(() => {
    // Once signed URLs exist, the rendered lazy images own the fetch. Preloading here would
    // download pictures even when their messages are outside the viewport.
    const userMessagesById = new Map(
      displayServerMessages
        .filter((message) => message.role === "user")
        .map((message) => [String(message.id), message] as const),
    );
    for (const [messageId, handoffPreviewUrls] of Object.entries(
      attachmentPreviewHandoffByMessageId,
    )) {
      const attachments = userMessagesById.get(messageId)?.attachments ?? [];
      const urls = attachments.flatMap((attachment) =>
        isImageAttachment(attachment) && attachment.previewUrl ? [attachment.previewUrl] : [],
      );
      if (
        urls.length > 0 &&
        urls.length === handoffPreviewUrls.length &&
        urls.every((url) => !url.startsWith("blob:"))
      ) {
        clearAttachmentPreviewHandoff(messageId as MessageId, handoffPreviewUrls);
      }
    }
  }, [attachmentPreviewHandoffByMessageId, clearAttachmentPreviewHandoff, displayServerMessages]);
  const timelineMessages = useMemo(() => {
    const messages = displayServerMessages;
    const serverMessagesWithPreviewHandoff =
      Object.keys(attachmentPreviewHandoffByMessageId).length === 0
        ? messages
        : messages.map((message) => {
            if (
              message.role !== "user" ||
              !message.attachments ||
              message.attachments.length === 0
            ) {
              return message;
            }
            const handoffPreviewUrls = attachmentPreviewHandoffByMessageId[message.id];
            if (!handoffPreviewUrls || handoffPreviewUrls.length === 0) {
              return message;
            }

            let imageIndex = 0;
            return projectHandoffMessagePreviews(message, (attachment) => {
              if (!isImageAttachment(attachment)) {
                return undefined;
              }
              const handoffPreviewUrl = handoffPreviewUrls[imageIndex];
              imageIndex += 1;
              return handoffPreviewUrl;
            });
          });

    const localMessages = optimisticUserMessages;
    if (localMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    const serverIds = new Set(serverMessagesWithPreviewHandoff.map((message) => message.id));
    const pendingMessages = localMessages.filter((message) => !serverIds.has(message.id));
    if (pendingMessages.length === 0) {
      return serverMessagesWithPreviewHandoff;
    }
    return [...serverMessagesWithPreviewHandoff, ...pendingMessages];
  }, [
    attachmentPreviewHandoffByMessageId,
    displayServerMessages,
    optimisticUserMessages,
    projectHandoffMessagePreviews,
  ]);
  // A change of this Mate's landing is a fact about the forge, not about the
  // agent, so it does not come from the activity stream.
  useZeropsMateAppDetailHold(activeThreadEnvironmentId);
  const changeLandedEvents = useZeropsChangeLandedEvents(activeThreadEnvironmentId);
  // Production running a release is news to the Mate too: where the app answers now.
  const productionLive = useZeropsProductionLive(activeThreadEnvironmentId);
  // When the agent last spoke — the line between what it knows and what has
  // happened since. Without one nothing is said rather than everything.
  const agentSpokeAt = useMemo(() => agentLastSpokeAt(timelineMessages), [timelineMessages]);
  // What the Mate hears of its vault: the person's changes since it last spoke, as chips and a note.
  const vaultTurn = useVaultTurnNotes(activeThreadEnvironmentId, activeThreadKey, agentSpokeAt);
  // Fitted to the bound a send takes: a vault change a line, the rest counted and told later.
  const turnContext = useMemo(() => {
    const context = agentContext(
      [
        ...agentTurnNotes(changeLandedEvents, agentSpokeAt),
        ...productionTurnNotes(productionLive, agentSpokeAt),
      ],
      vaultTurn.changes,
    );
    return { notes: context.lines, vaultChanges: context.told };
  }, [agentSpokeAt, changeLandedEvents, productionLive, vaultTurn.changes]);
  const agentNotes = turnContext.notes;
  // The Mate hears of every landing; this conversation shows the ones it named.
  const conversationLandedEvents = useZeropsConversationLandings(
    changeLandedEvents,
    timelineMessages,
  );
  const timelineProjectionRef = useRef<{
    threadKey: string | null;
    projection: TimelineEntriesProjection;
  } | null>(null);
  const timelineEntries = useMemo(() => {
    const started = mateDiagnostics.enabled ? performance.now() : 0;
    const previous = timelineProjectionRef.current;
    const projection = deriveTimelineEntriesWithState(
      timelineMessages,
      activeThread?.proposedPlans ?? [],
      workLogEntries,
      previous?.threadKey === activeThreadKey ? previous.projection : null,
      turnPlans,
      zeropsThreadModel.entries,
      conversationLandedEvents,
    );
    timelineProjectionRef.current = { threadKey: activeThreadKey, projection };
    mateDiagnostics.record({
      kind: "history-stage",
      environmentId,
      threadId,
      stage: "projection",
      durationMs: performance.now() - started,
    });
    return projection.entries;
  }, [
    timelineProjectionRef,
    activeThreadKey,
    activeThread?.proposedPlans,
    timelineMessages,
    turnPlans,
    workLogEntries,
    zeropsThreadModel.entries,
    conversationLandedEvents,
  ]);
  // While the thread detail reloads, repaint this thread's own last timeline
  // instead of an empty pane.
  const displayedTimeline = resolveThreadSwitchTimeline({
    loading: timelineEntries.length === 0 && threadSyncPhase !== null,
    activeThreadKey,
    nextEntries: timelineEntries,
    rememberedForActive: peekRememberedThreadTimeline<typeof timelineEntries>(activeThreadKey),
  });
  useLayoutEffect(() => {
    if (
      threadDetailLoading ||
      timelineEntries.length === 0 ||
      timelineHasEphemeralPreviewUrls(timelineEntries)
    ) {
      return;
    }
    rememberReadyThreadTimeline({ threadKey: activeThreadKey, entries: timelineEntries });
  }, [activeThreadKey, threadDetailLoading, timelineEntries]);
  const [dockedDraftHeroThreadKey, setDockedDraftHeroThreadKey] = useState<string | null>(null);
  const draftHeroDockRequested =
    activeThreadKey !== null && dockedDraftHeroThreadKey === activeThreadKey;
  // The person's Chief: the organization's Mate (`chief.ts`).
  const chiefConversation = (() => {
    const at = zeropsMateAt(zeropsMates, environmentId);
    return at.kind === "mate" && at.mate.chief === true;
  })();
  // A Mate no coding agent is signed in to — its Chief, or one nobody has signed in yet, whose
  // opening lands on a draft: the Mate sign-in stands in place of its question and the composer,
  // as an empty conversation's opening (`mateShowsSignIn`).
  const mateSignIn = mateShowsSignIn({
    mate: zeropsMateAt(zeropsMates, environmentId).kind === "mate",
    automated: automatedHere,
    signInRequired: admissionNeedsSignIn(zeropsAgentAuthRead, providerStatuses),
    said: timelineEntries.length > 0,
  });
  const isDraftHeroState =
    !mateSignIn &&
    resolveDraftHeroState({
      isLocalDraftThread,
      hasTimelineEntries: timelineEntries.length > 0,
      isWorking,
      draftHeroDockRequested,
      backgroundSubmissionPending,
    });
  const [
    attachDraftHeroTransitionGroupRef,
    attachDraftHeroComposerAnchorRef,
    captureDraftHeroComposerRect,
  ] = useDraftHeroLayoutTransition(isDraftHeroState);

  const gitCwd = activeProject
    ? projectScriptCwd({
        project: { cwd: activeProject.workspaceRoot },
        worktreePath: activeThread?.worktreePath ?? null,
      })
    : null;
  const gitStatusCwd = activeThread?.worktreePath ?? gitCwd;
  // A Mate's new terminal starts in its code checkout, never its bare workspace (`terminalStartCwd`).
  const mateLeases = useThreadLeases(
    activeProject ? environmentId : null,
    activeThreadId,
    activeThread?.lease ?? null,
  );
  const mateRepositories = useMateRepositories(activeProject ? environmentId : null, mateLeases);
  const terminalOpenCwd = activeProject
    ? terminalStartCwd({
        launchCwd: null,
        workspaceRoot: activeProject.workspaceRoot,
        lease: activeThread?.lease?.alias ?? null,
        worktreePath: activeThread?.worktreePath ?? null,
        repositories: mateRepositories,
      })
    : null;
  const gitStatusQuery = useEnvironmentQuery(
    gitStatusCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId,
          input: { cwd: gitStatusCwd },
        }),
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const manualCompactionProviderAvailable = useMemo(
    () =>
      hasAvailableCompactionProvider({
        providers: providerInstanceEntries,
        driverKind: selectedProvider,
        instanceId: activeProviderInstanceId,
        lockedInstanceId: lockedProvider
          ? (activeThread?.session?.providerInstanceId ??
            activeThread?.modelSelection.instanceId ??
            null)
          : null,
      }),
    [
      activeProviderInstanceId,
      activeThread?.modelSelection.instanceId,
      activeThread?.session?.providerInstanceId,
      lockedProvider,
      providerInstanceEntries,
      selectedProvider,
    ],
  );
  const [resumeCompactionPermanentlyDismissed, setResumeCompactionPermanentlyDismissed] =
    useLocalStorage(
      `t3code:resume-compaction-dismissed:${environmentId}:${activeProviderInstanceId ?? "claudeAgent"}`,
      false,
      Schema.Boolean,
    );
  const nativeResumeCompactionDismissed = useMemo(
    () => hasDismissedResumeCompaction(threadActivities),
    [threadActivities],
  );
  useEffect(() => {
    if (nativeResumeCompactionDismissed && !resumeCompactionPermanentlyDismissed) {
      setResumeCompactionPermanentlyDismissed(true);
    }
  }, [
    nativeResumeCompactionDismissed,
    resumeCompactionPermanentlyDismissed,
    setResumeCompactionPermanentlyDismissed,
  ]);
  const mateStandUp = useMateStandUp({
    environmentId: activeThreadEnvironmentId,
    threadRef: isServerThread ? activeThreadRef : null,
    messageCount: activeThread?.messages.length ?? 0,
    // Held while it is read again (a reload): a conversation with messages gives the composer back
    // at once, and its room with it, rather than when the read settles and the end moves.
    live: threadSyncPhase === null,
  });
  // Whose Mate it is, as HQ records it: a colleague's is read along, never written to.
  const admissionMate = zeropsMateAt(zeropsMates, environmentId);
  const pageMateName = admissionMate.kind === "mate" ? admissionMate.mate.name : undefined;
  // Its descriptor places a new Mate before HQ's overview can name its environment.
  const admissionProject = useEnvironmentProjectRef(environmentId);
  const nativeCapabilities = usePlatformCapabilities(environmentId);
  const admissionPeople = useHqProjectPerson(admissionProject?.projectId ?? "");
  const admissionOwner =
    zeropsViewerSubject === undefined
      ? undefined
      : zeropsMateOwnerOf(admissionPeople?.owner, zeropsViewerSubject);
  const engineCards = useEngineRunCards(activeThreadRef);
  // The engine answers a send before admission does: a message sent from here that admission
  // then refused goes back into the composer, as a refused send always did, unless the person has
  // started writing something else there.
  const sentHereRef = useRef(new Set<string>());
  useEffect(() => {
    for (const card of Object.values(engineCards ?? {})) {
      const refused = card.refused;
      if (refused === undefined || !sentHereRef.current.delete(refused.messageId)) continue;
      if (promptRef.current.length > 0) continue;
      promptRef.current = refused.text;
      setComposerDraftPrompt(composerDraftTarget, refused.text);
      composerRef.current?.resetCursorState({
        cursor: collapseExpandedComposerCursor(refused.text, refused.text.length),
        prompt: refused.text,
        detectTrigger: true,
      });
    }
  }, [composerDraftTarget, composerRef, engineCards, setComposerDraftPrompt]);
  const admission = agentAdmission({
    environmentId,
    operate: admissionProject === null ? undefined : nativeCapabilities.operate,
    instanceId: activeProviderInstanceId ?? activeThread?.modelSelection.instanceId,
    viewerSubject: zeropsViewerSubject,
    read: zeropsAgentAuthRead,
    standUpHolds: mateStandUp.holdsComposer,
    empty: isServerThread && (activeThread?.messages.length ?? 0) === 0,
    refusalSource:
      localServerError !== null
        ? localServerErrorsByThreadKey[routeThreadKey]?.refusalSource
        : localDraftError !== null
          ? localDraftErrorsByDraftId[draftId ?? ""]?.refusalSource
          : engineRunRefusal(
              engineCards === null
                ? undefined
                : Object.values(engineCards).flatMap((card) => card.runs),
            ),
    providers: providerStatuses,
    mateName: admissionMate.kind === "mate" ? admissionMate.mate.name : "This Mate",
    // It runs on the organization's key: no sign-in, and with no agent to run, it says so.
    automated: automatedHere,
    owner:
      admissionMate.kind === "nobody" || admissionPeople?.owned === false
        ? null
        : admissionOwner === undefined
          ? undefined
          : { mine: admissionOwner.isViewer },
  });
  const colleagueReadOnly =
    admissionOwner?.isViewer === false
      ? colleagueMateReadOnly({
          mateName: admissionMate.kind === "mate" ? admissionMate.mate.name : "This Mate",
          ownerName: admissionOwner.name,
        })
      : admission.readOnly
        ? {
            notice: admission.sendBlockReason ?? MATE_READ_ACCESS_LINE,
            waitingLabel: "Waiting for a project operator",
          }
        : null;
  const readAlongRoom = nextReadAlongRoom(readAlongRoomState, {
    threadKey: routeThreadKey,
    turnId: activeLatestTurn?.turnId ?? null,
    pendingHeight:
      admission.footer === "held" && (activeThread?.messages.length ?? 0) > 0
        ? composerOverlayHeight
        : 0,
    readAlong: colleagueReadOnly !== null,
  });
  useLayoutEffect(() => {
    if (readAlongRoom !== readAlongRoomState) setReadAlongRoom(readAlongRoom);
  }, [readAlongRoom, readAlongRoomState]);
  const warmTimelineAsk = useWarmTimelineAsk();
  const rememberedInset = rememberedTimelineInset(routeThreadKey);
  const timelineInsetMeasured = composerOverlaySettledFor === routeThreadKey;
  const timelineInsetEnd =
    composerOverlaySettledFor === routeThreadKey
      ? Math.max(composerOverlayHeight, readAlongRoom.heldHeight)
      : (rememberedInset ?? Math.max(composerOverlayHeight, readAlongRoom.heldHeight));

  // The agent the conversation runs on, where it is one the agents card signs in.
  const conversationInstanceId =
    activeProviderInstanceId ?? activeThread?.modelSelection.instanceId;
  const conversationAgentId =
    agentIdForDriverKind(
      providerStatuses.find((provider) => provider.instanceId === conversationInstanceId)?.driver,
    ) ?? agentIdForProviderInstance(conversationInstanceId);
  // An engine run that broke off says so on its card, as a V1 turn's error activity did.
  const shownThreadError =
    admission.explainsRefusal || engineCardsShowError(engineCards, visibleThreadError)
      ? null
      : visibleThreadError;
  const activeProjectCwd = activeProject?.workspaceRoot ?? null;
  const activeThreadWorktreePath = activeThread?.worktreePath ?? null;
  const activeWorkspaceRoot = activeThreadWorktreePath ?? activeProjectCwd ?? undefined;
  const activeTerminalLaunchContext =
    terminalUiLaunchContext?.threadId === activeThreadId ? terminalUiLaunchContext : null;
  // Git status arrives after the composer paints. A checkout seen earlier in
  // this session answers from memory, so a non-Git project does not mount the
  // branch strip and then drop it. A never-seen checkout assumes Git, which
  // is what nearly every project is.
  const liveIsGitRepo = gitStatusQuery.data?.isRepo;
  useEffect(() => {
    if (gitStatusCwd !== null && liveIsGitRepo !== undefined) {
      rememberCheckoutIsRepo(environmentId, gitStatusCwd, liveIsGitRepo);
    }
  }, [environmentId, gitStatusCwd, liveIsGitRepo]);
  const isGitRepo = liveIsGitRepo ?? recallCheckoutIsRepo(environmentId, gitStatusCwd) ?? true;
  const showComposerContextStrip = shouldShowComposerContextStrip({
    hasActiveProject: activeProject !== null,
    isGitRepo,
    showEnvironmentIndicator: showComposerEnvironmentIndicator,
  });
  const terminalShortcutLabelOptions = useMemo(
    () => ({
      context: {
        terminalFocus: true,
        terminalOpen: Boolean(terminalUiState.terminalOpen),
      },
    }),
    [terminalUiState.terminalOpen],
  );
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.split", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const splitTerminalVerticalShortcutLabel = useMemo(
    () =>
      shortcutLabelForCommand(keybindings, "terminal.splitVertical", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.new", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "terminal.close", terminalShortcutLabelOptions),
    [keybindings, terminalShortcutLabelOptions],
  );
  const onToggleDiff = useCallback(() => {
    // A Chief's panel offers no diff (`rightPanelKinds.ts`): its shortcut opens none either.
    if (!isServerThread || chiefConversation) {
      return;
    }
    if (!diffOpen) {
      onDiffPanelOpen?.();
    }
    if (activeThreadRef) {
      useRightPanelStore.getState().toggle(activeThreadRef, "diff");
    }
  }, [activeThreadRef, chiefConversation, diffOpen, isServerThread, onDiffPanelOpen]);

  const envLocked = Boolean(
    activeThread &&
    (activeThread.messages.length > 0 ||
      (activeThread.session !== null && activeThread.session.status !== "stopped")),
  );

  // Handle environment change for draft threads.  When the user picks a
  // different environment we update the draft context to point at the physical
  // project in that environment while keeping the same logical project.
  const onEnvironmentChange = useCallback(
    (nextEnvironmentId: EnvironmentId) => {
      if (envLocked || !draftId) return;
      const target = logicalProjectEnvironments.find(
        (env) => env.environmentId === nextEnvironmentId,
      );
      if (!target) return;
      setDraftThreadContext(draftId, {
        projectRef: scopeProjectRef(target.environmentId, target.projectId),
      });
    },
    [draftId, envLocked, logicalProjectEnvironments, setDraftThreadContext],
  );

  const activeTerminalGroup =
    terminalUiState.terminalGroups.find(
      (group) => group.id === terminalUiState.activeTerminalGroupId,
    ) ??
    terminalUiState.terminalGroups.find((group) =>
      group.terminalIds.includes(terminalUiState.activeTerminalId),
    ) ??
    null;
  const hasReachedSplitLimit =
    (activeTerminalGroup?.terminalIds.length ?? 0) >= MAX_TERMINALS_PER_GROUP;
  const setThreadError = useCallback(
    (targetThreadId: ThreadId | null, error: string | null, refusalSource?: AgentRefusalSource) => {
      if (!targetThreadId) return;
      const nextError = sanitizeThreadErrorMessage(error);
      const nextEntry: LocalThreadErrorEntry = {
        message: nextError,
        at: Date.now(),
        after: activeServerNewestTurnRef.current,
        refusalSource,
      };
      if (
        shouldWriteThreadErrorToCurrentServerThread({
          activeServerThread,
          routeThreadRef,
          targetThreadId,
        })
      ) {
        setLocalServerErrorsByThreadKey((existing) => {
          if (threadErrorEntryUnchanged(existing[routeThreadKey], nextEntry)) {
            return existing;
          }
          return {
            ...existing,
            [routeThreadKey]: nextEntry,
          };
        });
        return;
      }
      const localDraftErrorKey = draftId ?? targetThreadId;
      setLocalDraftErrorsByDraftId((existing) => {
        if (threadErrorEntryUnchanged(existing[localDraftErrorKey], nextEntry)) {
          return existing;
        }
        return {
          ...existing,
          [localDraftErrorKey]: nextEntry,
        };
      });
    },
    [activeServerThread, draftId, routeThreadKey, routeThreadRef],
  );

  // `afterTurn`: work its turn left runs on (set below, once the view knows it): a Stop then
  // needs no running turn.
  const interruptContextRef = useRef({ activeThread, phase, setThreadError, afterTurn: false });
  interruptContextRef.current = { activeThread, phase, setThreadError, afterTurn: false };
  // Assigned once the composer queue helpers exist further down.
  const restoreQueuedMessagesRef = useRef<(messages: ReadonlyArray<QueuedComposerMessage>) => void>(
    () => {},
  );
  // The one Stop (`useStopConversation`): the turn and everything it started — its helpers, its
  // shells, the work it left running after it — whichever control or key pressed it.
  const stopConversation = useStopConversation();
  const onInterrupt = useCallback(async () => {
    const { activeThread, phase, setThreadError, afterTurn } = interruptContextRef.current;
    if (!activeThread) return;
    if (!afterTurn && buildRunningThreadTurnInterruptInput(activeThread, phase) === null) return;
    // Stop also cancels the queue: the messages return to the composer instead
    // of starting a new turn the moment the interrupted one settles.
    restoreQueuedMessagesRef.current(
      useQueuedMessageStore
        .getState()
        .drain(scopedThreadKey(scopeThreadRef(activeThread.environmentId, activeThread.id))),
    );
    const answer = await stopConversation({
      environmentId: activeThread.environmentId,
      threadId: activeThread.id,
      turnId: activeThread.latestTurn?.turnId ?? null,
    });
    if (answer.kind === "refused") setThreadError(activeThread.id, answer.reason);
  }, [stopConversation]);
  /** A held message withdrawn: the engine's Stop ends its queued run before any agent has it. */
  const onWithdrawHeldMessage = async (runId: string) => {
    if (!activeThread) return;
    const result = await interruptThreadTurn({
      environmentId: activeThread.environmentId,
      input: { threadId: activeThread.id, turnId: runId as TurnId },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      setThreadError(
        activeThread.id,
        error instanceof Error ? error.message : "The message could not be withdrawn.",
      );
    }
  };
  const canInterruptRunningThread =
    buildRunningThreadTurnInterruptInput(activeThread, phase) !== null;

  const focusComposer = useCallback(() => {
    composerRef.current?.focusAtEnd();
  }, [composerRef]);
  const scheduleComposerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      focusComposer();
    });
  }, [focusComposer]);
  const addTerminalContextToDraft = useCallback(
    (selection: TerminalContextSelection) => {
      composerRef.current?.addTerminalContext(selection);
    },
    [composerRef],
  );
  const setTerminalOpen = useCallback(
    (open: boolean) => {
      if (!activeThreadRef) return;
      storeSetTerminalOpen(activeThreadRef, open);
    },
    [activeThreadRef, storeSetTerminalOpen],
  );
  const toggleTerminalVisibility = useCallback(() => {
    if (!activeThreadRef) return;
    const nextOpen = !terminalUiState.terminalOpen;
    if (nextOpen && terminalUiState.terminalIds.length === 0) {
      if (!activeThreadId || !activeProject) {
        return;
      }
      const cwdForOpen = terminalOpenCwd ?? activeProject.workspaceRoot;
      if (!cwdForOpen) {
        return;
      }
      const terminalId = nextTerminalId(allocatableActiveTerminalIds);
      storeEnsureTerminal(activeThreadRef, terminalId, { open: true });
      void openTerminal({
        environmentId,
        input: {
          threadId: activeThreadId,
          terminalId,
          cwd: cwdForOpen,
          ...(activeThreadWorktreePath != null ? { worktreePath: activeThreadWorktreePath } : {}),
          env: projectScriptRuntimeEnv({
            project: { cwd: activeProject.workspaceRoot },
            worktreePath: activeThreadWorktreePath,
          }),
        },
      });
      return;
    }
    setTerminalOpen(nextOpen);
  }, [
    activeProject,
    activeThreadId,
    activeThreadRef,
    activeThreadWorktreePath,
    allocatableActiveTerminalIds,
    environmentId,
    terminalOpenCwd,
    openTerminal,
    setTerminalOpen,
    storeEnsureTerminal,
    terminalUiState.terminalIds.length,
    terminalUiState.terminalOpen,
  ]);
  const splitTerminal = useCallback(
    (direction: "horizontal" | "vertical" = "horizontal") => {
      if (!activeThreadRef || hasReachedSplitLimit || !activeThreadId || !activeProject) {
        return;
      }
      const cwdForOpen = terminalOpenCwd ?? activeProject.workspaceRoot;
      if (!cwdForOpen) {
        return;
      }
      const terminalId = nextTerminalId(allocatableActiveTerminalIds);
      if (direction === "vertical") {
        storeSplitTerminalVertical(activeThreadRef, terminalId);
      } else {
        storeSplitTerminal(activeThreadRef, terminalId);
      }
      setTerminalFocusRequestId((value) => value + 1);
      void openTerminal({
        environmentId,
        input: {
          threadId: activeThreadId,
          terminalId,
          cwd: cwdForOpen,
          ...(activeThreadWorktreePath != null ? { worktreePath: activeThreadWorktreePath } : {}),
          env: projectScriptRuntimeEnv({
            project: { cwd: activeProject.workspaceRoot },
            worktreePath: activeThreadWorktreePath,
          }),
        },
      });
    },
    [
      activeProject,
      activeThreadId,
      allocatableActiveTerminalIds,
      activeThreadRef,
      openTerminal,
      activeThreadWorktreePath,
      environmentId,
      terminalOpenCwd,
      hasReachedSplitLimit,
      storeSplitTerminal,
      storeSplitTerminalVertical,
    ],
  );
  const createNewTerminal = useCallback(() => {
    if (!activeThreadRef || !activeThreadId || !activeProject) {
      return;
    }
    const cwdForOpen = terminalOpenCwd ?? activeProject.workspaceRoot;
    if (!cwdForOpen) {
      return;
    }
    const terminalId = nextTerminalId(allocatableActiveTerminalIds);
    storeNewTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
    void openTerminal({
      environmentId,
      input: {
        threadId: activeThreadId,
        terminalId,
        cwd: cwdForOpen,
        ...(activeThreadWorktreePath != null ? { worktreePath: activeThreadWorktreePath } : {}),
        env: projectScriptRuntimeEnv({
          project: { cwd: activeProject.workspaceRoot },
          worktreePath: activeThreadWorktreePath,
        }),
      },
    });
  }, [
    activeProject,
    activeThreadId,
    allocatableActiveTerminalIds,
    activeThreadRef,
    openTerminal,
    activeThreadWorktreePath,
    environmentId,
    terminalOpenCwd,
    storeNewTerminal,
  ]);
  const closeTerminal = useCallback(
    (terminalId: string) => {
      if (!activeThreadId || !activeThreadRef) return;
      const fallbackExitWrite = () =>
        writeTerminal({
          environmentId,
          input: { threadId: activeThreadId, terminalId, data: "exit\n" },
        });
      void (async () => {
        const closeResult = await closeTerminalMutation({
          environmentId,
          input: {
            threadId: activeThreadId,
            terminalId,
            deleteHistory: true,
          },
        });
        if (closeResult._tag === "Failure" && !isAtomCommandInterrupted(closeResult)) {
          await fallbackExitWrite();
        }
      })();
      storeCloseTerminal(activeThreadRef, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [
      activeThreadId,
      activeThreadRef,
      closeTerminalMutation,
      environmentId,
      storeCloseTerminal,
      writeTerminal,
    ],
  );
  const runProjectScript = useCallback(
    async (
      script: ProjectScript,
      options?: {
        cwd?: string;
        env?: Record<string, string>;
        worktreePath?: string | null;
        preferNewTerminal?: boolean;
        rememberAsLastInvoked?: boolean;
      },
    ) => {
      if (!activeThreadId || !activeProject || !activeThread) return;
      if (options?.rememberAsLastInvoked !== false) {
        setLastInvokedScriptByProjectId((current) => {
          if (current[activeProject.id] === script.id) return current;
          return { ...current, [activeProject.id]: script.id };
        });
      }
      const targetCwd = options?.cwd ?? gitCwd ?? activeProject.workspaceRoot;
      const baseTerminalId =
        terminalUiState.activeTerminalId || activeKnownTerminalIds[0] || DEFAULT_THREAD_TERMINAL_ID;
      const isBaseTerminalBusy = runningTerminalIds.includes(baseTerminalId);
      const wantsNewTerminal = Boolean(options?.preferNewTerminal) || isBaseTerminalBusy;
      const shouldCreateNewTerminal = wantsNewTerminal;
      const targetWorktreePath = options?.worktreePath ?? activeThread.worktreePath ?? null;

      setTerminalUiLaunchContext({
        threadId: activeThreadId,
        cwd: targetCwd,
        worktreePath: targetWorktreePath,
      });
      setTerminalOpen(true);
      if (!activeThreadRef) {
        return;
      }
      setTerminalFocusRequestId((value) => value + 1);

      const runtimeEnv = projectScriptRuntimeEnv({
        project: {
          cwd: activeProject.workspaceRoot,
        },
        worktreePath: targetWorktreePath,
        ...(options?.env ? { extraEnv: options.env } : {}),
      });
      const targetTerminalId = shouldCreateNewTerminal
        ? nextTerminalId(allocatableActiveTerminalIds)
        : baseTerminalId;
      const openTerminalInput: TerminalOpenInput = shouldCreateNewTerminal
        ? {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            ...(targetWorktreePath !== null ? { worktreePath: targetWorktreePath } : {}),
            env: runtimeEnv,
            cols: SCRIPT_TERMINAL_COLS,
            rows: SCRIPT_TERMINAL_ROWS,
          }
        : {
            threadId: activeThreadId,
            terminalId: targetTerminalId,
            cwd: targetCwd,
            ...(targetWorktreePath !== null ? { worktreePath: targetWorktreePath } : {}),
            env: runtimeEnv,
          };

      if (shouldCreateNewTerminal) {
        storeNewTerminal(activeThreadRef, targetTerminalId);
      } else {
        storeSetActiveTerminal(activeThreadRef, targetTerminalId);
      }

      const openResult = await openTerminal({ environmentId, input: openTerminalInput });
      if (openResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(openResult)) {
          const error = squashAtomCommandFailure(openResult);
          setThreadError(
            activeThreadId,
            error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
          );
        }
        return;
      }

      const writeResult = await writeTerminal({
        environmentId,
        input: {
          threadId: activeThreadId,
          terminalId: targetTerminalId,
          data: `${script.command}\r`,
        },
      });
      if (writeResult._tag === "Failure" && !isAtomCommandInterrupted(writeResult)) {
        const error = squashAtomCommandFailure(writeResult);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : `Failed to run script "${script.name}".`,
        );
      }
    },
    [
      activeProject,
      activeThread,
      activeThreadId,
      activeThreadRef,
      gitCwd,
      setTerminalOpen,
      setThreadError,
      storeNewTerminal,
      storeSetActiveTerminal,
      setLastInvokedScriptByProjectId,
      environmentId,
      openTerminal,
      activeKnownTerminalIds,
      allocatableActiveTerminalIds,
      runningTerminalIds,
      terminalUiState.activeTerminalId,
      writeTerminal,
    ],
  );

  const runProjectScriptRef = useRef(runProjectScript);
  useLayoutEffect(() => {
    runProjectScriptRef.current = runProjectScript;
  }, [runProjectScript]);
  const runShellCommand = useCallback((command: string) => {
    void runProjectScriptRef.current(
      {
        id: "chat-code-block",
        name: "Chat code block",
        command,
        icon: "play",
        runOnWorktreeCreate: false,
      },
      { rememberAsLastInvoked: false },
    );
  }, []);

  const persistProjectScripts = useCallback(
    async (input: {
      projectId: ProjectId;
      projectCwd: string;
      previousScripts: ReadonlyArray<ProjectScript>;
      nextScripts: ReadonlyArray<ProjectScript>;
      keybinding?: string | null;
      keybindingCommand: KeybindingCommand | null;
    }): Promise<AtomCommandResult<void, unknown>> => {
      const updateResult = mapAtomCommandResult(
        await updateProjectScriptSettings({
          environmentId,
          input: {
            patch: {
              projectScriptOverrides: {
                [input.projectId]: input.nextScripts,
              },
            },
          },
        }),
        () => undefined,
      );
      if (updateResult._tag === "Failure") {
        return updateResult;
      }

      const keybindingRule = decodeProjectScriptKeybindingRule({
        keybinding: input.keybinding,
        command: input.keybindingCommand,
      });

      if (!isElectron) return updateResult;
      const scriptId =
        input.keybindingCommand === null
          ? null
          : projectScriptIdFromCommand(input.keybindingCommand);
      const writes = projectScriptKeybindingWrites({
        rule: keybindingRule,
        command: input.keybindingCommand,
        bound: environmentById.get(environmentId)?.serverConfig?.keybindings ?? [],
        retainedElsewhere:
          scriptId !== null &&
          allProjects.some(
            (other) =>
              other.environmentId === environmentId &&
              other.id !== input.projectId &&
              resolveProjectScripts(settings, other).some((script) => script.id === scriptId),
          ),
      });
      for (const rule of writes.remove) {
        const removed = await removeKeybinding({ environmentId, input: rule });
        if (removed._tag === "Failure") return mapAtomCommandResult(removed, () => undefined);
      }
      return writes.upsert === null
        ? updateResult
        : mapAtomCommandResult(
            await upsertKeybinding({ environmentId, input: writes.upsert }),
            () => undefined,
          );
    },
    [
      allProjects,
      environmentById,
      environmentId,
      removeKeybinding,
      settings,
      updateProjectScriptSettings,
      upsertKeybinding,
    ],
  );
  const saveProjectScript = useCallback(
    async (input: NewProjectScriptInput): Promise<AtomCommandResult<void, unknown>> => {
      if (!activeProject) {
        return AsyncResult.success(undefined);
      }
      const nextId = nextProjectScriptId(
        input.name,
        activeProjectScripts.map((script) => script.id),
      );
      const nextScript = buildProjectScript(nextId, input);
      const nextScripts = input.runOnWorktreeCreate
        ? [
            ...activeProjectScripts.map((script) =>
              script.runOnWorktreeCreate ? { ...script, runOnWorktreeCreate: false } : script,
            ),
            nextScript,
          ]
        : [...activeProjectScripts, nextScript];

      return persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.workspaceRoot,
        previousScripts: activeProjectScripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(nextId),
      });
    },
    [activeProject, activeProjectScripts, persistProjectScripts],
  );
  const updateProjectScript = useCallback(
    async (
      scriptId: string,
      input: NewProjectScriptInput,
    ): Promise<AtomCommandResult<void, unknown>> => {
      if (!activeProject) {
        return AsyncResult.success(undefined);
      }
      const existingScript = activeProjectScripts.find((script) => script.id === scriptId);
      if (!existingScript) {
        return AsyncResult.failure(Cause.fail(new Error("Script not found.")));
      }

      const updatedScript = buildProjectScript(existingScript.id, input);
      const nextScripts = activeProjectScripts.map((script) =>
        script.id === scriptId
          ? updatedScript
          : input.runOnWorktreeCreate
            ? { ...script, runOnWorktreeCreate: false }
            : script,
      );

      return persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.workspaceRoot,
        previousScripts: activeProjectScripts,
        nextScripts,
        keybinding: input.keybinding,
        keybindingCommand: commandForProjectScript(scriptId),
      });
    },
    [activeProject, activeProjectScripts, persistProjectScripts],
  );
  const deleteProjectScript = useCallback(
    async (scriptId: string): Promise<AtomCommandResult<void, unknown>> => {
      if (!activeProject) {
        return AsyncResult.success(undefined);
      }
      const nextScripts = activeProjectScripts.filter((script) => script.id !== scriptId);

      const deletedName = activeProjectScripts.find((s) => s.id === scriptId)?.name;

      const result = await persistProjectScripts({
        projectId: activeProject.id,
        projectCwd: activeProject.workspaceRoot,
        previousScripts: activeProjectScripts,
        nextScripts,
        keybinding: null,
        keybindingCommand: commandForProjectScript(scriptId),
      });
      if (result._tag === "Success") {
        toastManager.add({
          type: "success",
          title: `Deleted action "${deletedName ?? "Unknown"}"`,
        });
      } else if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not delete action",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      }
      return result;
    },
    [activeProject, activeProjectScripts, persistProjectScripts],
  );

  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return;
      setComposerDraftRuntimeMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { runtimeMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      isLocalDraftThread,
      runtimeMode,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftRuntimeMode,
      setDraftThreadContext,
    ],
  );

  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === "plan" && !interactionModeEnabled) return;
      if (mode === interactionMode) return;
      setComposerDraftInteractionMode(composerDraftTarget, mode);
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, { interactionMode: mode });
      }
      scheduleComposerFocus();
    },
    [
      interactionMode,
      interactionModeEnabled,
      isLocalDraftThread,
      scheduleComposerFocus,
      composerDraftTarget,
      setComposerDraftInteractionMode,
      setDraftThreadContext,
    ],
  );
  const toggleInteractionMode = useCallback(() => {
    if (!interactionModeEnabled) return;
    handleInteractionModeChange(interactionMode === "plan" ? "default" : "plan");
  }, [handleInteractionModeChange, interactionMode, interactionModeEnabled]);
  const openProviderSetup = useCallback(
    (instanceId: ProviderInstanceId) => {
      void navigate({
        to: "/settings/providers",
        search: { environmentId, instanceId },
      });
    },
    [environmentId, navigate],
  );
  // The launcher's availability decides who may open Diff.
  const addDiffSurface = useCallback(() => {
    if (!activeThreadRef || !isServerThread) return;
    useDiffPanelStore.getState().clearSelection(activeThreadRef);
    useRightPanelStore.getState().open(activeThreadRef, "diff");
    onDiffPanelOpen?.();
  }, [activeThreadRef, isServerThread, onDiffPanelOpen]);
  const addFilesSurface = useCallback(() => {
    if (!activeThreadRef || !activeProject) return;
    useRightPanelStore.getState().open(activeThreadRef, "files");
  }, [activeProject, activeThreadRef]);
  const addAgentsSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "agents");
  }, [activeThreadRef]);
  const addZeropsSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "zerops");
  }, [activeThreadRef]);

  const addDataSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "data");
  }, [activeThreadRef]);
  const addGitSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "git");
  }, [activeThreadRef]);
  const addCrewSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "crew");
  }, [activeThreadRef]);
  const addMcpSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "mcp");
  }, [activeThreadRef]);
  const addVaultSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "vault");
  }, [activeThreadRef]);
  const addOverviewSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "overview");
  }, [activeThreadRef]);
  const openDataSurface = useCallback(
    (service: string) => {
      if (!activeThreadRef) return;
      useRightPanelStore.getState().openData(activeThreadRef, service);
    },
    [activeThreadRef],
  );
  const mateAddresses = useMateAddresses(activeThreadEnvironmentId, activeThreadId);
  // Browser opens its own view and nothing else: each public address opens
  // as its own tab only when a person picks it (the header's links, the view's list).
  const addBrowserSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "browser");
  }, [activeThreadRef]);
  const addMacSurface = useCallback(() => {
    if (!activeThreadRef) return;
    useRightPanelStore.getState().open(activeThreadRef, "mac");
  }, [activeThreadRef]);
  const chromeMate =
    activeThreadEnvironmentId === null
      ? undefined
      : zeropsMateAt(zeropsMates, activeThreadEnvironmentId);
  const zeropsChrome = resolveZeropsChatChrome(activeThreadRef, {
    topology: zeropsTopology,
    agentAuth: zeropsAgentAuth,
    providers: providerStatuses,
    appName: chromeMate?.kind === "mate" ? chromeMate.mate.project : undefined,
  });
  // The Mate's crew: the board's tab exists only while its status says a crew
  // is, or could be, set up; its view gives the strip its crew group and a
  // crew thread its crewmate.
  const crew = useCrew(activeThreadEnvironmentId);
  // What this viewer may change on the crew: the answer the server's door reaches (D6).
  const crewDoor = useCrewAccess(activeThreadEnvironmentId, crew.snapshot);
  const openAgentAuthDialog = useCallback(() => {
    const item = admission.attention;
    if (item?.action === "manage-api-key" || item?.action === "settings") {
      openProviderSetup(item.instanceId as ProviderInstanceId);
    } else if (item?.agentId !== undefined) {
      if (item.action === "check-again" || item.action === "register-again") {
        if (activeThreadRef !== null)
          void checkAgentAuth({
            environmentId: activeThreadRef.environmentId,
            input: {
              agentId: item.agentId,
              ...(item.loginKey === item.agentId ? {} : { loginId: item.loginKey }),
            },
          });
      } else
        zeropsSignInDialog.openFor(
          item.agentId,
          item.loginKey === item.agentId ? undefined : item.loginKey,
        );
    } else if (activeProviderStatus !== null) openProviderSetup(activeProviderStatus.instanceId);
  }, [
    admission.attention,
    activeProviderStatus,
    activeThreadRef,
    checkAgentAuth,
    openProviderSetup,
    zeropsSignInDialog,
  ]);
  const zeropsFooter = admission.footer;
  const admissionPlacement = useAgentAdmissionPlacement(admission.attention);
  const zeropsHeldDraft = useComposerDraftStore((store) =>
    zeropsFooter === "held" ? (store.getComposerDraft(composerDraftTarget)?.prompt ?? "") : "",
  );
  // A started conversation keeps its login; its admission item explains why Send waits.
  const zeropsSendBlockReason = admission.sendBlockReason;
  const zeropsArrivalHoldsComposer = admission.holdsComposer || mateSignIn;
  const activeProjectDisplayName = zeropsChrome.projectName ?? activeProject?.title;
  const chromeLogicalProjectEnvironments = useMemo(
    () =>
      logicalProjectEnvironments.map((environment) =>
        zeropsChrome.projectName !== null &&
        environment.environmentId === activeThread?.environmentId
          ? { ...environment, label: zeropsChrome.projectName }
          : environment,
      ),
    [activeThread?.environmentId, logicalProjectEnvironments, zeropsChrome.projectName],
  );
  const composerPlaceholders = resolveComposerPlaceholders({
    whoLivesHere: whoLivesHereKind,
    zeropsAvailable: zeropsChrome.panel === "available",
    chief: chiefConversation,
    ...(activeThreadTask === null
      ? {}
      : { task: { mate: admissionMate.kind === "mate" ? admissionMate.mate.name : null } }),
  });
  const openFileSurface = useCallback(
    (relativePath: string) => {
      if (!activeThreadRef || !activeProject) return;
      useRightPanelStore.getState().openFile(activeThreadRef, relativePath);
    },
    [activeProject, activeThreadRef],
  );
  const closePreviewPanel = useCallback(() => {
    if (activeThreadRef) {
      setMaximizedRightPanelThreadKey(null);
      useRightPanelStore.getState().close(activeThreadRef);
    }
  }, [activeThreadRef]);
  const addTerminalSurface = useCallback(() => {
    if (!activeThreadRef || !activeThreadId || !activeProject) return;
    const cwd = gitCwd ?? activeProject.workspaceRoot;
    const terminalId = nextTerminalId(allocatableActiveTerminalIds);
    useRightPanelStore.getState().openTerminal(activeThreadRef, terminalId);
    setTerminalFocusRequestId((value) => value + 1);
    void openTerminal({
      environmentId: activeThreadRef.environmentId,
      input: {
        threadId: activeThreadId,
        terminalId,
        cwd,
        ...(activeThreadWorktreePath != null ? { worktreePath: activeThreadWorktreePath } : {}),
        env: projectScriptRuntimeEnv({
          project: { cwd: activeProject.workspaceRoot },
          worktreePath: activeThreadWorktreePath,
        }),
      },
    });
  }, [
    activeProject,
    activeThreadId,
    activeThreadRef,
    activeThreadWorktreePath,
    allocatableActiveTerminalIds,
    gitCwd,
    openTerminal,
  ]);
  const splitPanelTerminal = useCallback(
    (direction: "horizontal" | "vertical" = "horizontal") => {
      if (
        !activeThreadRef ||
        !activeThreadId ||
        !activeProject ||
        activeRightPanelSurface?.kind !== "terminal" ||
        activeRightPanelSurface.terminalIds.length >= MAX_TERMINALS_PER_GROUP
      ) {
        return;
      }
      const terminalId = nextTerminalId(allocatableActiveTerminalIds);
      const cwd = gitCwd ?? activeProject.workspaceRoot;
      useRightPanelStore
        .getState()
        .splitTerminal(activeThreadRef, activeRightPanelSurface.id, terminalId, direction);
      setTerminalFocusRequestId((value) => value + 1);
      void openTerminal({
        environmentId: activeThreadRef.environmentId,
        input: {
          threadId: activeThreadId,
          terminalId,
          cwd,
          ...(activeThreadWorktreePath != null ? { worktreePath: activeThreadWorktreePath } : {}),
          env: projectScriptRuntimeEnv({
            project: { cwd: activeProject.workspaceRoot },
            worktreePath: activeThreadWorktreePath,
          }),
        },
      });
    },
    [
      activeProject,
      activeRightPanelSurface,
      activeThreadId,
      activeThreadRef,
      activeThreadWorktreePath,
      allocatableActiveTerminalIds,
      gitCwd,
      openTerminal,
    ],
  );
  const splitPanelTerminalVertical = useCallback(() => {
    splitPanelTerminal("vertical");
  }, [splitPanelTerminal]);
  const activatePanelTerminal = useCallback(
    (terminalId: string) => {
      if (!activeThreadRef || activeRightPanelSurface?.kind !== "terminal") return;
      useRightPanelStore
        .getState()
        .activateTerminal(activeThreadRef, activeRightPanelSurface.id, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [activeRightPanelSurface, activeThreadRef],
  );
  const closePanelTerminal = useCallback(
    (terminalId: string) => {
      if (!activeThreadRef || activeRightPanelSurface?.kind !== "terminal") return;
      void closeTerminalMutation({
        environmentId: activeThreadRef.environmentId,
        input: { threadId: activeThreadRef.threadId, terminalId, deleteHistory: true },
      });
      storeCloseTerminal(activeThreadRef, terminalId);
      useRightPanelStore
        .getState()
        .closeTerminal(activeThreadRef, activeRightPanelSurface.id, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    },
    [activeRightPanelSurface, activeThreadRef, closeTerminalMutation, storeCloseTerminal],
  );
  const requestCloseTerminal = useCallback(
    (terminalId: string) => {
      const label = activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId);
      void confirmTerminalClose([label]).then((confirmed) => {
        if (confirmed) closeTerminal(terminalId);
      });
    },
    [activeTerminalLabelsById, closeTerminal],
  );
  const requestClosePanelTerminal = useCallback(
    (terminalId: string) => {
      const label = activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId);
      void confirmTerminalClose([label]).then((confirmed) => {
        if (confirmed) closePanelTerminal(terminalId);
      });
    },
    [activeTerminalLabelsById, closePanelTerminal],
  );
  const activateRightPanelSurface = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      useRightPanelStore.getState().activateSurface(activeThreadRef, surface.id);
      if (surface.kind === "terminal") {
        setTerminalFocusRequestId((value) => value + 1);
      }
      if (surface.kind === "diff" && !diffOpen) {
        onDiffPanelOpen?.();
      }
    },
    [activeThreadRef, diffOpen, onDiffPanelOpen],
  );
  const toggleRightPanel = useCallback(() => {
    if (!activeThreadRef) return;
    if (rightPanelOpen) {
      closePreviewPanel();
      return;
    }
    useRightPanelStore.getState().toggleVisibility(activeThreadRef);
  }, [activeThreadRef, closePreviewPanel, rightPanelOpen]);
  const toggleRightPanelMaximized = useCallback(() => {
    if (!canMaximizeRightPanel) return;
    setMaximizedRightPanelThreadKey((threadKey) =>
      threadKey === routeThreadKey ? null : routeThreadKey,
    );
  }, [canMaximizeRightPanel, routeThreadKey]);
  const cleanupRightPanelSurfaces = useCallback(
    (surfaces: readonly RightPanelSurface[]) => {
      if (!activeThreadRef) return;
      for (const surface of surfaces) {
        if (surface.kind === "terminal") {
          for (const terminalId of surface.terminalIds) {
            storeCloseTerminal(activeThreadRef, terminalId);
            void closeTerminalMutation({
              environmentId: activeThreadRef.environmentId,
              input: { threadId: activeThreadRef.threadId, terminalId, deleteHistory: true },
            });
          }
        }
      }
    },
    [activeThreadRef, closeTerminalMutation, storeCloseTerminal],
  );
  const closeRightPanelSurface = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const finishClose = () => {
        cleanupRightPanelSurfaces([surface]);
        useRightPanelStore.getState().closeSurface(activeThreadRef, surface.id);
      };
      if (surface.kind !== "terminal") {
        finishClose();
        return;
      }
      const activeLabel =
        activeTerminalLabelsById.get(surface.activeTerminalId) ??
        getTerminalLabel(surface.activeTerminalId);
      const otherLabels = surface.terminalIds
        .filter((terminalId) => terminalId !== surface.activeTerminalId)
        .map(
          (terminalId) => activeTerminalLabelsById.get(terminalId) ?? getTerminalLabel(terminalId),
        );
      void confirmTerminalClose([activeLabel, ...otherLabels]).then((confirmed) => {
        if (confirmed) finishClose();
      });
    },
    [activeThreadRef, activeTerminalLabelsById, cleanupRightPanelSurfaces],
  );
  const closeOtherRightPanelSurfaces = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const surfaces = rightPanelState.surfaces.filter((entry) => entry.id !== surface.id);
      cleanupRightPanelSurfaces(surfaces);
      useRightPanelStore.getState().closeOtherSurfaces(activeThreadRef, surface.id);
    },
    [activeThreadRef, cleanupRightPanelSurfaces, rightPanelState.surfaces],
  );
  const closeRightPanelSurfacesToRight = useCallback(
    (surface: RightPanelSurface) => {
      if (!activeThreadRef) return;
      const surfaceIndex = rightPanelState.surfaces.findIndex((entry) => entry.id === surface.id);
      if (surfaceIndex < 0) return;
      const surfaces = rightPanelState.surfaces.slice(surfaceIndex + 1);
      cleanupRightPanelSurfaces(surfaces);
      useRightPanelStore.getState().closeSurfacesToRight(activeThreadRef, surface.id);
    },
    [activeThreadRef, cleanupRightPanelSurfaces, rightPanelState.surfaces],
  );
  const closeAllRightPanelSurfaces = useCallback(() => {
    if (!activeThreadRef) return;
    cleanupRightPanelSurfaces(rightPanelState.surfaces);
    useRightPanelStore.getState().closeAllSurfaces(activeThreadRef);
  }, [activeThreadRef, cleanupRightPanelSurfaces, rightPanelState.surfaces]);
  const copyRightPanelFilePath = useCallback((relativePath: string) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: "Clipboard API unavailable.",
        }),
      );
      return;
    }

    void navigator.clipboard.writeText(relativePath).then(
      () => {
        toastManager.add({
          type: "success",
          title: "Path copied",
          description: relativePath,
        });
      },
      (error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to copy path",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      },
    );
  }, []);
  const persistThreadSettingsForNextTurn = useCallback(
    async (input: {
      threadId: ThreadId;
      createdAt: string;
      modelSelection?: ModelSelection;
      branch?: string;
      runtimeMode: RuntimeMode;
      interactionMode: ProviderInteractionMode;
    }): Promise<AtomCommandResult<void, unknown>> => {
      if (!serverThread) {
        return AsyncResult.success(undefined);
      }

      let result: AtomCommandResult<void, unknown> = AsyncResult.success(undefined);
      const metadataUpdate = resolveThreadMetadataUpdateForNextTurn({
        currentModelSelection: serverThread.modelSelection,
        ...(input.modelSelection ? { nextModelSelection: input.modelSelection } : {}),
        currentBranch: serverThread.branch,
        ...(input.branch ? { nextBranch: input.branch } : {}),
      });
      if (metadataUpdate) {
        result = mapAtomCommandResult(
          await updateThreadMetadata({
            environmentId,
            input: {
              threadId: input.threadId,
              ...metadataUpdate,
            },
          }),
          () => undefined,
        );
        if (result._tag === "Failure") {
          return result;
        }
      }

      if (input.runtimeMode !== serverThread.runtimeMode) {
        result = mapAtomCommandResult(
          await setThreadRuntimeMode({
            environmentId,
            input: {
              threadId: input.threadId,
              runtimeMode: input.runtimeMode,
              createdAt: input.createdAt,
            },
          }),
          () => undefined,
        );
        if (result._tag === "Failure") {
          return result;
        }
      }

      if (input.interactionMode !== serverThread.interactionMode) {
        result = mapAtomCommandResult(
          await setThreadInteractionMode({
            environmentId,
            input: {
              threadId: input.threadId,
              interactionMode: input.interactionMode,
              createdAt: input.createdAt,
            },
          }),
          () => undefined,
        );
      }
      return result;
    },
    [
      environmentId,
      serverThread,
      setThreadInteractionMode,
      setThreadRuntimeMode,
      updateThreadMetadata,
    ],
  );

  // Debounce *showing* the scroll-to-bottom pill so it doesn't flash during
  // thread switches. LegendList fires scroll events with isAtEnd=false while
  // initialScrollAtEnd is settling; hiding is always immediate.
  const showScrollDebouncer = useRef(
    new Debouncer(() => setShowScrollToBottom(true), { wait: 150 }),
  );
  const timelineScrollModeRef = useRef<TimelineScrollMode>(
    timelineAnchorMessageId === null ? "following-end" : "anchoring-new-turn",
  );
  // State mirror of the follow mode refs. LegendList's maintainScrollAtEnd
  // re-pins on its own (independent of the refs), so the timeline needs a
  // render-visible flag to switch it off once the user scrolls away.
  const [timelineLiveFollowEnabled, setTimelineLiveFollowEnabled] = useState(true);
  const pendingTimelineAnchorRef = useRef<MessageId | null>(null);
  const positionedTimelineAnchorRef = useRef<MessageId | null>(null);
  const settledTimelineAnchorRef = useRef<MessageId | null>(null);
  const activeTimelineAnchorIndexRef = useRef<number | null>(null);
  const anchorUserScrollGenerationRef = useRef(0);
  const cancelPositionRestoreRef = useRef<(() => void) | null>(null);
  const liveFollowUserScrollGenerationRef = useRef<number | null>(0);
  // Manual navigation stops live-follow without removing anchored end space.
  // Collapsing that space during a gesture clamps the viewport back to the end.
  const cancelTimelineLiveFollowForUserNavigation = useCallback(() => {
    cancelPositionRestoreRef.current?.();
    anchorUserScrollGenerationRef.current += 1;
    timelineScrollModeRef.current = "free-scrolling";
    liveFollowUserScrollGenerationRef.current = null;
    setTimelineLiveFollowEnabled(false);
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
  }, []);
  const cancelTimelineLiveFollowForUserNavigationRef = useRef(
    cancelTimelineLiveFollowForUserNavigation,
  );
  useEffect(() => {
    cancelTimelineLiveFollowForUserNavigationRef.current =
      cancelTimelineLiveFollowForUserNavigation;
  }, [cancelTimelineLiveFollowForUserNavigation]);
  const getActiveTimelineTurnMetrics = useCallback(
    (list?: LegendListRef | null) => {
      const resolvedList = list ?? legendListRef.current;
      const anchorIndex = activeTimelineAnchorIndexRef.current;
      const state = resolvedList?.getState();
      if (!resolvedList || !state || anchorIndex === null) {
        return null;
      }

      return getAnchoredTurnMetrics({
        state,
        anchorIndex,
        composerOverlayHeight,
        anchorOffset: CHAT_LIST_ANCHOR_OFFSET,
      });
    },
    [composerOverlayHeight],
  );
  const timelineRealContentOverflowsViewport = useCallback(
    (list?: LegendListRef | null) => {
      const resolvedList = list ?? legendListRef.current;
      const state = resolvedList?.getState();
      if (!resolvedList || !state || state.data.length === 0) {
        return false;
      }

      const lastRowIndex = state.data.length - 1;
      const lastRowTop = state.positionAtIndex(lastRowIndex);
      const lastRowHeight = state.sizeAtIndex(lastRowIndex);
      if (
        typeof lastRowTop !== "number" ||
        typeof lastRowHeight !== "number" ||
        !Number.isFinite(lastRowTop) ||
        !Number.isFinite(lastRowHeight)
      ) {
        return false;
      }

      const realContentBottom = lastRowTop + Math.max(1, lastRowHeight);
      const visibleScrollLength = Math.max(
        0,
        (state.scrollLength ?? 0) - composerOverlayHeight - CHAT_LIST_ANCHOR_OFFSET,
      );
      return realContentBottom > visibleScrollLength;
    },
    [composerOverlayHeight],
  );
  // Live-follow stays active after send/thread-open until an actual list scroll
  // gesture opts out.
  /**
   * `sent`: the person's own message — already at the end, the view follows what it brings by the
   * list's glide (`createEndFollow`), never a cut: a queued steer moved the conversation 105 px in
   * one frame (Milo's third stress run).
   */
  const scrollToEnd = useCallback((animated = false, sent = false) => {
    cancelPositionRestoreRef.current?.();
    const following =
      sent && isAtEndRef.current && timelineScrollModeRef.current === "following-end";
    isAtEndRef.current = true;
    timelineScrollModeRef.current = "following-end";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(true);
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
    setTimelineAnchor(releaseChatTimelineAnchor);
    if (following) return;
    requestAnimationFrame(() => {
      // Under reduced motion the way there is a cut.
      void legendListRef.current?.scrollToEnd?.({ animated: animated && !prefersReducedMotion() });
    });
  }, []);
  useLayoutEffect(() => {
    if (timelineScrollModeRef.current !== "anchoring-new-turn") {
      return;
    }

    if (
      shouldReleaseTimelineAnchorForToolActivity({
        anchorMessageId: timelineAnchorMessageId,
        liveFollowEnabled: timelineLiveFollowEnabled,
        runningTurnId: activeRunningTurnId,
        timelineEntries,
      })
    ) {
      scrollToEnd();
    }
  }, [
    activeRunningTurnId,
    scrollToEnd,
    timelineAnchorMessageId,
    timelineEntries,
    timelineLiveFollowEnabled,
  ]);
  // Off at once, not on the next render: LegendList pins the end on every
  // row that lands or grows while follow is on, and a stream lands rows every
  // few frames — a deferred off lost the person's scroll to the next one, and
  // the list jumped back to the end under them.
  const leaveTimelineFollow = useCallback(() => {
    if (
      nextTimelineFollow(
        liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current,
        { type: "left-end" },
      )
    )
      return;
    if (liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current) {
      flushSync(() => cancelTimelineLiveFollowForUserNavigationRef.current());
    } else {
      cancelTimelineLiveFollowForUserNavigationRef.current();
    }
  }, []);
  // The person came back to the end: follow again, where the list stands.
  const resumeTimelineFollow = useCallback(() => {
    isAtEndRef.current = true;
    timelineScrollModeRef.current = "following-end";
    liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
    setTimelineLiveFollowEnabled(true);
    // Reachable only once manual navigation has already broken follow, so
    // the anchored turn framing is over: the user scrolled back to the live
    // edge and expects the stream to stick to it again, exactly like the
    // scroll-to-bottom pill.
    setTimelineAnchor(releaseChatTimelineAnchor);
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
  }, []);
  // A person's input on the list leaves the end only when it can move the
  // viewport away from it. Follow gates LegendList's maintainScrollAtEnd, so a
  // spurious leave while pinned at the end strands follow off with nothing
  // to bring it back; content that underflows the viewport can't scroll at all.
  const onTimelinePersonInput = useCallback(
    (input: TimelinePersonInput) => {
      if (input.kind !== "content-pointer") setReadAlongRoom(releaseReadAlongRoom);
      const contentScrollsUp = () => timelineRealContentOverflowsViewport();
      // The re-arm band, not the strict flag: streaming growth makes isAtEnd
      // flicker false for a frame before the follow scroll catches up.
      const viewportIsAwayFromEnd = () =>
        resolveTimelineIsAtEnd(legendListRef.current?.getState()) === false;
      switch (input.kind) {
        // Up is a leave; down far above the end comes back only through the
        // scroll it makes.
        case "wheel":
        case "key": {
          if (input.direction === "up") {
            if (contentScrollsUp()) leaveTimelineFollow();
            return;
          }
          // Down in the end band is coming back, even where the stream's
          // growth covers the move or the list stands at its hard bottom.
          const following =
            liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current;
          if (
            !following &&
            nextTimelineFollow(following, {
              type: "toward-end-input",
              inEndBand: resolveTimelineIsAtEnd(legendListRef.current?.getState()) === true,
            })
          )
            resumeTimelineFollow();
          return;
        }
        case "scrollbar":
          if (contentScrollsUp()) leaveTimelineFollow();
          return;
        // A finger's direction is not observable here, nor is a click a
        // scroll: they leave only once the list stands away from the end
        // (reading or selecting up there holds the place); the glide after a
        // short flick is told by the scroll it makes.
        case "touch-move":
        case "content-pointer":
          if (viewportIsAwayFromEnd()) leaveTimelineFollow();
          return;
      }
    },
    [leaveTimelineFollow, resumeTimelineFollow, timelineRealContentOverflowsViewport],
  );

  const onTimelineAnchorReady = useCallback((messageId: MessageId, anchorIndex: number) => {
    // Anchored-end space can be remeasured when the turn completes. Once the
    // user has scrolled away (or returned to ordinary end-following), that
    // remeasurement must not restart the send-time anchor positioning.
    if (timelineScrollModeRef.current !== "anchoring-new-turn") {
      return;
    }
    if (pendingTimelineAnchorRef.current === messageId) {
      pendingTimelineAnchorRef.current = null;
    }
    activeTimelineAnchorIndexRef.current = anchorIndex;
    if (positionedTimelineAnchorRef.current === messageId) {
      return;
    }
    positionedTimelineAnchorRef.current = messageId;
    settledTimelineAnchorRef.current = null;
    const positionAnchor = (remainingAttempts: number) => {
      requestAnimationFrame(() => {
        if (positionedTimelineAnchorRef.current !== messageId) {
          return;
        }
        const list = legendListRef.current;
        if (!list) {
          if (remainingAttempts > 0) {
            positionAnchor(remainingAttempts - 1);
          }
          return;
        }
        void list
          .scrollToIndex({
            index: anchorIndex,
            animated: !prefersReducedMotion(),
            viewPosition: 0,
            viewOffset: CHAT_LIST_ANCHOR_OFFSET,
          })
          .then(() => {
            if (positionedTimelineAnchorRef.current !== messageId) {
              return;
            }
            settledTimelineAnchorRef.current = messageId;
          });
      });
    };
    requestAnimationFrame(() => positionAnchor(12));
  }, []);

  const onIsAtEndChange = useCallback(
    (
      isAtEnd: boolean,
      scroll: {
        readonly byPerson: boolean;
        readonly direction: TimelineScrollDirection | null;
        readonly jumped?: boolean;
      },
    ) => {
      const following =
        liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current;
      const followsNext = nextTimelineFollow(following, {
        type: "position",
        atEnd: isAtEnd,
        ...scroll,
      });
      if (following && !followsNext) {
        // The person's scroll carried the list off the end with no input seen
        // first: a flick's glide, a scrollbar dragged from outside the list.
        leaveTimelineFollow();
        isAtEndRef.current = false;
        showScrollDebouncer.current.maybeExecute();
        return;
      }
      if (following) {
        showScrollDebouncer.current.cancel();
        setShowScrollToBottom(false);
        return;
      }
      const wasAtEnd = isAtEndRef.current;
      isAtEndRef.current = isAtEnd;
      if (followsNext) {
        resumeTimelineFollow();
        return;
      }
      // Still reading: the list landed at its end under the person (a card
      // below settled shorter) or moved off it as rows came; only the
      // jump-to-latest control follows what they are or are not at.
      if (wasAtEnd === isAtEnd) return;
      if (isAtEnd) {
        showScrollDebouncer.current.cancel();
        setShowScrollToBottom(false);
      } else {
        timelineScrollModeRef.current = "free-scrolling";
        liveFollowUserScrollGenerationRef.current = null;
        showScrollDebouncer.current.maybeExecute();
      }
    },
    [leaveTimelineFollow, resumeTimelineFollow],
  );

  // Anchored end space intentionally disables LegendList's normal end-follow so
  // the sent message can stay near the top. T3 only owns streaming adjustments
  // during that mode; LegendList owns ordinary end-follow everywhere else.
  useEffect(() => {
    if (!activeThread?.id) {
      return;
    }
    if (liveFollowUserScrollGenerationRef.current !== anchorUserScrollGenerationRef.current) {
      return;
    }
    if (timelineScrollModeRef.current !== "anchoring-new-turn") {
      return;
    }

    let secondFrame: number | null = null;
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (liveFollowUserScrollGenerationRef.current !== anchorUserScrollGenerationRef.current) {
          return;
        }
        if (pendingTimelineAnchorRef.current !== null) {
          return;
        }
        if (
          positionedTimelineAnchorRef.current !== null &&
          settledTimelineAnchorRef.current !== positionedTimelineAnchorRef.current
        ) {
          return;
        }
        const list = legendListRef.current;
        if (!list) {
          return;
        }

        const metrics = getActiveTimelineTurnMetrics(list);
        if (!metrics || metrics.scrollDeltaToRevealEnd <= 1) {
          return;
        }

        const nextOffset = list.getState().scroll + metrics.scrollDeltaToRevealEnd;
        void list.scrollToOffset({ offset: nextOffset, animated: false });
      });
    });

    return () => {
      cancelAnimationFrame(frame);
      if (secondFrame !== null) {
        cancelAnimationFrame(secondFrame);
      }
    };
  }, [activeThread?.id, timelineEntries, getActiveTimelineTurnMetrics]);

  useEffect(() => {
    setPullRequestDialogState(null);
    // A thread left mid-read reopens where the reader was; any other opens at its end.
    const followEnd = nextTimelineFollow(
      liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current,
      { type: "opened", atEnd: readTimelinePosition(routeThreadKey)?.atEnd !== false },
    );
    isAtEndRef.current = followEnd;
    timelineScrollModeRef.current = followEnd
      ? readDraftTimelineAnchor(routeThreadKey) !== null
        ? "anchoring-new-turn"
        : "following-end"
      : "free-scrolling";
    liveFollowUserScrollGenerationRef.current = followEnd
      ? anchorUserScrollGenerationRef.current
      : null;
    setTimelineLiveFollowEnabled(followEnd);
    pendingTimelineAnchorRef.current = null;
    positionedTimelineAnchorRef.current = null;
    settledTimelineAnchorRef.current = null;
    activeTimelineAnchorIndexRef.current = null;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(!followEnd);
    // activeThreadRef resets transitively with the active thread.
  }, [activeThread?.id, routeThreadKey]);

  useEffect(() => {
    if (activeThreadKey !== null) {
      rememberDraftTimelineAnchor(
        activeThreadKey,
        routeKind === "draft" ? timelineAnchorMessageId : null,
      );
    }
  }, [activeThreadKey, routeKind, timelineAnchorMessageId]);

  // The conversation whose open found no composer (its room held, or a strip): its focus waits.
  const openFocusOwedRef = useRef<string | null>(null);
  const composerShown = zeropsFooter === "composer";
  useEffect(() => {
    if (!activeThread?.id || terminalUiState.terminalOpen) return;
    if (!composerShown) {
      openFocusOwedRef.current = routeThreadKey;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const late = openFocusOwedRef.current === routeThreadKey;
      openFocusOwedRef.current = null;
      const active = document.activeElement;
      const focusElsewhere = active !== null && active !== document.body;
      if (!composerOpenFocus({ composerShown, late, focusElsewhere })) return;
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    activeThread?.id,
    composerShown,
    focusComposer,
    routeThreadKey,
    terminalUiState.terminalOpen,
  ]);

  // Tabbing back into the app lands focus wherever it last was, often the right panel or the
  // body. Put it in the composer unless something that takes typing already holds it. The
  // drawer terminal owns keyboard input while it is open, so it opts out here; a right panel
  // terminal is a surface and is recognized by the predicate instead. Mobile is left alone so
  // returning to the app does not raise the keyboard.
  useEffect(() => {
    if (!activeThread?.id || terminalUiState.terminalOpen || isMobileViewport) return;
    let frame: number | null = null;
    const onWindowFocus = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      // The element that held focus receives it again after the window's own event, and the
      // composer ignores that same frame so a restored focus does not lift a scroll-collapsed
      // composer. Wait one more frame so this focus counts as a request to expand it.
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          frame = null;
          if (shouldRefocusComposerOnWindowFocus(document.activeElement)) focusComposer();
        });
      });
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("focus", onWindowFocus);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [activeThread?.id, focusComposer, isMobileViewport, terminalUiState.terminalOpen]);

  useEffect(() => {
    if (!activeThread?.id) return;
    if (activeThread.messages.length === 0) {
      return;
    }
    const serverIds = new Set(activeThread.messages.map((message) => message.id));
    const removedMessages = optimisticUserMessages.filter((message) => serverIds.has(message.id));
    if (removedMessages.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setOptimisticUserMessages((existing) =>
        existing.filter((message) => !serverIds.has(message.id)),
      );
    }, 0);
    for (const removedMessage of removedMessages) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThread?.id, activeThread?.messages, handoffAttachmentPreviews, optimisticUserMessages]);

  useEffect(() => {
    setOptimisticUserMessages((existing) => {
      for (const message of existing) {
        revokeUserMessagePreviewUrls(message);
      }
      return [];
    });
    resetLocalDispatch();
    setExpandedImage(null);
  }, [draftId, resetLocalDispatch, threadId]);

  const closeExpandedImage = useCallback(() => {
    setExpandedImage(null);
  }, []);

  const activeWorktreePath = activeThread?.worktreePath ?? null;
  const derivedEnvMode: DraftThreadEnvMode = resolveEffectiveEnvMode({
    activeWorktreePath,
    hasServerThread: isServerThread,
    draftThreadEnvMode: isLocalDraftThread ? draftThread?.envMode : undefined,
    preparingWorktree: isPreparingWorktree,
  });
  const canOverrideServerThreadEnvMode = Boolean(
    isServerThread &&
    activeThread &&
    activeThread.messages.length === 0 &&
    activeThread.worktreePath === null &&
    !envLocked,
  );
  const envMode: DraftThreadEnvMode = canOverrideServerThreadEnvMode
    ? (pendingServerThreadEnvMode ?? draftThread?.envMode ?? derivedEnvMode)
    : derivedEnvMode;
  const activeThreadBranch =
    canOverrideServerThreadEnvMode && pendingServerThreadBranch !== undefined
      ? pendingServerThreadBranch
      : (activeThread?.branch ?? null);
  const startFromOrigin = isLocalDraftThread
    ? (draftThread?.startFromOrigin ?? false)
    : canOverrideServerThreadEnvMode
      ? (pendingServerThreadStartFromOriginByThreadId[activeThread?.id ?? ""] ??
        primaryServerSettings.newWorktreesStartFromOrigin)
      : false;
  const sendEnvMode = resolveSendEnvMode({
    requestedEnvMode: envMode,
    isGitRepo,
  });
  const localCheckoutBranchMismatch = useMemo(
    () =>
      isServerThread
        ? resolveLocalCheckoutBranchMismatch({
            effectiveEnvMode: envMode,
            activeWorktreePath,
            activeThreadBranch,
            currentGitBranch: gitStatusQuery.data?.refName ?? null,
          })
        : null,
    [activeThreadBranch, activeWorktreePath, envMode, gitStatusQuery.data?.refName, isServerThread],
  );
  const activeComposerTasksProgress =
    activeLatestTurn !== null && !latestTurnSettled
      ? (activeThreadShell?.planProgress ?? null)
      : null;
  const activeComposerTaskSteps =
    activeComposerTasksProgress && activePlan && activePlan.turnId === activeLatestTurn?.turnId
      ? activePlan.steps
      : null;
  const nowMinute = useNowMinute();
  const [isRestoringThreadBranch, setIsRestoringThreadBranch] = useState(false);
  const [branchRestoreConfirmOpen, setBranchRestoreConfirmOpen] = useState(false);
  const branchAdvice = useBranchAdvice({
    threadKey: activeThread ? routeThreadKey : null,
    mismatch: localCheckoutBranchMismatch,
    composerHasContent: composerHasUnsentContent,
  });
  const activeBranchMismatchKey = branchAdvice.key;
  const showBranchMismatchBanner = branchAdvice.visible;
  const handleSwitchCheckoutToThread = useCallback(async () => {
    if (
      !activeProjectCwd ||
      !activeThread ||
      !localCheckoutBranchMismatch ||
      isRestoringThreadBranch
    ) {
      return;
    }
    setIsRestoringThreadBranch(true);
    const checkoutResult = await switchGitRef({
      environmentId,
      input: {
        cwd: activeProjectCwd,
        refName: localCheckoutBranchMismatch.threadBranch,
      },
    });
    if (checkoutResult._tag === "Failure") {
      setIsRestoringThreadBranch(false);
      if (!isAtomCommandInterrupted(checkoutResult)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to switch checkout",
            description: chatActionErrorMessage(squashAtomCommandFailure(checkoutResult)),
          }),
        );
      }
      return;
    }

    const nextBranch = checkoutResult.value.refName ?? localCheckoutBranchMismatch.threadBranch;
    if (nextBranch !== activeThread.branch) {
      const updateResult = await updateThreadMetadata({
        environmentId,
        input: { threadId: activeThread.id, branch: nextBranch, worktreePath: null },
      });
      if (updateResult._tag === "Failure") {
        setIsRestoringThreadBranch(false);
        if (!isAtomCommandInterrupted(updateResult)) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Checkout switched, but the thread could not be updated",
              description: chatActionErrorMessage(squashAtomCommandFailure(updateResult)),
            }),
          );
        }
        gitStatusQuery.refresh();
        return;
      }
    }
    gitStatusQuery.refresh();
    setIsRestoringThreadBranch(false);
    scheduleComposerFocus();
  }, [
    activeProjectCwd,
    activeThread,
    environmentId,
    gitStatusQuery,
    isRestoringThreadBranch,
    localCheckoutBranchMismatch,
    scheduleComposerFocus,
    switchGitRef,
    updateThreadMetadata,
  ]);
  // Background work (subagent fleets, workflow runs, watch loops) can outlive
  // the turn; once it settles, the composer's Stop stops it, the only Stop.
  // It routes through the stop-everything interrupt: it kills every live
  // background task before interrupting, and works by session, so no active
  // turn is needed.
  const activeBackgroundLiveness =
    !isWorking && activeThread ? (activeThreadShell?.backgroundLiveness ?? null) : null;
  // What that work is, by name, where the engine's row names it: the card at the foot lists it.
  const activeBackgroundWork = activeThreadShell?.backgroundWork;
  // Which background jobs the server holds live: one it does not, unreported,
  // never will report — one judgement for the band and the run cards.
  const shellTaskIds = activeThreadShell?.backgroundTaskIds;
  const shellLiveness = activeThreadShell?.backgroundLiveness ?? null;
  const shellTaskKey = shellTaskIds === undefined ? null : shellTaskIds.join("\n");
  const engineConversation = engineCards !== null;
  const liveJobsNow = useMemo(
    () =>
      liveJobsOf({
        backgroundTaskIds:
          shellTaskKey === null ? undefined : shellTaskKey.split("\n").filter(Boolean),
        backgroundLiveness: shellLiveness,
        isWorking,
        engine: engineConversation,
      }),
    [shellTaskKey, shellLiveness, isWorking, engineConversation],
  );
  const liveJobs = useLiveJobs(liveJobsNow);
  // An engine conversation's cards say it from the change that ended the run; the row's word
  // comes a moment later (recheck on 0.15.41: the job's strip left at the turn's end, then came
  // back with the row's word 0.4 s later).
  const afterTurnLiveness =
    activeBackgroundLiveness ??
    (!isWorking && engineCards !== null && engineWorkRunsOn(engineCards) ? "working" : null);
  const backgroundRunsOn = afterTurnLiveness !== null;
  interruptContextRef.current.afterTurn = backgroundRunsOn;
  // One Stop for every control (`conversationStop`): the composer's, the menu row's, the
  // keybinding's. "Stopping…" from the press, on every device once the Mate's row says a Stop is
  // in force; "Stopped — nothing more will change." once nothing runs; given back, with why, when
  // the Mate refused it.
  const stopKey =
    activeThread === undefined
      ? null
      : scopedThreadKey(scopeThreadRef(activeThread.environmentId, activeThread.id));
  const stopPress = useStopPress(stopKey);
  const stopNow = conversationStop({
    press: stopPress,
    stopping: activeThreadShell?.stopping === true,
    working: isWorking || backgroundRunsOn,
    turnId: activeLatestTurn?.turnId ?? null,
  });
  const isStopping = stopNow.kind === "stopping";
  const stopBackgroundWork = useCallback(() => {
    void onInterrupt();
  }, [onInterrupt]);
  const composerBackgroundWork = useMemo(
    () => (backgroundRunsOn ? { stopping: isStopping, onStop: stopBackgroundWork } : null),
    [backgroundRunsOn, isStopping, stopBackgroundWork],
  );
  // An archived conversation reads as one and offers its way back: reopened from the chats menu it
  // drew a live composer that sent nothing, and Restore was gone with the archive's toast (engine
  // final run, G10).
  const activeThreadArchived = activeServerThread?.archivedAt != null;
  const [restoringThreadKey, setRestoringThreadKey] = useState<string | null>(null);
  // Session-scoped dismissals, one key per (thread, snapshot). A set rather
  // than a single slot so dismissing the banner on one thread does not
  // resurface it on another thread dismissed earlier.
  const [dismissedResumeCompactionKeys, setDismissedResumeCompactionKeys] = useState<
    ReadonlySet<string>
  >(new Set());
  const resumeCompactionKey =
    activeThread && activeContextWindow
      ? `${activeThread.id}:${activeContextWindow.updatedAt}`
      : null;
  const activeThreadHasCompactableConversation =
    activeThread?.messages.some(
      (message) => message.role === "user" && !isCompactCommandMessage(message),
    ) ?? false;
  // A crewmate's conversation is the crew engine's to compact and rotate;
  // `/compact` from here would start a turn around it.
  const compactThreadUnavailable =
    !activeThread ||
    !activeThreadHasCompactableConversation ||
    !activeProject ||
    !isServerThread ||
    activeThreadShell?.crew != null ||
    !manualCompactionProviderAvailable ||
    isWorking ||
    threadDetailLoading ||
    isPreparingWorktree ||
    activeEnvironmentUnavailable ||
    feedbackUploading ||
    pendingApprovals.length > 0 ||
    pendingUserInputs.length > 0 ||
    showPlanFollowUpPrompt;
  const compactDisabled = compactThreadUnavailable;
  const compactDisabledReason = compactDisabled
    ? !activeProject
      ? "Choose a project before compacting"
      : activeThreadShell?.crew != null
        ? "A crewmate's conversation compacts on its own"
        : !manualCompactionProviderAvailable
          ? "Compaction is unavailable for this provider"
          : "Compacting is unavailable right now"
    : null;
  const resumeCompactionNoticeItem = useMemo<ConversationNotice | null>(() => {
    if (
      !activeThread ||
      !activeContextWindow ||
      resumeCompactionKey === null ||
      dismissedResumeCompactionKeys.has(resumeCompactionKey) ||
      resumeCompactionPermanentlyDismissed ||
      nativeResumeCompactionDismissed ||
      pendingUserInputs.length > 0 ||
      phase === "running" ||
      !shouldOfferResumeCompaction({
        provider: selectedProvider,
        usedTokens: activeContextWindow.usedTokens,
        updatedAt: activeContextWindow.updatedAt,
        now: `${nowMinute}:00.000Z`,
      })
    ) {
      return null;
    }
    return resumeCompactionNotice({
      key: resumeCompactionKey,
      usedTokens: activeContextWindow.usedTokens,
      unavailable: compactDisabledReason,
      onCompact: () => {
        if (compactDisabled) return;
        composerRef.current?.compactContext();
      },
      onKeepFullHistory: () =>
        setDismissedResumeCompactionKeys((keys) => new Set(keys).add(resumeCompactionKey)),
    });
  }, [
    activeContextWindow,
    activeThread,
    compactDisabled,
    compactDisabledReason,
    composerRef,
    dismissedResumeCompactionKeys,
    nativeResumeCompactionDismissed,
    nowMinute,
    pendingUserInputs.length,
    phase,
    resumeCompactionKey,
    resumeCompactionPermanentlyDismissed,
    selectedProvider,
  ]);
  const handleRestoreThreadBranch = useCallback(() => {
    if (gitStatusQuery.data?.hasWorkingTreeChanges) {
      setBranchRestoreConfirmOpen(true);
      return;
    }
    void handleSwitchCheckoutToThread();
  }, [gitStatusQuery.data?.hasWorkingTreeChanges, handleSwitchCheckoutToThread]);

  /**
   * The composer's top: this Mate's change waiting for the person's review,
   * from the project's flow rather than from what the agent said
   * (`ZeropsNextStepBanner.tsx`); it gives way while a question or an
   * approval waits on the person, and while the Mate works in any of its chats.
   * Dismissed, the change still waits in the header's Review.
   */
  const mateAtWork = useMateWorks(environmentId);
  const composerTop = useZeropsNextStepStrip(
    activeThreadRef,
    {
      question: activePendingUserInput !== null,
      approval: activePendingApproval !== null,
      working: isWorking || mateAtWork,
    },
    colleagueReadOnly === null,
  );
  // Typing here while the Mate works in another of its chats, Send's hover says so
  // (`ConversationStrip.tsx`). A crewmate works on its own copy of the code, so another chat's
  // work is no warning there.
  const alsoWorkingHint = useAlsoWorkingHint({
    environmentId,
    currentThreadId: isServerThread ? threadId : null,
    typing: composerHasUnsentContent && activeThreadShell?.crew == null,
  });
  const activeCrewOrigin = activeThreadShell?.crew ?? null;
  // An empty crewmate chat opens on its own empty state: a save's seam from
  // before its first message is not drawn (`crewChatSeams.ts`).
  const inCrewChat = activeCrewOrigin !== null;
  const conversationEntries = useMemo(
    () =>
      inCrewChat
        ? crewChatEntries(displayedTimeline.entries, loadEarlierTurns === null)
        : displayedTimeline.entries,
    [displayedTimeline.entries, inCrewChat, loadEarlierTurns],
  );
  // A failure no run shows — a send refused here, a Mate that cannot say its run state — is the
  // conversation's last row, never an alert over it (S6).
  const endNoticeMateName = admissionMate.kind === "mate" ? admissionMate.mate.name : undefined;
  const endNoticeDriver = activeServerThread?.session?.providerName ?? null;
  const latestTurnIdForNotice = activeThread?.latestTurn?.turnId;
  const endNoticeLimitShown = useMemo(
    () =>
      shownThreadError !== null &&
      conversationEntries.some(
        (entry) => isUsageLimitError(entry) && timelineEntryTurnId(entry) === latestTurnIdForNotice,
      ),
    [conversationEntries, latestTurnIdForNotice, shownThreadError],
  );
  // The row's ×: a local error is cleared, a server-held one masked for the session; the mask is
  // no state of the view's, so the × bumps a render of its own.
  const [, setEndNoticeDismissals] = useState(0);
  const endNoticeKey =
    shownThreadError === null ? null : threadErrorDismissalKey(routeThreadKey, shownThreadError);
  const endNoticeDismissed = endNoticeKey !== null && threadErrorDismissed(endNoticeKey);
  const errorNotice = useMemo(
    () =>
      threadErrorNotice({
        error: shownThreadError,
        mateName: endNoticeMateName,
        driver: endNoticeDriver,
        usageLimitShown: endNoticeLimitShown,
        dismissed: endNoticeDismissed,
      }),
    [endNoticeDismissed, endNoticeDriver, endNoticeLimitShown, endNoticeMateName, shownThreadError],
  );
  // A Stop pressed here that ended everything says so plainly, as the conversation's last row,
  // until the next turn or its ×.
  const stoppedShown = errorNotice === null && stopNow.kind === "stopped";
  const endNotice = stoppedShown ? STOPPED_NOTICE : errorNotice;
  const activeThreadIdForNotice = activeThread?.id ?? null;
  const dismissEndNotice = useCallback(() => {
    if (stoppedShown) {
      if (stopKey !== null) useStopPressStore.getState().clear(stopKey);
      return;
    }
    if (endNoticeKey === null) return;
    dismissThreadError(endNoticeKey);
    setThreadError(activeThreadIdForNotice, null);
    setEndNoticeDismissals((count) => count + 1);
  }, [activeThreadIdForNotice, endNoticeKey, setThreadError, stopKey, stoppedShown]);
  // A crewmate's *Change its job*, and its composer's *Runs on*: its job in
  // the Crew tab; the lead's *Change the goal*: the crew's goal there.
  const editCrewmateJob = (handle: string) => {
    if (activeThreadRef !== null) openCrewView(activeThreadRef, { kind: "job", handle });
  };
  const editCrewGoal = () => {
    if (activeThreadRef !== null) openCrewView(activeThreadRef, { kind: "goal" });
  };
  const activeCrewmate =
    activeCrewOrigin === null
      ? null
      : (crew.view?.crewmates.find((row) => row.crewmate.handle === activeCrewOrigin.crewmate) ??
        null);
  // A crewmate's model, effort and permissions are its own (*Runs on*, the
  // crew gate): the composer says them, and opens its editor to change them.
  const crewRunsOnLabel =
    activeCrewmate === null
      ? null
      : crewRunsOnWord(crewRunsOn(activeCrewmate.crewmate, providerStatuses));
  // The lead's chat names crewmates on `@`; no other chat does (PRD §5.3).
  const crewMentions = useMemo(
    () => crewComposerMentions(activeCrewmate, crew.snapshot?.crewmates ?? []),
    [activeCrewmate, crew.snapshot],
  );
  // A crewmate's chat is written to the crewmate (PRD §4.5).
  const crewComposerPlaceholder =
    activeCrewOrigin === null
      ? null
      : crewMessagePlaceholder(activeCrewmate?.crewmate.displayName ?? activeCrewOrigin.crewmate);
  // A crewmate's chat: an earlier conversation points at the one it talks in
  // now and sends nothing, as its send would land there; the current one says
  // what its next turn brings in.
  const crewNotices = useMemo(
    () => (activeCrewmate === null ? null : crewChatNotices(activeCrewmate, threadId)),
    [activeCrewmate, threadId],
  );
  // What stops the person writing takes the composer's own place, with its one way out (S6): the
  // conversation archived, a crewmate's earlier conversation.
  const composerPlace = useMemo(
    () =>
      composerPlaceNotice(
        {
          archived:
            activeThreadArchived && activeThreadRef !== null
              ? { restoring: restoringThreadKey === activeThreadKey }
              : null,
          crewRetired: crewNotices?.retired ?? null,
        },
        {
          restore: () => {
            if (activeThreadRef === null) return;
            setRestoringThreadKey(activeThreadKey);
            void unarchiveThread(activeThreadRef).finally(() => setRestoringThreadKey(null));
          },
          openCurrent: () => {
            const current = crewNotices?.retired?.currentThreadId ?? null;
            if (current === null) return;
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(scopeThreadRef(environmentId, current)),
            });
          },
        },
      ),
    [
      activeThreadArchived,
      activeThreadKey,
      activeThreadRef,
      crewNotices,
      environmentId,
      navigate,
      restoringThreadKey,
      unarchiveThread,
    ],
  );
  // The project's repository while it clones stops only Send: its line stands at the composer's
  // top, and the composer stays (`ComposerCloneAsk`).
  const cloneShown = activeProjectRef === null ? null : activeProjectClone;
  const cloneTop = useMemo(
    () =>
      cloneShown === null || cloneShown.phase === "done" || activeProjectRef === null ? null : (
        <ComposerCloneAsk
          clone={cloneShown}
          actions={{
            cancel: () => {
              const { environmentId, projectId } = activeProjectRef;
              void runProjectCloneAction("Failed to cancel clone", () =>
                cancelProjectClone({ environmentId, input: { projectId } }),
              );
            },
            retry: () => {
              const { environmentId, projectId } = activeProjectRef;
              void runProjectCloneAction("Failed to retry clone", () =>
                retryProjectClone({ environmentId, input: { projectId } }),
              );
            },
            remove: () => {
              const { environmentId, projectId } = activeProjectRef;
              void removeClonedProject({ environmentId, projectId });
            },
          }}
        />
      ),
    [
      activeProjectRef,
      cancelProjectClone,
      cloneShown,
      removeClonedProject,
      retryProjectClone,
      runProjectCloneAction,
    ],
  );
  // What a crew thread's task cards need beyond their text: the board, and
  // for the stint's first card — while the conversation is loaded from its
  // start — why this conversation began and the one before it, unless the
  // engine's own stint seam says so already.
  const crewTimeline = useMemo<CrewTimeline | null>(() => {
    if (activeCrewOrigin === null) return null;
    const firstCard =
      loadEarlierTurns === null
        ? displayedTimeline.entries.find(
            (entry) =>
              entry.kind === "message" &&
              entry.message.role === "user" &&
              crewCardOf(entry.message) !== null,
          )
        : undefined;
    return {
      firstCardId: firstCard?.id ?? null,
      origin: crewCardOrigin({
        stints: activeCrewmate?.crewmate.stints ?? [],
        threadId,
        seamed: displayedTimeline.entries.some(
          (entry) => entry.kind === "work" && entry.entry.crewSeam?.seam === "stint",
        ),
      }),
      tasks: crew.snapshot?.board.tasks ?? [],
      crewmate: {
        handle: activeCrewOrigin.crewmate,
        profile: activeCrewmate?.crewmate ?? null,
      },
      mateName: (() => {
        const mateAt = zeropsMateAt(zeropsMates, environmentId);
        return mateAt.kind === "mate" ? mateAt.mate.name : "the Mate";
      })(),
      onOpenThread: (target) =>
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(environmentId, target)),
        }),
      // Its empty conversation's *Change its job*: offered once whose logins
      // they are is read, and only where the crew's door would take the save.
      onChangeJob:
        activeThreadRef !== null &&
        !crewDoor.reading &&
        crewDoor.crewmate(activeCrewOrigin.crewmate) === null
          ? () => openCrewView(activeThreadRef, { kind: "job", handle: activeCrewOrigin.crewmate })
          : null,
      // The engine crew's board is bounded: older finished work is read a page at a time.
      readTaskPage: (input) =>
        readCrewTaskPage({ environmentId, input }).then((result) =>
          result._tag === "Success"
            ? result.value
            : Promise.reject(new Error("The crew's finished work could not be read.")),
        ),
    };
  }, [
    activeCrewOrigin,
    activeCrewmate,
    activeThreadRef,
    crew.snapshot,
    crewDoor,
    displayedTimeline.entries,
    environmentId,
    loadEarlierTurns,
    navigate,
    readCrewTaskPage,
    threadId,
    zeropsMates,
  ]);

  const feedbackNotices = useMemo(
    () =>
      feedbackSubmissions.flatMap((submission) => {
        const item = feedbackNotice(submission, () => {
          setFeedbackSubmissionsByThreadKey((current) => ({
            ...current,
            [routeThreadKey]: (current[routeThreadKey] ?? []).filter(
              (entry) => entry.id !== submission.id,
            ),
          }));
        });
        return item ? [item] : [];
      }),
    [feedbackSubmissions, routeThreadKey],
  );
  // A stand-up's builds that ran on after its call returned leave the band
  // once the store reads them done.
  // Only while a turn runs: an operation of no turn never reads the project.
  const runningOperations = useMemo(
    () =>
      activeRunningTurnId === null
        ? []
        : displayedTimeline.entries.flatMap((entry) =>
            entry.kind === "operation" && entry.operation.turnId === activeRunningTurnId
              ? [entry.operation]
              : [],
          ),
    [displayedTimeline.entries, activeRunningTurnId],
  );
  const standupsDone = useStandupsDone(runningOperations, activeThreadEnvironmentId);
  // What runs while the Mate works — deploys, helpers, the task list — shown
  // in the conversation's working component, under the live line it belongs to.
  const dockModel = useMemo(
    () =>
      deriveDock({
        timelineEntries: displayedTimeline.entries,
        isWorking,
        runningTurnId: activeRunningTurnId,
        turnStartedAt: activeWorkStartedAt,
        agentPanelModel,
        plan: activePlan ?? null,
        backgroundTasks,
        backgroundLiveness: afterTurnLiveness,
        backgroundWork: activeBackgroundWork,
        liveJobs,
        // The server's own pause when it keeps one; the thread's last words otherwise.
        pause: limit.kind === "limited" ? { resetsAt: limit.resetsAt } : null,
        standupsDone,
      }),
    [
      standupsDone,
      liveJobs,
      displayedTimeline.entries,
      isWorking,
      activeRunningTurnId,
      activeWorkStartedAt,
      agentPanelModel,
      activePlan,
      backgroundTasks,
      afterTurnLiveness,
      activeBackgroundWork,
      limit,
    ],
  );
  // Over the composer stands only the Mate's link and the connection (S6 sends the rest to the
  // conversation and to the composer's place). Someone else's conversation is read, not run: a
  // calm word about this Mate's link offers a step on it, so only an urgent one is said there.
  const composerBannerItems = useMemo<ComposerBannerStackItem[]>(() => {
    const isUrgentSystemItem = (item: ComposerBannerStackItem) =>
      item.urgent === true || item.variant === "error" || item.variant === "warning";
    const urgentSystemItems = systemComposerBannerItems.filter(isUrgentSystemItem);
    if (colleagueReadOnly !== null) return urgentSystemItems;
    const calmSystemItems = systemComposerBannerItems.filter((item) => !isUrgentSystemItem(item));
    return [...urgentSystemItems, ...calmSystemItems];
  }, [colleagueReadOnly, systemComposerBannerItems]);
  // What happened that the person may still act on: quiet rows at the conversation's end, in the
  // order they come (S6). A colleague's conversation is read, not run, and says none of them.
  const crewNextNotice = useMemo(() => crewNextConversationNotice(crewNotices), [crewNotices]);
  const branchChangedNoticeItem = useMemo(
    () =>
      localCheckoutBranchMismatch === null ||
      localCheckoutBranchMismatch === undefined ||
      !showBranchMismatchBanner ||
      !activeBranchMismatchKey
        ? null
        : branchChangedNotice({
            key: activeBranchMismatchKey,
            mismatch: localCheckoutBranchMismatch,
            restoring: isRestoringThreadBranch,
            onRestore: handleRestoreThreadBranch,
            onDismiss: branchAdvice.dismiss,
          }),
    [
      activeBranchMismatchKey,
      branchAdvice.dismiss,
      handleRestoreThreadBranch,
      isRestoringThreadBranch,
      localCheckoutBranchMismatch,
      showBranchMismatchBanner,
    ],
  );
  const conversationNotices = useMemo<ReadonlyArray<ConversationNotice>>(() => {
    if (colleagueReadOnly !== null || threadDetailLoading) return EMPTY_CONVERSATION_NOTICES;
    const notices = [
      crewNextNotice,
      ...feedbackNotices,
      usageLimitsAnswer,
      resumeCompactionNoticeItem,
      branchChangedNoticeItem,
    ].filter((notice): notice is ConversationNotice => notice !== null);
    return notices.length === 0 ? EMPTY_CONVERSATION_NOTICES : notices;
  }, [
    branchChangedNoticeItem,
    colleagueReadOnly,
    crewNextNotice,
    feedbackNotices,
    resumeCompactionNoticeItem,
    threadDetailLoading,
    usageLimitsAnswer,
  ]);
  useEffect(() => {
    setPendingServerThreadEnvMode(null);
    setPendingServerThreadBranch(undefined);
  }, [activeThread?.id]);

  useEffect(() => {
    if (canOverrideServerThreadEnvMode) {
      return;
    }
    setPendingServerThreadEnvMode(null);
    setPendingServerThreadBranch(undefined);
  }, [canOverrideServerThreadEnvMode]);

  useEffect(() => {
    if (!activeThreadId) {
      setTerminalUiLaunchContext(null);
      return;
    }
    setTerminalUiLaunchContext((current) => {
      if (!current) return current;
      if (current.threadId === activeThreadId) return current;
      return null;
    });
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId || !activeProjectCwd) {
      return;
    }
    setTerminalUiLaunchContext((current) => {
      if (!current || current.threadId !== activeThreadId) {
        return current;
      }
      const settledCwd = projectScriptCwd({
        project: { cwd: activeProjectCwd },
        worktreePath: activeThreadWorktreePath,
      });
      if (
        settledCwd === current.cwd &&
        (activeThreadWorktreePath ?? null) === current.worktreePath
      ) {
        return null;
      }
      return current;
    });
  }, [activeProjectCwd, activeThreadId, activeThreadWorktreePath]);

  useEffect(() => {
    if (terminalUiState.terminalOpen) {
      return;
    }
    setTerminalUiLaunchContext((current) =>
      current?.threadId === activeThreadId ? null : current,
    );
  }, [activeThreadId, terminalUiState.terminalOpen]);

  useEffect(() => {
    if (!activeThreadKey) return;
    const previous = terminalUiOpenByThreadRef.current[activeThreadKey] ?? false;
    const current = Boolean(terminalUiState.terminalOpen);

    if (!previous && current) {
      terminalUiOpenByThreadRef.current[activeThreadKey] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalUiOpenByThreadRef.current[activeThreadKey] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalUiOpenByThreadRef.current[activeThreadKey] = current;
  }, [activeThreadKey, focusComposer, terminalUiState.terminalOpen]);

  const getShortcutContext = useCallback(
    (eventTarget: EventTarget | null = document.activeElement) => ({
      terminalFocus: getTerminalFocusOwner() !== null,
      terminalOpen: Boolean(terminalUiState.terminalOpen),
      editableFocus: isEditableFocused(eventTarget),
      modelPickerOpen: composerRef.current?.isModelPickerOpen() ?? false,
      isWeb: !isElectron,
      isDesktop: isElectron,
    }),
    [composerRef, terminalUiState.terminalOpen],
  );

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (preventRepeatedTerminalCloseShortcut(event, keybindings)) {
        event.stopPropagation();
        return;
      }
      // While a close confirmation is open, terminal focus has moved to the
      // dialog, so a deliberate second close shortcut would otherwise fall
      // through to the native window/tab close accelerator.
      if (isTerminalCloseConfirmPending() && preventTerminalCloseShortcut(event, keybindings)) {
        event.stopPropagation();
        return;
      }
      if (!activeThreadId || isCommandPaletteOpen()) {
        return;
      }
      const terminalFocusOwner = getTerminalFocusOwner();
      if (event.defaultPrevented && terminalFocusOwner === null) {
        return;
      }
      const shortcutContext = getShortcutContext(event.target);

      if (
        !shortcutContext.terminalFocus &&
        !shortcutContext.modelPickerOpen &&
        shouldTypeToFocusComposer(event)
      ) {
        if (composerRef.current?.insertTextAtEnd(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "thread.undo") {
        // Only claim the chord when there is an Undo to run; otherwise the
        // page keeps its native behavior for the key.
        if (event.repeat) return;
        if (undoLatestThreadAction()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleTerminalVisibility();
        return;
      }

      if (command === "rightPanel.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleRightPanel();
        return;
      }

      if (command === "rightPanel.toggleMaximized") {
        event.preventDefault();
        event.stopPropagation();
        toggleRightPanelMaximized();
        return;
      }

      if (command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel") {
          splitPanelTerminal();
          return;
        }
        if (!terminalUiState.terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.splitVertical") {
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel") {
          splitPanelTerminal("vertical");
          return;
        }
        if (!terminalUiState.terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal("vertical");
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel" && activeRightPanelSurface?.kind === "terminal") {
          requestClosePanelTerminal(activeRightPanelSurface.activeTerminalId);
          return;
        }
        if (!terminalUiState.terminalOpen) return;
        requestCloseTerminal(terminalUiState.activeTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        if (terminalFocusOwner === "right-panel") {
          addTerminalSurface();
          return;
        }
        if (!terminalUiState.terminalOpen) {
          setTerminalOpen(true);
        }
        createNewTerminal();
        return;
      }

      if (command === "diff.toggle") {
        event.preventDefault();
        event.stopPropagation();
        onToggleDiff();
        return;
      }

      if (command === "modelPicker.toggle") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) composerRef.current?.toggleModelPicker();
        return;
      }

      if (
        command === "composer.host" ||
        command === "composer.effort" ||
        command === "composer.mode" ||
        command === "composer.workspace"
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) composerRef.current?.openControl(command);
        return;
      }

      if (command === "composer.branch") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) branchToolbarRef.current?.openBranchPicker();
        return;
      }

      if (command === "composer.previousWorktree") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) branchToolbarRef.current?.usePreviousWorktree();
        return;
      }

      if (command === "thread.steerQueuedMessage") {
        const message = activeThreadKey
          ? useQueuedMessageStore.getState().queuesByThreadKey[activeThreadKey]?.[0]
          : undefined;
        if (!message) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) queuedMessageActionsRef.current.steer(message.id);
        return;
      }

      if (command === "thread.stop") {
        // An unavailable command should not shadow contextual shortcuts such as Escape to close a dialog.
        // A read-only conversation has no stop, by button or by key.
        if (!canInterruptRunningThread && composerBackgroundWork === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        void onInterrupt();
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProject) return;
      const script = activeProjectScripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      void runProjectScript(script);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activeProject,
    activeRightPanelSurface,
    activeProjectScripts,
    addTerminalSurface,
    activeThreadRef,
    canInterruptRunningThread,
    composerBackgroundWork,
    activeThreadKey,
    terminalUiState.terminalOpen,
    terminalUiState.activeTerminalId,
    activeThreadId,
    requestCloseTerminal,
    requestClosePanelTerminal,
    createNewTerminal,
    setTerminalOpen,
    runProjectScript,
    splitTerminal,
    splitPanelTerminal,
    keybindings,
    isServerThread,
    onInterrupt,
    onToggleDiff,
    getShortcutContext,
    toggleRightPanel,
    toggleRightPanelMaximized,
    toggleTerminalVisibility,
    composerRef,
  ]);

  const onCompactContext = async () => {
    if (compactDisabled || !activeThread || sendInFlightRef.current) {
      return;
    }
    const context = composerRef.current?.getSendContext();
    if (!context?.providerAvailable) return;

    // Compaction is a standalone command; the draft and its attachments stay local.
    const threadId = activeThread.id;
    const messageId = newMessageId();
    const createdAt = new Date().toISOString();
    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    setThreadError(threadId, null);
    setOptimisticUserMessages((messages) => [
      ...messages,
      {
        id: messageId,
        role: "user",
        text: "/compact",
        turnId: null,
        createdAt,
        updatedAt: createdAt,
        streaming: false,
      },
    ]);
    scrollToEnd();
    try {
      const settingsResult = await persistThreadSettingsForNextTurn({
        threadId,
        createdAt,
        modelSelection: context.selectedModelSelection,
        ...(localCheckoutBranchMismatch
          ? { branch: localCheckoutBranchMismatch.currentBranch }
          : {}),
        runtimeMode,
        interactionMode: context.interactionMode,
      });
      const result =
        settingsResult._tag === "Failure"
          ? settingsResult
          : await startThreadTurn({
              environmentId,
              input: {
                threadId,
                message: { messageId, role: "user", text: "/compact", attachments: [] },
                modelSelection: context.selectedModelSelection,
                runtimeMode,
                interactionMode: context.interactionMode,
                createdAt,
              },
            });
      if (result._tag === "Failure") {
        setOptimisticUserMessages((messages) =>
          messages.filter((message) => message.id !== messageId),
        );
        resetLocalDispatch();
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setThreadError(
            threadId,
            error instanceof Error ? error.message : "Failed to compact context.",
          );
        }
      }
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const queuedMessages = useQueuedMessages(activeThreadKey ?? "");
  // Where the notices stand: the conversation's last rows, or just above the composer while there
  // is no conversation to hold them (`noticesHome`).
  const noticesOverComposer =
    noticesHome({
      heroDraft: isDraftHeroState,
      entries: conversationEntries,
      isWorking,
      queued: queuedMessages.length,
    }) === "composer";
  // A notice the person's own action brought brings the conversation to its end, as a send does.
  const shownNoticeIdsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const before = shownNoticeIdsRef.current;
    shownNoticeIdsRef.current = new Set(conversationNotices.map((notice) => notice.id));
    if (noticesOverComposer || !personNoticeArrived(before, conversationNotices)) return;
    if (
      nextTimelineFollow(
        liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current,
        { type: "sent", byPerson: true },
      )
    ) {
      scrollToEnd(false, true);
    }
  }, [conversationNotices, noticesOverComposer, scrollToEnd]);
  const onSendRef = useRef<((ids?: ComposerSendIds) => Promise<ComposerSendResult>) | null>(null);
  // Whether the mounted composer's own send would go (`ChatComposer`'s `onSendableChange`).
  const [composerSendable, setComposerSendable] = useState(false);
  // What `onSend` would refuse unsaid, as the render reads it: a requested send waits it out.
  const requestedSendReady =
    composerSendable &&
    admission.canSend &&
    !sendInFlight &&
    !feedbackUploading &&
    !isSendBusy &&
    !isConnecting &&
    !threadDetailLoading &&
    !activeEnvironmentUnavailable &&
    !activePendingProgress;
  // What a surface asked this composer to send goes out through its own send.
  useComposerSendRequests({
    target: activeThread === undefined ? null : composerDraftTarget,
    targetKey: activeThread === undefined ? null : routeThreadKey,
    admits: composerAdmits(admission, colleagueReadOnly?.notice ?? null),
    ready: requestedSendReady,
    write: (prompt) => {
      promptRef.current = prompt;
      setComposerDraftPrompt(composerDraftTarget, prompt);
    },
    send: async (ids) => (await onSendRef.current?.(ids)) ?? { kind: "not-ready" },
  });

  // Puts queued messages back into the composer, e.g. after Stop or a Cancel.
  // Prompts join with blank lines; attachments and contexts are added.
  restoreQueuedMessagesRef.current = (messages) => restoreQueuedMessagesToComposer(messages);
  const restoreQueuedMessagesToComposer = (messages: ReadonlyArray<QueuedComposerMessage>) => {
    if (messages.length === 0) return;
    // A queued request back in the composer never went: its asker hears so.
    for (const message of messages) {
      if (message.sendIds !== undefined)
        tellSendOutcome(message.sendIds.messageId, {
          kind: "waits",
          why: "It was stopped before it went.",
        });
    }
    // The draft holds at most the per-turn cap of attachments. The pictures'
    // overflow goes back into the queue so nothing is lost, its places out of
    // the text; the user can send the first batch and the rest follows as a
    // queued message.
    const heldFiles =
      useComposerDraftStore.getState().getComposerDraft(composerDraftTarget)?.files ?? [];
    const {
      prompt: nextPrompt,
      images: restoredImages,
      overflow,
      files: restoredFiles,
    } = restoreQueuedToComposer({
      prompt: promptRef.current,
      imageCount: composerImagesRef.current.length,
      fileCount: heldFiles.length,
      heldAttachments: composerAttachmentCount(composerImagesRef.current, heldFiles),
      weigh: (image) => composerAttachmentCount([image], []),
      messages,
    });
    promptRef.current = nextPrompt;
    setComposerDraftPrompt(composerDraftTarget, nextPrompt);
    if (restoredFiles.length > 0) {
      const files = [...heldFiles, ...restoredFiles];
      useComposerDraftStore.getState().syncFiles(
        composerDraftTarget,
        files.map((file) => file.id),
        files,
      );
    }
    // The composer syncs this ref from the draft in an effect; a send before
    // that effect runs must already see the restored content.
    composerImagesRef.current = [...composerImagesRef.current, ...restoredImages];
    if (restoredImages.length > 0) addComposerDraftImages(composerDraftTarget, restoredImages);
    if (overflow.length > 0 && activeThreadKey) {
      useQueuedMessageStore.getState().enqueue(activeThreadKey, {
        prompt: "",
        images: overflow,
        terminalContexts: [],
        reviewComments: [],
        submissionIntent: "foreground",
        queuedAfterToolActivityId: latestCompletedToolActivityId(threadActivities),
        // Restoration is not a send. The user decides when the overflow goes.
        holdUntilUserAction: true,
        createdAt: new Date().toISOString(),
      });
      toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "Some attachments stayed queued",
          description: `A message holds at most ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments. Use Send now on the queued message when you want the rest to go.`,
        }),
      );
    }
    const restoredTerminalContexts = [
      ...composerTerminalContextsRef.current,
      ...messages.flatMap((message) => message.terminalContexts),
    ];
    composerTerminalContextsRef.current = restoredTerminalContexts;
    setComposerDraftTerminalContexts(composerDraftTarget, restoredTerminalContexts);
    const draft = useComposerDraftStore.getState().getComposerDraft(composerDraftTarget);
    setComposerDraftReviewComments(composerDraftTarget, [
      ...(draft?.reviewComments ?? []),
      ...messages.flatMap((message) => message.reviewComments),
    ]);
    composerRef.current?.resetCursorState({
      cursor: collapseExpandedComposerCursor(nextPrompt, nextPrompt.length),
      prompt: nextPrompt,
      detectTrigger: true,
    });
  };

  // Bound on every render, as `restoreQueuedMessagesRef` is: the effect above
  // is declared before this and would otherwise hold a stale closure.
  // A requested send's answer: not ready yet where `onSend` would refuse it unsaid (the render's
  // readiness, and what it reads from refs), otherwise whether its turn went.
  onSendRef.current = async (ids) => {
    if (
      !activeThread ||
      !requestedSendReady ||
      !admission.canSend ||
      sendInFlightRef.current ||
      feedbackUploadsInFlightRef.current.has(routeThreadKey) ||
      composerRef.current?.getSendContext().providerAvailable !== true
    )
      return { kind: "not-ready" };
    const end = await onSend(undefined, "foreground", undefined, ids);
    return end === "declined" ? { kind: "waits", why: "It did not go out." } : { kind: end };
  };
  const onSend = async (
    e?: { preventDefault: () => void },
    submissionIntent: ComposerSubmissionIntent = "foreground",
    /** A queued message being sent now instead of the live composer draft. */
    queuedMessage?: QueuedComposerMessage,
    /** The ids a requested send carries, so clients making the same send make one command. */
    sendIds?: ComposerSendIds,
    /** The person's own send, or a queued message leaving by itself at a boundary. */
    sentBy: "person" | "queue" = "person",
    /** Whether a turn went, waits in the queue behind the running one, or was declined here. */
  ): Promise<"sent" | "queued" | "declined"> => {
    e?.preventDefault();
    // Typed out in full rather than picked from the menu. Attachments or contexts
    // mean the user is sending a prompt, so those go through as usual.
    if (
      !queuedMessage &&
      usageLimitsOffered &&
      usageLimitsKey !== null &&
      !composerHasNonPromptContent &&
      isUsageLimitsCommand(promptRef.current)
    ) {
      if (openUsageLimits()) {
        promptRef.current = "";
        setComposerDraftPrompt(composerDraftTarget, "");
        composerRef.current?.resetCursorState();
      }
      return "declined";
    }
    // /mcp alone is Mate's own: it opens the MCP tab, and the agent never sees it.
    if (
      !queuedMessage &&
      !composerHasNonPromptContent &&
      isStandaloneMcpCommand(promptRef.current)
    ) {
      addMcpSurface();
      promptRef.current = "";
      setComposerDraftPrompt(composerDraftTarget, "");
      composerRef.current?.resetCursorState();
      return "declined";
    }
    if (
      !activeThread ||
      isSendBusy ||
      isConnecting ||
      threadDetailLoading ||
      sendInFlightRef.current ||
      feedbackUploadsInFlightRef.current.has(routeThreadKey)
    ) {
      return "declined";
    }
    if (activeEnvironmentUnavailable) {
      // A Mate's banner already says where its link is (`mateVoice`): no second voice. Where the
      // banner has no words yet, the refused send says so itself.
      if (mateVoiceSpeaks(mateLinkVoice)) return "declined";
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Not connected: message not sent",
          description: "Reconnecting to the environment. Try again once it is connected.",
        }),
      );
      return "declined";
    }
    if (activePendingProgress) {
      // A queued message waits until the question is answered; it must not
      // be submitted as the answer.
      if (queuedMessage) return "declined";
      onAdvanceActivePendingUserInput();
      return "declined";
    }
    const sendCtx = composerRef.current?.getSendContext();
    if (!admission.canSend || !sendCtx?.providerAvailable) {
      return "declined";
    }
    const {
      images: composerImages,
      files: composerFiles = [],
      terminalContexts: composerTerminalContexts,
      reviewComments: composerReviewComments,
    } = queuedMessage ?? sendCtx;
    const {
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
      interactionMode: sendInteractionMode,
      interactionModeEnabled: sendInteractionModeEnabled,
    } = sendCtx;
    const promptForSend = queuedMessage ? queuedMessage.prompt : promptRef.current;
    const {
      trimmedPrompt: trimmed,
      sendableTerminalContexts: sendableComposerTerminalContexts,
      expiredTerminalContextCount,
      hasSendableContent,
    } = deriveComposerSendState({
      prompt: promptForSend,
      imageCount: composerImages.length + composerFiles.length,
      terminalContexts: composerTerminalContexts,
      // The vault's chips ride with a message typed now, never with one queued before them.
      elementContextCount:
        composerReviewComments.length + (queuedMessage ? 0 : vaultTurn.changes.length),
    });
    const feedbackCommand =
      ctxSelectedProvider === "codex" &&
      composerImages.length === 0 &&
      composerFiles.length === 0 &&
      sendableComposerTerminalContexts.length === 0 &&
      composerReviewComments.length === 0
        ? parseCodexFeedbackCommand(trimmed)
        : null;
    if (feedbackCommand && !queuedMessage) {
      if (!isServerThread || activeThread.session === null) {
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: "Start a Codex thread first",
            description: "Send a message before you submit feedback.",
          }),
        );
        return "declined";
      }
      feedbackUploadsInFlightRef.current.add(routeThreadKey);
      await submitCodexFeedback({
        submission: {
          id: newMessageId(),
          command: trimmed,
          createdAt: new Date().toISOString(),
        },
        clearDraft: () => {
          promptRef.current = "";
          clearComposerDraftContent(composerDraftTarget);
          composerRef.current?.resetCursorState();
        },
        onUpdate: (submission) => {
          setFeedbackSubmissionsByThreadKey((current) => {
            const existing = current[routeThreadKey] ?? [];
            const found = existing.some((entry) => entry.id === submission.id);
            return {
              ...current,
              [routeThreadKey]: found
                ? existing.map((entry) => (entry.id === submission.id ? submission : entry))
                : [...existing, submission],
            };
          });
        },
        upload: () =>
          uploadThreadFeedback({
            environmentId,
            input: {
              threadId: activeThread.id,
              ...feedbackCommand,
            },
          }),
      }).finally(() => {
        feedbackUploadsInFlightRef.current.delete(routeThreadKey);
      });

      return "declined";
    }
    if (!queuedMessage && showPlanFollowUpPrompt && activeProposedPlan) {
      const followUp = resolvePlanFollowUpSubmission({
        draftText: trimmed,
        planMarkdown: activeProposedPlan.planMarkdown,
      });
      const outgoingFollowUpText = formatOutgoingPrompt({
        provider: ctxSelectedProvider,
        model: ctxSelectedModel,
        models: ctxSelectedProviderModels,
        effort: ctxSelectedPromptEffort,
        text: followUp.text.trim(),
      });
      if (composerRef.current?.validateProviderInput(outgoingFollowUpText) === false) {
        return "declined";
      }
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      return (await onSubmitPlanFollowUp({
        text: followUp.text,
        interactionMode: followUp.interactionMode,
      }))
        ? "sent"
        : "declined";
    }
    // Providers without the legacy toggle receive their native commands unchanged.
    const standaloneSlashCommand =
      sendInteractionModeEnabled &&
      composerImages.length === 0 &&
      composerFiles.length === 0 &&
      sendableComposerTerminalContexts.length === 0 &&
      composerReviewComments.length === 0
        ? parseStandaloneComposerSlashCommand(trimmed)
        : null;
    if (standaloneSlashCommand && !queuedMessage) {
      handleInteractionModeChange(standaloneSlashCommand);
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      return "declined";
    }
    if (!hasSendableContent) {
      if (expiredTerminalContextCount > 0) {
        const toastCopy = buildExpiredTerminalContextToastCopy(
          expiredTerminalContextCount,
          "empty",
        );
        toastManager.add(
          stackedThreadToast({
            type: "warning",
            title: toastCopy.title,
            description: toastCopy.description,
          }),
        );
      }
      // A queued message whose only content expired would retry on every
      // boundary and block the rest of the queue. Nothing sendable is left
      // in it, so drop it and let the queue move on.
      if (queuedMessage && activeThreadKey) {
        useQueuedMessageStore.getState().remove(activeThreadKey, queuedMessage.id);
      }
      return "declined";
    }
    if (!activeProject) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Choose a project first",
          description: "This draft no longer points to an available project.",
        }),
      );
      return "declined";
    }
    // With the queue follow-up behavior, a send during a running turn waits in
    // the queue. It leaves on the next tool boundary, when the turn ends, or
    // when the user clicks Send now. Steer sends it straight away; the provider
    // treats a mid-turn send as a steer of the active turn either way.
    if (
      !queuedMessage &&
      phase === "running" &&
      activeThreadKey &&
      settings.followUpBehavior === "queue"
    ) {
      if (composerRef.current?.validateProviderInput(promptForSend) === false) {
        return "declined";
      }
      useQueuedMessageStore.getState().enqueue(activeThreadKey, {
        prompt: promptForSend,
        images: [...composerImages],
        files: [...composerFiles],
        terminalContexts: [...composerTerminalContexts],
        reviewComments: [...composerReviewComments],
        agentNotes: [...agentNotes],
        vaultChanges: [...turnContext.vaultChanges],
        submissionIntent,
        // A requested send keeps its ids, and with them whose it is (`ComposerSendIds.fromPanel`).
        ...(sendIds === undefined ? {} : { sendIds }),
        ...(sendIds?.fromPanel === true ? { fromPanel: true as const } : {}),
        // What it leaves with if its conversation is not on screen by then.
        sendSettings: {
          modelSelection: ctxSelectedModelSelection,
          runtimeMode,
          interactionMode: sendInteractionMode,
          promptEffort: outgoingPromptEffort({
            provider: ctxSelectedProvider,
            model: ctxSelectedModel,
            models: ctxSelectedProviderModels,
            effort: ctxSelectedPromptEffort,
          }),
        },
        queuedAfterToolActivityId: latestCompletedToolActivityId(threadActivities),
        createdAt: new Date().toISOString(),
      });
      promptRef.current = "";
      // Attachments move with the message; their uploads stay pending. The
      // refs clear now too, so a Stop before the composer's sync effect runs
      // does not restore the moved attachments twice.
      composerImagesRef.current = [];
      composerTerminalContextsRef.current = [];
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
      // The person's own send pins the end at once, though the message waits
      // in the queue; its leaving later moves no one.
      if (
        nextTimelineFollow(
          liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current,
          { type: "sent", byPerson: true },
        )
      ) {
        scrollToEnd(false, true);
      }
      // Queued, it leaves by itself at the turn's next boundary; its asker hears then.
      return "queued";
    }
    const threadIdForSend = activeThread.id;
    const isFirstMessage = !isServerThread || activeThread.messages.length === 0;
    const baseBranchForWorktree =
      isFirstMessage && sendEnvMode === "worktree" && !activeThread.worktreePath
        ? activeThreadBranch
        : null;

    // In worktree mode, require an explicit base branch so we don't silently
    // fall back to local execution when branch selection is missing.
    const shouldCreateWorktree =
      isFirstMessage && sendEnvMode === "worktree" && !activeThread.worktreePath;
    if (shouldCreateWorktree && !activeThreadBranch) {
      setThreadError(threadIdForSend, "Select a base branch before sending in New worktree mode.");
      return "declined";
    }

    const composerImagesSnapshot = [...composerImages];
    const composerFilesSnapshot = [...composerFiles];
    const composerTerminalContextsSnapshot = [...sendableComposerTerminalContexts];
    const composerReviewCommentsSnapshot: ReviewCommentContext[] = [...composerReviewComments];
    // Each picture's place becomes its label and notes, so the Mate reads words
    // and pictures in the order they were written.
    const messageTextWithContexts = appendTerminalContextsToPrompt(
      materializePicturePrompt(promptForSend, composerImagesSnapshot, composerFilesSnapshot),
      composerTerminalContextsSnapshot,
    );
    const messageTextForSend = appendReviewCommentsToPrompt(
      messageTextWithContexts,
      composerReviewCommentsSnapshot,
    );
    const outgoingMessageText = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text:
        messageTextForSend ||
        (!queuedMessage &&
        composerImagesSnapshot.length + composerFilesSnapshot.length === 0 &&
        vaultTurn.changes.length > 0
          ? vaultChipsOnlyText(vaultTurn.changes)
          : IMAGE_ONLY_BOOTSTRAP_PROMPT),
    });
    if (composerRef.current?.validateProviderInput(outgoingMessageText) === false) {
      // A queued message that no longer fits is held at the head for the
      // user to edit via Cancel, instead of failing on every boundary.
      if (queuedMessage && activeThreadKey) {
        const outcome = queuedSendOutcome({ kind: "too-long" }, 0);
        useQueuedMessageStore
          .getState()
          .holdAtFront(
            activeThreadKey,
            queuedMessage,
            outcome.action === "hold" ? outcome.reason : undefined,
          );
      }
      return "declined";
    }

    sendInFlightRef.current = true;
    // Every early return above leaves a queued message in the queue for a
    // later retry. From here on a failure hands it back held.
    if (queuedMessage) {
      // Marked in flight for both senders: the next message waits for this one.
      const taken = activeThreadKey
        ? beginQueuedSend(
            activeThreadKey,
            queuedMessage.id,
            latestCompletedToolActivityId(threadActivities),
          )
        : null;
      if (!taken) {
        sendInFlightRef.current = false;
        return "declined";
      }
    }
    // Stop drains the queue. A queued send whose upload was still running at
    // that moment must not start a turn afterwards; it checks this before
    // dispatch and hands the message back to the composer instead.
    const drainGenerationAtTake = activeThreadKey ? drainGenerationOf(activeThreadKey) : 0;
    // A queued send always knows its ids: a retry after an interruption goes with the same ones.
    const attemptIds =
      queuedMessage === undefined
        ? sendIds
        : queuedSendAttemptIds({
            given: sendIds,
            stored: queuedMessage.sendIds,
            fromPanel: queuedMessage.fromPanel === true,
            mint: () => ({ commandId: newCommandId(), messageId: newMessageId() }),
          });
    // A queued send that did not go goes back to the head of the queue: unheld
    // where it failed for a moment, for the drain to send again; held with its
    // reason where it was refused, which its bubble says — never the banner.
    // The messages behind it keep their order and wait; the composer is not
    // touched. The person retries from the bubble or edits with Cancel.
    const abortQueuedReplay = (
      failure: QueuedSendFailure,
      message: QueuedComposerMessage | undefined = queuedMessage,
    ) => {
      if (!message || !activeThreadKey) return;
      settleQueuedSend(activeThreadKey, null);
      const outcome = queuedSendOutcome(failure, message.retries ?? 0);
      const store = useQueuedMessageStore.getState();
      if (outcome.action === "requeue") {
        store.requeueAtFront(
          activeThreadKey,
          attemptIds === undefined ? message : { ...message, sendIds: attemptIds },
        );
      } else store.holdAtFront(activeThreadKey, message, outcome.reason);
    };
    // A live send that failed goes back into the composer, unless the user
    // has started writing something else there in the meantime.
    const composerLeftEmpty = () =>
      promptRef.current.length === 0 &&
      composerImagesRef.current.length === 0 &&
      (useComposerDraftStore.getState().getComposerDraft(composerDraftTarget)?.files.length ??
        0) === 0 &&
      composerTerminalContextsRef.current.length === 0 &&
      (useComposerDraftStore.getState().getComposerDraft(composerDraftTarget)?.reviewComments
        .length ?? 0) === 0;
    const restoreSentToComposer = () => {
      promptRef.current = promptForSend;
      const retryComposerImages = composerImagesSnapshot.map(cloneComposerImageForRetry);
      composerImagesRef.current = retryComposerImages;
      composerTerminalContextsRef.current = composerTerminalContextsSnapshot;
      setComposerDraftPrompt(composerDraftTarget, promptForSend);
      addComposerDraftImages(composerDraftTarget, retryComposerImages);
      useComposerDraftStore.getState().syncFiles(
        composerDraftTarget,
        composerFilesSnapshot.map((file) => file.id),
        composerFilesSnapshot,
      );
      setComposerDraftTerminalContexts(composerDraftTarget, composerTerminalContextsSnapshot);
      setComposerDraftReviewComments(composerDraftTarget, composerReviewCommentsSnapshot);
      composerRef.current?.resetCursorState({
        cursor: collapseExpandedComposerCursor(promptForSend, promptForSend.length),
        prompt: promptForSend,
        detectTrigger: true,
      });
    };
    if (
      supportsAttachmentUploads &&
      (composerImagesSnapshot.length > 0 || composerFilesSnapshot.length > 0)
    ) {
      for (const image of composerImagesSnapshot) {
        startAttachmentUpload({ environmentId, image });
      }
      for (const file of composerFilesSnapshot) {
        startFileUpload({ environmentId, file });
      }
      await awaitAttachmentUploads([
        ...composerImagesSnapshot.map((image) => image.id),
        ...composerFilesSnapshot.map((file) => file.id),
      ]);
      const step = sendStepAfterUploads({
        uploaded: getUploadedAttachments({
          environmentId,
          images: composerImagesSnapshot,
          files: composerFilesSnapshot,
        }),
        queued: queuedMessage !== undefined,
      });
      if (step.action !== "send") {
        sendInFlightRef.current = false;
        if (step.action === "abort-queued") abortQueuedReplay(step.failure);
        else setThreadError(threadIdForSend, step.message);
        return "declined";
      }
    }
    if (
      queuedMessage &&
      activeThreadKey &&
      drainGenerationOf(activeThreadKey) !== drainGenerationAtTake
    ) {
      sendInFlightRef.current = false;
      settleQueuedSend(activeThreadKey, null);
      restoreQueuedMessagesToComposer([queuedMessage]);
      return "declined";
    }

    // A crewmate's chat never starts a turn of its own (`crewComposerSend.ts`):
    // the crew engine opens the task, admits the turn against the crewmate's
    // login and writes the message into this thread. So no title, no turn
    // settings — the crewmate's *Runs on* owns model and effort — and no
    // optimistic row, which only a turn's message id could reconcile.
    const crewAttachments = getUploadedAttachments({
      environmentId,
      images: composerImagesSnapshot,
      files: composerFilesSnapshot,
    });
    const crewMessage = crewMessageCommand(activeThreadShell, {
      text: messageTextForSend || IMAGE_ONLY_BOOTSTRAP_PROMPT,
      attachments: crewAttachments ?? [],
    });
    if (crewMessage !== null) {
      const step = sendStepAfterUploads({
        uploaded: crewAttachments,
        queued: queuedMessage !== undefined,
      });
      if (step.action !== "send") {
        sendInFlightRef.current = false;
        if (step.action === "abort-queued") abortQueuedReplay(step.failure);
        else setThreadError(threadIdForSend, step.message);
        return "declined";
      }
      setThreadError(threadIdForSend, null);
      if (!queuedMessage) {
        promptRef.current = "";
        clearComposerDraftContent(composerDraftTarget);
        composerRef.current?.resetCursorState();
      }
      const crewResult = await sendCrewCommand({ environmentId, input: crewMessage });
      if (crewResult._tag === "Success") {
        if (queuedMessage && activeThreadKey) settleQueuedSend(activeThreadKey, null);
        if (supportsAttachmentUploads) {
          releaseAttachmentUploads(composerImagesSnapshot);
          releaseAttachmentUploads(composerFilesSnapshot);
        }
      } else {
        if (queuedMessage) {
          abortQueuedReplay(
            isAtomCommandInterrupted(crewResult)
              ? { kind: "interrupted" }
              : { kind: "error", error: squashAtomCommandFailure(crewResult) },
          );
        } else if (composerLeftEmpty()) restoreSentToComposer();
        if (!queuedMessage && !isAtomCommandInterrupted(crewResult)) {
          setThreadError(
            threadIdForSend,
            crewFailureSentence(squashAtomCommandFailure(crewResult)),
          );
        }
      }
      sendInFlightRef.current = false;
      if (crewResult._tag !== "Success") return "declined";
      if (attemptIds !== undefined) tellSendOutcome(attemptIds.messageId, { kind: "sent" });
      return "sent";
    }

    const resolvedSubmissionIntent =
      submissionIntent === "background" && isLocalDraftThread ? "background" : "foreground";
    if (
      shouldDockDraftHeroForSubmission({
        isDraftHeroState,
        activeThreadKey,
        submissionIntent: resolvedSubmissionIntent,
      }) &&
      activeThreadKey
    ) {
      let resolveDockStarted: (() => void) | undefined;
      const dockStarted = new Promise<void>((resolve) => {
        resolveDockStarted = resolve;
      });
      const dockTransition = runMobileComposerTransition(() => {
        flushSync(() => {
          captureDraftHeroComposerRect();
          setDockedDraftHeroThreadKey(activeThreadKey);
        });
        resolveDockStarted?.();
      });
      void dockTransition.catch(() => resolveDockStarted?.());
      await dockStarted;
    }
    beginLocalDispatch({
      preparingWorktree: Boolean(baseBranchForWorktree),
      submissionIntent: resolvedSubmissionIntent,
    });

    const messageIdForSend = attemptIds?.messageId ?? newMessageId();
    const messageCreatedAt = new Date().toISOString();
    // Uploaded, the message carries its files first, then each image with its
    // kept original right after it; without uploads, its images as data.
    const turnAttachmentsPromise: Promise<
      ReadonlyArray<UploadChatAttachment | ContractChatAttachment>
    > = supportsAttachmentUploads
      ? Promise.resolve().then(() => {
          const uploaded = getUploadedAttachments({
            environmentId,
            images: composerImagesSnapshot,
            files: composerFilesSnapshot,
          });
          if (uploaded === null) {
            throw new Error("An attachment did not finish uploading.");
          }
          return uploaded;
        })
      : Promise.all(
          composerImagesSnapshot.map(async (image) => ({
            type: "image" as const,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            dataUrl: await readFileAsDataUrl(image.file),
          })),
        );
    const optimisticAttachments = [
      ...optimisticFileAttachments(composerFilesSnapshot),
      ...optimisticPictureAttachments(composerImagesSnapshot),
    ];
    const shouldAnchorFirstMessage =
      activeThread.latestTurn === null &&
      !timelineMessages.some((message) => message.role === "user");
    if (shouldAnchorFirstMessage) {
      isAtEndRef.current = true;
      timelineScrollModeRef.current = "anchoring-new-turn";
      liveFollowUserScrollGenerationRef.current = anchorUserScrollGenerationRef.current;
      setTimelineLiveFollowEnabled(true);
      pendingTimelineAnchorRef.current = messageIdForSend;
      activeTimelineAnchorIndexRef.current = null;
      showScrollDebouncer.current.cancel();
      setShowScrollToBottom(false);
      setTimelineAnchor({
        threadKey: scopedThreadKey(scopeThreadRef(activeThread.environmentId, threadIdForSend)),
        messageId: messageIdForSend,
      });
    } else if (
      // Only the person's own send pins the end; a queued message leaving by
      // itself leaves a reader above where they are.
      nextTimelineFollow(
        liveFollowUserScrollGenerationRef.current === anchorUserScrollGenerationRef.current,
        { type: "sent", byPerson: sentBy === "person" },
      )
    ) {
      scrollToEnd(false, sentBy === "person");
    }
    setOptimisticUserMessages((existing) => [
      ...existing,
      {
        id: messageIdForSend,
        role: "user",
        text: outgoingMessageText,
        ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
        turnId: null,
        createdAt: messageCreatedAt,
        updatedAt: messageCreatedAt,
        streaming: false,
      },
    ]);
    setThreadError(threadIdForSend, null);
    if (expiredTerminalContextCount > 0) {
      const toastCopy = buildExpiredTerminalContextToastCopy(
        expiredTerminalContextCount,
        "omitted",
      );
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: toastCopy.title,
          description: toastCopy.description,
        }),
      );
    }
    // The menu's row says what went until the conversation does (`sentAsk.ts`); a queued message
    // records the same operation here as when the root sender sends it.
    const sentAsk = turnSendAsk({
      trimmedPrompt: trimmed,
      messageId: messageIdForSend,
      threadId: threadIdForSend,
      at: messageCreatedAt,
      fromPanel: attemptIds?.fromPanel === true,
    });
    if (sentAsk !== null) sendTurnReceipts?.requested(environmentId, sentAsk);
    if (!queuedMessage) {
      promptRef.current = "";
      clearComposerDraftContent(composerDraftTarget);
      composerRef.current?.resetCursorState();
    }

    let firstComposerImageName: string | null = null;
    if (composerImagesSnapshot.length > 0) {
      const firstComposerImage = composerImagesSnapshot[0];
      if (firstComposerImage) {
        firstComposerImageName = firstComposerImage.name;
      }
    }
    // A slash command is an instruction to the harness, not the thread's
    // subject: the title waits for the first real ask.
    let titleSeed = isSlashCommand(trimmed) ? "" : trimmed;
    if (!titleSeed) {
      if (firstComposerImageName) {
        titleSeed = `Image: ${firstComposerImageName}`;
      } else if (composerFilesSnapshot[0]) {
        titleSeed = `File: ${composerFilesSnapshot[0].name}`;
      } else if (composerTerminalContextsSnapshot.length > 0) {
        titleSeed = formatTerminalContextLabel(composerTerminalContextsSnapshot[0]!);
      } else {
        titleSeed = "New thread";
      }
    }
    const title = truncate(titleSeed);
    const threadCreateModelSelection = createModelSelection(
      ctxSelectedModelSelection.instanceId,
      ctxSelectedModel || activeProjectDefaultModelSelection?.model || DEFAULT_MODEL,
      ctxSelectedModelSelection.options,
    );

    let turnStartAttempted = false;
    let failure: AtomCommandResult<unknown, unknown> | null = null;
    // Auto-title from the first message the person sends; a page's ask never names it.
    if (isFirstMessage && isServerThread && attemptIds?.fromPanel !== true) {
      const titleResult = await updateThreadMetadata({
        environmentId,
        input: {
          threadId: threadIdForSend,
          title,
        },
      });
      if (titleResult._tag === "Failure") {
        failure = titleResult;
      }
    }

    if (failure === null && isServerThread) {
      const settingsResult = await persistThreadSettingsForNextTurn({
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
        ...(ctxSelectedModel ? { modelSelection: ctxSelectedModelSelection } : {}),
        ...(localCheckoutBranchMismatch
          ? { branch: localCheckoutBranchMismatch.currentBranch }
          : {}),
        runtimeMode,
        interactionMode: sendInteractionMode,
      });
      if (settingsResult._tag === "Failure") {
        failure = settingsResult;
      }
    }

    const turnAttachmentsResult = await settlePromise(() => turnAttachmentsPromise);
    if (failure === null && turnAttachmentsResult._tag === "Failure") {
      failure = turnAttachmentsResult;
    }

    let turnStartSucceeded = false;
    if (failure === null && turnAttachmentsResult._tag === "Success") {
      const bootstrap =
        isLocalDraftThread || baseBranchForWorktree
          ? {
              ...(isLocalDraftThread
                ? {
                    createThread: {
                      projectId: activeProject.id,
                      title,
                      modelSelection: threadCreateModelSelection,
                      runtimeMode,
                      interactionMode: sendInteractionMode,
                      branch: activeThreadBranch,
                      worktreePath: activeThread.worktreePath,
                      createdAt: activeThread.createdAt,
                    },
                  }
                : {}),
              ...(baseBranchForWorktree
                ? {
                    prepareWorktree: {
                      projectCwd: activeProject.workspaceRoot,
                      baseBranch: baseBranchForWorktree,
                      branch: buildTemporaryWorktreeBranchName(randomHex),
                      ...(startFromOrigin ? { startFromOrigin: true } : {}),
                    },
                    runSetupScript: true,
                  }
                : {}),
            }
          : undefined;
      beginLocalDispatch({ preparingWorktree: false });
      const backgroundThreadRef =
        resolvedSubmissionIntent === "background"
          ? scopeThreadRef(activeThread.environmentId, threadIdForSend)
          : null;
      if (backgroundThreadRef) {
        beginBackgroundDraftSubmissionByRef(backgroundThreadRef);
      }
      const turnAgentNotes = agentNotesFor(
        outgoingMessageText,
        queuedMessage ? (queuedMessage.agentNotes ?? []) : agentNotes,
      );
      const toldVault =
        turnAgentNotes.length > 0
          ? queuedMessage
            ? (queuedMessage.vaultChanges ?? [])
            : turnContext.vaultChanges
          : [];
      turnStartAttempted = true;
      if (queuedMessage && activeThreadKey) {
        settleQueuedSend(activeThreadKey, createLocalDispatchSnapshot(activeThread));
      }
      const startResult = await startThreadTurn({
        environmentId,
        input: {
          ...(attemptIds === undefined ? {} : { commandId: attemptIds.commandId }),
          threadId: threadIdForSend,
          message: {
            messageId: messageIdForSend,
            role: "user",
            text: outgoingMessageText,
            attachments: turnAttachmentsResult.value,
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: title,
          // What the Mate has not been told, placed in front of the text for
          // the provider only: the stored message stays what was typed. A
          // slash command carries none.
          ...(turnAgentNotes.length > 0 ? { agentNotes: turnAgentNotes } : {}),
          runtimeMode,
          interactionMode: sendInteractionMode,
          ...(bootstrap ? { bootstrap } : {}),
          // A page's ask never names the conversation (`ComposerSendIds.fromPanel`).
          ...(attemptIds?.fromPanel === true ? { fromPanel: true as const } : {}),
          createdAt: messageCreatedAt,
        },
      });
      if (startResult._tag === "Failure") {
        if (backgroundThreadRef) {
          clearBackgroundDraftSubmissionByRef(backgroundThreadRef);
        }
        failure = startResult;
      } else {
        turnStartSucceeded = true;
        vaultTurn.told(toldVault);
        // The turn is under way and will spend quota, so that thread's limits
        // snapshot is stale. Uploads may have outlasted a navigation, so only
        // the sending thread's panel clears.
        clearUsageLimitsFor(routeThreadKey);
        if (supportsAttachmentUploads) {
          releaseAttachmentUploads(composerImagesSnapshot);
          releaseAttachmentUploads(composerFilesSnapshot);
        }
        if (backgroundThreadRef) {
          markPromotedDraftThreadByRef(backgroundThreadRef);
          try {
            const nextDraft = await handleNewThread(
              scopeProjectRef(activeProject.environmentId, activeProject.id),
              resolveBackgroundDraftWorkspaceOptions({
                envMode: sendEnvMode,
                branch: activeThreadBranch,
                startFromOrigin,
              }),
            );
            if (nextDraft) {
              finalizePromotedDraftThreadByRef(backgroundThreadRef);
              toastManager.add(
                stackedThreadToast({
                  type: "success",
                  title: "Started in background",
                  timeout: 5_000,
                  actionProps: {
                    children: "Open",
                    onClick: () => {
                      void navigate({
                        to: "/$environmentId/$threadId",
                        params: buildThreadRouteParams(backgroundThreadRef),
                      });
                    },
                  },
                }),
              );
            } else {
              clearBackgroundDraftSubmissionByRef(backgroundThreadRef);
            }
          } catch (error) {
            clearBackgroundDraftSubmissionByRef(backgroundThreadRef);
            resetLocalDispatch();
            toastManager.add(
              stackedThreadToast({
                type: "warning",
                title: "Task started in the background",
                description:
                  error instanceof Error
                    ? `Could not open a fresh composer: ${error.message}`
                    : "Could not open a fresh composer.",
              }),
            );
          }
        }
      }
    }

    if (failure === null && turnStartSucceeded) {
      sendTurnReceipts?.accepted(environmentId, messageIdForSend);
      // A queued request's asker hears here, as its message leaves the queue with its turn.
      tellSendOutcome(messageIdForSend, { kind: "sent" });
      if (engineConversation) sentHereRef.current.add(messageIdForSend);
    }
    if (failure !== null) {
      sendTurnReceipts?.failed(environmentId, messageIdForSend, turnStartAttempted);
      if (queuedMessage) {
        setOptimisticUserMessages((existing) => {
          const removed = existing.filter((message) => message.id === messageIdForSend);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        });
        // The optimistic row's preview URLs were just revoked, so the images
        // need fresh ones before the row can show them again.
        abortQueuedReplay(
          isAtomCommandInterrupted(failure)
            ? { kind: "interrupted" }
            : { kind: "error", error: squashAtomCommandFailure(failure) },
          { ...queuedMessage, images: queuedMessage.images.map(cloneComposerImageForRetry) },
        );
      } else if (composerLeftEmpty()) {
        setOptimisticUserMessages((existing) => {
          const removed = existing.filter((message) => message.id === messageIdForSend);
          for (const message of removed) {
            revokeUserMessagePreviewUrls(message);
          }
          const next = existing.filter((message) => message.id !== messageIdForSend);
          return next.length === existing.length ? existing : next;
        });
        restoreSentToComposer();
      }
      // A queued send's reason is its bubble's to say (`abortQueuedReplay`).
      if (!queuedMessage && !isAtomCommandInterrupted(failure)) {
        const error = squashAtomCommandFailure(failure);
        if (isLocalDraftThread && draftId && wasBootstrapThreadDeleted(error)) {
          const failedDraftSession = getDraftSession(draftId);
          if (failedDraftSession?.threadId === threadIdForSend) {
            setLogicalProjectDraftThreadId(
              failedDraftSession.logicalProjectKey,
              scopeProjectRef(failedDraftSession.environmentId, failedDraftSession.projectId),
              draftId,
              {
                threadId: newThreadId(),
                createdAt: new Date().toISOString(),
              },
            );
          }
        }
        setThreadError(
          threadIdForSend,
          error instanceof Error ? error.message : "Failed to send message.",
          isDispatchCommandError(error) ? error.agentAdmission : undefined,
        );
      }
    }
    sendInFlightRef.current = false;
    // A queued send that ended without its turn leaves nothing in flight for the next to wait on.
    if (queuedMessage && activeThreadKey && !turnStartSucceeded) {
      settleQueuedSend(activeThreadKey, null);
    }
    if (!turnStartSucceeded) {
      setDockedDraftHeroThreadKey((currentThreadKey) =>
        currentThreadKey === activeThreadKey ? null : currentThreadKey,
      );
      resetLocalDispatch();
    }
    return turnStartSucceeded ? "sent" : "declined";
  };
  // Sends the oldest queued message once it is due: a tool call finished
  // after it was queued, or the turn ended. Only one leaves per boundary; the
  // take inside onSend re-anchors the rest.
  const sendQueuedMessage = useEffectEvent((message: QueuedComposerMessage) => {
    void onSend(undefined, message.submissionIntent, message, undefined, "queue");
  });
  const nextQueuedMessage = queuedMessages[0] ?? null;
  const latestToolActivityId = useMemo(
    () => (nextQueuedMessage ? latestCompletedToolActivityId(threadActivities) : null),
    [nextQueuedMessage, threadActivities],
  );
  // Approvals and questions block the agent; a steer landing on top of them
  // would answer nothing and confuse the turn, so the queue holds until the
  // user resolves them.
  const queueBlockedByPendingRequest =
    activePendingApproval !== null || pendingUserInputs.length > 0;
  // The open conversation sends its own queue; the root sender sends the others'
  // (`QueuedMessageSender`). A send in flight from either is waited for here.
  useEffect(
    () =>
      activeThreadKey ? useQueuedMessageStore.getState().holdOpen(activeThreadKey) : undefined,
    [activeThreadKey],
  );
  const queuedSendInFlight = useQueuedMessageStore((state) =>
    activeThreadKey ? state.queuedSendByThreadKey[activeThreadKey] : undefined,
  );
  const queuedSendInFlightAwaitsServer = queuedSendAwaitsServer({
    send: queuedSendInFlight,
    thread: activeThread ?? null,
    phase,
    pendingRequest: queueBlockedByPendingRequest,
  });
  // onSend bails early on transient gates (environment offline, checkpoint
  // rewinding, messages loading, no provider yet, zerops D6 block) and
  // leaves the message queued. Re-run when any of them clear so a due
  // message does not wait for an unrelated phase change.
  const queueSendGate =
    queuedSendInFlightAwaitsServer ||
    activeEnvironmentUnavailable ||
    threadDetailLoading ||
    activeProviderStatus === null ||
    !admission.canSend;
  useEffect(() => {
    if (!nextQueuedMessage || isSendBusy || queueBlockedByPendingRequest || queueSendGate) return;
    if (sendInFlightRef.current) return;
    if (!isQueuedMessageDue({ message: nextQueuedMessage, phase, latestToolActivityId })) return;
    sendQueuedMessage(nextQueuedMessage);
  }, [
    isSendBusy,
    latestToolActivityId,
    nextQueuedMessage,
    phase,
    queueBlockedByPendingRequest,
    queueSendGate,
  ]);

  // The row handlers are read from refs at call-time so their identity stays
  // stable and does not bust the timeline's row context on every render.
  const queuedMessageActionsRef = useRef({
    steer: (_id: string) => {},
    remove: (_id: string) => {},
  });
  queuedMessageActionsRef.current = {
    steer: (id) => {
      const message = queuedMessages.find((entry) => entry.id === id);
      if (!message || sendInFlightRef.current || queueBlockedByPendingRequest) return;
      // Retry on a held send: its hold goes first, so a gate that turns it back
      // leaves it for the drain rather than held again with nothing to say.
      const released =
        message.holdUntilUserAction && activeThreadKey
          ? (useQueuedMessageStore.getState().release(activeThreadKey, id) ?? message)
          : message;
      void onSend(undefined, released.submissionIntent, released);
    },
    remove: (id) => {
      if (!activeThreadKey) return;
      const message = useQueuedMessageStore.getState().remove(activeThreadKey, id);
      if (message) restoreQueuedMessagesToComposer([message]);
    },
  };
  const onSteerQueuedMessage = useCallback((id: string) => {
    queuedMessageActionsRef.current.steer(id);
  }, []);
  const onRemoveQueuedMessage = useCallback((id: string) => {
    queuedMessageActionsRef.current.remove(id);
  }, []);

  // Starting over in one of a Mate's chats: the chat is archived — it leaves
  // the strip and stays readable under Archived — and a fresh thread in the
  // same project takes its place (archived threads never rank as primary);
  // in place of the main chat it takes the pin at its first send. Blocked
  // while a turn is running, the same as archiving from the sidebar.
  const startFreshConversation = async () => {
    if (!activeThreadRef) return;
    const result = await archiveThread(activeThreadRef, {
      toast: { title: "Started fresh", description: "The last conversation is under Archived." },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      const blocked = isThreadArchiveBlockedError(error);
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: blocked ? "Stop the agent before starting fresh" : "Couldn't start fresh",
          description: blocked ? undefined : String(error),
        }),
      );
    }
  };

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      if (!activeThreadId) return;

      setRespondingRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      const result = await respondToThreadApproval({
        environmentId,
        input: {
          threadId: activeThreadId,
          requestId,
          decision,
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : "Failed to submit approval decision.",
        );
      }
      setRespondingRequestIds((existing) => existing.filter((id) => id !== requestId));
      return result;
    },
    [activeThreadId, environmentId, respondToThreadApproval, setThreadError],
  );

  const onRespondToUserInput = useCallback(
    async (requestId: ApprovalRequestId, answers: Record<string, unknown>) => {
      if (!activeThreadId) return;

      const attachmentsByQuestionId = questionAttachments.forResponse();
      if (attachmentsByQuestionId === null) return;
      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      const result = await respondToThreadUserInput({
        environmentId,
        input: {
          threadId: activeThreadId,
          requestId,
          answers,
          attachmentsByQuestionId,
        },
      });
      if (result._tag === "Success") questionAttachments.clear();
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : "Failed to submit user input.",
        );
      }
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
      return result;
    },
    [activeThreadId, environmentId, respondToThreadUserInput, setThreadError, questionAttachments],
  );

  // Closes an async question without messaging the agent. The server records
  // the dismissal so every client releases the composer.
  const onDismissUserInput = useCallback(
    async (requestId: ApprovalRequestId) => {
      if (!activeThreadId) return;

      setRespondingUserInputRequestIds((existing) =>
        existing.includes(requestId) ? existing : [...existing, requestId],
      );
      const result = await dismissThreadUserInput({
        environmentId,
        input: { threadId: activeThreadId, requestId },
      });
      if (result._tag === "Success") questionAttachments.clear();
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThreadId,
          error instanceof Error ? error.message : "Failed to dismiss the question.",
        );
      }
      setRespondingUserInputRequestIds((existing) => existing.filter((id) => id !== requestId));
      return result;
    },
    [activeThreadId, dismissThreadUserInput, environmentId, setThreadError, questionAttachments],
  );

  const setActivePendingUserInputQuestionIndex = useCallback(
    (nextQuestionIndex: number) => {
      if (!activePendingUserInput) {
        return;
      }
      setPendingUserInputQuestionIndexByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: nextQuestionIndex,
      }));
    },
    [activePendingUserInput],
  );

  const onSelectActivePendingUserInputOption = useCallback(
    (questionId: string, optionValue: string) => {
      if (!activePendingUserInput) {
        return;
      }
      // The option replaces the custom answer. Anything typed there is the
      // user's text, so it goes back to the thread draft instead of vanishing.
      const displacedAnswer =
        pendingUserInputAnswersByRequestId[activePendingUserInput.requestId]?.[questionId]
          ?.customAnswer;
      const currentPrompt =
        useComposerDraftStore.getState().getComposerDraft(composerDraftTarget)?.prompt ?? "";
      const nextPrompt = carryDisplacedCustomAnswerIntoPrompt(currentPrompt, displacedAnswer);
      if (nextPrompt !== currentPrompt) {
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
      }
      setPendingUserInputAnswersByRequestId((existing) => {
        const question =
          (activePendingProgress?.activeQuestion?.id === questionId
            ? activePendingProgress.activeQuestion
            : undefined) ??
          activePendingUserInput.questions.find((entry) => entry.id === questionId);
        if (!question) {
          return existing;
        }

        return {
          ...existing,
          [activePendingUserInput.requestId]: {
            ...existing[activePendingUserInput.requestId],
            [questionId]: togglePendingUserInputOptionSelection(
              question,
              existing[activePendingUserInput.requestId]?.[questionId],
              optionValue,
            ),
          },
        };
      });
      promptRef.current = "";
      composerRef.current?.resetCursorState({ cursor: 0 });
    },
    [
      activePendingProgress?.activeQuestion,
      activePendingUserInput,
      composerDraftTarget,
      composerRef,
      pendingUserInputAnswersByRequestId,
      setComposerDraftPrompt,
    ],
  );

  const onChangeActivePendingUserInputCustomAnswer = useCallback(
    (
      questionId: string,
      value: string,
      nextCursor: number,
      expandedCursor: number,
      _cursorAdjacentToMention: boolean,
    ) => {
      if (!activePendingUserInput) {
        return;
      }
      const question = activePendingUserInput.questions.find((entry) => entry.id === questionId);
      if (!question || question.allowCustomAnswer === false) {
        return;
      }
      promptRef.current = value;
      setPendingUserInputAnswersByRequestId((existing) => ({
        ...existing,
        [activePendingUserInput.requestId]: {
          ...existing[activePendingUserInput.requestId],
          [questionId]: setPendingUserInputCustomAnswer(
            existing[activePendingUserInput.requestId]?.[questionId],
            value,
          ),
        },
      }));
      const snapshot = composerRef.current?.readSnapshot();
      if (
        snapshot?.value !== value ||
        snapshot.cursor !== nextCursor ||
        snapshot.expandedCursor !== expandedCursor
      ) {
        composerRef.current?.focusAt(nextCursor);
      }
    },
    [activePendingUserInput, composerRef],
  );

  const onAdvanceActivePendingUserInput = useCallback(() => {
    if (!activePendingUserInput || !activePendingProgress) {
      return;
    }
    if (activePendingProgress.isLastQuestion) {
      if (activePendingResolvedAnswers) {
        void onRespondToUserInput(activePendingUserInput.requestId, activePendingResolvedAnswers);
      }
      return;
    }
    setActivePendingUserInputQuestionIndex(activePendingProgress.questionIndex + 1);
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingUserInput,
    onRespondToUserInput,
    setActivePendingUserInputQuestionIndex,
  ]);

  const onPreviousActivePendingUserInputQuestion = useCallback(() => {
    if (!activePendingProgress) {
      return;
    }
    setActivePendingUserInputQuestionIndex(Math.max(activePendingProgress.questionIndex - 1, 0));
  }, [activePendingProgress, setActivePendingUserInputQuestionIndex]);

  const onSubmitPlanFollowUp = useCallback(
    async ({
      text,
      interactionMode: nextInteractionMode,
    }: {
      text: string;
      interactionMode: "default" | "plan";
    }): Promise<boolean> => {
      if (
        !activeThread ||
        !isServerThread ||
        isSendBusy ||
        isConnecting ||
        sendInFlightRef.current
      ) {
        return false;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return false;
      }

      const sendCtx = composerRef.current?.getSendContext();
      if (!sendCtx?.providerAvailable || !sendCtx.interactionModeEnabled) {
        return false;
      }
      const {
        selectedProvider: ctxSelectedProvider,
        selectedModel: ctxSelectedModel,
        selectedProviderModels: ctxSelectedProviderModels,
        selectedPromptEffort: ctxSelectedPromptEffort,
        selectedModelSelection: ctxSelectedModelSelection,
      } = sendCtx;

      const threadIdForSend = activeThread.id;
      const messageIdForSend = newMessageId();
      const messageCreatedAt = new Date().toISOString();
      const outgoingMessageText = formatOutgoingPrompt({
        provider: ctxSelectedProvider,
        model: ctxSelectedModel,
        models: ctxSelectedProviderModels,
        effort: ctxSelectedPromptEffort,
        text: trimmed,
      });

      sendInFlightRef.current = true;
      beginLocalDispatch({ preparingWorktree: false });
      setThreadError(threadIdForSend, null);

      scrollToEnd(false, true);

      setOptimisticUserMessages((existing) => [
        ...existing,
        {
          id: messageIdForSend,
          role: "user",
          text: outgoingMessageText,
          turnId: null,
          createdAt: messageCreatedAt,
          updatedAt: messageCreatedAt,
          streaming: false,
        },
      ]);

      const settingsResult = await persistThreadSettingsForNextTurn({
        threadId: threadIdForSend,
        createdAt: messageCreatedAt,
        modelSelection: ctxSelectedModelSelection,
        ...(localCheckoutBranchMismatch
          ? { branch: localCheckoutBranchMismatch.currentBranch }
          : {}),
        runtimeMode,
        interactionMode: nextInteractionMode,
      });
      let failure: AtomCommandResult<unknown, unknown> | null =
        settingsResult._tag === "Failure" ? settingsResult : null;

      if (failure === null) {
        // Keep the mode toggle and plan-follow-up banner in sync immediately
        // while the same-thread implementation turn is starting.
        setComposerDraftInteractionMode(
          scopeThreadRef(activeThread.environmentId, threadIdForSend),
          nextInteractionMode,
        );

        const startResult = await startThreadTurn({
          environmentId,
          input: {
            threadId: threadIdForSend,
            message: {
              messageId: messageIdForSend,
              role: "user",
              text: outgoingMessageText,
              attachments: [],
            },
            modelSelection: ctxSelectedModelSelection,
            titleSeed: activeThread.title,
            runtimeMode,
            interactionMode: nextInteractionMode,
            ...(nextInteractionMode === "default" && activeProposedPlan
              ? {
                  sourceProposedPlan: {
                    threadId: activeThread.id,
                    planId: activeProposedPlan.id,
                  },
                }
              : {}),
            createdAt: messageCreatedAt,
          },
        });
        failure = startResult._tag === "Failure" ? startResult : null;
      }

      if (failure === null) {
        clearUsageLimitsFor(routeThreadKey);
        sendInFlightRef.current = false;
        return true;
      }

      setOptimisticUserMessages((existing) =>
        existing.filter((message) => message.id !== messageIdForSend),
      );
      if (!isAtomCommandInterrupted(failure)) {
        const error = squashAtomCommandFailure(failure);
        setThreadError(
          threadIdForSend,
          error instanceof Error ? error.message : "Failed to send plan follow-up.",
        );
      }
      sendInFlightRef.current = false;
      resetLocalDispatch();
      return false;
    },
    [
      activeThread,
      activeProposedPlan,
      beginLocalDispatch,
      isConnecting,
      isSendBusy,
      isServerThread,
      localCheckoutBranchMismatch,
      persistThreadSettingsForNextTurn,
      resetLocalDispatch,
      runtimeMode,
      scrollToEnd,
      setComposerDraftInteractionMode,
      setThreadError,
      startThreadTurn,
      environmentId,
      composerRef,
      clearUsageLimitsFor,
      routeThreadKey,
    ],
  );

  const onImplementPlanInNewThread = useCallback(async () => {
    if (
      !activeThread ||
      !activeProject ||
      !activeProposedPlan ||
      !isServerThread ||
      isSendBusy ||
      isConnecting ||
      activeEnvironmentUnavailable ||
      sendInFlightRef.current
    ) {
      return;
    }

    const sendCtx = composerRef.current?.getSendContext();
    if (!sendCtx?.providerAvailable || !sendCtx.interactionModeEnabled) {
      return;
    }
    const {
      selectedProvider: ctxSelectedProvider,
      selectedModel: ctxSelectedModel,
      selectedProviderModels: ctxSelectedProviderModels,
      selectedPromptEffort: ctxSelectedPromptEffort,
      selectedModelSelection: ctxSelectedModelSelection,
    } = sendCtx;

    const createdAt = new Date().toISOString();
    const nextThreadId = newThreadId();
    const planMarkdown = activeProposedPlan.planMarkdown;
    const implementationPrompt = buildPlanImplementationPrompt(planMarkdown);
    const outgoingImplementationPrompt = formatOutgoingPrompt({
      provider: ctxSelectedProvider,
      model: ctxSelectedModel,
      models: ctxSelectedProviderModels,
      effort: ctxSelectedPromptEffort,
      text: implementationPrompt,
    });
    if (composerRef.current?.validateProviderInput(outgoingImplementationPrompt) === false) {
      return;
    }
    const nextThreadTitle = truncate(buildPlanImplementationThreadTitle(planMarkdown));
    const nextThreadModelSelection: ModelSelection = ctxSelectedModelSelection;

    sendInFlightRef.current = true;
    beginLocalDispatch({ preparingWorktree: false });
    const finish = () => {
      sendInFlightRef.current = false;
      resetLocalDispatch();
    };

    const createResult = await createThread({
      environmentId,
      input: {
        threadId: nextThreadId,
        projectId: activeProject.id,
        title: nextThreadTitle,
        modelSelection: nextThreadModelSelection,
        runtimeMode,
        interactionMode: "default",
        branch: activeThreadBranch,
        worktreePath: activeThread.worktreePath,
        createdAt,
      },
    });
    let failure: AtomCommandResult<unknown, unknown> | null =
      createResult._tag === "Failure" ? createResult : null;

    if (failure === null) {
      const startResult = await startThreadTurn({
        environmentId,
        input: {
          threadId: nextThreadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: outgoingImplementationPrompt,
            attachments: [],
          },
          modelSelection: ctxSelectedModelSelection,
          titleSeed: nextThreadTitle,
          runtimeMode,
          interactionMode: "default",
          sourceProposedPlan: {
            threadId: activeThread.id,
            planId: activeProposedPlan.id,
          },
          createdAt,
        },
      });
      failure = startResult._tag === "Failure" ? startResult : null;
    }

    if (failure === null) {
      const startedResult = await settlePromise(() =>
        waitForStartedServerThread(scopeThreadRef(activeThread.environmentId, nextThreadId)),
      );
      failure = startedResult._tag === "Failure" ? startedResult : null;
    }

    if (failure === null) {
      const navigateResult = await settlePromise(() =>
        navigate({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: activeThread.environmentId,
            threadId: nextThreadId,
          },
        }),
      );
      failure = navigateResult._tag === "Failure" ? navigateResult : null;
    }

    if (failure !== null) {
      if (!isAtomCommandInterrupted(failure)) {
        const error = squashAtomCommandFailure(failure);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start implementation thread",
            description:
              error instanceof Error
                ? error.message
                : "An error occurred while creating the new thread.",
          }),
        );
      }
    }
    finish();
  }, [
    activeProject,
    activeProposedPlan,
    activeThreadBranch,
    activeThread,
    beginLocalDispatch,
    activeEnvironmentUnavailable,
    createThread,
    isConnecting,
    isSendBusy,
    isServerThread,
    navigate,
    resetLocalDispatch,
    runtimeMode,
    startThreadTurn,
    environmentId,
    composerRef,
  ]);

  const getModelDisabledReason = useCallback(
    (instanceId: ProviderInstanceId, model: string): string | null => {
      if (!activeThread) {
        return null;
      }
      const reason = getStartedThreadModelChangeBlockReason({
        providers: providerStatuses,
        hasStartedSession: activeThread.session !== null,
        currentModelSelection: activeThread.modelSelection,
        currentProviderInstanceId: activeThread.session?.providerInstanceId ?? null,
        nextModelSelection: { instanceId, model },
      });
      return reason ? `${reason.description} Start a new thread to use this model.` : null;
    },
    [activeThread, providerStatuses],
  );

  const onProviderModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      if (!activeThread) return;
      // Look up the configured instance so model normalization and custom
      // model lookup stay scoped to that exact instance. Unknown instance ids
      // are rejected by returning early; the server remains authoritative too.
      const entry = providerStatuses.find((snapshot) => snapshot.instanceId === instanceId);
      const resolvedDriverKind = entry?.driver ?? null;
      if (
        lockedProvider !== null &&
        resolvedDriverKind !== null &&
        resolvedDriverKind !== lockedProvider
      ) {
        scheduleComposerFocus();
        return;
      }
      if (lockedProvider !== null && activeThread.session?.providerInstanceId) {
        const currentEntry = providerStatuses.find(
          (snapshot) => snapshot.instanceId === activeThread.session?.providerInstanceId,
        );
        if (
          currentEntry?.continuation?.groupKey &&
          entry?.continuation?.groupKey &&
          currentEntry.continuation.groupKey !== entry.continuation.groupKey
        ) {
          scheduleComposerFocus();
          return;
        }
      }
      const resolvedModel = resolveAppModelSelectionForInstance(
        instanceId,
        settings,
        providerStatuses,
        model,
      );
      if (!resolvedModel) {
        scheduleComposerFocus();
        return;
      }
      const nextModelSelection: ModelSelection = {
        instanceId,
        model: resolvedModel,
      };
      const modelChangeBlockReason = getStartedThreadModelChangeBlockReason({
        providers: providerStatuses,
        hasStartedSession: activeThread.session !== null,
        currentModelSelection: activeThread.modelSelection,
        currentProviderInstanceId: activeThread.session?.providerInstanceId ?? null,
        nextModelSelection,
      });
      if (modelChangeBlockReason) {
        toastManager.add({
          type: "warning",
          title: modelChangeBlockReason.title,
          description: modelChangeBlockReason.description,
        });
        scheduleComposerFocus();
        return;
      }
      setComposerDraftModelSelection(
        scopeThreadRef(activeThread.environmentId, activeThread.id),
        nextModelSelection,
      );
      setStickyComposerModelSelection(nextModelSelection);
      scheduleComposerFocus();
    },
    [
      activeThread,
      lockedProvider,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
      providerStatuses,
      settings,
    ],
  );
  const onEnvModeChange = useCallback(
    (mode: DraftThreadEnvMode) => {
      if (canOverrideServerThreadEnvMode) {
        setPendingServerThreadEnvMode(mode);
        scheduleComposerFocus();
        return;
      }
      if (isLocalDraftThread) {
        setDraftThreadContext(composerDraftTarget, {
          envMode: mode,
          startFromOrigin: resolveNewDraftStartFromOrigin({
            envMode: mode,
            newWorktreesStartFromOrigin: primaryServerSettings.newWorktreesStartFromOrigin,
          }),
          ...(mode === "worktree" && draftThread?.worktreePath ? { worktreePath: null } : {}),
        });
      }
      scheduleComposerFocus();
    },
    [
      canOverrideServerThreadEnvMode,
      composerDraftTarget,
      draftThread?.worktreePath,
      isLocalDraftThread,
      primaryServerSettings.newWorktreesStartFromOrigin,
      setPendingServerThreadEnvMode,
      scheduleComposerFocus,
      setDraftThreadContext,
    ],
  );

  const onStartFromOriginChange = (nextStartFromOrigin: boolean) => {
    if (canOverrideServerThreadEnvMode && activeThread) {
      setPendingServerThreadStartFromOriginByThreadId((current) =>
        current[activeThread.id] === nextStartFromOrigin
          ? current
          : { ...current, [activeThread.id]: nextStartFromOrigin },
      );
      return;
    }
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        startFromOrigin: nextStartFromOrigin,
      });
    }
  };

  const onExpandTimelineImage = useCallback((preview: ExpandedImagePreview) => {
    setExpandedImage(preview);
  }, []);

  // Empty state: no active thread
  if (!activeThread) {
    return <NoActiveThreadState />;
  }

  const panelToggleControls = (
    <PanelLayoutControls
      terminalAvailable={activeProject !== null}
      terminalOpen={terminalUiState.terminalOpen}
      terminalShortcutLabel={shortcutLabelForCommand(keybindings, "terminal.toggle")}
      rightPanelAvailable={activeProject !== null}
      rightPanelOpen={rightPanelOpen}
      rightPanelShortcutLabel={shortcutLabelForCommand(keybindings, "rightPanel.toggle")}
      // Suppressed while the Agents surface is visible: the roster itself is
      // on screen, so the toggle badge would be pointing at nothing.
      liveAgentCount={
        rightPanelOpen && activeRightPanelSurface?.kind === "agents" ? 0 : agentPanelModel.liveCount
      }
      onToggleTerminal={toggleTerminalVisibility}
      onToggleRightPanel={toggleRightPanel}
    />
  );
  const panelLayoutControls = (
    <div
      className={cn(
        // One inset in both states: the controls move between containers when
        // the right panel opens, and a different right offset made them jump
        // sideways on every toggle.
        "absolute top-[var(--workspace-controls-top)] right-[var(--workspace-controls-right)] z-50 mr-px flex h-[var(--workspace-topbar-height)] items-center gap-1 [-webkit-app-region:no-drag]",
      )}
      data-workspace-titlebar-controls
    >
      {rightPanelOpen && !shouldUseRightPanelSheet ? (
        <RightPanelMaximizeControl
          maximized={rightPanelMaximized}
          onToggle={toggleRightPanelMaximized}
        />
      ) : null}
      {panelToggleControls}
    </div>
  );
  // A Chief's overview opens wide enough for two of its cards side by side, as its opening's
  // panel stood (`conversationPanelWidth`).
  const rightPanelDefaultWidth = conversationPanelWidth({
    chief: chiefConversation,
    surfaces: rightPanelState.surfaces,
  });
  const rightPanelAvailability = resolveRightPanelAvailability({
    projectOpen: activeProject !== null,
    gitRepo: isGitRepo,
    serverThread: isServerThread,
    zeropsPanel: zeropsChrome.panel,
    crewStatus: crew.status,
    chief: chiefConversation,
  });
  const onAddRightPanelSurface = (kind: Exclude<RightPanelKind, "file" | "terminal">): void => {
    switch (kind) {
      case "diff":
        addDiffSurface();
        return;
      case "files":
        addFilesSurface();
        return;
      case "agents":
        addAgentsSurface();
        return;
      case "zerops":
        addZeropsSurface();
        return;
      case "browser":
        addBrowserSurface();
        return;
      case "mac":
        addMacSurface();
        return;
      case "data":
        addDataSurface();
        return;
      case "git":
        addGitSurface();
        return;
      case "crew":
        addCrewSurface();
        return;
      case "mcp":
        addMcpSurface();
        return;
      case "vault":
        addVaultSurface();
        return;
      case "overview":
        addOverviewSurface();
        return;
    }
    kind satisfies never;
  };
  // A site's tab is the site alone, drawn by `ServiceBrowserPanels`: no page and no head over it.
  const rightPanelPageBody =
    activeThreadRef && activeRightPanelSurface && !isRightPanelSite(activeRightPanelSurface) ? (
      <Suspense fallback={<Loading label="The panel" shape="room" />}>
        {(() => {
          switch (activeRightPanelSurface.kind) {
            case "terminal":
              return (
                <PersistentThreadTerminalPanel
                  visible={rightPanelOpen}
                  threadRef={activeThreadRef}
                  surface={activeRightPanelSurface}
                  launchContext={activeTerminalLaunchContext ?? null}
                  focusRequestId={terminalFocusRequestId}
                  keybindings={keybindings}
                  onAddTerminalContext={addTerminalContextToDraft}
                  onSplitTerminal={splitPanelTerminal}
                  onSplitTerminalVertical={splitPanelTerminalVertical}
                  onNewTerminal={addTerminalSurface}
                  onActiveTerminalChange={activatePanelTerminal}
                  onCloseTerminal={closePanelTerminal}
                  splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
                  splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
                  newShortcutLabel={newTerminalShortcutLabel ?? undefined}
                  closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
                />
              );
            case "diff":
              return (
                <Suspense fallback={<Loading label="The changes" shape="room" />}>
                  <DiffPanel
                    key={activeThreadKey}
                    mode="embedded"
                    composerDraftTarget={composerDraftTarget}
                  />
                </Suspense>
              );
            case "agents":
              return (
                <AgentsPanel
                  model={agentPanelModel}
                  activities={threadActivities}
                  environmentId={activeThreadRef.environmentId}
                  threadId={activeThreadRef.threadId}
                />
              );
            case "zerops":
              return (
                <ZeropsPanel
                  visible={rightPanelOpen}
                  agentAuthCard={zeropsChrome.agentAuthCard}
                  agentAuthUnknown={zeropsChrome.agentAuthUnknown}
                  agentAuthSnapshot={zeropsAgentAuth.snapshot}
                  agentSignInDemanded={admission.attention !== null}
                  conversationAgentId={conversationAgentId}
                  runningToolLabel={zeropsThreadModel.running?.kicker}
                  threadRef={zeropsChrome.threadRef}
                />
              );
            case "browser":
              return <ZeropsBrowserSurface threadRef={zeropsChrome.threadRef} />;
            case "mac":
              return <ZeropsMacSurface threadRef={zeropsChrome.threadRef} />;
            case "data":
              // Every open Data tab stays mounted, the inactive ones hidden:
              // a switch between db and db2 keeps each tab's tree, selection,
              // sort and filters exactly where they were.
              return rightPanelState.surfaces
                .filter((surface) => surface.kind === "data")
                .map((surface) => {
                  const service = "service" in surface ? surface.service : undefined;
                  return (
                    <div
                      className="contents"
                      data-zerops-data-surface={surface.id}
                      hidden={surface.id !== activeRightPanelSurface.id}
                      key={`${zeropsChrome.threadRef?.environmentId}:${service ?? ""}`}
                    >
                      <RightPanelPageEdgeScope hidden={surface.id !== activeRightPanelSurface.id}>
                        <ZeropsDataPanel
                          maximized={rightPanelMaximized}
                          onAddContext={addTerminalContextToDraft}
                          onOpenService={openDataSurface}
                          onToggleMaximized={
                            canMaximizeRightPanel ? toggleRightPanelMaximized : undefined
                          }
                          service={service}
                          threadRef={zeropsChrome.threadRef}
                        />
                      </RightPanelPageEdgeScope>
                    </div>
                  );
                });
            case "git":
              return <ZeropsGitSurface threadRef={zeropsChrome.threadRef} />;
            case "crew":
              // One Mate's crew: another Mate's draws afresh, its sheets and drafts closed. A crew
              // closed to this viewer offers the conversation's one way out, its one dialog.
              return (
                <CrewPanel
                  key={activeThreadRef.environmentId}
                  onSignIn={zeropsSignInDialog.openFor}
                  threadRef={activeThreadRef}
                />
              );
            case "mcp":
              // Each dot is the conversation's own agent's state; a draft has no session to ask.
              return (
                <McpPanel
                  driver={selectedProvider}
                  environmentId={activeThreadRef.environmentId}
                  key={`${activeThreadRef.environmentId}|${activeThreadRef.threadId}`}
                  threadId={isServerThread ? activeThreadRef.threadId : undefined}
                />
              );
            case "vault":
              // One Mate's vault: another Mate's draws afresh, nothing open or half-typed carried over.
              return (
                <VaultPanelContainer
                  environmentId={activeThreadRef.environmentId}
                  key={activeThreadRef.environmentId}
                />
              );
            case "overview":
              // The organization's cards, the overview page itself, in the Chief's panel.
              return (
                <div className="h-full min-h-0 overflow-y-auto">
                  {/* Its cards' Mates wear their own faces, not the Chief's mark. */}
                  <MateFaceAsMark.Provider value={false}>
                    <ZeropsProjectsPage inPanel />
                  </MateFaceAsMark.Provider>
                </div>
              );
            case "change":
              return (
                <ZeropsChangeDetailPage
                  groupId={activeRightPanelSurface.groupId}
                  number={activeRightPanelSurface.number}
                  repository={activeRightPanelSurface.repository}
                />
              );
            case "files":
            case "file":
              if (!activeProject || !activeWorkspaceRoot) return null;
              return (
                <Suspense fallback={<Loading label="The files" shape="room" />}>
                  <FilePreviewPanel
                    key={`${activeProject.environmentId}:${activeWorkspaceRoot}`}
                    environmentId={activeProject.environmentId}
                    cwd={activeWorkspaceRoot}
                    projectName={activeProjectDisplayName ?? activeProject.title}
                    threadRef={activeThreadRef}
                    composerDraftTarget={composerDraftTarget}
                    keybindings={keybindings}
                    availableEditors={availableEditors}
                    relativePath={
                      activeRightPanelSurface.kind === "file"
                        ? activeRightPanelSurface.relativePath
                        : null
                    }
                    revealLine={activeFileSurface?.revealLine ?? null}
                    revealRequestId={activeFileSurface?.revealRequestId ?? 0}
                    onOpenFile={openFileSurface}
                    onPendingChange={handleFilePendingChange}
                  />
                </Suspense>
              );
          }
          const exhaustiveSurface: never = activeRightPanelSurface;
          return exhaustiveSurface;
        })()}
      </Suspense>
    ) : null;
  // Every page opens the same way, its head painted before the page itself has read anything.
  const rightPanelContent =
    rightPanelPageBody === null || activeRightPanelSurface === null ? null : (
      <RightPanelPage kind={activeRightPanelSurface.kind} mate={pageMateName}>
        {rightPanelPageBody}
      </RightPanelPage>
    );

  const workspaceFileDropHandlers = makeWorkspaceFileDropHandlers({
    setDragActive: setIsWorkspaceFileDragActive,
    addFiles: (files) => composerRef.current?.addDroppedFiles(files),
    // Every environment here is remote, so a local folder path means nothing
    // to the agent; the drop is refused instead of uploading an empty file.
    addFolders: () => {
      toastManager.add({
        type: "error",
        title: "Folders can't be dropped into remote environments",
        description: "Drop the files themselves instead.",
      });
    },
  });
  const externalComposerDrawerAttached =
    composerBannerItems.length > 0 ||
    Boolean(shownThreadSyncPhase && !activeEnvironmentUnavailable);

  /**
   * A change's address at HQ a Mate wrote into its conversation opens on the
   * change's own page here. Anything this account's HQ does not own is left
   * exactly as it was.
   */
  const resolveChangeLink = useOpenZeropsChange(activeThreadRef);

  return (
    <ServiceBrowserScope
      threadRef={activeThreadRef}
      services={zeropsTopology?.services}
      resolveAppLink={resolveChangeLink}
      className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background"
    >
      {rightPanelOpen && !shouldUseRightPanelSheet ? panelLayoutControls : null}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col overflow-x-hidden",
          rightPanelMaximized ? "w-0 flex-none" : "flex-1",
        )}
        data-chat-column-maximized-away={rightPanelMaximized ? "true" : "false"}
      >
        {/* Top bar */}
        <WorkspacePageHeader
          data-chat-header
          electron={isElectron}
          reserveNativeControls={reserveTitleBarControlInset && !inlineRightPanelOwnsTitleBar}
          className="relative bg-background"
        >
          {!rightPanelOpen ? panelLayoutControls : null}
          <ChatHeader
            activeThreadEnvironmentId={activeThread.environmentId}
            activeThreadId={activeThread.id}
            {...(routeKind === "draft" && draftId ? { draftId } : {})}
            activeThreadTitle={activeThread.title}
            activeThreadTask={activeThreadTask ?? undefined}
            conversationLoading={threadDetailLoading}
            isServerThread={isServerThread}
            activeProjectName={activeProjectDisplayName}
            activeProjectCwd={activeProject?.workspaceRoot ?? null}
            activeProjectFaviconPath={activeProject?.faviconPath ?? null}
            openInCwd={gitCwd}
            activeProjectScripts={activeProjectScripts}
            preferredScriptId={
              activeProject ? (lastInvokedScriptByProjectId[activeProject.id] ?? null) : null
            }
            keybindings={keybindings}
            availableEditors={availableEditors}
            rightPanelOpen={rightPanelOpen}
            gitCwd={gitCwd}
            onNewThreadInProject={handleNewThreadInActiveProject}
            onStartFresh={startFreshConversation}
            onEditCrewmateJob={editCrewmateJob}
            onEditBrief={editCrewGoal}
            {...(activeDraftLogicalProjectKey
              ? { onOpenProjectSettings: handleOpenDraftProjectSettings }
              : {})}
            onRunProjectScript={runProjectScript}
            onAddProjectScript={saveProjectScript}
            onUpdateProjectScript={updateProjectScript}
            onDeleteProjectScript={deleteProjectScript}
          />
        </WorkspacePageHeader>
        {zeropsSignInDialog.dialog}

        {/* Main content area with optional plan sidebar */}
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* Chat column */}
          <div
            className="relative flex min-h-0 min-w-0 flex-1 flex-col"
            data-chat-workspace-drop-target="true"
            onDragEnter={workspaceFileDropHandlers.onDragEnter}
            onDragOver={workspaceFileDropHandlers.onDragOver}
            onDragLeave={workspaceFileDropHandlers.onDragLeave}
            onDrop={workspaceFileDropHandlers.onDrop}
          >
            {isWorkspaceFileDragActive ? (
              <div
                className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-primary/[0.035]"
                data-chat-workspace-drop-overlay="true"
              >
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-full border border-primary/25 bg-background/95 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg"
                >
                  <PaperclipIcon className="size-4 text-primary" aria-hidden="true" />
                  Drop files to attach
                </div>
              </div>
            ) : null}
            {/* Messages Wrapper */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              {/* Messages — LegendList handles virtualization and scrolling
                  internally. A switch between Mates is at once: the list is
                  the next conversation's own from the press. One seen a
                  moment ago is kept, hidden, and shows its rows in place;
                  another's come in as they are placed. */}
              <KeptTimelines
                open={routeThreadKey}
                warm={warmTimelineAsk}
                insetMeasured={timelineInsetMeasured}
                insetRemembered={rememberedInset !== undefined}
                crewTimeline={crewTimeline}
                timeline={{
                  agentPanelModel,
                  onOpenAgents: addAgentsSurface,
                  working: dockModel,
                  afterTurnWork: activeBackgroundLiveness,
                  endNotice,
                  onDismissEndNotice: dismissEndNotice,
                  liveJobs,
                  isWorking,
                  workingStepLabel,
                  isCompacting,
                  originAsks,
                  isStopping,
                  activeTurnStartedAt: activeWorkStartedAt,
                  listRef: legendListRef,
                  timelineEntries: conversationEntries,
                  latestTurn: activeLatestTurn,
                  runningTurnId: activeRunningTurnId,
                  activeThreadEnvironmentId: activeThread.environmentId,
                  routeThreadKey,
                  arrivesFromItsDraft: draftArrival.fromItsDraft,
                  provider:
                    activeThread.session?.providerName ??
                    conversationProviderStatus?.driver ??
                    null,
                  ...(activeProject ? { onRunShellCommand: runShellCommand } : {}),
                  onImageExpand: onExpandTimelineImage,
                  markdownCwd: gitCwd ?? undefined,
                  resolvedTheme,
                  timestampFormat,
                  workspaceRoot: activeWorkspaceRoot,
                  skills: activeProviderStatus
                    ? resolveProviderSkillsForCwd(activeProviderStatus, gitCwd)
                    : EMPTY_PROVIDER_SKILLS,
                  anchorMessageId: timelineAnchorMessageId,
                  onAnchorReady: onTimelineAnchorReady,
                  contentInsetEndAdjustment: zeropsArrivalHoldsComposer ? 0 : timelineInsetEnd,
                  askRoomEnd: zeropsArrivalHoldsComposer ? 0 : composerAskRoom,
                  liveFollowEnabled: timelineLiveFollowEnabled,
                  onIsAtEndChange,
                  onPersonInput: onTimelinePersonInput,
                  onManualNavigation: cancelTimelineLiveFollowForUserNavigation,
                  cancelPositionRestoreRef,
                  hideEmptyPlaceholder:
                    isDraftHeroState ||
                    threadDetailLoading ||
                    conversationContentPending({
                      messageCount: activeThread?.messages.length ?? 0,
                      shell: activeThreadShell ?? null,
                    }),
                  loading: threadDetailLoading && !isDraftHeroState,
                  syncing: threadSyncPhase !== null || threadDetailLoading,
                  queuedMessages,
                  notices: noticesOverComposer ? EMPTY_CONVERSATION_NOTICES : conversationNotices,
                  usagePause: activeThreadShell?.usagePause ?? null,
                  limit,
                  away: mateAway,
                  interruption: activeServerThread?.session?.interruption ?? null,
                  onRestartContinue:
                    isWorking || isSendBusy || queueBlockedByPendingRequest || !admission.canSend
                      ? null
                      : (interruption) => {
                          const pending = activeServerThread?.session?.interruption;
                          if (
                            activeThreadKey === null ||
                            pending == null ||
                            pending.turnId !== interruption.turnId ||
                            pending.messageId !== interruption.messageId
                          )
                            return;
                          const message = useQueuedMessageStore
                            .getState()
                            .enqueue(activeThreadKey, {
                              prompt: "Continue the work that was interrupted by the restart.",
                              images: [],
                              terminalContexts: [],
                              reviewComments: [],
                              submissionIntent: "foreground",
                              queuedAfterToolActivityId: null,
                              createdAt: new Date().toISOString(),
                              holdUntilUserAction: true,
                            });
                          void onSend(undefined, "foreground", message);
                        },
                  onUsageContinue:
                    isWorking || isSendBusy || queueBlockedByPendingRequest
                      ? null
                      : () => {
                          if (activeThreadKey === null || activeThread === undefined) return;
                          // The engine tries the provider itself: the held message, else the
                          // limited work's resume. V1 continues by a message.
                          if (engineConversation) {
                            void continueAfterLimit({
                              environmentId: activeThread.environmentId,
                              input: { threadId: activeThread.id },
                            });
                            return;
                          }
                          const message = useQueuedMessageStore
                            .getState()
                            .enqueue(activeThreadKey, {
                              prompt: "Continue the work that was paused.",
                              images: [],
                              terminalContexts: [],
                              reviewComments: [],
                              submissionIntent: "foreground",
                              queuedAfterToolActivityId: null,
                              createdAt: new Date().toISOString(),
                              holdUntilUserAction: true,
                            });
                          void onSend(undefined, "foreground", message);
                        },
                  usageContinueTries: engineConversation,
                  onWithdrawHeldMessage: engineConversation ? onWithdrawHeldMessage : null,
                  onSteerQueuedMessage,
                  queueBlockedByAnswer: queueBlockedByPendingRequest,
                  steerQueuedMessageShortcutLabel: shortcutLabelForCommand(
                    keybindings,
                    "thread.steerQueuedMessage",
                    { context: { terminalFocus: false } },
                  ),
                  onRemoveQueuedMessage,
                  topFadeEnabled: true,
                  loadEarlier: loadEarlierTurns,
                }}
              />

              {/* The way back to the end, once the person has scrolled away from
                  it: a round button floating over the timeline, always drawn and
                  eased in and out, so it rises into place instead of popping. It
                  stands beside the conversation's column, never on its words
                  (Bodhi's audit), and at its right edge where there is no room. */}
              <div
                className="pointer-events-none absolute z-30 flex justify-center py-2"
                style={{
                  bottom: composerOverlayHeight + 4,
                  left: "min(calc(50% + 24rem + 0.75rem), calc(100% - 3rem))",
                }}
              >
                {/* Hidden, it is inert: out of the tab order and the tree the
                    reader hears, and a button still focused as it goes (a click
                    or a key focused it) lets the focus go with it. */}
                <button
                  aria-label="Scroll to end"
                  className="pointer-events-auto flex size-8 cursor-pointer items-center justify-center rounded-full border border-border/70 bg-popover text-foreground shadow-lg/8 transition-[opacity,translate,scale,background-color] duration-200 ease-out hover:bg-accent active:scale-95 not-data-shown:pointer-events-none not-data-shown:translate-y-1.5 not-data-shown:scale-96 not-data-shown:opacity-0"
                  data-shown={showScrollToBottom ? "" : undefined}
                  inert={!showScrollToBottom}
                  onClick={() => {
                    if (nextTimelineFollow(false, { type: "jump-to-latest" })) scrollToEnd(true);
                  }}
                  type="button"
                >
                  <ArrowDownIcon aria-hidden="true" className="size-4" />
                </button>
              </div>
            </div>

            {/* Input bar — centered hero while a draft has no messages, docked at the bottom otherwise */}
            <div
              ref={setComposerOverlayElement}
              data-conversation-footer=""
              data-chat-composer-overlay="true"
              data-chat-composer-hero={isDraftHeroState ? "true" : undefined}
              className={
                isDraftHeroState
                  ? "pointer-events-none absolute inset-0 z-20 flex items-center"
                  : "pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-6 sm:pt-7"
              }
            >
              <div
                ref={attachDraftHeroTransitionGroupRef}
                className="w-full ps-(--workspace-gutter-start) pe-(--workspace-gutter-end)"
              >
                <div className="pointer-events-auto relative z-10">
                  {isDraftHeroState ? (
                    <div className="absolute inset-x-0 bottom-full z-0">
                      <div
                        className="pb-4"
                        style={
                          forceExpandedMobileComposer
                            ? { viewTransitionName: MOBILE_DRAFT_HEADLINE_VIEW_TRANSITION_NAME }
                            : undefined
                        }
                      >
                        <DraftHeroHeadline
                          activeProjectRef={activeProjectRef}
                          activeProjectTitle={activeProjectDisplayName ?? null}
                        />
                      </div>
                      <NoticesOverComposer notices={conversationNotices} />
                      <ComposerBannerStack className="relative z-0" items={composerBannerItems} />
                    </div>
                  ) : (
                    <>
                      {noticesOverComposer ? (
                        // No conversation to hold them: they stand just above the composer, over
                        // the empty state, holding no room in the composer's frame.
                        <div className="pointer-events-auto absolute inset-x-0 bottom-full">
                          <NoticesOverComposer notices={conversationNotices} />
                        </div>
                      ) : null}
                      <ComposerBannerStack className="relative z-0" items={composerBannerItems} />
                      {/* The lead's plan waits above its composer, where its
                          answer ends (PRD §4.6). */}
                      {activeCrewmate?.crewmate.kind === "lead" &&
                      activeCrewmate.crewmate.currentThreadId === threadId ? (
                        <div className="mx-auto w-full max-w-3xl pb-2">
                          <CrewLeadPlan environmentId={environmentId} />
                        </div>
                      ) : null}
                    </>
                  )}
                  {shownThreadSyncPhase && !activeEnvironmentUnavailable ? (
                    <ThreadSyncStatusPill phase={shownThreadSyncPhase} />
                  ) : null}
                  <div
                    // While a new Mate's stand-up waits on this person, the conversation's one
                    // message is its headline: the composer keeps its place (it is what sends the
                    // stand-up) but is neither seen nor reached, and fades back once it has gone.
                    aria-hidden={zeropsArrivalHoldsComposer ? true : undefined}
                    className="relative"
                    data-standup-holds-composer={zeropsArrivalHoldsComposer ? "" : undefined}
                    inert={zeropsArrivalHoldsComposer}
                    style={
                      forceExpandedMobileComposer
                        ? { viewTransitionName: MOBILE_COMPOSER_VIEW_TRANSITION_NAME }
                        : undefined
                    }
                  >
                    <div
                      data-room-held={zeropsFooter === "held" ? "" : undefined}
                      data-slot="composer-shell"
                      className={cn(
                        "chat-composer-glass-shell relative mx-auto w-full max-w-3xl",
                        externalComposerDrawerAttached && "chat-composer-glass-shell-attached",
                        showComposerContextStrip &&
                          zeropsFooter !== "read-only" &&
                          "chat-composer-glass-shell-with-context",
                      )}
                    >
                      <div className="chat-composer-glass-host relative z-10 w-full">
                        <div ref={attachDraftHeroComposerAnchorRef} className="relative z-10">
                          <AgentAdmissionExplanation
                            attention={admissionPlacement.composer}
                            onAction={openAgentAuthDialog}
                          />
                          {zeropsFooter === "held" ? (
                            <ComposerRoomHeld draft={zeropsHeldDraft} />
                          ) : colleagueReadOnly !== null ? (
                            <ZeropsReadOnlyConversationFooter
                              change={threadDetailLoading ? null : composerTop}
                              environmentId={environmentId}
                              pendingApprovals={pendingApprovals}
                              pendingUserInputs={pendingUserInputs}
                              readOnly={colleagueReadOnly}
                            />
                          ) : composerPlace !== null ? (
                            <ComposerPlaceLine notice={composerPlace} />
                          ) : (
                            <ChatComposer
                              composerRef={composerRef}
                              composerDraftTarget={composerDraftTarget}
                              environmentId={environmentId}
                              attachmentUploadsCapabilityKnown={attachmentUploadsCapabilityKnown}
                              supportsAttachmentUploads={supportsAttachmentUploads}
                              routeKind={routeKind}
                              routeThreadRef={routeThreadRef}
                              draftId={draftId}
                              activeThreadId={activeThreadId}
                              activeThreadEnvironmentId={activeThread?.environmentId}
                              activeThread={activeThread}
                              activeThreadShell={routeServerThreadShell}
                              threadDetailLoading={threadDetailLoading}
                              promptHistoryMessages={timelineMessages}
                              isServerThread={isServerThread}
                              isLocalDraftThread={isLocalDraftThread}
                              forceExpandedOnMobile={
                                forceExpandedMobileComposer && isDraftHeroState
                              }
                              projectSelectionRequired={
                                isLocalDraftThread && activeProject === null
                              }
                              connectedPlaceholder={
                                crewComposerPlaceholder ?? composerPlaceholders.connected
                              }
                              idlePlaceholder={crewComposerPlaceholder ?? composerPlaceholders.idle}
                              mentionCrewmates={crewMentions}
                              top={threadDetailLoading ? null : (cloneTop ?? composerTop)}
                              vaultChanges={vaultTurn.changes}
                              onDismissVaultChange={vaultTurn.dismiss}
                              {...(crewRunsOnLabel === null || activeCrewmate === null
                                ? {}
                                : {
                                    crewRunsOn: {
                                      label: crewRunsOnLabel,
                                      onEdit: () => editCrewmateJob(activeCrewmate.crewmate.handle),
                                    },
                                  })}
                              phase={phase}
                              isConnecting={isConnecting}
                              // A session starting for the message just sent
                              // is the send still under way: the button keeps
                              // its spinner until the turn runs and it turns
                              // into Stop, never the arrow in between.
                              isSendBusy={isSendBusy || phase === "connecting"}
                              sendHint={alsoWorkingHint}
                              sendDisabledReason={
                                feedbackUploading
                                  ? "Sending feedback"
                                  : threadDetailLoading
                                    ? "Messages loading"
                                    : // Out of reach, the send says why in the Mate's own words.
                                      (mateAwayWords ?? cloneSendBlockReason(cloneShown))
                              }
                              zeropsSendBlockReason={zeropsSendBlockReason ?? null}
                              onSendableChange={setComposerSendable}
                              isPreparingWorktree={isPreparingWorktree}
                              // With attachments or contexts aboard the pick just inserts the
                              // text, so it sends as a prompt like the typed path would.
                              onUsageLimitsCommand={
                                usageLimitsOffered &&
                                usageLimitsKey !== null &&
                                !composerHasNonPromptContent
                                  ? openUsageLimits
                                  : undefined
                              }
                              onMcpCommand={addMcpSurface}
                              externalDrawerAttached={externalComposerDrawerAttached}
                              environmentUnavailable={activeEnvironmentUnavailable}
                              activePendingApproval={activePendingApproval}
                              pendingApprovals={pendingApprovals}
                              pendingUserInputs={pendingUserInputs}
                              activePendingProgress={activePendingProgress}
                              activePendingResolvedAnswers={activePendingResolvedAnswers}
                              activePendingIsResponding={activePendingIsResponding}
                              activePendingDraftAnswers={activePendingDraftAnswers}
                              questionAttachments={questionAttachments}
                              activePendingQuestionIndex={activePendingQuestionIndex}
                              respondingRequestIds={respondingRequestIds}
                              showPlanFollowUpPrompt={showPlanFollowUpPrompt}
                              activeProposedPlan={activeProposedPlan}
                              activeTasksProgress={activeComposerTasksProgress}
                              activeTaskSteps={activeComposerTaskSteps}
                              runtimeMode={runtimeMode}
                              interactionMode={interactionMode}
                              lockedProvider={lockedProvider}
                              providerStatuses={providerStatuses as ServerProvider[]}
                              providerCatalogKnown={serverConfig !== null}
                              activeProjectDefaultModelSelection={
                                activeProjectDefaultModelSelection
                              }
                              activeThreadModelSelection={activeThread?.modelSelection}
                              zeropsAgentAvailabilityByInstanceId={
                                zeropsAgentAvailabilityByInstanceId
                              }
                              automatedMate={automatedHere}
                              activeContextWindow={activeContextWindow}
                              compactThreadUnavailable={compactThreadUnavailable}
                              compactDisabled={compactDisabled}
                              compactDisabledReason={compactDisabledReason}
                              resolvedTheme={resolvedTheme}
                              settings={settings}
                              keybindings={keybindings}
                              terminalOpen={Boolean(terminalUiState.terminalOpen)}
                              gitCwd={gitCwd}
                              promptRef={promptRef}
                              composerImagesRef={composerImagesRef}
                              composerTerminalContextsRef={composerTerminalContextsRef}
                              onCompactContext={onCompactContext}
                              onSend={onSend}
                              onInterrupt={onInterrupt}
                              backgroundWork={composerBackgroundWork}
                              stopping={isStopping}
                              onImplementPlanInNewThread={onImplementPlanInNewThread}
                              onRespondToApproval={onRespondToApproval}
                              onSelectActivePendingUserInputOption={
                                onSelectActivePendingUserInputOption
                              }
                              onAdvanceActivePendingUserInput={onAdvanceActivePendingUserInput}
                              onDismissActivePendingUserInput={onDismissUserInput}
                              onPreviousActivePendingUserInputQuestion={
                                onPreviousActivePendingUserInputQuestion
                              }
                              onChangeActivePendingUserInputCustomAnswer={
                                onChangeActivePendingUserInputCustomAnswer
                              }
                              onProviderModelSelect={onProviderModelSelect}
                              onOpenProviderSetup={openProviderSetup}
                              agentStatus={admission.providerStatus}
                              getModelDisabledReason={getModelDisabledReason}
                              toggleInteractionMode={toggleInteractionMode}
                              handleRuntimeModeChange={handleRuntimeModeChange}
                              handleInteractionModeChange={handleInteractionModeChange}
                              scheduleComposerFocus={scheduleComposerFocus}
                              setThreadError={setThreadError}
                            />
                          )}
                        </div>
                      </div>
                      <div className="min-h-0">
                        <div
                          data-terminal-open={terminalUiState.terminalOpen ? "true" : undefined}
                          className="relative z-0"
                        >
                          {/* Drawn in the held room too, unseen with it, so the composer's
                              arrival keeps the page where it stands. */}
                          {showComposerContextStrip && zeropsFooter !== "read-only" && (
                            <div className="pointer-events-auto">
                              <BranchToolbar
                                ref={branchToolbarRef}
                                environmentId={activeThread.environmentId}
                                threadId={activeThread.id}
                                showGitControls={isGitRepo}
                                {...(routeKind === "draft" && draftId ? { draftId } : {})}
                                onEnvModeChange={onEnvModeChange}
                                startFromOrigin={startFromOrigin}
                                onStartFromOriginChange={onStartFromOriginChange}
                                {...(canOverrideServerThreadEnvMode || isPreparingWorktree
                                  ? { effectiveEnvModeOverride: envMode }
                                  : {})}
                                {...(canOverrideServerThreadEnvMode
                                  ? {
                                      activeThreadBranchOverride: activeThreadBranch,
                                      onActiveThreadBranchOverrideChange:
                                        setPendingServerThreadBranch,
                                    }
                                  : {})}
                                envLocked={envLocked}
                                onComposerFocusRequest={scheduleComposerFocus}
                                {...(canCheckoutPullRequestIntoThread
                                  ? { onCheckoutPullRequestRequest: openPullRequestDialog }
                                  : {})}
                                {...(hasMultipleEnvironments ? { onEnvironmentChange } : {})}
                                availableEnvironments={chromeLogicalProjectEnvironments}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div
                      aria-hidden
                      className="h-[calc(env(safe-area-inset-bottom)+1rem)] sm:h-[calc(env(safe-area-inset-bottom)+1.25rem)]"
                    />
                  </div>
                </div>
              </div>
            </div>

            <AlertDialog open={branchRestoreConfirmOpen} onOpenChange={setBranchRestoreConfirmOpen}>
              <AlertDialogPopup>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Switch to{" "}
                    <code className="font-medium">
                      {localCheckoutBranchMismatch?.threadBranch ?? ""}
                    </code>
                    ?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    You have uncommitted changes. They'll carry over to the other branch, or block
                    the switch if they conflict.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="secondary" />}>
                    Cancel
                  </AlertDialogClose>
                  <Button
                    variant="primary"
                    onClick={() => {
                      setBranchRestoreConfirmOpen(false);
                      void handleSwitchCheckoutToThread();
                    }}
                  >
                    Switch branch
                  </Button>
                </AlertDialogFooter>
              </AlertDialogPopup>
            </AlertDialog>

            {pullRequestDialogState ? (
              <PullRequestThreadDialog
                key={pullRequestDialogState.key}
                open
                environmentId={activeThread.environmentId}
                threadId={activeThread.id}
                cwd={activeProject?.workspaceRoot ?? null}
                initialReference={pullRequestDialogState.initialReference}
                onOpenChange={(open) => {
                  if (!open) {
                    closePullRequestDialog();
                  }
                }}
                onPrepared={handlePreparedPullRequestThread}
              />
            ) : null}
          </div>
          {/* end chat column */}
        </div>
        {/* end horizontal flex container */}

        {mountedTerminalThreadRefs.map(({ key: mountedThreadKey, threadRef: mountedThreadRef }) => (
          <PersistentThreadTerminalDrawer
            key={mountedThreadKey}
            threadRef={mountedThreadRef}
            threadId={mountedThreadRef.threadId}
            visible={mountedThreadKey === activeThreadKey && terminalUiState.terminalOpen}
            launchContext={
              mountedThreadKey === activeThreadKey ? (activeTerminalLaunchContext ?? null) : null
            }
            focusRequestId={mountedThreadKey === activeThreadKey ? terminalFocusRequestId : 0}
            splitShortcutLabel={splitTerminalShortcutLabel ?? undefined}
            splitVerticalShortcutLabel={splitTerminalVerticalShortcutLabel ?? undefined}
            newShortcutLabel={newTerminalShortcutLabel ?? undefined}
            closeShortcutLabel={closeTerminalShortcutLabel ?? undefined}
            keybindings={keybindings}
            onAddTerminalContext={addTerminalContextToDraft}
          />
        ))}
      </div>

      {!shouldUseRightPanelSheet && rightPanelOpen && activeThreadRef ? (
        <RightPanelTabs
          mode="inline"
          widthStorageKey={`t3code:preview-panel-width:${activeThreadKey}`}
          {...(rightPanelDefaultWidth === undefined
            ? {}
            : { defaultWidth: rightPanelDefaultWidth })}
          maximized={rightPanelMaximized}
          surfaces={rightPanelState.surfaces}
          activeSurfaceId={activeRightPanelSurface?.id ?? null}
          pendingSurfaceIds={pendingFileSurfaceIds}
          terminalLabelsById={activeTerminalLabelsById}
          onActivate={activateRightPanelSurface}
          onCloseSurface={closeRightPanelSurface}
          onCloseOtherSurfaces={closeOtherRightPanelSurfaces}
          onCloseSurfacesToRight={closeRightPanelSurfacesToRight}
          onCloseAllSurfaces={closeAllRightPanelSurfaces}
          onCopyFilePath={copyRightPanelFilePath}
          availability={rightPanelAvailability}
          onAdd={onAddRightPanelSurface}
          onAddTerminal={addTerminalSurface}
          liveAgentCount={agentPanelModel.liveCount}
          keybindings={keybindings}
          getShortcutContext={getShortcutContext}
        >
          {rightPanelContent}
          <ServiceBrowserPanels
            key={activeThreadKey}
            surfaces={rightPanelState.surfaces}
            activeSurfaceId={activeRightPanelSurface?.id ?? null}
            services={zeropsTopology?.services}
            addresses={mateAddresses.addresses}
            addressesKnown={mateAddresses.known}
          />
        </RightPanelTabs>
      ) : null}
      {shouldUseRightPanelSheet && rightPanelOpen && activeThreadRef ? (
        <RightPanelSheet open onClose={closePreviewPanel}>
          <RightPanelTabs
            mode="sheet"
            // Same effective inset as the closed-state titlebar controls
            // (pr-3 in the tab bar plus this pixel equals the absolute
            // right inset plus mr-px), so the cluster does not creep when
            // the sheet opens.
            layoutControls={<div className="mr-px flex items-center">{panelToggleControls}</div>}
            surfaces={rightPanelState.surfaces}
            activeSurfaceId={activeRightPanelSurface?.id ?? null}
            pendingSurfaceIds={pendingFileSurfaceIds}
            terminalLabelsById={activeTerminalLabelsById}
            onActivate={activateRightPanelSurface}
            onCloseSurface={closeRightPanelSurface}
            onCloseOtherSurfaces={closeOtherRightPanelSurfaces}
            onCloseSurfacesToRight={closeRightPanelSurfacesToRight}
            onCloseAllSurfaces={closeAllRightPanelSurfaces}
            onCopyFilePath={copyRightPanelFilePath}
            availability={rightPanelAvailability}
            onAdd={onAddRightPanelSurface}
            onAddTerminal={addTerminalSurface}
            liveAgentCount={agentPanelModel.liveCount}
            keybindings={keybindings}
            getShortcutContext={getShortcutContext}
          >
            {rightPanelContent}
            <ServiceBrowserPanels
              key={activeThreadKey}
              surfaces={rightPanelState.surfaces}
              activeSurfaceId={activeRightPanelSurface?.id ?? null}
              services={zeropsTopology?.services}
              addresses={mateAddresses.addresses}
              addressesKnown={mateAddresses.known}
            />
          </RightPanelTabs>
        </RightPanelSheet>
      ) : null}

      {expandedImage && (
        <ExpandedImageDialog
          key={`${expandedImage.images[expandedImage.index]?.src ?? "image"}:${expandedImage.index}`}
          preview={expandedImage}
          onClose={closeExpandedImage}
        />
      )}
    </ServiceBrowserScope>
  );
}

/** Whether the person asked for less motion: a scroll's way then is a cut. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
