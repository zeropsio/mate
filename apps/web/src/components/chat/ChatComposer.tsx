import { COMPOSER_ATTACHED_OUTLINE } from "./composerAttached";
import type { useQuestionAttachments } from "./useQuestionAttachments";
import type {
  ApprovalRequestId,
  Crewmate,
  KeybindingCommand,
  EnvironmentId,
  ModelSelection,
  ProviderApprovalDecision,
  ProviderInteractionMode,
  ResolvedKeybindingsConfig,
  RuntimeMode,
  ScopedThreadRef,
  ServerProvider,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { agentIdForDriverKind, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import {
  attachmentDestination,
  attachmentRefusal,
  attachmentSendBlock,
} from "@t3tools/client-runtime/zerops/composer/attachments";
import {
  commandStandsAlone,
  compactCommandOffered,
} from "@t3tools/client-runtime/zerops/composer/commandOffers";
import type { ComposerWaits } from "@t3tools/client-runtime/zerops/composer/facts";
import { readOncePerFile } from "@t3tools/client-runtime/zerops/composer/fileReads";
import { sendAway, sendHeld } from "@t3tools/client-runtime/zerops/composer/footerActions";
import {
  compactRefusal,
  composerAsk,
  composerInputClosed,
  editorHolds,
  insertionRefused,
  sendRefusal,
} from "@t3tools/client-runtime/zerops/composer/pending";
import {
  promptFieldCarriesDraft,
  promptFieldSays,
  type PromptFieldSays,
} from "@t3tools/client-runtime/zerops/composer/promptField";
import {
  agentTakesTurn,
  providerChrome,
  sendBlock,
} from "@t3tools/client-runtime/zerops/composer/sendBlock";
import type { ZeropsAgentAvailability } from "@t3tools/client-runtime/zerops/agentAvailability";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import {
  createModelSelection,
  isClaudeUltrathinkPrompt,
  normalizeModelSlug,
} from "@t3tools/shared/model";
import { USAGE_LIMITS_COMMAND } from "@t3tools/shared/usageLimits";
import { isZeropsInstanceRunnable } from "@t3tools/client-runtime/data";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { useZeropsAgentSignInDialog } from "../zerops/useZeropsAgentSignInDialog";
import { ZEROPS_AGENT_NAMES } from "@t3tools/client-runtime/zerops/agentSignIn";
import { ZeropsAgentPickerPanel } from "../zerops/ZeropsAgentPickerPanel";
import { automatedMateEntries, automatedRunsOnLine } from "../../zerops/automatedMate.logic";
import { CrewRunsOnControl } from "../zerops/crew/CrewRunsOnControl";
import { mateMentionText, type MentionableMate } from "../../zerops/mateMentions";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import {
  clampCollapsedComposerCursor,
  type ComposerSubmissionIntent,
  type ComposerTrigger,
  type ComposerTriggerOptions,
  collapseExpandedComposerCursor,
  composerStateAtPromptEnd,
  composerSubmissionIntentForEnter,
  detectComposerTrigger,
  expandCollapsedComposerCursor,
  isPathSuggestionCurrent,
  replaceTextRange,
} from "../../composer-logic";
import {
  DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
  DISCONNECTED_COMPOSER_PLACEHOLDER,
} from "../../composerPlaceholder";
import {
  composerHasSendableContent,
  composerSendableWords,
  getAntigravitySendBlockReason,
  getProviderCatalogSendBlockReason,
  readFileAsDataUrl,
  resolveComposerInteractionMode,
  resolveComposerProviderSelection,
  threadShellHasStarted,
} from "../ChatView.logic";
import {
  dataTransferHasComposerMention,
  makeComposerMentionDragHandlers,
} from "./composerMentionDrag";
import {
  composerTargetKey,
  type ComposerImageAttachment,
  type DraftId,
  persistableImageAttachments,
  composerDraftWords,
  readComposerDraftWords,
  useComposerDraftStore,
  useComposerThreadDraftBesideWords,
  useComposerDraftWordsChange,
  useEffectiveComposerModelState,
  watchComposerDraftWords,
} from "../../composerDraftStore";
import { usePromptStashStore } from "../../promptStashStore";
import { ComposerStashBadge } from "./ComposerStashBadge";
import { FULL_COMPOSER_MS, fullComposerHeight } from "./fullComposer.logic";
import { ComposerStashMenu } from "./ComposerStashMenu";
import { useComposerTriggerState } from "./useComposerTriggerState";
import {
  ComposerTasksBadge,
  ComposerTasksDrawer,
  type ComposerTaskStep,
  type ComposerTasksProgress,
} from "./ComposerTasksBadge";
import { type ComposerFileAttachment, composerAttachmentRoute } from "../../lib/composerFiles";
import {
  attachmentUploadKeys,
  releaseAttachmentUpload,
  startAttachmentUpload,
  startFileUpload,
  useAttachmentUploadStore,
} from "../../lib/attachmentUploadQueue";
import { attachmentUploadBlockReason } from "../../lib/attachmentUploadState";
import { picturesBlockReason } from "../../lib/composerPictures";
import type { ComposerPictureView } from "./ComposerPicture";
import { type ComposerPictureOptions, useComposerPictures } from "./useComposerPictures";
import type { ComposerFileView } from "./ComposerFile";
import { useComposerFiles } from "./useComposerFiles";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { getTerminalFocusOwner } from "../../lib/terminalFocus";
import { resolveShortcutCommand } from "../../keybindings";
import {
  type TerminalContextDraft,
  type TerminalContextSelection,
  filterTerminalContextsWithText,
  insertInlineTerminalContextPlaceholder,
  replaceMentionWithInlineContextPlaceholder,
  removeInlineTerminalContextPlaceholder,
} from "../../lib/terminalContext";
import { useComposerPathSearch } from "../../lib/composerPathSearchState";
import {
  type DataMentionEntry,
  describeServiceContext,
} from "@t3tools/client-runtime/zerops/dataConsole";
import { useDatabaseCatalog, useDatabaseMentionRead } from "../../zerops/useDatabase";
import { useZeropsDataMentions } from "../../zerops/useZeropsDataMentions";
import { composerModelOptionsFor, isNewConversation } from "../../zerops/newConversationEffort";
import { getProviderModelCapabilities } from "../../providerModels";
import { ComposerPendingReviewComments } from "./ComposerPendingReviewComments";
import { shouldUseCompactComposerPrimaryActions } from "../composerFooterLayout";
import {
  ComposerVaultKeysContext,
  type ComposerEditorSnapshot,
  type ComposerPromptEditorHandle,
} from "../ComposerPromptEditor";
import {
  type ComposerEditorWords,
  ComposerEditorOnWords,
  createComposerCaret,
} from "./ComposerEditorOnWords";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { composerThreadControlKey } from "./composerControlMemory";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  type ComposerCommandItem,
  ComposerCommandMenu,
  composerSuggestionOptionId,
} from "./ComposerCommandMenu";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ComposerAskFace, useComposerAskName } from "./ComposerAsk";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { ComposerVaultAskContainer, useOpenVaultAskId } from "../zerops/vault/VaultAskContainer";
import { docksAboveComposer } from "../ask/ask.logic";
import { useAskCardOnScreen, useDockedAsk } from "../ask/askReveal";
import {
  ComposerAccessControl,
  ComposerInteractionModeToggle,
  ComposerModelChoices,
  type ComposerTraitsInput,
} from "./ComposerModelControl";
import { showsAccessControl } from "./ComposerModelControl.logic";
import { resolveComposerMenuActiveItemId, useComposerMenuHighlight } from "./composerMenuHighlight";
import { useSyncStateOnChange } from "./composerStateSync";
import { getComposerPromptInjectionState, getComposerProviderState } from "./composerProviderState";
import { getTraitsSectionVisibility } from "./TraitsPicker";
import { ComposerFooterPrimaryActions } from "./ComposerFooterPrimaryActions";
import { ComposerAttachFilesButton } from "./ComposerAttachFilesButton";
import { ComposerVaultAddButton, useComposerVaultKeys } from "../zerops/vault/ComposerVaultAdd";
import { ComposerFullScreenToggle } from "./ComposerFullScreenToggle";
import { ComposerQuestionAttachments } from "./ComposerQuestionAttachments";
import { isInsideComposerFloatingLayer } from "./composerFloatingLayer";
import { syncTerminalContextsByIds, terminalContextIdListsEqual } from "./composerTerminalContexts";
import { useWorkspaceSnapshotRefresh } from "./useWorkspaceSnapshotRefresh";
import { ComposerFoldedPromptRow } from "./ComposerFoldedPromptRow";
import { ComposerFoldedAnswerRow } from "./ComposerFoldedAnswerRow";
import {
  providerSupportsManualCompaction,
  resolveContextWindowModelDisplayName,
  shouldReserveContextWindowMeter,
} from "./ContextWindowMeter.logic";
import { cn, randomUUID } from "~/lib/utils";
import {
  getComposerPromptLengthValidationMessage,
  getComposerSubmissionValidationMessage,
  submitComposerDraft,
} from "./composerSubmission";
import { ComposerPromptLengthValidation } from "./ComposerPromptLengthValidation";
import { ComposerCommandMenuLayer } from "./ComposerCommandMenuLayer";
import { Button } from "../ui/button";
import { toastManager } from "~/lib/toasts";
import { CircleAlertIcon } from "lucide-react";
import { providerAvailability, providerNameOf } from "./providerAvailability.logic";
import { UnavailableAgentControl } from "./AgentAvailability";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  NO_PROVIDER_MODEL_SELECTION,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { type AppModelOption, getAppModelOptionsForInstance } from "../../modelSelection";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import type { ChatMessage, SessionPhase, Thread, ThreadShell } from "../../types";
import {
  buildComposerPromptHistoryEntries,
  stepComposerPromptHistory,
  type ComposerPromptHistoryPosition,
} from "./composerPromptHistory";
import { useComposerStash } from "./useComposerStash";
import { useComposerMenuItems } from "./useComposerMenuItems";
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type { PendingApproval, PendingUserInput } from "../../session-logic";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import {
  resolveProviderSkillsForCwd,
  resolveProviderSlashCommandsForCwd,
} from "@t3tools/client-runtime/providerSkills";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { ReviewCommentContext } from "../../reviewCommentContext";
import { Text } from "~/components/ui/text";

/** Stable empty skills and commands while no provider is selected, so the menu items keep their identity. */
const NO_PROVIDER_SKILLS: ServerProvider["skills"] = [];
/** `@` names crewmates first (`mentionCrewmates`). */
const CREWMATE_MENTIONS = { mentions: "crewmate" } as const satisfies ComposerTriggerOptions;
const NO_PROVIDER_SLASH_COMMANDS: ServerProvider["slashCommands"] = [];

const extendReplacementRangeForTrailingSpace = (
  text: string,
  rangeEnd: number,
  replacement: string,
): number => {
  if (!replacement.endsWith(" ")) {
    return rangeEnd;
  }
  return text[rangeEnd] === " " ? rangeEnd + 1 : rangeEnd;
};

const NO_PICTURES: ReadonlyArray<ComposerPictureView> = [];
const NO_FILES: ReadonlyArray<ComposerFileView> = [];

/** A draft's image as its save for a reload reads it: each file once. */
export const readComposerFileDataUrl = readOncePerFile(readFileAsDataUrl);

// --------------------------------------------------------------------------
// Handle exposed to ChatView
// --------------------------------------------------------------------------

export interface ChatComposerHandle {
  focusAtEnd: () => void;
  focusAt: (cursor: number) => void;
  /** `keepOriginal`: each picture sends its untouched file beside the copy fitted for the agent. */
  /** Settles once every picture is read into the draft, so a send after it carries them. */
  addDroppedFiles: (files: File[], options?: ComposerPictureOptions) => Promise<void>;
  insertTextAtEnd: (text: string, options?: { ensureLeadingBoundary?: boolean }) => boolean;
  openModelPicker: () => void;
  toggleModelPicker: () => void;
  openControl: (command: KeybindingCommand) => void;
  isModelPickerOpen: () => boolean;
  compactContext: () => void;
  readSnapshot: () => ComposerEditorSnapshot;
  /** Reset composer cursor/trigger/highlight after external prompt mutations (e.g. onSend). */
  resetCursorState: (options?: {
    cursor?: number;
    prompt?: string;
    detectTrigger?: boolean;
  }) => void;
  /** Insert a terminal context from the terminal drawer. */
  addTerminalContext: (selection: TerminalContextSelection) => void;
  /** Get the current prompt/effort/model state for use in send. */
  getSendContext: () => {
    prompt: string;
    images: ComposerImageAttachment[];
    files: ComposerFileAttachment[];
    terminalContexts: TerminalContextDraft[];
    reviewComments: ReviewCommentContext[];
    selectedPromptEffort: string | null;
    selectedModelOptionsForDispatch: unknown;
    selectedModelSelection: ModelSelection;
    providerAvailable: boolean;
    selectedProvider: ProviderDriverKind;
    selectedModel: string;
    selectedProviderModels: ReadonlyArray<ServerProvider["models"][number]>;
    interactionMode: ProviderInteractionMode;
    interactionModeEnabled: boolean;
  };
  /** Validates the fully composed text just before a provider turn starts: why it cannot go, or null. */
  validateProviderInput: (providerInput: string) => string | null;
}

// --------------------------------------------------------------------------
// Props
// --------------------------------------------------------------------------

interface ChatComposerProps {
  composerDraftTarget: ScopedThreadRef | DraftId;
  environmentId: EnvironmentId;
  attachmentUploadsCapabilityKnown: boolean;
  supportsAttachmentUploads: boolean;
  routeKind: "server" | "draft";
  routeThreadRef: ScopedThreadRef;
  draftId: DraftId | null;

  // Thread context
  activeThreadId: ThreadId | null;
  activeThreadEnvironmentId: EnvironmentId | undefined;
  activeThread: Thread | undefined;
  /** The routed server thread's shell, present before its detail loads. */
  activeThreadShell: ThreadShell | null;
  /** True while the routed thread's detail is still loading. */
  threadDetailLoading: boolean;
  /** Timeline messages including optimistic sends, for ArrowUp prompt recall. */
  promptHistoryMessages: ReadonlyArray<ChatMessage>;
  isServerThread: boolean;
  isLocalDraftThread: boolean;
  forceExpandedOnMobile: boolean;
  projectSelectionRequired: boolean;
  connectedPlaceholder?: string;
  /**
   * What the composer invites before a session runs. A Mate is there whether
   * or not its session started, so its conversation says the same both ways.
   */
  idlePlaceholder?: string;
  /**
   * The lead's chat (PRD §4.6, §5.3): `@` offers these crewmates, then files.
   * Absent in every other chat — a person's or a crewmate's — whose `@` keeps
   * to files and data.
   */
  mentionCrewmates?: ReadonlyArray<Crewmate> | undefined;
  /**
   * The person's other Mates, which `@` offers after any crewmates and before files: a pick writes
   * `@Name`, and the message tells the Mate which Mate it names. Absent in a crewmate's chat.
   */
  mentionMates?: ReadonlyArray<MentionableMate> | undefined;
  /**
   * A crewmate's chat (PRD §2.3): what the crewmate runs on, read-only in
   * place of the model, effort and permission-mode pickers — its *Runs on* and
   * the crew gate decide those — with a way into its editor.
   */
  crewRunsOn?: { readonly label: string; readonly onEdit: () => void } | undefined;
  /**
   * A crewmate's chat, known from its first paint: the model the crewmate is set to, which Send
   * checks in place of the one its conversation last saved; `null` for its login's default, and
   * while the crew is unread. Absent in every other chat.
   */
  crewmateModel?: string | null | undefined;
  /**
   * The composer's top (C3): what waits on the person — this Mate's change,
   * waiting for their review — as a section inside the composer, sharing its
   * edges and corners, over what they write.
   */
  top?: ReactNode;

  // Session phase
  phase: SessionPhase;
  isConnecting: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  /** What Send's hover says before it sends: the Mate at work in another chat on the same files. */
  sendHint?: string | null | undefined;
  /**
   * D6: this agent is not runnable by this viewer right now, on a thread
   * that stays locked to it (the picker offers sign-in instead of a
   * different selection). Kept separate from `sendDisabledReason` — unlike
   * that generic reason, this one must never block answering a pending
   * question: that is not a turn-starting command, so the server never
   * refused it either.
   */
  zeropsSendBlockReason: string | null;
  isPreparingWorktree: boolean;
  externalDrawerAttached: boolean;
  /** Picking /usage-limits from the menu is the action itself; the draft keeps nothing of it. */
  onUsageLimitsCommand?: (() => void) | undefined;
  /** Mate's own /mcp: opens the MCP tab; nothing is sent. */
  onMcpCommand?: (() => void) | undefined;
  /** The composer's environment is not connected: nothing can be sent. */
  environmentUnavailable: boolean;

  // Pending approvals / inputs
  activePendingApproval: PendingApproval | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  activePendingProgress: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    customAnswer: string;
    activeQuestion: {
      id: string;
      multiSelect?: boolean | undefined;
      allowCustomAnswer?: boolean | undefined;
    } | null;
  } | null;
  activePendingResolvedAnswers: Record<string, unknown> | null;
  activePendingIsResponding: boolean;
  activePendingDraftAnswers: Record<string, PendingUserInputDraftAnswer>;
  questionAttachments?: ReturnType<typeof useQuestionAttachments>;
  activePendingQuestionIndex: number;
  respondingRequestIds: ApprovalRequestId[];

  // Plan
  showPlanFollowUpPrompt: boolean;
  activeProposedPlan: Thread["proposedPlans"][number] | null;
  activeTasksProgress: ComposerTasksProgress | null;
  activeTaskSteps: readonly ComposerTaskStep[] | null;

  // Mode
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;

  // Provider / model
  /** The driver a started conversation runs on now (`deriveThreadDriver`); null before it started. */
  threadDriver: ProviderDriverKind | null;
  providerStatuses: ServerProvider[];
  /** False until the environment's server config has arrived at least once. */
  providerCatalogKnown: boolean;
  activeProjectDefaultModelSelection: ModelSelection | null | undefined;
  activeThreadModelSelection: ModelSelection | null | undefined;
  /**
   * Per-instance zerops runnability (D6) — `ChatView`'s
   * `resolveZeropsProviderAvailability`, so the composer's selection gate and
   * the picker's per-agent panels read the same answer. `undefined` on a
   * non-Zerops environment; behavior is then exactly as before zerops
   * existed.
   */
  zeropsAgentAvailabilityByInstanceId?:
    | ReadonlyMap<ProviderInstanceId, ZeropsAgentAvailability>
    | undefined;
  /** An automated Mate's: it runs on the organization's key, so no agent a person signs in. */
  automatedMate?: boolean | undefined;

  // Context window
  activeContextWindow: ContextWindowSnapshot | null;
  compactThreadUnavailable: boolean;
  compactDisabled: boolean;
  compactDisabledReason: string | null;

  // Misc
  resolvedTheme: "light" | "dark";
  settings: UnifiedSettings;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  gitCwd: string | null;

  // Refs the parent needs kept in sync
  promptRef: React.RefObject<string>;
  composerImagesRef: React.RefObject<ComposerImageAttachment[]>;
  composerTerminalContextsRef: React.RefObject<TerminalContextDraft[]>;
  composerRef: React.RefObject<ChatComposerHandle | null>;

  // Callbacks
  onCompactContext: () => void;
  onSend: (e?: { preventDefault: () => void }, intent?: ComposerSubmissionIntent) => void;
  /** Whether this composer's send would go now: told as it changes, and false once it unmounts. */
  onSendableChange?: (sendable: boolean) => void;
  /** Work the turn started that runs on after it, which the composer offers to stop. */
  backgroundWork: { readonly stopping: boolean; readonly onStop: () => void } | null;
  /** A person's Stop is in force (`conversationStop`): the Stop says so. */
  stopping?: boolean;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
  onRespondToApproval: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
  onSelectActivePendingUserInputOption: (questionId: string, optionValue: string) => void;
  onAdvanceActivePendingUserInput: () => void;
  onDismissActivePendingUserInput: (requestId: ApprovalRequestId) => void;
  onPreviousActivePendingUserInputQuestion: () => void;
  onChangeActivePendingUserInputCustomAnswer: (
    questionId: string,
    value: string,
    nextCursor: number,
    expandedCursor: number,
    cursorAdjacentToMention: boolean,
  ) => void;

  onProviderModelSelect: (instanceId: ProviderInstanceId, model: string) => void;
  onOpenProviderSetup: (instanceId: ProviderInstanceId) => void;
  /** The status of the agent the conversation runs on, as admission reads it (the model control's dot). */
  agentStatus: ServerProvider | null;
  getModelDisabledReason: (instanceId: ProviderInstanceId, model: string) => string | null;
  toggleInteractionMode: () => void;
  handleRuntimeModeChange: (mode: RuntimeMode) => void;
  handleInteractionModeChange: (mode: ProviderInteractionMode) => void;

  scheduleComposerFocus: () => void;
  setThreadError: (threadId: ThreadId | null, error: string | null) => void;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export const ChatComposer = memo(function ChatComposer(props: ChatComposerProps) {
  const {
    composerDraftTarget,
    environmentId,
    attachmentUploadsCapabilityKnown,
    supportsAttachmentUploads,
    routeKind,
    routeThreadRef,
    draftId,
    activeThreadId,
    activeThreadEnvironmentId: _activeThreadEnvironmentId,
    activeThread,
    promptHistoryMessages,
    isServerThread: _isServerThread,
    isLocalDraftThread: _isLocalDraftThread,
    forceExpandedOnMobile,
    projectSelectionRequired,
    connectedPlaceholder = DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
    idlePlaceholder = DISCONNECTED_COMPOSER_PLACEHOLDER,
    mentionCrewmates,
    mentionMates,
    crewRunsOn,
    crewmateModel,
    top,
    phase,
    isConnecting,
    isSendBusy,
    sendDisabledReason: externalSendDisabledReason,
    sendHint = null,
    zeropsSendBlockReason,
    onSendableChange,
    isPreparingWorktree,
    environmentUnavailable,
    activePendingApproval,
    pendingApprovals,
    pendingUserInputs,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    respondingRequestIds,
    showPlanFollowUpPrompt,
    activeProposedPlan,
    activeTasksProgress,
    activeTaskSteps,
    runtimeMode,
    interactionMode: requestedInteractionMode,
    threadDriver,
    providerStatuses,
    providerCatalogKnown,
    activeProjectDefaultModelSelection,
    activeThreadModelSelection,
    zeropsAgentAvailabilityByInstanceId,
    automatedMate = false,
    activeContextWindow,
    compactThreadUnavailable,
    compactDisabled,
    compactDisabledReason,
    resolvedTheme,
    settings,
    keybindings,
    terminalOpen,
    gitCwd,
    promptRef,
    composerRef,
    composerImagesRef,
    composerTerminalContextsRef,
    onCompactContext,
    onSend,
    onInterrupt,
    backgroundWork,
    stopping,
    onImplementPlanInNewThread,
    onRespondToApproval,
    onSelectActivePendingUserInputOption,
    onAdvanceActivePendingUserInput,
    onDismissActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
    onChangeActivePendingUserInputCustomAnswer,
    onProviderModelSelect,
    onOpenProviderSetup,
    agentStatus,
    getModelDisabledReason,
    toggleInteractionMode,
    handleRuntimeModeChange,
    handleInteractionModeChange,
    scheduleComposerFocus,
    setThreadError,
  } = props;
  // ------------------------------------------------------------------
  // Store subscriptions (prompt / images / terminal contexts)
  // ------------------------------------------------------------------
  // The draft's words are the editor's to read (`ComposerEditorOnWords`). What stands around it
  // reads what it shows of them and no more — that there are any, that they could be sent, that
  // they set the effort — so a key typed draws none of it again.
  const composerDraft = useComposerThreadDraftBesideWords(composerDraftTarget);
  const promptHasText = useComposerDraftStore(
    (store) => composerDraftWords(store, composerDraftTarget).trim().length > 0,
  );
  const promptHasSendableWords = useComposerDraftStore(
    (store) => composerSendableWords(composerDraftWords(store, composerDraftTarget)).length > 0,
  );
  // The words while they say "ultrathink", which sets the effort and which the one control
  // rewrites; none otherwise.
  const effortWords = useComposerDraftStore((store) => {
    const words = composerDraftWords(store, composerDraftTarget);
    return isClaudeUltrathinkPrompt(words) ? words : "";
  });
  const composerImages = composerDraft.images;
  const composerFiles = composerDraft.files;
  const composerTerminalContexts = composerDraft.terminalContexts;
  const composerReviewComments = composerDraft.reviewComments;
  const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;
  const uploadsByImageId = useAttachmentUploadStore((state) => state.uploadsByImageId);
  const attachmentBlockReason = attachmentSendBlock({
    picturesBlock: picturesBlockReason(composerImages),
    uploadsSupported: supportsAttachmentUploads,
    uploadBlock: attachmentUploadBlockReason({
      imageIds: composerImages.flatMap(attachmentUploadKeys),
      fileIds: composerFiles.map((file) => file.id),
      uploadsByImageId,
      environmentId,
    }),
  });
  // An upload that failed holds the send until the person retries or removes it: a held send ends.
  const attachmentUploadFailed =
    supportsAttachmentUploads &&
    [...composerImages.flatMap(attachmentUploadKeys), ...composerFiles.map((file) => file.id)].some(
      (id) => {
        const upload = uploadsByImageId[id];
        return upload?.status === "failed" && upload.environmentId === environmentId;
      },
    );
  const setComposerDraftPrompt = useComposerDraftStore((store) => store.setPrompt);
  const addComposerDraftImages = useComposerDraftStore((store) => store.addImages);
  const insertComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.insertTerminalContext,
  );
  const removeComposerDraftTerminalContext = useComposerDraftStore(
    (store) => store.removeTerminalContext,
  );
  const setComposerDraftTerminalContexts = useComposerDraftStore(
    (store) => store.setTerminalContexts,
  );
  const removeComposerDraftReviewComment = useComposerDraftStore(
    (store) => store.removeReviewComment,
  );
  const clearComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.clearPersistedAttachments,
  );
  const clearComposerDraftPromptAndImages = useComposerDraftStore(
    (store) => store.clearComposerPromptAndImages,
  );
  const syncComposerDraftPersistedAttachments = useComposerDraftStore(
    (store) => store.syncPersistedAttachments,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);

  useEffect(() => {
    if (!attachmentUploadsCapabilityKnown) {
      return;
    }
    if (!supportsAttachmentUploads) {
      for (const image of composerImages) {
        releaseAttachmentUpload(image.id);
      }
      return;
    }
    for (const image of composerImages) {
      // A picture's copy uploads once it is made.
      if (image.picture?.preparing) continue;
      startAttachmentUpload({ environmentId, image });
    }
    // A file uploads as soon as it is added.
    for (const file of composerFiles) startFileUpload({ environmentId, file });
  }, [
    attachmentUploadsCapabilityKnown,
    composerFiles,
    composerImages,
    environmentId,
    supportsAttachmentUploads,
  ]);

  // ------------------------------------------------------------------
  // Model state
  // ------------------------------------------------------------------
  // Instance-aware projection of the wire provider list. One entry per
  // configured instance (default built-in + any custom `providerInstances.*`),
  // sorted default-first per driver kind for a stable picker order.
  const providerInstanceEntries = useMemo<ReadonlyArray<ProviderInstanceEntry>>(
    () =>
      automatedMateEntries(
        sortProviderInstanceEntries(
          applyProviderInstanceSettings(deriveProviderInstanceEntries(providerStatuses), settings),
        ),
        automatedMate,
      ),
    [automatedMate, providerStatuses, settings],
  );
  const selectedProviderByThreadId = composerDraft.activeProvider ?? null;
  const isZeropsAgentRunnable = useCallback(
    (instanceId: ProviderInstanceId) =>
      isZeropsInstanceRunnable(zeropsAgentAvailabilityByInstanceId, instanceId),
    [zeropsAgentAvailabilityByInstanceId],
  );
  const {
    selectedProviderEntry,
    requestedDriverKind,
    unavailableProviderInstanceId,
    zeropsSignInRequired,
  } = useMemo(
    () =>
      resolveComposerProviderSelection({
        entries: providerInstanceEntries,
        candidateInstanceIds: [
          selectedProviderByThreadId,
          activeThread?.session?.providerInstanceId,
          activeThreadModelSelection?.instanceId,
          activeProjectDefaultModelSelection?.instanceId,
        ],
        threadDriver,
        zerops:
          zeropsAgentAvailabilityByInstanceId !== undefined
            ? { available: true, isAgentRunnable: isZeropsAgentRunnable }
            : undefined,
      }),
    [
      activeProjectDefaultModelSelection?.instanceId,
      activeThread?.session?.providerInstanceId,
      activeThreadModelSelection?.instanceId,
      isZeropsAgentRunnable,
      selectedProviderByThreadId,
      threadDriver,
      providerInstanceEntries,
      zeropsAgentAvailabilityByInstanceId,
    ],
  );
  const zeropsSignInDialog = useZeropsAgentSignInDialog(environmentId, routeThreadRef);
  const cancelZeropsAgentLogin = useAgentLoginCancel(routeThreadRef);
  const openZeropsAgentSignIn = zeropsSignInDialog.openFor;
  // The instance a started conversation runs on now: another agent's continues it.
  const runsOn =
    threadDriver === null
      ? null
      : (activeThread?.session?.providerInstanceId ??
        activeThreadModelSelection?.instanceId ??
        null);
  // Signing an agent in is project-wide: on a started conversation another agent's panel says
  // which agent runs it now, and that this one continues it once it is signed in.
  const threadZeropsAgentName = useMemo(() => {
    if (threadDriver === null) return undefined;
    const threadAgentId = agentIdForDriverKind(threadDriver);
    return threadAgentId === undefined ? undefined : ZEROPS_AGENT_NAMES[threadAgentId];
  }, [threadDriver]);
  const renderZeropsInstancePanel = useCallback(
    (entry: ProviderInstanceEntry, requestClosePicker: () => void): ReactNode | null => {
      const availability = zeropsAgentAvailabilityByInstanceId?.get(entry.instanceId);
      if (availability === undefined || availability.kind === "ready") return null;
      const agentId = agentIdForDriverKind(entry.driverKind);
      if (agentId === undefined) return null;
      const runsOnAgentName =
        threadZeropsAgentName !== undefined && entry.driverKind !== threadDriver
          ? threadZeropsAgentName
          : undefined;
      return (
        <ZeropsAgentPickerPanel
          agentId={agentId}
          availability={availability}
          runsOnAgentName={runsOnAgentName}
          onCancel={cancelZeropsAgentLogin}
          onOpenDialog={openZeropsAgentSignIn}
          requestClosePicker={requestClosePicker}
        />
      );
    },
    [
      cancelZeropsAgentLogin,
      threadDriver,
      threadZeropsAgentName,
      openZeropsAgentSignIn,
      zeropsAgentAvailabilityByInstanceId,
    ],
  );
  const selectedInstanceId =
    selectedProviderEntry?.instanceId ?? NO_PROVIDER_MODEL_SELECTION.instanceId;
  const providerState = providerChrome({
    picked: selectedProviderEntry !== undefined,
    catalogKnown: providerCatalogKnown,
  });
  const noProviderAvailable = providerState !== "picked";
  // Before the catalog arrives, every thread resolves to "no provider". Send
  // stays blocked either way; only the chrome waits, keeping the picker with
  // the thread's own selection instead of swapping in the setup button and
  // back once the catalog lands.
  const providerCatalogPending = providerState === "pending";
  const showProviderUnavailable = providerState === "unavailable";
  const providerSetupInstanceId = noProviderAvailable ? unavailableProviderInstanceId : undefined;
  // The agent the conversation asked for while none is picked: Send names it as away.
  const providerSetupSnapshot =
    providerInstanceEntries.find((entry) => entry.instanceId === providerSetupInstanceId)
      ?.snapshot ?? null;
  const unavailableAgentName = providerSetupSnapshot ? providerNameOf(providerSetupSnapshot) : null;
  // The agent's availability, wherever this person can act on the agent (S6). A colleague's
  // read-along footer and a held footer replace these controls and say none of it: that viewer
  // cannot act on the agent.
  const agentAvailability = providerAvailability(agentStatus);
  const unavailableAgent = showProviderUnavailable
    ? (agentAvailability ?? providerAvailability(providerSetupSnapshot))
    : null;
  const resolvedCompactDisabledReason =
    compactDisabledReason ?? (noProviderAvailable ? "Compacting is unavailable right now" : null);
  // The driver kind follows the instance that will actually run the turn,
  // which can differ from the persisted selection when that selection is
  // disabled.
  const selectedProvider: ProviderDriverKind =
    selectedProviderEntry?.driverKind ?? requestedDriverKind;

  const { modelOptions: composerModelOptions, selectedModel } = useEffectiveComposerModelState({
    threadRef: composerDraftTarget,
    providers: providerStatuses,
    selectedProvider,
    selectedInstanceId,
    threadModelSelection: activeThreadModelSelection,
    projectModelSelection: activeProjectDefaultModelSelection,
    settings,
  });
  // A crewmate's chat runs the model the crewmate is set to, never the one its conversation last
  // saved: that is the model Send checks.
  const providerSendBlockReason =
    getAntigravitySendBlockReason(
      selectedProviderEntry?.snapshot,
      crewmateModel === undefined ? selectedModel : crewmateModel,
    ) ?? getProviderCatalogSendBlockReason(selectedProviderEntry?.snapshot);
  const providerSendable = agentTakesTurn({
    providerPicked: !noProviderAvailable,
    providerBlock: providerSendBlockReason,
    zeropsBlock: zeropsSendBlockReason,
  });
  useEffect(() => {
    onSendableChange?.(providerSendable);
    return () => onSendableChange?.(false);
  }, [onSendableChange, providerSendable]);
  const sendDisabledReason = sendBlock({
    conversationBlock: externalSendDisabledReason,
    answering: activePendingProgress !== null,
    attachmentBlock: attachmentBlockReason,
    providerBlock: providerSendBlockReason,
    zeropsBlock: zeropsSendBlockReason,
  });
  const isSendDisabled = sendDisabledReason !== null;
  const selectedProviderStatus = useMemo(
    () => selectedProviderEntry?.snapshot ?? null,
    [selectedProviderEntry],
  );
  const compactCommandAvailable = providerSupportsManualCompaction(selectedProviderEntry);
  const selectedProviderSkills = selectedProviderStatus
    ? resolveProviderSkillsForCwd(selectedProviderStatus, gitCwd)
    : NO_PROVIDER_SKILLS;
  const selectedProviderSlashCommands = selectedProviderStatus
    ? resolveProviderSlashCommandsForCwd(selectedProviderStatus, gitCwd)
    : NO_PROVIDER_SLASH_COMMANDS;
  useWorkspaceSnapshotRefresh({
    environmentId,
    gitCwd,
    selectedProviderEntry,
    selectedProviderStatus,
  });
  const selectedProviderModels = useMemo<ReadonlyArray<ServerProvider["models"][number]>>(
    () => selectedProviderEntry?.models ?? [],
    [selectedProviderEntry],
  );

  const composerPromptInjectionState = useMemo(
    () => getComposerPromptInjectionState(effortWords),
    [effortWords],
  );
  // D10: a new conversation shows and sends Extra High; a person's own pick wins.
  const newConversation = isNewConversation(routeKind, activeThread);
  const selectedComposerModelOptions = useMemo(
    () =>
      composerModelOptionsFor({
        isNew: newConversation,
        capabilities: getProviderModelCapabilities(
          selectedProviderModels,
          selectedModel,
          selectedProvider,
          settings.planModeEnabled,
        ),
        options: composerModelOptions?.[selectedInstanceId],
      }),
    [
      composerModelOptions,
      newConversation,
      selectedInstanceId,
      selectedModel,
      selectedProvider,
      selectedProviderModels,
      settings.planModeEnabled,
    ],
  );
  const composerProviderState = useMemo(
    () =>
      getComposerProviderState({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        promptInjectionState: composerPromptInjectionState,
        modelOptions: selectedComposerModelOptions,
        planModeEnabled: settings.planModeEnabled,
      }),
    [
      composerPromptInjectionState,
      selectedComposerModelOptions,
      selectedModel,
      selectedProvider,
      selectedProviderModels,
      settings.planModeEnabled,
    ],
  );

  const selectedPromptEffort = composerProviderState.promptEffort;
  const selectedModelOptionsForDispatch = composerProviderState.modelOptionsForDispatch;
  const { enabled: planModeUiEnabled, interactionMode } = resolveComposerInteractionMode({
    planModeEnabled: settings.planModeEnabled,
    provider: selectedProviderStatus,
    interactionMode: requestedInteractionMode,
  });
  const selectedModelSelection = useMemo<ModelSelection>(
    () => createModelSelection(selectedInstanceId, selectedModel, selectedModelOptionsForDispatch),
    [selectedInstanceId, selectedModel, selectedModelOptionsForDispatch],
  );
  const selectedModelForPicker = selectedModel;
  const sendSettingsKey = useMemo(
    () => JSON.stringify([selectedModelSelection, interactionMode, runtimeMode]),
    [interactionMode, runtimeMode, selectedModelSelection],
  );
  // Instance-keyed option list so the picker can show each configured
  // instance (built-in + custom) as a first-class sidebar entry. The
  // options are server-reported models plus that exact instance's
  // configured custom models. A missing OpenCode selection is included as
  // an unavailable row until the catalog reports it again.
  const modelOptionsByInstance = useMemo<
    ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>
  >(() => {
    const out = new Map<ProviderInstanceId, ReadonlyArray<AppModelOption>>();
    for (const entry of providerInstanceEntries) {
      out.set(
        entry.instanceId,
        getAppModelOptionsForInstance(
          settings,
          entry,
          entry.instanceId === selectedInstanceId ? selectedModelForPicker : null,
        ),
      );
    }
    return out;
  }, [providerInstanceEntries, selectedInstanceId, selectedModelForPicker, settings]);
  const selectedModelForPickerWithCustomFallback = useMemo(() => {
    const currentOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
    return currentOptions.some((option) => option.slug === selectedModelForPicker)
      ? selectedModelForPicker
      : (normalizeModelSlug(selectedModelForPicker, selectedProvider) ?? selectedModelForPicker);
  }, [modelOptionsByInstance, selectedInstanceId, selectedModelForPicker, selectedProvider]);

  // ------------------------------------------------------------------
  // Context window
  // ------------------------------------------------------------------
  const activeThreadModelDisplayName = useMemo(
    () => resolveContextWindowModelDisplayName(activeThreadModelSelection, modelOptionsByInstance),
    [activeThreadModelSelection, modelOptionsByInstance],
  );
  const reserveContextWindowMeter = shouldReserveContextWindowMeter({
    meterEnabled: true,
    detailLoading: props.threadDetailLoading,
    threadStarted: threadShellHasStarted(props.activeThreadShell),
    providerReportsContextWindow: selectedProviderStatus
      ? selectedProviderStatus.reportsContextWindow === true
      : null,
  });

  // ------------------------------------------------------------------
  // Composer-local state
  // ------------------------------------------------------------------
  // The caret moves with every key: held beside the composer, where the editor reads it.
  const [composerCaret] = useState(() => {
    const words = readComposerDraftWords(composerDraftTarget);
    return createComposerCaret(collapseExpandedComposerCursor(words, words.length));
  });
  const setComposerCursor = composerCaret.set;
  const offersCrewmates = mentionCrewmates !== undefined;
  // What the editor draws as a face: a crewmate's `@handle`, another Mate's `@Name`.
  const editorMentionChips = useMemo(
    () =>
      mentionMates === undefined || mentionMates.length === 0
        ? mentionCrewmates
        : [
            ...(mentionCrewmates ?? []),
            ...mentionMates.map((mate) => ({
              handle: mate.name,
              tint: mate.tint,
              shape: mate.shape,
              mate: true as const,
            })),
          ],
    [mentionCrewmates, mentionMates],
  );
  const detectTrigger = useCallback(
    (text: string, cursor: number) =>
      detectComposerTrigger(text, cursor, offersCrewmates ? CREWMATE_MENTIONS : undefined),
    [offersCrewmates],
  );
  const {
    trigger: composerTrigger,
    setTrigger: setComposerTrigger,
    resolveTrigger: resolveComposerTrigger,
    dismissTrigger: dismissComposerTrigger,
    resetTrigger: resetComposerTrigger,
  } = useComposerTriggerState(() => {
    const words = readComposerDraftWords(composerDraftTarget);
    return detectTrigger(words, words.length);
  });
  // Active ArrowUp recall. Cleared on edit and on thread switch.
  const promptHistoryPositionRef = useRef<ComposerPromptHistoryPosition | null>(null);
  const [isDragOverComposer, setIsDragOverComposer] = useState(false);
  const [isComposerPrimaryActionsCompact, setIsComposerPrimaryActionsCompact] = useState(false);
  const [isComposerModelPickerOpen, setIsComposerModelPickerOpen] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  // Full screen (`fullComposer.logic.ts`): grown over the conversation, or on its way back.
  // It belongs to the conversation it was opened in: another opens at its own size.
  const [fullComposerAt, setFullComposerAt] = useState<{
    readonly threadId: typeof activeThreadId;
    readonly state: "on" | "leaving";
  } | null>(null);
  const fullComposer =
    fullComposerAt !== null && fullComposerAt.threadId === activeThreadId
      ? fullComposerAt.state
      : "off";
  const [composerSubmissionError, setComposerSubmissionError] = useState<string | null>(null);
  const [providerInputSubmissionError, setProviderInputSubmissionError] = useState<string | null>(
    null,
  );
  const [composerMenuAnchor, setComposerMenuAnchor] = useState<HTMLDivElement | null>(null);
  const [isStashMenuOpen, setIsStashMenuOpen] = useState(false);
  const [isTasksDrawerOpen, setIsTasksDrawerOpen] = useState(false);
  const [dismissedTasksTurnId, setDismissedTasksTurnId] = useState<TurnId | null>(null);
  const [stashPulse, setStashPulse] = useState<{ key: number; active: boolean }>({
    key: 0,
    active: false,
  });
  const isMobileViewport = useMediaQuery("max-sm");
  const isComposerCollapsedMobile =
    isMobileViewport && !forceExpandedOnMobile && !isComposerFocused;

  // ------------------------------------------------------------------
  // Refs
  // ------------------------------------------------------------------
  const composerEditorRef = useRef<ComposerPromptEditorHandle>(null);
  const composerFormRef = useRef<HTMLFormElement>(null);
  const composerSurfaceRef = useRef<HTMLDivElement>(null);
  const providerInputRejectedRef = useRef(false);

  const leaveFullComposer = useCallback(() => {
    setFullComposerAt((current) =>
      current?.state === "on" ? { ...current, state: "leaving" } : current,
    );
  }, []);
  useEffect(() => {
    if (fullComposer !== "leaving") return;
    const timer = window.setTimeout(() => setFullComposerAt(null), FULL_COMPOSER_MS);
    return () => window.clearTimeout(timer);
  }, [fullComposer]);
  // Its height is measured, not guessed: the chat column, and what stands with
  // the composer in it, decide how tall it is. Both are watched, so a smaller
  // window, or a banner or strip arriving or leaving in the stack, refits it.
  useLayoutEffect(() => {
    if (fullComposer !== "on") return;
    const form = composerFormRef.current;
    const editor = form?.querySelector<HTMLElement>('[data-testid="composer-editor"]');
    const overlay = form?.closest<HTMLElement>('[data-chat-composer-overlay="true"]');
    const column = overlay?.parentElement;
    const stack = overlay?.firstElementChild;
    if (!form || !editor || !overlay || !column || !(stack instanceof HTMLElement)) return;
    const fit = () => {
      const height = fullComposerHeight({
        column: column.getBoundingClientRect(),
        stack: stack.getBoundingClientRect(),
        editorHeight: editor.getBoundingClientRect().height,
        centred: overlay.dataset.chatComposerHero === "true",
      });
      form.style.setProperty("--composer-full-height", `${height}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(column);
    observer.observe(stack);
    return () => observer.disconnect();
  }, [fullComposer]);
  const composerSelectLockRef = useRef(false);
  const composerMenuOpenRef = useRef(false);
  const composerMenuItemsRef = useRef<ComposerCommandItem[]>([]);
  const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null);
  const composerBlurFrameRef = useRef<number | null>(null);
  const mobileComposerExpandFrameRef = useRef<number | null>(null);
  const mobileComposerExpandReleaseFrameRef = useRef<number | null>(null);
  const mobileComposerExpandInFlightRef = useRef(false);
  const stashPulseKeyRef = useRef(0);
  const stashPulseTimeoutRef = useRef<number | null>(null);
  /**
   * Snapshots currently being encoded, keyed by target+prompt+image ids.
   * Keyed rather than boolean so a genuinely different prompt (or a different
   * thread) can still be stashed while an earlier encode is running.
   */
  const stashInFlightRef = useRef<Set<string>>(new Set());
  /**
   * Count of pasted images still being compressed, per thread. Reserved
   * against the attachment limit so concurrent pastes can't overshoot it,
   * and checked before sending or compacting so an image cannot move into
   * the next draft.
   */
  const pendingImageCompressionsRef = useRef<Map<ThreadId, number>>(new Map());
  // A send asked for while pictures are still read, prepared or uploaded waits for them and goes
  // once they are ready (`heldSend`); each finished read draws again, so the wait can end. It goes
  // as it was asked for: with the model and mode of that moment.
  const [heldSend, setHeldSend] = useState<{
    readonly threadId: ThreadId;
    readonly intent: ComposerSubmissionIntent;
    readonly settingsKey: string;
  } | null>(null);
  const [imageReadsSettled, setImageReadsSettled] = useState(0);

  const isComposerApprovalState = activePendingApproval !== null;
  const questionsWait = pendingUserInputs.length > 0;
  const answering = activePendingProgress !== null;
  const openQuestion = !activePendingProgress?.activeQuestion
    ? "none"
    : activePendingProgress.activeQuestion.allowCustomAnswer === false
      ? "choice-only"
      : "own-words";
  const composerWaits = useMemo<ComposerWaits>(
    () => ({
      approval: isComposerApprovalState,
      questions: questionsWait,
      answering,
      openQuestion,
    }),
    [isComposerApprovalState, questionsWait, answering, openQuestion],
  );

  const attachmentFacts = {
    waits: composerWaits,
    uploads: { known: attachmentUploadsCapabilityKnown, supported: supportsAttachmentUploads },
  };

  // Pictures sit in the text where they were pasted.
  const composerPictures = useComposerPictures({
    draftTarget: composerDraftTarget,
    environmentId,
    images: composerImages,
    supportsAttachmentUploads,
    uploadsByImageId,
    editorRef: composerEditorRef,
    promptRef,
    onPromptWritten: (nextPrompt, nextCursor) => {
      setComposerCursor(nextCursor);
      setComposerTrigger(null);
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor);
      });
    },
    refusal: () =>
      attachmentRefusal("picture", attachmentFacts) === "question-waits"
        ? "Attach pictures after answering pending questions."
        : null,
    onError: (message) => setThreadError(activeThreadId, message),
  });

  // Files that are not pictures sit in the text the same way, as chips.
  const composerFileList = useComposerFiles({
    draftTarget: composerDraftTarget,
    environmentId,
    files: composerFiles,
    uploadsByImageId,
    editorRef: composerEditorRef,
    promptRef,
    onPromptWritten: (_nextPrompt, nextCursor) => {
      setComposerCursor(nextCursor);
      setComposerTrigger(null);
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCursor);
      });
    },
    refusal: () => {
      switch (attachmentRefusal("file", attachmentFacts)) {
        case "question-waits":
          return "Attach files after answering pending questions.";
        case "no-file-support":
          return "This Mate cannot take files yet: attach pictures, or paste the text.";
        case null:
          return null;
      }
    },
    onError: (message) => setThreadError(activeThreadId, message),
  });

  // ------------------------------------------------------------------
  // Derived: composer send state
  // ------------------------------------------------------------------
  const sendableTerminalContextCount = useMemo(
    () => filterTerminalContextsWithText(composerTerminalContexts).length,
    [composerTerminalContexts],
  );
  const hasSendableContent = composerHasSendableContent({
    hasWords: promptHasSendableWords,
    imageCount: composerImages.length + composerFiles.length,
    sendableTerminalContextCount,
    elementContextCount: composerReviewComments.length,
  });
  // ------------------------------------------------------------------
  // Derived: composer trigger / menu
  // ------------------------------------------------------------------
  const composerTriggerKind = composerTrigger?.kind ?? null;
  // A crewmate `@` (the lead's chat) offers files after the crewmates, so it
  // searches them as a file `@` does.
  const isPathTrigger = composerTriggerKind === "path" || composerTriggerKind === "crewmate";
  const pathTriggerQuery = isPathTrigger ? (composerTrigger?.query ?? "") : "";
  const workspaceEntries = useComposerPathSearch({
    environmentId,
    cwd: isPathTrigger ? gitCwd : null,
    query: isPathTrigger ? pathTriggerQuery : null,
  });
  const dataMentions = useZeropsDataMentions(
    environmentId,
    isPathTrigger ? pathTriggerQuery : null,
  );
  const dataCatalogEntries = useDatabaseCatalog(environmentId).entries;
  const readDataMention = useDatabaseMentionRead(environmentId);
  // `/compact` is offered where the command is all the draft says: read of the words only while
  // a command is being typed.
  const slashCommandStandsAlone = useComposerDraftStore((store) => {
    if (composerTrigger?.kind !== "slash-command") return false;
    const words = composerDraftWords(store, composerDraftTarget);
    return commandStandsAlone(words, {
      start: composerTrigger.rangeStart,
      end: composerTrigger.rangeEnd,
    });
  });
  const compactSlashCommandAvailable = compactCommandOffered({
    standsAlone: slashCommandStandsAlone,
    compactUnavailable: compactThreadUnavailable,
    load: {
      pictures: composerImages.length,
      files: composerFiles.length,
      keptAttachments: composerDraft.persistedAttachments.length,
      terminalContexts: composerTerminalContexts.length,
      reviewComments: composerReviewComments.length,
    },
  });

  const mcpCommandOffered = props.onMcpCommand !== undefined;
  const composerMenuItems = useComposerMenuItems({
    composerTrigger,
    mentionCrewmates,
    mentionMates,
    workspaceEntries,
    dataMentions,
    mcpCommandOffered,
    planModeUiEnabled,
    selectedProviderSkills,
    settings,
    selectedProviderSlashCommands,
    selectedProvider,
    compactSlashCommandAvailable,
    selectedProviderStatus,
  });

  const composerMenuOpen = Boolean(composerTrigger);
  // The suggestion list's id, apart for every composer on the page: the editor points a screen
  // reader at the option the keys are on by it.
  const composerSuggestionListId = `${useId()}-suggestions`;
  const composerMenuSearchKey = composerTrigger
    ? `${composerTrigger.kind}:${composerTrigger.query.trim().toLowerCase()}`
    : null;
  const {
    highlightedItemId: composerHighlightedItemId,
    setHighlightedItemId: setComposerHighlightedItemId,
    highlightedSearchKey: composerHighlightedSearchKey,
    setHighlightedSearchKey: setComposerHighlightedSearchKey,
  } = useComposerMenuHighlight({
    menuOpen: composerMenuOpen,
    items: composerMenuItems,
    searchKey: composerMenuSearchKey,
  });
  const activeComposerMenuItem = useMemo(() => {
    const activeItemId = resolveComposerMenuActiveItemId({
      items: composerMenuItems,
      highlightedItemId: composerHighlightedItemId,
      currentSearchKey: composerMenuSearchKey,
      highlightedSearchKey: composerHighlightedSearchKey,
    });
    return composerMenuItems.find((item) => item.id === activeItemId) ?? null;
  }, [
    composerHighlightedItemId,
    composerHighlightedSearchKey,
    composerMenuItems,
    composerMenuSearchKey,
  ]);

  composerMenuOpenRef.current = composerMenuOpen;
  composerMenuItemsRef.current = composerMenuItems;
  activeComposerMenuItemRef.current = activeComposerMenuItem;

  const nonPersistedComposerImageIdSet = useMemo(
    () => new Set(nonPersistedComposerImageIds),
    [nonPersistedComposerImageIds],
  );
  const composerPictureChips = useMemo(
    () =>
      composerPictures.chips.map((chip) => ({
        ...chip,
        unsaved: nonPersistedComposerImageIdSet.has(chip.id),
      })),
    [composerPictures.chips, nonPersistedComposerImageIdSet],
  );

  // What the editor holds: nothing under an approval, the answer under a question, the draft's
  // words otherwise — read by the editor as they change, from where they are kept.
  const editorContent = editorHolds(composerWaits);
  const editorWordsInPlaceOfDraft =
    editorContent === "nothing"
      ? ""
      : editorContent === "answer" && activePendingProgress !== null
        ? activePendingProgress.customAnswer
        : null;
  const editorWords = useMemo<ComposerEditorWords>(
    () => ({
      subscribe: (onChange) => {
        const offDraft = useComposerDraftStore.subscribe(onChange);
        const offCaret = composerCaret.subscribe(onChange);
        return () => {
          offDraft();
          offCaret();
        };
      },
      value: () => editorWordsInPlaceOfDraft ?? readComposerDraftWords(composerDraftTarget),
      cursor: composerCaret.read,
    }),
    [composerCaret, composerDraftTarget, editorWordsInPlaceOfDraft],
  );
  const composerSuggestionsVisible = composerMenuOpen && !isComposerApprovalState;
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const isChoiceOnlyPendingQuestion = composerWaits.openQuestion === "choice-only";
  const fieldCarriesDraft = promptFieldCarriesDraft(composerWaits);
  // A value the Mate asked for waits after any approval or question: one ask at a time. Its card
  // stands in the conversation; it docks here too once the Mate's turn has stopped on it, while
  // that card is out of view.
  const openVaultAskId = useOpenVaultAskId(routeKind === "server" ? routeThreadRef : null);
  const cardOnScreen = useAskCardOnScreen(openVaultAskId);
  // Any other ask a card offered to dock (an MCP server's setup) stands there by the same rule.
  const dockedAsk = useDockedAsk(routeKind === "server" ? scopedThreadKey(routeThreadRef) : null);
  const dockedOnScreen = useAskCardOnScreen(dockedAsk?.askId ?? null);
  const ask = composerAsk({
    waits: composerWaits,
    vaultDocks:
      openVaultAskId !== null &&
      docksAboveComposer("waiting", { turnRunning: phase === "running", cardOnScreen }),
    otherDocks:
      dockedAsk !== null &&
      docksAboveComposer("waiting", {
        turnRunning: phase === "running",
        cardOnScreen: dockedOnScreen,
      }),
  });
  const vaultAskWaits = ask === "vault";
  const dockedAskWaits = ask === "docked" && dockedAsk !== null;
  // What the agent asks stands at the composer's top in the look of the change waiting for review
  // (the owner's pick, S6 on the "Composer Strips" board, 2026-10-12); a phone's folded composer
  // keeps it in the drawer over its one line.
  const composerAsks = ask !== null;
  const showComposerTopDrawer = isComposerCollapsedMobile && composerAsks;
  const askFace = <ComposerAskFace environmentId={environmentId} />;
  const askName = useComposerAskName(environmentId);
  const showCollapsedMobilePromptRow =
    isComposerCollapsedMobile && !isComposerApprovalState && pendingUserInputs.length === 0;
  // The folded composer says the draft's words in the editor's place: read only while it is folded.
  const collapsedPromptWords = useComposerDraftStore((store) =>
    showCollapsedMobilePromptRow ? composerDraftWords(store, composerDraftTarget).trim() : "",
  );

  const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
  const composerFooterActionLayoutKey = useMemo(() => {
    if (activePendingProgress) {
      return `pending:${activePendingProgress.questionIndex}:${activePendingProgress.isLastQuestion}:${activePendingIsResponding}`;
    }
    if (phase === "running") {
      return "running";
    }
    if (showPlanFollowUpPrompt) {
      return promptHasText ? "plan:refine" : "plan:implement";
    }
    return `idle:${hasSendableContent}:${isSendBusy}:${isConnecting}:${isPreparingWorktree}`;
  }, [
    activePendingIsResponding,
    activePendingProgress,
    hasSendableContent,
    isConnecting,
    isPreparingWorktree,
    isSendBusy,
    phase,
    promptHasText,
    showPlanFollowUpPrompt,
  ]);

  const isComposerMenuLoading =
    composerTriggerKind === "path" && pathTriggerQuery.length > 0 && workspaceEntries.isPending;
  const composerMenuEmptyState = useMemo(() => {
    if (composerTriggerKind === "skill") {
      return "No skills found. Try / to browse provider commands.";
    }
    if (composerTriggerKind !== "path") return "No matching command.";
    // `@` also names the person's other Mates here: the empty line says so.
    return mentionMates !== undefined && mentionMates.length > 0
      ? "No Mate, file or folder by that name."
      : "No matching files or folders.";
  }, [composerTriggerKind, mentionMates]);

  // ------------------------------------------------------------------
  // Provider traits UI
  // ------------------------------------------------------------------
  const setPromptFromTraits = useCallback(
    (rewrite: (prompt: string) => string) => {
      const nextPrompt = rewrite(readComposerDraftWords(composerDraftTarget));
      if (nextPrompt === promptRef.current) {
        scheduleComposerFocus();
        return;
      }
      promptRef.current = nextPrompt;
      setComposerDraftPrompt(composerDraftTarget, nextPrompt);
      const nextCursor = collapseExpandedComposerCursor(nextPrompt, nextPrompt.length);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectTrigger(nextPrompt, nextPrompt.length));
      scheduleComposerFocus();
    },
    [
      setComposerCursor,
      detectTrigger,
      composerDraftTarget,
      promptRef,
      scheduleComposerFocus,
      setComposerDraftPrompt,
      setComposerTrigger,
    ],
  );

  // The model's traits, read and written by the one control (C4): its label
  // says the effort, its menu holds every choice. A draft or a thread holds
  // them; with neither, the menu offers the access alone.
  const composerTraitsInput: ComposerTraitsInput | null =
    routeKind === "server" || (routeKind === "draft" && draftId)
      ? {
          provider: selectedProvider,
          instanceId: selectedInstanceId,
          ...(routeKind === "server" ? { threadRef: routeThreadRef } : {}),
          ...(routeKind === "draft" && draftId ? { draftId } : {}),
          model: selectedModel,
          models: selectedProviderModels,
          modelOptions: selectedComposerModelOptions,
          prompt: effortWords,
          onPromptChange: setPromptFromTraits,
          planModeEnabled: settings.planModeEnabled,
        }
      : null;
  const composerTraits = getTraitsSectionVisibility({
    provider: selectedProvider,
    models: selectedProviderModels,
    model: selectedModel,
    prompt: effortWords,
    modelOptions: selectedComposerModelOptions,
    planModeEnabled: settings.planModeEnabled,
  });
  // The access lives in the one control's menu, which opens only where the
  // control stands: with the provider's setup in its place, the access keeps a
  // control of its own. A catalog still read is a beat before the menu opens,
  // not a place of its own: the toolbar keeps the one look it will have
  // (pass 30), where a "Full access" control stood for that beat and went.
  const accessInToolbar = showsAccessControl(runtimeMode, {
    modelMenuOpens: !(showProviderUnavailable && !zeropsSignInRequired),
  });
  const pendingPrimaryAction = useMemo(
    () =>
      activePendingProgress
        ? {
            questionIndex: activePendingProgress.questionIndex,
            isLastQuestion: activePendingProgress.isLastQuestion,
            canAdvance: activePendingProgress.canAdvance,
            isResponding: activePendingIsResponding,
            isComplete: Boolean(activePendingResolvedAnswers),
          }
        : null,
    [activePendingIsResponding, activePendingProgress, activePendingResolvedAnswers],
  );
  const away = sendAway({
    environmentUnavailable,
    projectMissing: projectSelectionRequired,
    provider: providerState,
  });
  const collapsedComposerPrimaryActionDisabled =
    phase === "running" ||
    !hasSendableContent ||
    sendHeld({
      busy: isSendBusy,
      blocked: isSendDisabled,
      connecting: isConnecting,
      unavailable: away !== null,
    });
  const showMobilePendingAnswerActions =
    isMobileViewport && !isComposerCollapsedMobile && pendingPrimaryAction !== null;

  // ------------------------------------------------------------------
  // Prompt helpers
  // ------------------------------------------------------------------
  const setPrompt = useCallback(
    (nextPrompt: string) => {
      setComposerDraftPrompt(composerDraftTarget, nextPrompt);
    },
    [composerDraftTarget, setComposerDraftPrompt],
  );

  const removeComposerTerminalContextFromDraft = useCallback(
    (contextId: string) => {
      const contextIndex = composerTerminalContexts.findIndex(
        (context) => context.id === contextId,
      );
      if (contextIndex < 0) return;
      const removal = removeInlineTerminalContextPlaceholder(promptRef.current, contextIndex);
      promptRef.current = removal.prompt;
      setPrompt(removal.prompt);
      removeComposerDraftTerminalContext(composerDraftTarget, contextId);
      const nextCursor = collapseExpandedComposerCursor(removal.prompt, removal.cursor);
      setComposerCursor(nextCursor);
      setComposerTrigger(detectTrigger(removal.prompt, removal.cursor));
    },
    [
      setComposerCursor,
      detectTrigger,
      composerDraftTarget,
      composerTerminalContexts,
      promptRef,
      removeComposerDraftTerminalContext,
      setPrompt,
    ],
  );

  // ------------------------------------------------------------------
  // Sync refs back to parent
  // ------------------------------------------------------------------
  // The draft's words as they change, whoever wrote them: the parent's copy follows, and the caret
  // stays inside them. Followed here, not read, so the words changing draws nothing of the composer.
  const followedWordsRef = useRef<string | null>(null);
  useEffect(() => {
    const follow = (words: string) => {
      if (words === followedWordsRef.current) return;
      followedWordsRef.current = words;
      promptRef.current = words;
      composerCaret.set(clampCollapsedComposerCursor(words, composerCaret.read()));
    };
    follow(readComposerDraftWords(composerDraftTarget));
    return watchComposerDraftWords(composerDraftTarget, follow);
  }, [composerCaret, composerDraftTarget, promptRef]);

  // An error of the words is read again as they change: watched only while one shows.
  useEffect(() => {
    if (composerSubmissionError === null) return;
    const recheck = (words: string) => {
      const nextError = getComposerPromptLengthValidationMessage(words);
      if (nextError !== composerSubmissionError) {
        setComposerSubmissionError(nextError);
      }
    };
    recheck(readComposerDraftWords(composerDraftTarget));
    return watchComposerDraftWords(composerDraftTarget, recheck);
  }, [composerDraftTarget, composerSubmissionError]);

  useSyncStateOnChange(providerInputSubmissionError, setProviderInputSubmissionError, null, [
    composerReviewComments,
    composerTerminalContexts,
    selectedModel,
    selectedPromptEffort,
    selectedProvider,
  ]);
  // The words changing takes the agent's refusal back too: watched only while it shows.
  useComposerDraftWordsChange(composerDraftTarget, providerInputSubmissionError !== null, () =>
    setProviderInputSubmissionError(null),
  );

  useEffect(() => {
    composerImagesRef.current = composerImages;
  }, [composerImages, composerImagesRef]);

  useEffect(() => {
    composerTerminalContextsRef.current = composerTerminalContexts;
  }, [composerTerminalContexts, composerTerminalContextsRef]);

  const lastSyncedPendingInputRef = useRef<{
    requestId: string | null;
    questionId: string | null;
  } | null>(null);

  // While a question is answered the editor holds the answer, and the draft's words changing
  // behind it hands the parent's copy back to the answer: read only then.
  const draftWordsBehindAnswer = useComposerDraftStore((store) =>
    typeof activePendingProgress?.customAnswer === "string"
      ? composerDraftWords(store, composerDraftTarget)
      : null,
  );
  useEffect(() => {
    const nextCustomAnswer = activePendingProgress?.customAnswer;
    if (typeof nextCustomAnswer !== "string") {
      // The question is gone and the editor shows the thread draft again. The
      // ref still holds the last answer text, and Send reads the ref. Place
      // the caret at the end so the next keystroke appends.
      if (lastSyncedPendingInputRef.current !== null) {
        const words = readComposerDraftWords(composerDraftTarget);
        promptRef.current = words;
        const { cursor, trigger } = composerStateAtPromptEnd(words);
        setComposerCursor(cursor);
        resetComposerTrigger(trigger);
      }
      lastSyncedPendingInputRef.current = null;
      return;
    }

    const nextRequestId = activePendingUserInput?.requestId ?? null;
    const nextQuestionId = activePendingProgress?.activeQuestion?.id ?? null;
    const questionChanged =
      lastSyncedPendingInputRef.current?.requestId !== nextRequestId ||
      lastSyncedPendingInputRef.current?.questionId !== nextQuestionId;
    const textChangedExternally = promptRef.current !== nextCustomAnswer;

    lastSyncedPendingInputRef.current = {
      requestId: nextRequestId,
      questionId: nextQuestionId,
    };

    if (!questionChanged && !textChangedExternally) {
      return;
    }

    promptRef.current = nextCustomAnswer;
    const { cursor, trigger } = composerStateAtPromptEnd(nextCustomAnswer);
    setComposerCursor(cursor);
    resetComposerTrigger(trigger);
    setComposerHighlightedItemId(null);
  }, [
    activePendingProgress?.customAnswer,
    activePendingProgress?.activeQuestion?.id,
    activePendingUserInput?.requestId,
    composerDraftTarget,
    draftWordsBehindAnswer,
    promptRef,
    resetComposerTrigger,
    setComposerCursor,
  ]);

  // ------------------------------------------------------------------
  // Reset compositor state on thread/draft change
  // ------------------------------------------------------------------
  useEffect(() => {
    setComposerHighlightedItemId(null);
    setComposerSubmissionError(null);
    setProviderInputSubmissionError(null);
    setComposerCursor(collapseExpandedComposerCursor(promptRef.current, promptRef.current.length));
    resetComposerTrigger(detectTrigger(promptRef.current, promptRef.current.length));
    setIsDragOverComposer(false);
  }, [detectTrigger, draftId, activeThreadId, promptRef, resetComposerTrigger, setComposerCursor]);

  // ------------------------------------------------------------------
  // Footer compact layout observation
  // ------------------------------------------------------------------
  useLayoutEffect(() => {
    const composerForm = composerFormRef.current;
    if (!composerForm) return;
    // Only wide actions shorten to fit. Without them nothing is measured: reading the form's width
    // here laid the page out in the middle of the first key typed (Send coming on changes the key
    // below), and the frame laid it out again.
    if (!composerFooterHasWideActions) {
      setIsComposerPrimaryActionsCompact(false);
      return;
    }
    const measurePrimaryActionsCompactness = () =>
      shouldUseCompactComposerPrimaryActions(composerForm.clientWidth, {
        hasWideActions: composerFooterHasWideActions,
      });

    setIsComposerPrimaryActionsCompact(measurePrimaryActionsCompactness());
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      const nextCompact = measurePrimaryActionsCompactness();
      setIsComposerPrimaryActionsCompact((previous) =>
        previous === nextCompact ? previous : nextCompact,
      );
    });

    observer.observe(composerForm);
    return () => {
      observer.disconnect();
    };
  }, [activeThreadId, composerFooterActionLayoutKey, composerFooterHasWideActions]);

  // ------------------------------------------------------------------
  // Image persist effect
  // ------------------------------------------------------------------
  useEffect(() => {
    if (composerImages.length === 0) {
      clearComposerDraftPersistedAttachments(composerDraftTarget);
      return;
    }
    let cancelled = false;
    // In the draft's order, and only files not read before are read.
    void persistableImageAttachments(
      composerImages,
      getComposerDraft(composerDraftTarget)?.persistedAttachments ?? [],
      readComposerFileDataUrl,
    ).then((attachments) => {
      if (!cancelled) syncComposerDraftPersistedAttachments(composerDraftTarget, attachments);
    });
    return () => {
      cancelled = true;
    };
  }, [
    composerDraftTarget,
    clearComposerDraftPersistedAttachments,
    composerImages,
    getComposerDraft,
    syncComposerDraftPersistedAttachments,
  ]);

  // ------------------------------------------------------------------
  // Callbacks: prompt change
  // ------------------------------------------------------------------
  const onPromptChange = useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      expandedCursor: number,
      cursorAdjacentToMention: boolean,
      terminalContextIds: string[],
      pictureIds: string[],
      fileIds: string[] = [],
    ) => {
      if (activePendingProgress?.activeQuestion && pendingUserInputs.length > 0) {
        if (activePendingProgress.activeQuestion.allowCustomAnswer === false) return;
        setComposerCursor(nextCursor);
        setComposerTrigger(
          cursorAdjacentToMention ? null : detectTrigger(nextPrompt, expandedCursor),
        );
        onChangeActivePendingUserInputCustomAnswer(
          activePendingProgress.activeQuestion.id,
          nextPrompt,
          nextCursor,
          expandedCursor,
          cursorAdjacentToMention,
        );
        return;
      }
      // The draft's pictures follow the text; a place whose picture is gone leaves it.
      const picturesHealed = composerPictures.sync(pictureIds, nextPrompt);
      // So do its files, each matched to its own place.
      const filesHealed = composerFileList.sync(fileIds, picturesHealed ?? nextPrompt);
      const healedPrompt = filesHealed ?? picturesHealed;
      if (healedPrompt !== null) {
        promptRef.current = healedPrompt;
        setPrompt(healedPrompt);
        return;
      }
      promptRef.current = nextPrompt;
      setPrompt(nextPrompt);
      // Any edit ends browsing, even one later undone by hand: typing a
      // character and deleting it leaves the text equal to the recall, and
      // ArrowDown must move the caret then, not clear the composer.
      if (promptHistoryPositionRef.current?.recalled !== nextPrompt) {
        promptHistoryPositionRef.current = null;
      }
      if (!terminalContextIdListsEqual(composerTerminalContexts, terminalContextIds)) {
        setComposerDraftTerminalContexts(
          composerDraftTarget,
          syncTerminalContextsByIds(composerTerminalContexts, terminalContextIds),
        );
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(
        cursorAdjacentToMention ? null : detectTrigger(nextPrompt, expandedCursor),
      );
    },
    [
      setComposerCursor,
      detectTrigger,
      activePendingProgress?.activeQuestion,
      pendingUserInputs.length,
      onChangeActivePendingUserInputCustomAnswer,
      promptRef,
      setPrompt,
      setComposerTrigger,
      composerDraftTarget,
      composerFileList,
      composerPictures,
      composerTerminalContexts,
      setComposerDraftTerminalContexts,
    ],
  );

  // ------------------------------------------------------------------
  // Callbacks: prompt replacement / menu
  // ------------------------------------------------------------------
  const applyPromptReplacement = useCallback(
    (
      rangeStart: number,
      rangeEnd: number,
      replacement: string,
      options?: { expectedText?: string; focusEditorAfterReplace?: boolean },
    ): boolean => {
      if (
        activePendingUserInput &&
        activePendingProgress?.activeQuestion?.allowCustomAnswer === false
      ) {
        return false;
      }
      const currentText = promptRef.current;
      const safeStart = Math.max(0, Math.min(currentText.length, rangeStart));
      const safeEnd = Math.max(safeStart, Math.min(currentText.length, rangeEnd));
      if (
        options?.expectedText !== undefined &&
        currentText.slice(safeStart, safeEnd) !== options.expectedText
      ) {
        return false;
      }
      const next = replaceTextRange(promptRef.current, rangeStart, rangeEnd, replacement);
      const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
      const nextExpandedCursor = expandCollapsedComposerCursor(next.text, nextCursor);
      promptRef.current = next.text;
      const activePendingQuestion = activePendingProgress?.activeQuestion;
      if (activePendingQuestion && activePendingUserInput) {
        onChangeActivePendingUserInputCustomAnswer(
          activePendingQuestion.id,
          next.text,
          nextCursor,
          nextExpandedCursor,
          false,
        );
      } else {
        setPrompt(next.text);
      }
      setComposerCursor(nextCursor);
      setComposerTrigger(detectTrigger(next.text, nextExpandedCursor));
      if (options?.focusEditorAfterReplace !== false) {
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAt(nextCursor);
        });
      }
      return true;
    },
    [
      setComposerCursor,
      detectTrigger,
      activePendingProgress?.activeQuestion,
      activePendingUserInput,
      onChangeActivePendingUserInputCustomAnswer,
      promptRef,
      setPrompt,
      setComposerTrigger,
    ],
  );

  const readComposerSnapshot = useCallback((): ComposerEditorSnapshot => {
    const editorSnapshot = composerEditorRef.current?.readSnapshot();
    if (editorSnapshot) {
      return editorSnapshot;
    }
    return {
      value: promptRef.current,
      cursor: composerCaret.read(),
      expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCaret.read()),
      terminalContextIds: composerTerminalContexts.map((context) => context.id),
      pictureIds: composerImages.map((image) => image.id),
      fileIds: composerFiles.map((file) => file.id),
    };
  }, [composerCaret, composerFiles, composerImages, composerTerminalContexts, promptRef]);

  // A key the key button put in the vault: its `$NAME` at the caret, which the editor draws as the
  // key (`ComposerVaultKeysContext`) and the Mate reads with the vault's note on it.
  const vaultKeys = useComposerVaultKeys(environmentId);
  const insertVaultKey = useCallback(
    (key: string) => {
      const { value, expandedCursor } = readComposerSnapshot();
      const before = value[expandedCursor - 1];
      const lead = before === undefined || /\s/.test(before) ? "" : " ";
      return applyPromptReplacement(expandedCursor, expandedCursor, `${lead}$${key} `);
    },
    [applyPromptReplacement, readComposerSnapshot],
  );

  /**
   * Attaches a context at the caret: the same inline-placeholder insertion the
   * Data panel and the terminal selection both go through, so the chip lands
   * where the user is typing and materializes into its mention on send.
   */
  const attachContextAtCursor = useCallback(
    (selection: TerminalContextSelection) => {
      if (!activeThread || isChoiceOnlyPendingQuestion) return;
      const snapshot = composerEditorRef.current?.readSnapshot() ?? {
        value: promptRef.current,
        cursor: composerCaret.read(),
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCaret.read()),
        terminalContextIds: composerTerminalContexts.map((context) => context.id),
        pictureIds: composerImages.map((image) => image.id),
        fileIds: composerFiles.map((file) => file.id),
      };
      const insertion = insertInlineTerminalContextPlaceholder(
        snapshot.value,
        snapshot.expandedCursor,
      );
      const nextCollapsedCursor = collapseExpandedComposerCursor(
        insertion.prompt,
        insertion.cursor,
      );
      const inserted = insertComposerDraftTerminalContext(
        composerDraftTarget,
        insertion.prompt,
        {
          id: randomUUID(),
          threadId: activeThread.id,
          createdAt: new Date().toISOString(),
          ...selection,
        },
        insertion.contextIndex,
      );
      if (!inserted) return;
      promptRef.current = insertion.prompt;
      setComposerCursor(nextCollapsedCursor);
      setComposerTrigger(detectTrigger(insertion.prompt, insertion.cursor));
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCollapsedCursor);
      });
    },
    [
      detectTrigger,
      activeThread,
      composerCaret,
      composerDraftTarget,
      composerTerminalContexts,
      insertComposerDraftTerminalContext,
      isChoiceOnlyPendingQuestion,
      promptRef,
    ],
  );

  /**
   * Resolves a picked mention's schema, then swaps the typed `@db` text for
   * its chip in ONE mutation over `promptRef` — never by reading the editor
   * back after a separate removal, which races the editor and leaves the
   * literal mention in the prompt beside its own chip.
   *
   * The schema is resolved first so a failed lookup leaves what the user
   * typed exactly as it is.
   */
  const attachDataMentionContext = useCallback(
    async (entry: DataMentionEntry, rangeStart: number, rangeEnd: number, typedText: string) => {
      if (!activeThread || isChoiceOnlyPendingQuestion) return;
      const described = await (async () => {
        if (entry.kind === "service") {
          return describeServiceContext(entry, dataCatalogEntries);
        }
        return readDataMention(entry);
      })();
      if (described === undefined) return;
      // The user may have kept typing while the schema was in flight; only
      // replace the range if it still holds exactly what they picked from.
      if (promptRef.current.slice(rangeStart, rangeEnd) !== typedText) return;
      const insertion = replaceMentionWithInlineContextPlaceholder(
        promptRef.current,
        rangeStart,
        rangeEnd,
      );
      const inserted = insertComposerDraftTerminalContext(
        composerDraftTarget,
        insertion.prompt,
        {
          id: randomUUID(),
          threadId: activeThread.id,
          createdAt: new Date().toISOString(),
          kind: "data",
          token: entry.token,
          terminalId: `data:${described.label}`,
          terminalLabel: described.label,
          lineStart: 1,
          lineEnd: described.text.split("\n").length,
          text: described.text,
        },
        insertion.contextIndex,
      );
      if (!inserted) return;
      promptRef.current = insertion.prompt;
      const nextCollapsedCursor = collapseExpandedComposerCursor(
        insertion.prompt,
        insertion.cursor,
      );
      setComposerCursor(nextCollapsedCursor);
      setComposerTrigger(null);
      window.requestAnimationFrame(() => {
        composerEditorRef.current?.focusAt(nextCollapsedCursor);
      });
    },
    [
      activeThread,
      readDataMention,
      composerDraftTarget,
      dataCatalogEntries,
      environmentId,
      insertComposerDraftTerminalContext,
      isChoiceOnlyPendingQuestion,
      promptRef,
      setComposerCursor,
    ],
  );

  const resolveActiveComposerTrigger = useCallback((): {
    snapshot: { value: string; cursor: number; expandedCursor: number };
    trigger: ComposerTrigger | null;
  } => {
    const snapshot = readComposerSnapshot();
    return {
      snapshot,
      trigger: resolveComposerTrigger(detectTrigger(snapshot.value, snapshot.expandedCursor)),
    };
  }, [detectTrigger, readComposerSnapshot, resolveComposerTrigger]);

  const { onUsageLimitsCommand, onMcpCommand } = props;
  const onSelectComposerItem = useCallback(
    (item: ComposerCommandItem) => {
      if (composerSelectLockRef.current) return;
      composerSelectLockRef.current = true;
      window.requestAnimationFrame(() => {
        composerSelectLockRef.current = false;
      });
      const { snapshot, trigger } = resolveActiveComposerTrigger();
      if (!trigger) return;
      if (item.type === "crewmate" || item.type === "mate") {
        const replacement = `${item.type === "mate" ? mateMentionText(item.name) : `@${item.handle}`} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "path") {
        if (!isPathSuggestionCurrent(item.searchTarget, trigger, environmentId, gitCwd)) return;
        const replacement = `${serializeComposerFileLink(item.path)} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "data") {
        setComposerHighlightedItemId(null);
        void attachDataMentionContext(
          item.entry,
          trigger.rangeStart,
          trigger.rangeEnd,
          snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
        );
        return;
      }
      if (item.type === "slash-command") {
        if (item.command === "model") {
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
            focusEditorAfterReplace: false,
          });
          if (applied) {
            setComposerHighlightedItemId(null);
            setIsComposerModelPickerOpen(true);
          }
          return;
        }
        if (item.command === "mcp") {
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
            focusEditorAfterReplace: false,
          });
          if (applied) {
            setComposerHighlightedItemId(null);
            onMcpCommand?.();
          }
          return;
        }
        if (!planModeUiEnabled) return;
        void handleInteractionModeChange(item.command === "plan" ? "plan" : "default");
        const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
          expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
        });
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "provider-slash-command") {
        if (item.command.name === USAGE_LIMITS_COMMAND.name && onUsageLimitsCommand) {
          const applied = applyPromptReplacement(trigger.rangeStart, trigger.rangeEnd, "", {
            expectedText: snapshot.value.slice(trigger.rangeStart, trigger.rangeEnd),
            focusEditorAfterReplace: false,
          });
          if (applied) {
            setComposerHighlightedItemId(null);
            onUsageLimitsCommand();
          }
          return;
        }
        const replacement = `/${item.command.name} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
      if (item.type === "skill") {
        const replacement = `$${item.skill.name} `;
        const replacementRangeEnd = extendReplacementRangeForTrailingSpace(
          snapshot.value,
          trigger.rangeEnd,
          replacement,
        );
        const applied = applyPromptReplacement(
          trigger.rangeStart,
          replacementRangeEnd,
          replacement,
          { expectedText: snapshot.value.slice(trigger.rangeStart, replacementRangeEnd) },
        );
        if (applied) {
          setComposerHighlightedItemId(null);
        }
        return;
      }
    },
    [
      applyPromptReplacement,
      attachDataMentionContext,
      environmentId,
      gitCwd,
      handleInteractionModeChange,
      planModeUiEnabled,
      onUsageLimitsCommand,
      onMcpCommand,
      resolveActiveComposerTrigger,
    ],
  );

  const onComposerMenuItemHighlighted = useCallback(
    (itemId: string | null) => {
      setComposerHighlightedItemId(itemId);
      setComposerHighlightedSearchKey(composerMenuSearchKey);
    },
    [composerMenuSearchKey],
  );

  const nudgeComposerMenuHighlight = useCallback(
    (key: "ArrowDown" | "ArrowUp") => {
      if (composerMenuItems.length === 0) return;
      const highlightedIndex = composerMenuItems.findIndex(
        (item) => item.id === composerHighlightedItemId,
      );
      const normalizedIndex =
        highlightedIndex >= 0 ? highlightedIndex : key === "ArrowDown" ? -1 : 0;
      const offset = key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        (normalizedIndex + offset + composerMenuItems.length) % composerMenuItems.length;
      const nextItem = composerMenuItems[nextIndex];
      setComposerHighlightedItemId(nextItem?.id ?? null);
    },
    [composerHighlightedItemId, composerMenuItems],
  );

  const blurMobileComposerAfterSend = useCallback(() => {
    if (!isMobileViewport) return;
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
      composerBlurFrameRef.current = null;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
    setIsComposerFocused(false);
  }, [isMobileViewport]);

  const shouldBlurMobileComposerOnSubmit = useCallback(() => {
    if (!isMobileViewport) return false;
    if (
      isSendBusy ||
      isSendDisabled ||
      isConnecting ||
      noProviderAvailable ||
      environmentUnavailable ||
      phase === "running"
    ) {
      return false;
    }
    if (activePendingProgress) {
      return activePendingProgress.isLastQuestion && Boolean(activePendingResolvedAnswers);
    }
    return showPlanFollowUpPrompt || hasSendableContent;
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    hasSendableContent,
    environmentUnavailable,
    isConnecting,
    isMobileViewport,
    isSendBusy,
    isSendDisabled,
    noProviderAvailable,
    phase,
    showPlanFollowUpPrompt,
  ]);

  const submitComposer = useCallback(
    (event?: { preventDefault: () => void }, intent: ComposerSubmissionIntent = "foreground") => {
      // A send while a pasted image is still being read would strand that
      // image: the turn snapshot wouldn't include it, and it would surface
      // in the *next* draft instead. Only oversized images hit this — small
      // files clear the pending counter within a microtask.
      const refusal = sendRefusal({
        providerPicked: !noProviderAvailable,
        sendBlocked: isSendDisabled,
        compressing:
          activeThreadId !== null &&
          (pendingImageCompressionsRef.current.get(activeThreadId) ?? 0) > 0,
      });
      if (refusal !== null) {
        event?.preventDefault();
        // Pictures on their way are no reason to press Send again: the send waits for them.
        const waitsOnPictures =
          refusal === "compressing" ||
          (!noProviderAvailable &&
            attachmentBlockReason !== null &&
            sendDisabledReason === attachmentBlockReason &&
            !attachmentUploadFailed);
        if (activeThreadId !== null && waitsOnPictures) {
          setHeldSend({ threadId: activeThreadId, intent, settingsKey: sendSettingsKey });
        }
        return;
      }
      const submission = submitComposerDraft({
        prompt: promptRef.current,
        submissionTarget: activePendingProgress ? "pending-user-input" : "provider-turn",
        event,
        onSend: (sendEvent) => {
          // ChatView reports its final composed-input preflight through the
          // composer handle before its first asynchronous send step.
          providerInputRejectedRef.current = false;
          onSend(sendEvent, intent);
          return !providerInputRejectedRef.current;
        },
      });
      setComposerSubmissionError(submission.validationMessage);
      if (!submission.didDispatch) return;
      leaveFullComposer();
      if (shouldBlurMobileComposerOnSubmit()) {
        blurMobileComposerAfterSend();
      }
    },
    [
      activeThreadId,
      activePendingProgress,
      attachmentBlockReason,
      attachmentUploadFailed,
      blurMobileComposerAfterSend,
      isSendDisabled,
      leaveFullComposer,
      noProviderAvailable,
      onSend,
      promptRef,
      sendDisabledReason,
      sendSettingsKey,
      shouldBlurMobileComposerOnSubmit,
    ],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases a held send in the render where its pictures joined the draft and stopped holding it
  useEffect(() => {
    if (heldSend === null) return;
    // Another conversation, a failed upload, another model or mode, or a question that now takes
    // the composer's words: the send asked for is not the one that would go, so it is taken back.
    if (
      heldSend.threadId !== activeThreadId ||
      attachmentUploadFailed ||
      heldSend.settingsKey !== sendSettingsKey ||
      activePendingProgress !== null
    ) {
      setHeldSend(null);
      return;
    }
    const reading = (pendingImageCompressionsRef.current.get(heldSend.threadId) ?? 0) > 0;
    if (reading || attachmentBlockReason !== null) return;
    setHeldSend(null);
    const { intent } = heldSend;
    // After the composer's later effects have synced its draft refs to this render.
    queueMicrotask(() => submitComposer(undefined, intent));
  }, [
    activeThreadId,
    activePendingProgress,
    attachmentBlockReason,
    attachmentUploadFailed,
    heldSend,
    imageReadsSettled,
    sendSettingsKey,
    submitComposer,
  ]);
  // The person's own change to the draft takes a waiting send back: words edited, a picture
  // removed. The pictures it waits on landing (their place and its line break written with them,
  // in one store write) are no change of theirs; new pictures added take it back where they start.
  useEffect(() => {
    if (heldSend === null) return;
    const draftOf = (state: ReturnType<typeof useComposerDraftStore.getState>) =>
      state.getComposerDraft(composerDraftTarget);
    let last = draftOf(useComposerDraftStore.getState());
    return useComposerDraftStore.subscribe((state) => {
      const next = draftOf(state);
      if (next === last) return;
      const before = new Set((last?.images ?? []).map((image) => image.id));
      const after = new Set((next?.images ?? []).map((image) => image.id));
      const removed = [...before].some((id) => !after.has(id));
      const landed = [...after].some((id) => !before.has(id));
      const edited = !landed && (next?.prompt ?? "") !== (last?.prompt ?? "");
      last = next;
      if (removed || edited) setHeldSend(null);
    });
  }, [composerDraftTarget, heldSend]);
  const compactThreadContext = useCallback(() => {
    // The compact buttons cannot see the compression counter (it lives in
    // a ref), so they render enabled during a paste; toast instead of
    // silently ignoring the click.
    const refusal = compactRefusal({
      compactDisabled,
      providerPicked: !noProviderAvailable,
      waits: composerWaits,
      running: phase === "running",
      sendBusy: isSendBusy,
      connecting: isConnecting,
      threadOpen: Boolean(activeThreadId),
      compressing:
        activeThreadId !== null &&
        (pendingImageCompressionsRef.current.get(activeThreadId) ?? 0) > 0,
    });
    if (refusal !== null) {
      if (refusal === "compressing") {
        toastManager.add({
          type: "info",
          title: "Still compressing a pasted image.",
          description: "Compact again once its thumbnail appears.",
        });
      }
      return;
    }

    onCompactContext();
  }, [
    activeThreadId,
    compactDisabled,
    composerWaits,
    isConnecting,
    isSendBusy,
    noProviderAvailable,
    onCompactContext,
    phase,
  ]);
  const expandMobileComposer = useCallback(() => {
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
      composerBlurFrameRef.current = null;
    }
    if (mobileComposerExpandFrameRef.current !== null) {
      window.cancelAnimationFrame(mobileComposerExpandFrameRef.current);
    }
    if (mobileComposerExpandReleaseFrameRef.current !== null) {
      window.cancelAnimationFrame(mobileComposerExpandReleaseFrameRef.current);
    }
    mobileComposerExpandInFlightRef.current = true;
    setIsComposerFocused(true);
    mobileComposerExpandFrameRef.current = window.requestAnimationFrame(() => {
      mobileComposerExpandFrameRef.current = null;
      composerEditorRef.current?.focusAtEnd();
      mobileComposerExpandReleaseFrameRef.current = window.requestAnimationFrame(() => {
        mobileComposerExpandReleaseFrameRef.current = null;
        mobileComposerExpandInFlightRef.current = false;
      });
    });
  }, []);

  // ------------------------------------------------------------------
  // Prompt history (ArrowUp / ArrowDown)
  // ------------------------------------------------------------------
  // Entries are built on the keypress, not per render: the timeline changes
  // on every streamed delta and ArrowUp is rare.
  const promptHistoryMessagesRef = useRef(promptHistoryMessages);
  promptHistoryMessagesRef.current = promptHistoryMessages;

  // The composer persists across threads. A recall from thread A must not
  // be treated as active in thread B, where the text-match fallback could
  // otherwise turn B's own draft into a browsing position.
  const promptHistoryTargetKey = composerTargetKey(composerDraftTarget);
  useEffect(() => {
    promptHistoryPositionRef.current = null;
  }, [promptHistoryTargetKey]);

  const replacePromptFromHistory = useCallback(
    (nextPrompt: string) => {
      promptRef.current = nextPrompt;
      setComposerDraftPrompt(composerDraftTarget, nextPrompt);
      setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
      setComposerTrigger(null);
      setComposerHighlightedItemId(null);
    },
    [composerDraftTarget, promptRef, setComposerCursor, setComposerDraftPrompt, setComposerTrigger],
  );

  const navigatePromptHistory = useCallback(
    (direction: "backward" | "forward", event: KeyboardEvent): boolean => {
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.isComposing) {
        return false;
      }
      if (isComposerApprovalState || pendingUserInputs.length > 0) return false;
      // A composer holding an image or review comment is not empty.
      // Recalling text into it would send the old prompt with the new
      // context, which is never what ArrowUp meant.
      if (composerImages.length > 0 || composerReviewComments.length > 0) {
        return false;
      }
      // A typed draft with no active recall can never step, so skip the
      // layout read and the entry build for that common case.
      if (promptHistoryPositionRef.current === null && promptRef.current.length > 0) {
        return false;
      }
      const editor = composerEditorRef.current;
      if (!editor?.isCaretOnVisualEdge(direction === "backward" ? "start" : "end")) {
        return false;
      }
      const step = stepComposerPromptHistory({
        direction,
        entries: buildComposerPromptHistoryEntries(promptHistoryMessagesRef.current),
        position: promptHistoryPositionRef.current,
        currentPrompt: promptRef.current,
      });
      if (!step) return false;
      promptHistoryPositionRef.current = step.position;
      replacePromptFromHistory(step.prompt);
      return true;
    },
    [
      composerImages.length,
      composerReviewComments.length,
      isComposerApprovalState,
      pendingUserInputs.length,
      promptRef,
      replacePromptFromHistory,
    ],
  );

  // ------------------------------------------------------------------
  // Callbacks: command key
  // ------------------------------------------------------------------
  const onComposerCommandKey = (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Escape",
    event: KeyboardEvent,
  ) => {
    if (key === "Tab" && event.shiftKey) {
      if (!planModeUiEnabled) return false;
      toggleInteractionMode();
      return true;
    }
    const { trigger } = resolveActiveComposerTrigger();
    const menuIsActive = composerMenuOpenRef.current || trigger !== null;
    if (key === "Escape") {
      if (event.isComposing || event.keyCode === 229) return false;
      // Esc takes back a send waiting on its pictures; the words and pictures stay.
      if (!menuIsActive && heldSend !== null) {
        setHeldSend(null);
        return true;
      }
      if (!menuIsActive) {
        // A menu closes first; then Esc takes a full-screen composer back.
        if (fullComposer !== "on") return false;
        leaveFullComposer();
        return true;
      }
      dismissComposerTrigger(trigger);
      composerMenuOpenRef.current = false;
      return true;
    }
    if (menuIsActive) {
      const currentItems = composerMenuItemsRef.current;
      const selectedItem = activeComposerMenuItemRef.current ?? currentItems[0];
      if (key === "ArrowDown" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowDown");
        return true;
      }
      if (key === "ArrowUp" && currentItems.length > 0) {
        nudgeComposerMenuHighlight("ArrowUp");
        return true;
      }
      if ((key === "Enter" || key === "Tab") && selectedItem) {
        onSelectComposerItem(selectedItem);
        return true;
      }
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      return navigatePromptHistory(key === "ArrowUp" ? "backward" : "forward", event);
    }
    const submissionIntent =
      key === "Enter"
        ? composerSubmissionIntentForEnter({
            isMobileViewport,
            shiftKey: event.shiftKey,
            modifierKey: event.metaKey || event.ctrlKey,
            isDraftThread: routeKind === "draft",
            sendShortcut: settings.sendShortcut,
            prompt: promptRef.current,
          })
        : null;
    if (submissionIntent) {
      submitComposer(undefined, submissionIntent);
      return true;
    }
    return false;
  };

  // ------------------------------------------------------------------
  // Prompt stash (⌘S)
  // ------------------------------------------------------------------
  // One global queue. Stashed prompts carry only text + images so they can be
  // restored into any thread or provider — stash, switch, restore is the
  // whole point.
  const stashQueue = usePromptStashStore((state) => state.entries);
  const { restoreStashEntry, deleteStashEntry, stashCurrentPrompt } = useComposerStash({
    addComposerDraftImages,
    clearComposerDraftPromptAndImages,
    composerDraftTarget,
    composerEditorRef,
    composerImagesRef,
    promptRef,
    setComposerCursor,
    setComposerDraftPrompt,
    setComposerTrigger,
    setIsStashMenuOpen,
    setStashPulse,
    stashInFlightRef,
    stashPulseKeyRef,
    stashPulseTimeoutRef,
  });

  const toggleStashMenu = useCallback(() => {
    setIsStashMenuOpen((open) => !open);
  }, []);
  const toggleInlineStashMenu = useCallback(() => {
    if (isComposerCollapsedMobile) {
      expandMobileComposer();
      setIsStashMenuOpen(true);
      return;
    }
    toggleStashMenu();
  }, [expandMobileComposer, isComposerCollapsedMobile, toggleStashMenu]);
  const toggleTasksDrawer = useCallback(() => {
    setIsTasksDrawerOpen((open) => !open);
  }, []);
  const activeTasksTurnId = activeThread?.latestTurn?.turnId ?? null;
  const tasksDismissedForActiveTurn =
    activeTasksTurnId !== null && dismissedTasksTurnId === activeTasksTurnId;
  const visibleTasksProgress = tasksDismissedForActiveTurn ? null : activeTasksProgress;
  const visibleTaskSteps = tasksDismissedForActiveTurn ? null : activeTaskSteps;
  // An ask closes the tasks drawer and hides the shoulder tabs while it waits, as the drawer did.
  const hasBlockingComposerTopDrawer = composerAsks;
  const dismissTasks = useCallback(() => {
    if (activeTasksTurnId !== null) {
      setDismissedTasksTurnId(activeTasksTurnId);
    }
    setIsTasksDrawerOpen(false);
  }, [activeTasksTurnId]);
  const showInlineStashBadge =
    stashQueue.length > 0 &&
    !isComposerApprovalState &&
    (props.externalDrawerAttached ||
      composerAsks ||
      isTasksDrawerOpen ||
      isComposerCollapsedMobile);
  const inlineStashBadge = showInlineStashBadge ? (
    <ComposerStashBadge
      count={stashQueue.length}
      menuOpen={isStashMenuOpen}
      placement="inline"
      pulseKey={stashPulse.key}
      pulsing={stashPulse.active}
      onToggleMenu={toggleInlineStashMenu}
    />
  ) : null;
  const showInlineTasksBadge =
    visibleTasksProgress !== null &&
    visibleTaskSteps !== null &&
    !isTasksDrawerOpen &&
    !hasBlockingComposerTopDrawer &&
    (props.externalDrawerAttached || isComposerCollapsedMobile);
  const inlineTasksBadge = showInlineTasksBadge ? (
    <ComposerTasksBadge
      expanded={false}
      onDismiss={dismissTasks}
      onToggle={toggleTasksDrawer}
      placement="inline"
      progress={visibleTasksProgress}
      steps={visibleTaskSteps}
    />
  ) : null;
  const showShoulderTabs =
    !props.externalDrawerAttached &&
    !composerAsks &&
    !isTasksDrawerOpen &&
    !isComposerCollapsedMobile;
  const hasShoulderTab =
    showShoulderTabs &&
    (stashQueue.length > 0 ||
      (visibleTasksProgress !== null &&
        visibleTaskSteps !== null &&
        visibleTasksProgress.totalSteps > 0));
  useSyncStateOnChange(
    isTasksDrawerOpen,
    setIsTasksDrawerOpen,
    isTasksDrawerOpen && visibleTasksProgress !== null && visibleTaskSteps !== null,
    [visibleTaskSteps, visibleTasksProgress],
  );
  useSyncStateOnChange(
    isTasksDrawerOpen,
    setIsTasksDrawerOpen,
    isTasksDrawerOpen && !hasBlockingComposerTopDrawer,
    [hasBlockingComposerTopDrawer],
  );
  useSyncStateOnChange(isTasksDrawerOpen, setIsTasksDrawerOpen, false, [activeThreadId]);

  // Close the stash menu whenever the trigger-driven command menu opens so
  // the two popovers never stack in the same layer, and when the user
  // resumes typing (the menu is a transient picker, not a panel).
  useSyncStateOnChange(isStashMenuOpen, setIsStashMenuOpen, isStashMenuOpen && !composerMenuOpen, [
    composerMenuOpen,
  ]);
  useComposerDraftWordsChange(composerDraftTarget, isStashMenuOpen, () =>
    setIsStashMenuOpen(false),
  );

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: getTerminalFocusOwner() !== null,
          terminalOpen,
          modelPickerOpen: isComposerModelPickerOpen,
        },
      });
      if (command !== "composer.stash") return;
      // Always claim the shortcut so the browser save dialog never opens,
      // even when the composer is in a state that can't stash.
      event.preventDefault();
      event.stopPropagation();
      if (isCommandPaletteOpen()) {
        return;
      }
      if (pendingUserInputs.length > 0 && !isComposerApprovalState) {
        setIsStashMenuOpen((open) => !open);
        return;
      }
      if (isComposerApprovalState || projectSelectionRequired || activePendingProgress !== null) {
        return;
      }
      void stashCurrentPrompt();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [
    activePendingProgress,
    isComposerApprovalState,
    isComposerModelPickerOpen,
    keybindings,
    pendingUserInputs.length,
    projectSelectionRequired,
    stashCurrentPrompt,
    terminalOpen,
  ]);

  // ------------------------------------------------------------------
  // Callbacks: images
  // ------------------------------------------------------------------
  const addComposerImages = async (files: File[], options?: ComposerPictureOptions) => {
    if (!activeThreadId || files.length === 0) return;
    // Captured before the awaits below: the user may switch threads while a
    // picture is read. It still lands in this thread's draft (the pictures
    // hook keeps each picture's own draft), and a send there must wait for it.
    const threadId = activeThreadId;
    // More pictures are a change of the person's: a send waiting on earlier ones is taken back.
    setHeldSend((held) => (held?.threadId === threadId ? null : held));
    const target = composerDraftTarget;
    const pictureCount = () =>
      useComposerDraftStore.getState().getComposerDraft(target)?.images.length ?? 0;
    const before = pictureCount();
    const pendingCount = pendingImageCompressionsRef.current.get(threadId) ?? 0;
    pendingImageCompressionsRef.current.set(threadId, pendingCount + files.length);
    try {
      await composerPictures.add(files, options);
    } finally {
      const remaining = (pendingImageCompressionsRef.current.get(threadId) ?? 0) - files.length;
      if (remaining > 0) {
        pendingImageCompressionsRef.current.set(threadId, remaining);
      } else {
        pendingImageCompressionsRef.current.delete(threadId);
      }
      // A picture that could not be read is none to wait for: the send stays with the person.
      if (pictureCount() - before < files.length) {
        setHeldSend((held) => (held?.threadId === threadId ? null : held));
      }
      setImageReadsSettled((settled) => settled + 1);
    }
  };

  // ------------------------------------------------------------------
  // Callbacks: paste / drag
  // ------------------------------------------------------------------
  /**
   * Pasted or dropped files: a picture Claude can look at goes to the
   * pictures, anything else to the files, and what cannot go says why.
   */
  const addComposerAttachments = (
    files: ReadonlyArray<File>,
    options?: ComposerPictureOptions,
  ): Promise<void> => {
    if (!activeThreadId || files.length === 0) return Promise.resolve();
    const pictures: File[] = [];
    const others: File[] = [];
    for (const file of files) {
      const route = composerAttachmentRoute(file);
      if (route.kind === "picture") pictures.push(file);
      else if (route.kind === "file") others.push(file);
      else setThreadError(activeThreadId, route.message);
    }
    // Files land at once; pictures are read first, and land after them.
    composerFileList.add(others);
    return addComposerImages(pictures, options);
  };

  /**
   * Files pasted or picked with the paperclip: an open question that takes an answer of its own
   * words takes them with it, otherwise the message does.
   */
  const attachComposerFiles = (files: File[]) => {
    switch (attachmentDestination(composerWaits)) {
      case "answer":
        void props.questionAttachments?.add(files);
        return;
      case "message":
        void addComposerAttachments(files);
        return;
      case "nowhere":
        return;
    }
  };

  const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    attachComposerFiles(files);
  };

  const composerFilePickerRef = useRef<HTMLInputElement>(null);

  const insertComposerTextAtEnd = (
    text: string,
    options?: { ensureLeadingBoundary?: boolean },
  ): boolean => {
    if (
      text.length === 0 ||
      insertionRefused({
        connecting: isConnecting,
        projectMissing: projectSelectionRequired,
        waits: composerWaits,
      })
    ) {
      return false;
    }
    const prompt = promptRef.current;
    const needsLeadingSpace =
      (options?.ensureLeadingBoundary ?? false) && prompt.length > 0 && !/\s$/.test(prompt);
    return applyPromptReplacement(
      prompt.length,
      prompt.length,
      needsLeadingSpace ? ` ${text}` : text,
    );
  };

  // File-tree drags land as mentions. Handled in the capture phase so the
  // editor never sees the drop; the load-bearing rules (native stop, "move"
  // effect, no eager focus) live in makeComposerMentionDragHandlers.
  const composerMentionDragHandlers = makeComposerMentionDragHandlers({
    insertMentionAtEnd: (text) => insertComposerTextAtEnd(text, { ensureLeadingBoundary: true }),
    setDragActive: setIsDragOverComposer,
    onInsertRejected: () => {
      toastManager.add({
        type: "error",
        title: "Unable to add to chat",
        description: "The composer is busy; try again once it is ready.",
      });
    },
  });

  const onComposerMentionDragLeaveCapture = (event: React.DragEvent<HTMLFormElement>) => {
    if (!dataTransferHasComposerMention(event.dataTransfer.types)) return;
    event.stopPropagation();
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsDragOverComposer(false);
  };

  // A cancelled drag (Escape) can end without a dragleave on the hovered
  // target, which would leave the drop highlight stuck. dragend always fires
  // on the in-page drag source and bubbles to window, so it is the reset of
  // last resort while the highlight is up.
  useEffect(() => {
    if (!isDragOverComposer) return;
    const onWindowDragEnd = () => {
      setIsDragOverComposer(false);
    };
    window.addEventListener("dragend", onWindowDragEnd);
    return () => window.removeEventListener("dragend", onWindowDragEnd);
  }, [isDragOverComposer]);
  const handleInterruptPrimaryAction = useCallback(() => {
    void onInterrupt();
  }, [onInterrupt]);
  const handleImplementPlanInNewThreadPrimaryAction = useCallback(() => {
    void onImplementPlanInNewThread();
  }, [onImplementPlanInNewThread]);
  const scheduleComposerCollapseCheck = useCallback(() => {
    if (!isMobileViewport) {
      return;
    }
    if (mobileComposerExpandInFlightRef.current) {
      return;
    }
    if (composerBlurFrameRef.current !== null) {
      window.cancelAnimationFrame(composerBlurFrameRef.current);
    }
    composerBlurFrameRef.current = window.requestAnimationFrame(() => {
      composerBlurFrameRef.current = null;
      if (mobileComposerExpandInFlightRef.current) {
        return;
      }
      const composerSurface = composerSurfaceRef.current;
      const composerForm = composerFormRef.current;
      const activeElement = document.activeElement;
      if (activeElement instanceof Element && isInsideComposerFloatingLayer(activeElement)) {
        return;
      }
      if (
        activeElement instanceof Node &&
        ((composerSurface && composerSurface.contains(activeElement)) ||
          (composerForm && composerForm.contains(activeElement)))
      ) {
        return;
      }
      setIsComposerFocused(false);
    });
  }, [isMobileViewport]);

  useEffect(() => {
    return () => {
      if (composerBlurFrameRef.current !== null) {
        window.cancelAnimationFrame(composerBlurFrameRef.current);
      }
      if (mobileComposerExpandFrameRef.current !== null) {
        window.cancelAnimationFrame(mobileComposerExpandFrameRef.current);
      }
      if (mobileComposerExpandReleaseFrameRef.current !== null) {
        window.cancelAnimationFrame(mobileComposerExpandReleaseFrameRef.current);
      }
    };
  }, []);

  // ------------------------------------------------------------------
  // Imperative handle
  // ------------------------------------------------------------------
  useImperativeHandle(
    composerRef,
    () => ({
      focusAtEnd: () => {
        composerEditorRef.current?.focusAtEnd();
      },
      focusAt: (cursor: number) => {
        composerEditorRef.current?.focusAt(cursor);
      },
      // No focus here: what lands takes the caret on the next frame, once the
      // editor has caught up. Focused now, the editor writes its text from
      // before the drop back over the files that just landed.
      addDroppedFiles: addComposerAttachments,
      insertTextAtEnd: insertComposerTextAtEnd,
      openModelPicker: () => {
        setIsComposerModelPickerOpen(true);
      },
      toggleModelPicker: () => {
        setIsComposerModelPickerOpen((open) => !open);
      },
      openControl: (command) => {
        if (composerBlurFrameRef.current !== null) {
          window.cancelAnimationFrame(composerBlurFrameRef.current);
          composerBlurFrameRef.current = null;
        }
        flushSync(() => {
          setIsComposerFocused(true);
        });
        const shell = composerFormRef.current?.closest('[data-slot="composer-shell"]');
        const trigger = Array.from(
          shell?.querySelectorAll<HTMLButtonElement>(
            `button[data-composer-shortcut~="${command}"]:not(:disabled)`,
          ) ?? [],
        ).find(
          (element) =>
            !element.closest("[inert]") && element.checkVisibility({ visibilityProperty: true }),
        );
        if (!trigger) return;
        trigger.focus({ preventScroll: true });
        trigger.click();
      },
      compactContext: compactThreadContext,
      isModelPickerOpen: () => isComposerModelPickerOpen,
      readSnapshot: () => {
        return readComposerSnapshot();
      },
      resetCursorState: (options?: {
        cursor?: number;
        prompt?: string;
        detectTrigger?: boolean;
      }) => {
        const promptForState = options?.prompt ?? promptRef.current;
        const cursor = clampCollapsedComposerCursor(promptForState, options?.cursor ?? 0);
        setComposerHighlightedItemId(null);
        setComposerCursor(cursor);
        resetComposerTrigger(
          options?.detectTrigger
            ? detectTrigger(promptForState, expandCollapsedComposerCursor(promptForState, cursor))
            : null,
        );
      },
      addTerminalContext: attachContextAtCursor,
      getSendContext: () => ({
        prompt: promptRef.current,
        images: composerImagesRef.current,
        files: getComposerDraft(composerDraftTarget)?.files ?? [],
        terminalContexts: composerTerminalContextsRef.current,
        reviewComments: composerReviewComments,
        selectedPromptEffort,
        selectedModelOptionsForDispatch,
        selectedModelSelection,
        providerAvailable: providerSendable,
        selectedProvider,
        selectedModel,
        selectedProviderModels,
        interactionMode,
        interactionModeEnabled: planModeUiEnabled,
      }),
      validateProviderInput: (providerInput: string) => {
        const validationMessage = getComposerSubmissionValidationMessage({
          prompt: promptRef.current,
          providerInput,
          submissionTarget: "provider-turn",
        });
        providerInputRejectedRef.current = validationMessage !== null;
        setProviderInputSubmissionError(validationMessage);
        return validationMessage;
      },
    }),
    [
      detectTrigger,
      activeThread,
      addComposerImages,
      composerDraftTarget,
      composerTerminalContexts,
      insertComposerDraftTerminalContext,
      promptRef,
      composerImagesRef,
      composerTerminalContextsRef,
      composerReviewComments,
      isConnecting,
      composerWaits,
      isChoiceOnlyPendingQuestion,
      projectSelectionRequired,
      applyPromptReplacement,
      isComposerModelPickerOpen,
      readComposerSnapshot,
      resetComposerTrigger,
      setComposerTrigger,
      selectedModel,
      selectedModelOptionsForDispatch,
      selectedModelSelection,
      providerSendable,
      selectedPromptEffort,
      selectedProvider,
      selectedProviderModels,
      interactionMode,
      planModeUiEnabled,
      compactThreadContext,
    ],
  );

  const promptFieldWords = (
    {
      approval: "Resolve this approval request to continue",
      "choose-option": "Choose an option above",
      "own-answer": "Type your own answer, or leave this blank to use the selected option",
      "plan-feedback": "Add feedback to refine the plan, or leave this blank to implement it",
      "choose-project": "Choose a project above to start a thread",
      "sign-in": "Sign this Mate in to start",
      "enable-provider": "Enable a provider in Settings to send a message",
      idle: idlePlaceholder,
      connected: connectedPlaceholder,
    } satisfies Record<PromptFieldSays, string>
  )[
    promptFieldSays({
      waits: composerWaits,
      planFollowUp: showPlanFollowUpPrompt && activeProposedPlan !== null,
      projectMissing: projectSelectionRequired,
      signInRequired: zeropsSignInRequired,
      providerUnavailable: showProviderUnavailable,
      disconnected: phase === "disconnected",
    })
  ];

  const approvalActions =
    activePendingApproval === null ? null : (
      <ComposerPendingApprovalActions
        requestId={activePendingApproval.requestId}
        isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
        options={activePendingApproval.options}
        onRespondToApproval={onRespondToApproval}
      />
    );
  const askPanel =
    ask === "approval" && activePendingApproval !== null ? (
      <ComposerPendingApprovalPanel
        approval={activePendingApproval}
        pendingCount={pendingApprovals.length}
        face={askFace}
        who={askName}
        actions={approvalActions}
      />
    ) : ask === "question" ? (
      <ComposerPendingUserInputPanel
        pendingUserInputs={pendingUserInputs}
        respondingRequestIds={respondingRequestIds}
        answers={activePendingDraftAnswers}
        questionIndex={activePendingQuestionIndex}
        onToggleOption={onSelectActivePendingUserInputOption}
        onAdvance={onAdvanceActivePendingUserInput}
        onDismiss={onDismissActivePendingUserInput}
        face={askFace}
        who={askName}
      />
    ) : vaultAskWaits ? (
      <ComposerVaultAskContainer environmentId={environmentId} threadRef={routeThreadRef} />
    ) : dockedAskWaits ? (
      dockedAsk.render()
    ) : null;
  const phonePendingAnswerActions = (
    <ComposerPrimaryActions
      compact
      pendingAction={pendingPrimaryAction}
      isRunning={false}
      showPlanFollowUpPrompt={false}
      promptHasText={false}
      isSendBusy={isSendBusy}
      sendDisabledReason={sendDisabledReason}
      isConnecting={isConnecting}
      away={away}
      unavailableAgentName={unavailableAgentName}
      isPreparingWorktree={false}
      hasSendableContent={false}
      preserveComposerFocusOnPointerDown
      onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
      onInterrupt={handleInterruptPrimaryAction}
      onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
    />
  );
  // What the agent asks, one at a time, where the change waiting for review stands; it takes the
  // place of that change until it is answered.
  const askTop = isComposerCollapsedMobile ? null : ask === "question" ? (
    <>
      {askPanel}
      <ComposerQuestionAttachments questionAttachments={props.questionAttachments} />
    </>
  ) : (
    askPanel
  );

  // Render
  // ------------------------------------------------------------------
  return (
    <>
      <form
        ref={composerFormRef}
        onSubmit={submitComposer}
        onFocusCapture={(event) => {
          const activeElement = event.target;
          if (
            isComposerCollapsedMobile &&
            activeElement instanceof HTMLElement &&
            activeElement.closest('[data-chat-composer-collapsed-controls="true"]')
          ) {
            return;
          }
          if (composerBlurFrameRef.current !== null) {
            window.cancelAnimationFrame(composerBlurFrameRef.current);
            composerBlurFrameRef.current = null;
          }
          setIsComposerFocused(true);
        }}
        onBlurCapture={() => {
          scheduleComposerCollapseCheck();
        }}
        onDragEnterCapture={composerMentionDragHandlers.onDragEnter}
        onDragOverCapture={composerMentionDragHandlers.onDragOver}
        onDragLeaveCapture={onComposerMentionDragLeaveCapture}
        onDropCapture={composerMentionDragHandlers.onDrop}
        className={cn("mx-auto w-full min-w-0 max-w-3xl", hasShoulderTab && "pt-7")}
        data-chat-composer-form="true"
        data-composer-full={fullComposer === "off" ? undefined : fullComposer}
      >
        {showComposerTopDrawer ? (
          <div
            className={cn("chat-composer-top-drawer", COMPOSER_ATTACHED_OUTLINE)}
            data-chat-composer-top-drawer="true"
            data-variant="info"
          >
            <div data-chat-composer-collapsed-controls="true">
              {askPanel}
              {ask === "question" ? (
                <ComposerFoldedAnswerRow
                  customAnswer={activePendingProgress?.customAnswer}
                  multiSelect={activePendingProgress?.activeQuestion?.multiSelect}
                  onExpand={expandMobileComposer}
                  tasksBadge={inlineTasksBadge}
                  stashBadge={inlineStashBadge}
                  actions={phonePendingAnswerActions}
                />
              ) : null}
            </div>
          </div>
        ) : null}
        {isTasksDrawerOpen &&
        !hasBlockingComposerTopDrawer &&
        visibleTasksProgress &&
        visibleTaskSteps ? (
          <ComposerTasksDrawer
            onDismiss={dismissTasks}
            onCollapse={toggleTasksDrawer}
            progress={visibleTasksProgress}
            steps={visibleTaskSteps}
          />
        ) : null}
        <div className="relative">
          {showShoulderTabs && visibleTasksProgress && visibleTaskSteps ? (
            <ComposerTasksBadge
              expanded={false}
              hasTrailingShoulder={stashQueue.length > 0}
              onDismiss={dismissTasks}
              onToggle={toggleTasksDrawer}
              progress={visibleTasksProgress}
              steps={visibleTaskSteps}
            />
          ) : null}
          {showShoulderTabs ? (
            <ComposerStashBadge
              count={stashQueue.length}
              menuOpen={isStashMenuOpen}
              pulseKey={stashPulse.key}
              pulsing={stashPulse.active}
              onToggleMenu={toggleStashMenu}
            />
          ) : null}
          <div
            data-chat-composer-main-surface="true"
            // No colour transition: its surface is painted here or by the
            // shell's layer as a drawer comes and goes, and a fade between
            // the two showed the page through the composer for 200 ms.
            className={cn(
              "group relative z-10 rounded-sheet p-px",
              composerProviderState.composerFrameClassName,
            )}
          >
            <div
              ref={composerSurfaceRef}
              data-chat-composer-surface="true"
              data-chat-composer-mobile-collapsed={isComposerCollapsedMobile ? "true" : "false"}
              // The shell draws the composer's ground and edge; a file held over it lights it.
              data-dropping={isDragOverComposer ? "" : undefined}
              className={cn(
                "rounded-sheet transition-[background-color] duration-200 data-dropping:bg-accent/45 data-dropping:ring-1 data-dropping:ring-primary/70",
                projectSelectionRequired ? "opacity-75" : null,
                composerProviderState.composerSurfaceClassName,
              )}
            >
              {askTop ?? top}
              {showCollapsedMobilePromptRow ? (
                <ComposerFoldedPromptRow
                  words={collapsedPromptWords}
                  placeholder={promptFieldWords}
                  availability={agentAvailability}
                  onExpand={expandMobileComposer}
                  tasksBadge={inlineTasksBadge}
                  stashBadge={inlineStashBadge}
                  sendDisabled={collapsedComposerPrimaryActionDisabled}
                  onSend={submitComposer}
                />
              ) : null}

              <div
                ref={setComposerMenuAnchor}
                className={cn(
                  "relative px-3 pb-2 sm:px-4",
                  "pt-3.5 sm:pt-4",
                  isComposerApprovalState && "pb-3 sm:pb-4",
                  isComposerCollapsedMobile && "hidden",
                )}
              >
                {isStashMenuOpen && !composerMenuOpen && !isComposerApprovalState && (
                  <ComposerCommandMenuLayer anchor={composerMenuAnchor} canOverflowTop>
                    <ComposerStashMenu
                      entries={stashQueue}
                      onRestore={restoreStashEntry}
                      onDelete={deleteStashEntry}
                      onClose={() => setIsStashMenuOpen(false)}
                    />
                  </ComposerCommandMenuLayer>
                )}

                <div role="status" aria-atomic="true" className="sr-only">
                  {composerSuggestionsVisible && composerMenuItems.length === 0
                    ? isComposerMenuLoading
                      ? "Searching workspace files..."
                      : composerMenuEmptyState
                    : ""}
                </div>
                {composerSuggestionsVisible && (
                  <ComposerCommandMenuLayer anchor={composerMenuAnchor}>
                    <ComposerCommandMenu
                      listId={composerSuggestionListId}
                      items={composerMenuItems}
                      resolvedTheme={resolvedTheme}
                      isLoading={isComposerMenuLoading}
                      triggerKind={composerTriggerKind}
                      emptyStateText={composerMenuEmptyState}
                      activeItemId={activeComposerMenuItem?.id ?? null}
                      onHighlightedItemChange={onComposerMenuItemHighlighted}
                      onSelect={onSelectComposerItem}
                    />
                  </ComposerCommandMenuLayer>
                )}

                {!isComposerCollapsedMobile &&
                  !isComposerApprovalState &&
                  pendingUserInputs.length === 0 &&
                  composerReviewComments.length > 0 && (
                    <ComposerPendingReviewComments
                      comments={composerReviewComments}
                      onRemove={(commentId) =>
                        removeComposerDraftReviewComment(composerDraftTarget, commentId)
                      }
                      className="mb-3"
                    />
                  )}

                <div className="relative">
                  <ComposerVaultKeysContext value={vaultKeys}>
                    <ComposerEditorOnWords
                      ariaLabel="Message"
                      suggestionListId={composerSuggestionListId}
                      activeSuggestionId={
                        composerSuggestionsVisible &&
                        composerMenuItems.length > 0 &&
                        activeComposerMenuItem
                          ? composerSuggestionOptionId(
                              composerSuggestionListId,
                              activeComposerMenuItem.id,
                            )
                          : undefined
                      }
                      editorRef={composerEditorRef}
                      words={editorWords}
                      terminalContexts={fieldCarriesDraft ? composerTerminalContexts : []}
                      skills={selectedProviderSkills}
                      crewmates={editorMentionChips}
                      pictures={fieldCarriesDraft ? composerPictureChips : NO_PICTURES}
                      onOpenPicture={composerPictures.open}
                      onRemovePicture={composerPictures.remove}
                      onRetryPicture={composerPictures.retry}
                      onPastePictures={fieldCarriesDraft ? composerPictures.paste : undefined}
                      files={fieldCarriesDraft ? composerFileList.chips : NO_FILES}
                      onRemoveFile={composerFileList.remove}
                      onRetryFile={composerFileList.retry}
                      {...(showMobilePendingAnswerActions ? { className: "max-sm:pb-11" } : {})}
                      onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
                      onChange={onPromptChange}
                      onCommandKeyDown={onComposerCommandKey}
                      onPaste={onComposerPaste}
                      placeholder={promptFieldWords}
                      disabled={composerInputClosed("editor", {
                        connecting: isConnecting,
                        projectMissing: projectSelectionRequired,
                        waits: composerWaits,
                      })}
                    />
                  </ComposerVaultKeysContext>
                  {isMobileViewport || isComposerApprovalState ? null : (
                    <ComposerFullScreenToggle
                      fullComposer={fullComposer}
                      onToggle={() => {
                        if (fullComposer === "on") leaveFullComposer();
                        else setFullComposerAt({ threadId: activeThreadId, state: "on" });
                      }}
                    />
                  )}
                  {composerPictures.view}
                  {showMobilePendingAnswerActions ? (
                    <div
                      data-chat-composer-mobile-pending-actions="true"
                      className="absolute bottom-0 right-0 flex items-center justify-end gap-1"
                    >
                      {inlineTasksBadge}
                      {inlineStashBadge}
                      {phonePendingAnswerActions}
                    </div>
                  ) : null}
                </div>
              </div>

              <ComposerPromptLengthValidation
                message={providerInputSubmissionError ?? composerSubmissionError}
              />
              {/* What stops the agent taking a message is the composer's own to say (S6): the
                  model control's dot names it, and this line says why sending waits. Where the
                  Mate's admission holds the send, its own notice says why, once. */}
              {providerSendBlockReason === null ||
              zeropsSendBlockReason !== null ||
              providerInputSubmissionError !== null ||
              composerSubmissionError !== null ||
              isComposerCollapsedMobile ? null : (
                <Text
                  className="px-3 pb-2 sm:px-4"
                  render={<p />}
                  variant="note"
                  data-chat-composer-blocked=""
                >
                  {providerSendBlockReason}
                </Text>
              )}

              {/* Bottom toolbar */}
              {isComposerCollapsedMobile || isComposerApprovalState ? null : (
                <div
                  data-chat-composer-footer="true"
                  className={cn(
                    // The toolbar (C4): one quiet control at the text's edge, the
                    // send at the right, 6 over and 12 around, 8 between.
                    "flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible pt-1.5 pe-3 pb-3 ps-3.5",
                    showMobilePendingAnswerActions && "hidden sm:flex",
                  )}
                >
                  <div className="-m-1 -ms-3.5 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto p-1 ps-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {crewRunsOn !== undefined ? (
                      <CrewRunsOnControl
                        label={crewRunsOn.label}
                        onEdit={crewRunsOn.onEdit}
                        availability={agentAvailability}
                      />
                    ) : showProviderUnavailable && !zeropsSignInRequired && unavailableAgent ? (
                      <UnavailableAgentControl
                        availability={unavailableAgent}
                        onOpenSetup={
                          providerSetupInstanceId
                            ? () => onOpenProviderSetup(providerSetupInstanceId)
                            : null
                        }
                      />
                    ) : showProviderUnavailable && !zeropsSignInRequired ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!providerSetupInstanceId}
                        onClick={() => {
                          if (providerSetupInstanceId) {
                            onOpenProviderSetup(providerSetupInstanceId);
                          }
                        }}
                        data-chat-provider-unavailable="true"
                        className="shrink-0"
                      >
                        <CircleAlertIcon />
                        {providerSetupInstanceId
                          ? "Open provider settings"
                          : "No provider available"}
                      </Button>
                    ) : automatedMate ? (
                      // An automated Mate runs on the organization's key: nothing to pick.
                      <Text
                        className="min-w-0"
                        truncate
                        variant="remark"
                        data-chat-composer-runs-on="true"
                      >
                        {automatedRunsOnLine(
                          activeThreadModelSelection?.model ??
                            selectedModelForPickerWithCustomFallback,
                        )}
                      </Text>
                    ) : (
                      <ProviderModelPicker
                        composer={{
                          traits: {
                            descriptors: composerTraits.descriptors,
                            ultrathinkPromptControlled: composerTraits.ultrathinkPromptControlled,
                          },
                          choices: (
                            <ComposerModelChoices
                              traits={composerTraitsInput}
                              runtimeMode={runtimeMode}
                              onRuntimeModeChange={handleRuntimeModeChange}
                            />
                          ),
                          shortcuts: accessInToolbar
                            ? "composer.effort"
                            : "composer.effort composer.mode",
                        }}
                        disabled={providerCatalogPending}
                        catalogPending={providerCatalogPending}
                        rememberAs={composerThreadControlKey(scopedThreadKey(routeThreadRef))}
                        activeInstanceId={
                          providerCatalogPending
                            ? (activeThreadModelSelection?.instanceId ?? selectedInstanceId)
                            : selectedInstanceId
                        }
                        model={
                          providerCatalogPending
                            ? (activeThreadModelSelection?.model ??
                              selectedModelForPickerWithCustomFallback)
                            : selectedModelForPickerWithCustomFallback
                        }
                        runsOn={runsOn}
                        instanceEntries={providerInstanceEntries}
                        keybindings={keybindings}
                        modelOptionsByInstance={modelOptionsByInstance}
                        {...(zeropsSignInRequired
                          ? { triggerLabelOverride: "Sign this Mate in" }
                          : {})}
                        renderInstancePanel={renderZeropsInstancePanel}
                        terminalOpen={terminalOpen}
                        open={isComposerModelPickerOpen}
                        {...(composerProviderState.modelPickerIconClassName
                          ? {
                              activeProviderIconClassName:
                                composerProviderState.modelPickerIconClassName,
                            }
                          : {})}
                        onOpenChange={(open) => {
                          setIsComposerModelPickerOpen(open);
                        }}
                        getModelDisabledReason={getModelDisabledReason}
                        onInstanceModelChange={onProviderModelSelect}
                        agentStatus={agentStatus}
                      />
                    )}

                    {crewRunsOn === undefined && accessInToolbar ? (
                      <ComposerAccessControl
                        runtimeMode={runtimeMode}
                        onRuntimeModeChange={handleRuntimeModeChange}
                      />
                    ) : null}
                    {crewRunsOn === undefined && planModeUiEnabled ? (
                      <ComposerInteractionModeToggle
                        interactionMode={interactionMode}
                        onToggle={toggleInteractionMode}
                      />
                    ) : null}
                  </div>

                  {/* Right side: send / stop button */}
                  <div
                    data-chat-composer-actions="right"
                    data-chat-composer-primary-actions-compact={
                      isComposerPrimaryActionsCompact ? "true" : "false"
                    }
                    className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
                  >
                    <ComposerVaultAddButton
                      environmentId={environmentId}
                      onAdded={insertVaultKey}
                    />
                    <ComposerAttachFilesButton
                      disabled={composerInputClosed("paperclip", {
                        connecting: isConnecting,
                        projectMissing: projectSelectionRequired,
                        waits: composerWaits,
                      })}
                      pickerRef={composerFilePickerRef}
                      onFiles={attachComposerFiles}
                    />
                    {showMobilePendingAnswerActions ? null : inlineTasksBadge}
                    {showMobilePendingAnswerActions ? null : inlineStashBadge}
                    <ComposerFooterPrimaryActions
                      compact={isComposerPrimaryActionsCompact}
                      activeContextWindow={activeContextWindow}
                      autoCompactSetting={
                        props.activeThreadShell?.crew
                          ? "crew.yaml → members → context"
                          : threadDriver === "claudeAgent"
                            ? "Settings → Providers → Claude"
                            : null
                      }
                      reserveContextWindowMeter={reserveContextWindowMeter}
                      activeThreadModelDisplayName={activeThreadModelDisplayName}
                      pendingAction={pendingPrimaryAction}
                      isRunning={phase === "running"}
                      backgroundWork={phase === "running" ? null : backgroundWork}
                      stopping={stopping ?? false}
                      showPlanFollowUpPrompt={
                        pendingUserInputs.length === 0 && showPlanFollowUpPrompt
                      }
                      promptHasText={promptHasText}
                      isSendBusy={isSendBusy || heldSend !== null}
                      sendDisabledReason={sendDisabledReason}
                      sendHint={sendHint}
                      isConnecting={isConnecting}
                      away={away}
                      unavailableAgentName={unavailableAgentName}
                      isPreparingWorktree={isPreparingWorktree}
                      hasSendableContent={hasSendableContent}
                      preserveComposerFocusOnPointerDown={isMobileViewport}
                      onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                      onInterrupt={handleInterruptPrimaryAction}
                      onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                      compactDisabled={
                        compactDisabled || noProviderAvailable || isSendBusy || isConnecting
                      }
                      compactDisabledReason={resolvedCompactDisabledReason}
                      {...(compactCommandAvailable
                        ? { onCompactContext: compactThreadContext }
                        : {})}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </form>
      {zeropsSignInDialog.dialog}
    </>
  );
});
