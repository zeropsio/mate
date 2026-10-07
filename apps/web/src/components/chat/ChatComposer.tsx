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
import {
  agentIdForDriverKind,
  ProviderDriverKind,
  ProviderInstanceId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "@t3tools/contracts";
import type { ZeropsAgentAvailability } from "@t3tools/client-runtime/zerops/agentAvailability";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { createModelSelection, normalizeModelSlug } from "@t3tools/shared/model";
import { USAGE_LIMITS_COMMAND } from "@t3tools/shared/usageLimits";
import { isZeropsInstanceRunnable } from "../ChatView.logic";
import { useAgentLoginCancel } from "../../zerops/useAgentLoginCancel";
import { useZeropsAgentSignInDialog } from "../../zerops/useZeropsAgentSignInDialog";
import { ZEROPS_AGENT_NAMES } from "../zerops/ZeropsAgentSignIn.logic";
import { ZeropsAgentPickerPanel } from "../zerops/ZeropsAgentPickerPanel";
import { CrewRunsOnControl } from "../zerops/crew/CrewRunsOnControl";
import { crewmateMenuItems } from "../zerops/crew/CrewTellComposer.logic";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
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
  replaceTextRange,
} from "../../composer-logic";
import {
  DEFAULT_CONNECTED_COMPOSER_PLACEHOLDER,
  DISCONNECTED_COMPOSER_PLACEHOLDER,
} from "../../composerPlaceholder";
import {
  deriveComposerSendState,
  getAntigravitySendBlockReason,
  getProviderCatalogSendBlockReason,
  readFileAsDataUrl,
  readOncePerFile,
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
  type PersistedComposerImageAttachment,
  hydrateImagesFromPersisted,
  persistableImageAttachments,
  persistedPicture,
  useComposerDraftStore,
  useComposerThreadDraft,
  useEffectiveComposerModelState,
} from "../../composerDraftStore";
import {
  MAX_STASH_ENTRIES,
  partitionStashAttachments,
  restoreStashedPictures,
  usePromptStashStore,
  type PromptStashEntry,
} from "../../promptStashStore";
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
import { compressImageForStash } from "../../lib/imageCompression";
import {
  type ComposerFileAttachment,
  composerAttachmentRoute,
  stripInlineFilePlaceholders,
} from "../../lib/composerFiles";
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
import { useComposerPictures } from "./useComposerPictures";
import type { ComposerFileView } from "./ComposerFile";
import { useComposerFiles } from "./useComposerFiles";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { getTerminalFocusOwner } from "../../lib/terminalFocus";
import { resolveShortcutCommand } from "../../keybindings";
import {
  type TerminalContextDraft,
  type TerminalContextSelection,
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
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
import { zeropsCommands } from "../../state/zeropsCommands";
import type { VaultChange } from "@t3tools/client-runtime/data";
import { ComposerPendingReviewComments } from "./ComposerPendingReviewComments";
import { ComposerPendingVaultChanges } from "./ComposerPendingVaultChanges";
import { shouldUseCompactComposerPrimaryActions } from "../composerFooterLayout";
import {
  type ComposerEditorSnapshot,
  type ComposerPromptEditorHandle,
  ComposerPromptEditor,
} from "../ComposerPromptEditor";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { composerThreadControlKey } from "./composerControlMemory";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type ComposerCommandItem, ComposerCommandMenu } from "./ComposerCommandMenu";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";
import { ComposerPlanFollowUpBanner } from "./ComposerPlanFollowUpBanner";
import {
  ComposerAccessControl,
  ComposerInteractionModeToggle,
  ComposerModelChoices,
  type ComposerTraitsInput,
} from "./ComposerModelControl";
import { showsAccessControl } from "./ComposerModelControl.logic";
import { resolveComposerMenuActiveItemId, useComposerMenuHighlight } from "./composerMenuHighlight";
import { useSyncStateOnChange } from "./composerStateSync";
import {
  searchSlashCommandItems,
  slashCommandItemsForPromptPosition,
  withoutShadowedProviderCommands,
} from "./composerSlashCommandSearch";
import { getComposerPromptInjectionState, getComposerProviderState } from "./composerProviderState";
import { getTraitsSectionVisibility } from "./TraitsPicker";
import { ContextWindowMeter, ContextWindowMeterPlaceholder } from "./ContextWindowMeter";
import {
  providerSupportsManualCompaction,
  resolveContextWindowModelDisplayName,
  shouldReserveContextWindowMeter,
} from "./ContextWindowMeter.logic";
import { basenameOfPath } from "../../pierre-icons";
import { cn, randomUUID } from "~/lib/utils";
import {
  getComposerPromptLengthValidationMessage,
  getComposerSubmissionValidationMessage,
  submitComposerDraft,
} from "./composerSubmission";
import { ComposerPromptLengthValidation } from "./ComposerPromptLengthValidation";

type ComposerCommandMenuPosition = {
  bottom: number;
  left: number;
  maxHeight: number;
  width: number;
};

function composerCommandMenuPositionsEqual(
  a: ComposerCommandMenuPosition,
  b: ComposerCommandMenuPosition,
): boolean {
  return (
    a.bottom === b.bottom && a.left === b.left && a.maxHeight === b.maxHeight && a.width === b.width
  );
}

function ComposerCommandMenuLayer(props: { anchor: HTMLElement | null; children: ReactNode }) {
  const [position, setPosition] = useState<ComposerCommandMenuPosition | null>(null);

  useLayoutEffect(() => {
    const anchor = props.anchor;
    if (!anchor) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const form = anchor.closest<HTMLElement>('[data-chat-composer-form="true"]');
      const mainSurface = form?.querySelector<HTMLElement>(
        '[data-chat-composer-main-surface="true"]',
      );
      const rect = (mainSurface ?? form ?? anchor).getBoundingClientRect();
      const rootFontSizePx =
        Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
      const drawerInsetRem =
        Number.parseFloat(
          window.getComputedStyle(form ?? anchor).getPropertyValue("--chat-composer-drawer-inset"),
        ) || 1.375;
      const drawerInset = drawerInsetRem * rootFontSizePx;
      // One extra pixel prevents fractional layout coordinates from exposing
      // the canvas between the drawer mask and the composer's foreground edge.
      // Mirrors --chat-composer-attachment-overlap: calc(1rem + 1px).
      const composerOverlap = rootFontSizePx + 1;
      const next = {
        bottom: window.innerHeight - rect.top - composerOverlap,
        left: rect.left + drawerInset,
        maxHeight: Math.max(96, rect.top - 24 + composerOverlap),
        width: Math.max(0, rect.width - drawerInset * 2),
      };
      setPosition((current) =>
        current && composerCommandMenuPositionsEqual(current, next) ? current : next,
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    if (observer) {
      // The composer is centered and capped at a max width, so opening a side
      // panel slides it sideways without ever resizing it. Watching the anchor
      // alone would leave the menu behind; the ancestors are what shrink, and
      // they resize on every frame of the panel animation.
      observer.observe(anchor);
      for (let element = anchor.parentElement; element; element = element.parentElement) {
        observer.observe(element);
      }
    }

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [props.anchor]);

  if (!position) return null;

  return createPortal(
    <div
      className="pointer-events-auto fixed z-[70]"
      data-composer-drawer-layer="true"
      style={{
        bottom: position.bottom,
        left: position.left,
        maxHeight: position.maxHeight,
        width: position.width,
      }}
    >
      {props.children}
    </div>,
    document.body,
  );
}
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import { CircleAlertIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
import { proposedPlanTitle } from "../../proposedPlan";
import { hasProviderSetup } from "./ProviderStatusBanner";
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
import type { PendingUserInputDraftAnswer } from "../../pendingUserInput";
import type { PendingApproval, PendingUserInput } from "../../session-logic";
import type { ContextWindowSnapshot } from "../../lib/contextWindow";
import {
  formatProviderSkillDisplayName,
  getProviderSlashCommandsForSlashMenu,
  getProviderSkillsForSlashMenu,
  resolveProviderSkillsForCwd,
  resolveProviderSlashCommandsForCwd,
} from "@t3tools/client-runtime/providerSkills";
import { searchProviderSkills } from "../../providerSkillSearch";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import type { ReviewCommentContext } from "../../reviewCommentContext";

const WORKSPACE_SNAPSHOT_RETRY_COOLDOWN_MS = 10_000;

/** Stable empty skills and commands while no provider is selected, so the menu items keep their identity. */
const NO_PROVIDER_SKILLS: ServerProvider["skills"] = [];
/** `@` names crewmates first (`mentionCrewmates`). */
const CREWMATE_MENTIONS = { mentions: "crewmate" } as const satisfies ComposerTriggerOptions;
const NO_PROVIDER_SLASH_COMMANDS: ServerProvider["slashCommands"] = [];

const COMPOSER_FLOATING_LAYER_SELECTOR = [
  '[data-composer-drawer-layer="true"]',
  '[data-slot="popover-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

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
const NO_VAULT_CHANGES: ReadonlyArray<VaultChange> = [];

/** A draft's image as its save for a reload reads it: each file once. */
const readComposerFileDataUrl = readOncePerFile(readFileAsDataUrl);

const syncTerminalContextsByIds = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): TerminalContextDraft[] => {
  const contextsById = new Map(contexts.map((context) => [context.id, context]));
  return ids.flatMap((id) => {
    const context = contextsById.get(id);
    return context ? [context] : [];
  });
};

const terminalContextIdListsEqual = (
  contexts: ReadonlyArray<TerminalContextDraft>,
  ids: ReadonlyArray<string>,
): boolean =>
  contexts.length === ids.length && contexts.every((context, index) => context.id === ids[index]);

function isInsideComposerFloatingLayer(element: Element): boolean {
  return element.closest(COMPOSER_FLOATING_LAYER_SELECTOR) !== null;
}

const ComposerFooterPrimaryActions = memo(function ComposerFooterPrimaryActions(props: {
  compact: boolean;
  activeContextWindow: ContextWindowSnapshot | null;
  reserveContextWindowMeter: boolean;
  activeThreadModelDisplayName: string | null;
  isPreparingWorktree: boolean;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  hasSendableContent: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
  onCompactContext?: (() => void) | undefined;
  compactDisabled: boolean;
  compactDisabledReason: string | null;
}) {
  return (
    <>
      {props.activeContextWindow ? (
        <ContextWindowMeter
          usage={props.activeContextWindow}
          modelDisplayName={props.activeThreadModelDisplayName}
          onCompact={props.onCompactContext}
          compactDisabled={props.compactDisabled}
          compactDisabledReason={props.compactDisabledReason}
        />
      ) : props.reserveContextWindowMeter ? (
        <ContextWindowMeterPlaceholder />
      ) : null}
      {props.isPreparingWorktree ? (
        <span className="text-secondary-label text-xs">Preparing worktree...</span>
      ) : null}
      <ComposerPrimaryActions
        compact={props.compact}
        pendingAction={props.pendingAction}
        isRunning={props.isRunning}
        showPlanFollowUpPrompt={props.showPlanFollowUpPrompt}
        promptHasText={props.promptHasText}
        isSendBusy={props.isSendBusy}
        sendDisabledReason={props.sendDisabledReason}
        isConnecting={props.isConnecting}
        isEnvironmentUnavailable={props.isEnvironmentUnavailable}
        isPreparingWorktree={props.isPreparingWorktree}
        hasSendableContent={props.hasSendableContent}
        preserveComposerFocusOnPointerDown={props.preserveComposerFocusOnPointerDown ?? false}
        onPreviousPendingQuestion={props.onPreviousPendingQuestion}
        onInterrupt={props.onInterrupt}
        onImplementPlanInNewThread={props.onImplementPlanInNewThread}
      />
    </>
  );
});

// --------------------------------------------------------------------------
// Handle exposed to ChatView
// --------------------------------------------------------------------------

export interface ChatComposerHandle {
  focusAtEnd: () => void;
  focusAt: (cursor: number) => void;
  addDroppedFiles: (files: File[]) => void;
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
  /** Validate the fully composed text immediately before a provider turn starts. */
  validateProviderInput: (providerInput: string) => boolean;
}

// --------------------------------------------------------------------------
// Props
// --------------------------------------------------------------------------

export interface ChatComposerProps {
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
   * A crewmate's chat (PRD §2.3): what the crewmate runs on, read-only in
   * place of the model, effort and permission-mode pickers — its *Runs on* and
   * the crew gate decide those — with a way into its editor.
   */
  crewRunsOn?: { readonly label: string; readonly onEdit: () => void } | undefined;
  /**
   * The composer's top (C3): what waits on the person — this Mate's change,
   * waiting for their review — as a section inside the composer, sharing its
   * edges and corners, over what they write.
   */
  top?: ReactNode;
  /** The vault changes the next message tells the Mate: chips above the text, each set aside with ×. */
  vaultChanges?: ReadonlyArray<VaultChange> | undefined;
  onDismissVaultChange?: ((change: VaultChange) => void) | undefined;

  // Session phase
  phase: SessionPhase;
  isConnecting: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
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
  lockedProvider: ProviderDriverKind | null;
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
    crewRunsOn,
    top,
    vaultChanges = NO_VAULT_CHANGES,
    onDismissVaultChange,
    phase,
    isConnecting,
    isSendBusy,
    sendDisabledReason: externalSendDisabledReason,
    zeropsSendBlockReason,
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
    lockedProvider,
    providerStatuses,
    providerCatalogKnown,
    activeProjectDefaultModelSelection,
    activeThreadModelSelection,
    zeropsAgentAvailabilityByInstanceId,
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
    onImplementPlanInNewThread,
    onRespondToApproval,
    onSelectActivePendingUserInputOption,
    onAdvanceActivePendingUserInput,
    onDismissActivePendingUserInput,
    onPreviousActivePendingUserInputQuestion,
    onChangeActivePendingUserInputCustomAnswer,
    onProviderModelSelect,
    onOpenProviderSetup,
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
  const composerDraft = useComposerThreadDraft(composerDraftTarget);
  const prompt = composerDraft.prompt;
  const composerImages = composerDraft.images;
  const composerFiles = composerDraft.files;
  const composerTerminalContexts = composerDraft.terminalContexts;
  const composerReviewComments = composerDraft.reviewComments;
  const nonPersistedComposerImageIds = composerDraft.nonPersistedImageIds;
  const uploadsByImageId = useAttachmentUploadStore((state) => state.uploadsByImageId);
  const attachmentBlockReason =
    picturesBlockReason(composerImages) ??
    (supportsAttachmentUploads
      ? attachmentUploadBlockReason({
          imageIds: composerImages.flatMap(attachmentUploadKeys),
          fileIds: composerFiles.map((file) => file.id),
          uploadsByImageId,
          environmentId,
        })
      : null);
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
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(providerStatuses), settings),
      ),
    [providerStatuses, settings],
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
    lockedContinuationGroupKey,
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
        lockedProvider,
        lockedInstanceId:
          activeThread?.session?.providerInstanceId ?? activeThreadModelSelection?.instanceId,
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
      lockedProvider,
      providerInstanceEntries,
      zeropsAgentAvailabilityByInstanceId,
    ],
  );
  const zeropsSignInDialog = useZeropsAgentSignInDialog(environmentId, routeThreadRef);
  const cancelZeropsAgentLogin = useAgentLoginCancel(routeThreadRef);
  const openZeropsAgentSignIn = zeropsSignInDialog.openFor;
  // Signing an agent in is project-wide, not per session, so the panel must
  // stay reachable even for an instance the session is locked out of — the
  // locked-agent name lets it say where the sign-in will actually run.
  const lockedZeropsAgentName = useMemo(() => {
    if (lockedProvider === null) return undefined;
    const lockedAgentId = agentIdForDriverKind(lockedProvider);
    return lockedAgentId === undefined ? undefined : ZEROPS_AGENT_NAMES[lockedAgentId];
  }, [lockedProvider]);
  const renderZeropsInstancePanel = useCallback(
    (entry: ProviderInstanceEntry, requestClosePicker: () => void): ReactNode | null => {
      const availability = zeropsAgentAvailabilityByInstanceId?.get(entry.instanceId);
      if (availability === undefined || availability.kind === "ready") return null;
      const agentId = agentIdForDriverKind(entry.driverKind);
      if (agentId === undefined) return null;
      const lockedToAgentName =
        lockedZeropsAgentName !== undefined && entry.driverKind !== lockedProvider
          ? lockedZeropsAgentName
          : undefined;
      return (
        <ZeropsAgentPickerPanel
          agentId={agentId}
          availability={availability}
          lockedToAgentName={lockedToAgentName}
          onCancel={cancelZeropsAgentLogin}
          onOpenDialog={openZeropsAgentSignIn}
          requestClosePicker={requestClosePicker}
        />
      );
    },
    [
      cancelZeropsAgentLogin,
      lockedProvider,
      lockedZeropsAgentName,
      openZeropsAgentSignIn,
      zeropsAgentAvailabilityByInstanceId,
    ],
  );
  const selectedInstanceId =
    selectedProviderEntry?.instanceId ?? NO_PROVIDER_MODEL_SELECTION.instanceId;
  const noProviderAvailable = selectedProviderEntry === undefined;
  // Before the catalog arrives, every thread resolves to "no provider". Send
  // stays blocked either way; only the chrome waits, keeping the picker with
  // the thread's own selection instead of swapping in the setup button and
  // back once the catalog lands.
  const providerCatalogPending = noProviderAvailable && !providerCatalogKnown;
  const showProviderUnavailable = noProviderAvailable && !providerCatalogPending;
  const providerSetupInstanceId = noProviderAvailable
    ? (unavailableProviderInstanceId ??
      (lockedProvider === null
        ? providerInstanceEntries.find((entry) => hasProviderSetup(entry.snapshot))?.instanceId
        : undefined))
    : undefined;
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
  const providerSendBlockReason =
    getAntigravitySendBlockReason(selectedProviderEntry?.snapshot, selectedModel) ??
    getProviderCatalogSendBlockReason(selectedProviderEntry?.snapshot);
  const sendDisabledReason =
    externalSendDisabledReason ??
    (activePendingProgress
      ? null
      : (attachmentBlockReason ?? providerSendBlockReason ?? zeropsSendBlockReason));
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
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const workspaceRefreshKeyRef = useRef<string | null>(null);
  const workspaceRefreshRetryRef = useRef<{ key: string; notBefore: number } | null>(null);
  const hadWorkspaceSnapshotRef = useRef(false);
  useEffect(() => {
    const hasWorkspaceSnapshot = Boolean(
      gitCwd &&
      selectedProviderStatus?.workspaceSnapshots?.some((snapshot) => snapshot.cwd === gitCwd),
    );
    if (hadWorkspaceSnapshotRef.current && !hasWorkspaceSnapshot) {
      workspaceRefreshKeyRef.current = null;
      workspaceRefreshRetryRef.current = null;
    }
    hadWorkspaceSnapshotRef.current = hasWorkspaceSnapshot;
  }, [gitCwd, selectedProviderStatus]);
  useEffect(() => {
    if (!gitCwd || !selectedProviderEntry) return;
    const key = `${environmentId}:${selectedProviderEntry.instanceId}:${gitCwd}`;
    const hasWorkspaceSnapshot = selectedProviderStatus?.workspaceSnapshots?.some(
      (snapshot) => snapshot.cwd === gitCwd,
    );
    if (workspaceRefreshKeyRef.current === key) return;
    if (hasWorkspaceSnapshot) {
      workspaceRefreshKeyRef.current = key;
      workspaceRefreshRetryRef.current = null;
      return;
    }
    const retry = workspaceRefreshRetryRef.current;
    if (retry?.key === key && Date.now() < retry.notBefore) return;
    workspaceRefreshKeyRef.current = key;
    const retryLater = () => {
      if (workspaceRefreshKeyRef.current !== key) return;
      workspaceRefreshKeyRef.current = null;
      workspaceRefreshRetryRef.current = {
        key,
        notBefore: Date.now() + WORKSPACE_SNAPSHOT_RETRY_COOLDOWN_MS,
      };
    };
    void refreshProviders({
      environmentId,
      input: { instanceId: selectedProviderEntry.instanceId, cwd: gitCwd },
    }).then((result) => {
      const hasWorkspaceSnapshot =
        result._tag === "Success" &&
        result.value.providers
          .find((provider) => provider.instanceId === selectedProviderEntry.instanceId)
          ?.workspaceSnapshots?.some((snapshot) => snapshot.cwd === gitCwd);
      if (!hasWorkspaceSnapshot && workspaceRefreshKeyRef.current === key) {
        retryLater();
      }
    }, retryLater);
  }, [environmentId, gitCwd, prompt, refreshProviders, selectedProviderEntry]);
  const selectedProviderModels = useMemo<ReadonlyArray<ServerProvider["models"][number]>>(
    () => selectedProviderEntry?.models ?? [],
    [selectedProviderEntry],
  );

  const composerPromptInjectionState = useMemo(
    () => getComposerPromptInjectionState(prompt),
    [prompt],
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
  const [composerCursor, setComposerCursor] = useState(() =>
    collapseExpandedComposerCursor(prompt, prompt.length),
  );
  const offersCrewmates = mentionCrewmates !== undefined;
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
  } = useComposerTriggerState(() => detectTrigger(prompt, prompt.length));
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
      pendingUserInputs.length > 0 ? "Attach pictures after answering pending questions." : null,
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
    refusal: () =>
      pendingUserInputs.length > 0
        ? "Attach files after answering pending questions."
        : attachmentUploadsCapabilityKnown && !supportsAttachmentUploads
          ? "This Mate cannot take files yet: attach pictures, or paste the text."
          : null,
    onError: (message) => setThreadError(activeThreadId, message),
  });

  // ------------------------------------------------------------------
  // Derived: composer send state
  // ------------------------------------------------------------------
  const composerSendState = useMemo(
    () =>
      deriveComposerSendState({
        prompt,
        imageCount: composerImages.length + composerFiles.length,
        terminalContexts: composerTerminalContexts,
        elementContextCount: composerReviewComments.length + vaultChanges.length,
      }),
    [
      composerFiles.length,
      composerImages.length,
      composerReviewComments.length,
      vaultChanges.length,
      composerTerminalContexts,
      prompt,
    ],
  );
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
  const compactSlashCommandAvailable =
    composerTrigger?.kind === "slash-command" &&
    prompt.slice(0, composerTrigger.rangeStart).trim() === "" &&
    !compactThreadUnavailable &&
    prompt.slice(composerTrigger.rangeEnd).trim() === "" &&
    composerImages.length === 0 &&
    composerFiles.length === 0 &&
    composerDraft.persistedAttachments.length === 0 &&
    composerTerminalContexts.length === 0 &&
    composerReviewComments.length === 0;

  const mcpCommandOffered = props.onMcpCommand !== undefined;
  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (!composerTrigger) return [];
    if (composerTrigger.kind === "path" || composerTrigger.kind === "crewmate") {
      const crewmateItems =
        composerTrigger.kind === "crewmate" && mentionCrewmates !== undefined
          ? crewmateMenuItems(mentionCrewmates, composerTrigger.query)
          : [];
      const fileItems = workspaceEntries.entries.map((entry) => ({
        id: `path:${entry.kind}:${entry.path}`,
        type: "path" as const,
        path: entry.path,
        pathKind: entry.kind,
        label: basenameOfPath(entry.path),
        description: entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))),
      }));
      const query = composerTrigger.query.trim().toLowerCase();
      const dataItems = dataMentions.map((entry) => ({
        id: `data:${entry.token}`,
        type: "data" as const,
        entry,
        label: entry.token,
        description:
          entry.kind === "service"
            ? `Data service · ${entry.serviceType}`
            : `Table in ${entry.service}`,
      }));
      // A data mention only outranks the file results when the user is
      // plainly typing its name; otherwise files stay first, as before.
      const named = (item: (typeof dataItems)[number]) =>
        query.length > 0 &&
        [item.entry.token, ...item.entry.aliases].some((candidate) =>
          candidate.toLowerCase().startsWith(query),
        );
      return [
        ...crewmateItems,
        ...dataItems.filter((item) => named(item)),
        ...fileItems,
        ...dataItems.filter((item) => !named(item)),
      ];
    }
    if (composerTrigger.kind === "slash-command") {
      const builtInSlashCommandItems = [
        {
          id: "slash:model",
          type: "slash-command",
          command: "model",
          label: "/model",
          description: "Switch response model for this thread",
        },
        ...(mcpCommandOffered
          ? ([
              {
                id: "slash:mcp",
                type: "slash-command",
                command: "mcp",
                label: "/mcp",
                description: "See and add the MCP servers your agents can call",
              },
            ] as const)
          : []),
        ...(planModeUiEnabled
          ? ([
              {
                id: "slash:plan",
                type: "slash-command",
                command: "plan",
                label: "/plan",
                description: "Switch this thread into plan mode",
              },
              {
                id: "slash:default",
                type: "slash-command",
                command: "default",
                label: "/default",
                description: "Switch this thread back to normal build mode",
              },
            ] as const)
          : []),
      ] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
      const slashMenuSkills = getProviderSkillsForSlashMenu(
        selectedProviderSkills,
        settings.showSkillsInSlashMenu,
      );
      const providerSlashCommandItems = getProviderSlashCommandsForSlashMenu(
        selectedProviderSlashCommands,
        slashMenuSkills,
      ).map((command) => ({
        id: `provider-slash-command:${selectedProvider}:${command.name}`,
        type: "provider-slash-command" as const,
        provider: selectedProvider,
        command,
        label: `/${command.name}`,
        description: command.description ?? command.input?.hint ?? "Run provider command",
      }));
      const query = composerTrigger.query.trim().toLowerCase();
      const skillItems = slashMenuSkills.map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: `/skill:${skill.name}`,
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? `${skill.scope} skill` : ""),
      }));
      const visibleProviderSlashCommandItems = providerSlashCommandItems.filter(
        (item) => item.command.name !== "compact" || compactSlashCommandAvailable,
      );
      const slashCommandItems = slashCommandItemsForPromptPosition(
        withoutShadowedProviderCommands([
          ...builtInSlashCommandItems,
          ...visibleProviderSlashCommandItems,
          ...skillItems,
        ]),
        composerTrigger.rangeStart === 0,
      );
      return searchSlashCommandItems(slashCommandItems, query);
    }
    if (composerTrigger.kind === "skill") {
      return searchProviderSkills(selectedProviderSkills, composerTrigger.query).map((skill) => ({
        id: `skill:${selectedProvider}:${skill.name}`,
        type: "skill" as const,
        provider: selectedProvider,
        skill,
        label: formatProviderSkillDisplayName(skill),
        description:
          skill.shortDescription ??
          skill.description ??
          (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
      }));
    }
    return [];
  }, [
    compactSlashCommandAvailable,
    composerTrigger,
    dataMentions,
    mcpCommandOffered,
    mentionCrewmates,
    planModeUiEnabled,
    selectedProvider,
    selectedProviderSkills,
    selectedProviderSlashCommands,
    selectedProviderStatus,
    settings.showSkillsInSlashMenu,
    workspaceEntries.entries,
  ]);

  const composerMenuOpen = Boolean(composerTrigger);
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

  const isComposerApprovalState = activePendingApproval !== null;
  const activePendingUserInput = pendingUserInputs[0] ?? null;
  const isChoiceOnlyPendingQuestion =
    activePendingProgress?.activeQuestion?.allowCustomAnswer === false;
  const showComposerTopDrawer =
    isComposerApprovalState ||
    pendingUserInputs.length > 0 ||
    (!isComposerCollapsedMobile && showPlanFollowUpPrompt && activeProposedPlan !== null);
  const showCollapsedMobilePromptRow =
    isComposerCollapsedMobile && !isComposerApprovalState && pendingUserInputs.length === 0;

  const composerFooterHasWideActions = showPlanFollowUpPrompt || activePendingProgress !== null;
  const composerFooterActionLayoutKey = useMemo(() => {
    if (activePendingProgress) {
      return `pending:${activePendingProgress.questionIndex}:${activePendingProgress.isLastQuestion}:${activePendingIsResponding}`;
    }
    if (phase === "running") {
      return "running";
    }
    if (showPlanFollowUpPrompt) {
      return prompt.trim().length > 0 ? "plan:refine" : "plan:implement";
    }
    return `idle:${composerSendState.hasSendableContent}:${isSendBusy}:${isConnecting}:${isPreparingWorktree}`;
  }, [
    activePendingIsResponding,
    activePendingProgress,
    composerSendState.hasSendableContent,
    isConnecting,
    isPreparingWorktree,
    isSendBusy,
    phase,
    prompt,
    showPlanFollowUpPrompt,
  ]);

  const isComposerMenuLoading =
    composerTriggerKind === "path" && pathTriggerQuery.length > 0 && workspaceEntries.isPending;
  const composerMenuEmptyState = useMemo(() => {
    if (composerTriggerKind === "skill") {
      return "No skills found. Try / to browse provider commands.";
    }
    return composerTriggerKind === "path"
      ? "No matching files or folders."
      : "No matching command.";
  }, [composerTriggerKind]);

  // ------------------------------------------------------------------
  // Provider traits UI
  // ------------------------------------------------------------------
  const setPromptFromTraits = useCallback(
    (nextPrompt: string) => {
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
          prompt,
          onPromptChange: setPromptFromTraits,
          planModeEnabled: settings.planModeEnabled,
        }
      : null;
  const composerTraits = getTraitsSectionVisibility({
    provider: selectedProvider,
    models: selectedProviderModels,
    model: selectedModel,
    prompt,
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
  const collapsedComposerPrimaryActionDisabled =
    phase === "running" ||
    isSendBusy ||
    isSendDisabled ||
    isConnecting ||
    noProviderAvailable ||
    projectSelectionRequired ||
    environmentUnavailable ||
    !composerSendState.hasSendableContent;
  const collapsedComposerPrimaryActionLabel = "Send message";
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
  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt, promptRef]);
  useSyncStateOnChange(
    composerCursor,
    setComposerCursor,
    clampCollapsedComposerCursor(prompt, composerCursor),
    [prompt],
  );

  useEffect(() => {
    if (composerSubmissionError === null) return;
    const nextError = getComposerPromptLengthValidationMessage(prompt);
    if (nextError !== composerSubmissionError) {
      setComposerSubmissionError(nextError);
    }
  }, [composerSubmissionError, prompt]);

  useSyncStateOnChange(providerInputSubmissionError, setProviderInputSubmissionError, null, [
    composerReviewComments,
    composerTerminalContexts,
    prompt,
    selectedModel,
    selectedPromptEffort,
    selectedProvider,
  ]);

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

  useEffect(() => {
    const nextCustomAnswer = activePendingProgress?.customAnswer;
    if (typeof nextCustomAnswer !== "string") {
      // The question is gone and the editor shows the thread draft again. The
      // ref still holds the last answer text, and Send reads the ref. Place
      // the caret at the end so the next keystroke appends.
      if (lastSyncedPendingInputRef.current !== null) {
        promptRef.current = prompt;
        const { cursor, trigger } = composerStateAtPromptEnd(prompt);
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
    prompt,
    promptRef,
    resetComposerTrigger,
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
  }, [detectTrigger, draftId, activeThreadId, promptRef, resetComposerTrigger]);

  // ------------------------------------------------------------------
  // Footer compact layout observation
  // ------------------------------------------------------------------
  useLayoutEffect(() => {
    const composerForm = composerFormRef.current;
    if (!composerForm) return;
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
      cursor: composerCursor,
      expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
      terminalContextIds: composerTerminalContexts.map((context) => context.id),
      pictureIds: composerImages.map((image) => image.id),
      fileIds: composerFiles.map((file) => file.id),
    };
  }, [composerCursor, composerFiles, composerImages, composerTerminalContexts, promptRef]);

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
        cursor: composerCursor,
        expandedCursor: expandCollapsedComposerCursor(promptRef.current, composerCursor),
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
      composerCursor,
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
      if (item.type === "crewmate") {
        const replacement = `@${item.handle} `;
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
    return showPlanFollowUpPrompt || composerSendState.hasSendableContent;
  }, [
    activePendingProgress,
    activePendingResolvedAnswers,
    composerSendState.hasSendableContent,
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
      if (noProviderAvailable || isSendDisabled) {
        event?.preventDefault();
        return;
      }
      // A send while a pasted image is still compressing would strand that
      // image: the turn snapshot wouldn't include it, and it would surface
      // in the *next* draft instead. Only oversized images hit this — small
      // files clear the pending counter within a microtask.
      if (activeThreadId && (pendingImageCompressionsRef.current.get(activeThreadId) ?? 0) > 0) {
        event?.preventDefault();
        toastManager.add({
          type: "info",
          title: "Still compressing a pasted image.",
          description: "Send again once its thumbnail appears.",
        });
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
      blurMobileComposerAfterSend,
      isSendDisabled,
      leaveFullComposer,
      noProviderAvailable,
      onSend,
      promptRef,
      shouldBlurMobileComposerOnSubmit,
    ],
  );
  const compactThreadContext = useCallback(() => {
    if (
      compactDisabled ||
      noProviderAvailable ||
      activePendingApproval !== null ||
      pendingUserInputs.length > 0 ||
      phase === "running" ||
      isSendBusy ||
      isConnecting ||
      !activeThreadId
    ) {
      return;
    }
    // The compact buttons cannot see the compression counter (it lives in
    // a ref), so they render enabled during a paste; toast instead of
    // silently ignoring the click.
    if ((pendingImageCompressionsRef.current.get(activeThreadId) ?? 0) > 0) {
      toastManager.add({
        type: "info",
        title: "Still compressing a pasted image.",
        description: "Compact again once its thumbnail appears.",
      });
      return;
    }

    onCompactContext();
  }, [
    activePendingApproval,
    activeThreadId,
    compactDisabled,
    isConnecting,
    isSendBusy,
    noProviderAvailable,
    onCompactContext,
    pendingUserInputs.length,
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
    [composerDraftTarget, promptRef, setComposerDraftPrompt, setComposerTrigger],
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
  const stashEntryToQueue = usePromptStashStore((state) => state.stashEntry);
  const takeStashEntry = usePromptStashStore((state) => state.takeEntry);
  const finalizeStashEntryImages = usePromptStashStore((state) => state.finalizeEntryImages);

  useEffect(() => {
    return () => {
      if (stashPulseTimeoutRef.current !== null) {
        window.clearTimeout(stashPulseTimeoutRef.current);
      }
    };
  }, []);

  /** Briefly highlight the badge so the save registers without a flourish. */
  const pulseStashBadge = useCallback(() => {
    stashPulseKeyRef.current += 1;
    setStashPulse({ key: stashPulseKeyRef.current, active: true });
    if (stashPulseTimeoutRef.current !== null) {
      window.clearTimeout(stashPulseTimeoutRef.current);
    }
    stashPulseTimeoutRef.current = window.setTimeout(() => {
      stashPulseTimeoutRef.current = null;
      setStashPulse((current) => ({ ...current, active: false }));
    }, 1200);
  }, []);

  const restoreStashEntry = useCallback(
    (entry: PromptStashEntry) => {
      // Remove first so a double activation (click + Enter) can't restore twice.
      const { entry: taken, durable } = takeStashEntry(entry.id);
      if (!taken) return;
      if (!durable) {
        toastManager.add({
          type: "warning",
          title: "Restored prompt may reappear in the stash",
          description:
            "Browser storage rejected the update, so this entry could still be there after a reload.",
          data: { hideCopyButton: true },
        });
      }
      setIsStashMenuOpen(false);

      // Each picture that comes back takes its own place in the text; the
      // place of one that does not leaves it. Anything past the attachment
      // limit cannot be restored: the entry is already out of the queue, so
      // the overflow is reported by name instead of discarded silently.
      const {
        prompt: entryPrompt,
        images: restoredImages,
        unrestoredNames: unrestoredImageNames,
      } = restoreStashedPictures(entry, {
        heldIds: new Set(composerImagesRef.current.map((image) => image.id)),
        room: PROVIDER_SEND_TURN_MAX_ATTACHMENTS - composerImagesRef.current.length,
        hydrate: hydrateImagesFromPersisted,
      });

      const currentPrompt = promptRef.current;
      // An image-only stash must not append blank lines to whatever is
      // already in the composer.
      const nextPrompt =
        entryPrompt.length === 0
          ? currentPrompt
          : currentPrompt.trim().length
            ? `${currentPrompt.replace(/\s+$/, "")}\n\n${entryPrompt}`
            : entryPrompt;
      const promptChanged = nextPrompt !== currentPrompt;
      if (promptChanged) {
        promptRef.current = nextPrompt;
        setComposerDraftPrompt(composerDraftTarget, nextPrompt);
        setComposerCursor(collapseExpandedComposerCursor(nextPrompt, nextPrompt.length));
        setComposerTrigger(null);
      }
      if (restoredImages.length > 0) {
        addComposerDraftImages(composerDraftTarget, restoredImages);
      }

      // Deliberately no model/provider restore: the stash exists to carry a
      // prompt across threads and providers, so whatever the composer has
      // selected right now stays selected.

      // Each cause gets its own sentence so "too large" is never blamed for a
      // file that actually failed to decode, or for one the composer simply
      // had no room to take back.
      const missingImageReasons: string[] = [];
      if (entry.droppedImageNames.length > 0) {
        missingImageReasons.push(
          `${entry.droppedImageNames.join(", ")} exceeded the stash size limit when this prompt was saved.`,
        );
      }
      if (entry.unreadableImageNames && entry.unreadableImageNames.length > 0) {
        missingImageReasons.push(
          `${entry.unreadableImageNames.join(", ")} could not be read when this prompt was saved.`,
        );
      }
      if (unrestoredImageNames.length > 0) {
        missingImageReasons.push(
          `${unrestoredImageNames.join(", ")} could not be restored: the composer is at its ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS}-image limit.`,
        );
      }
      if (missingImageReasons.length > 0) {
        toastManager.add({
          type: "warning",
          title: "Some images were not restored",
          description: missingImageReasons.join(" "),
        });
      }

      // Only yank the caret to the end when text was actually inserted;
      // restoring images alone should leave the user where they were typing.
      if (promptChanged) {
        window.requestAnimationFrame(() => {
          composerEditorRef.current?.focusAtEnd();
        });
      }
    },
    [
      addComposerDraftImages,
      composerDraftTarget,
      composerImagesRef,
      promptRef,
      setComposerDraftPrompt,
      setComposerTrigger,
      takeStashEntry,
    ],
  );

  const deleteStashEntry = useCallback(
    (entry: PromptStashEntry) => {
      const { durable } = takeStashEntry(entry.id);
      if (!durable) {
        toastManager.add({
          type: "warning",
          title: "Stash entry may come back",
          description:
            "Browser storage rejected the delete, so this prompt could reappear after a reload.",
          data: { hideCopyButton: true },
        });
      }
    },
    [takeStashEntry],
  );

  const stashCurrentPrompt = useCallback(async () => {
    // Terminal-context placeholders reference live sessions the stash can't
    // round-trip, so they are stripped from the stashed prompt.
    // Files stay in the composer too: the stash keeps words and pictures.
    const prompt = stripInlineFilePlaceholders(
      promptRef.current.split(INLINE_TERMINAL_CONTEXT_PLACEHOLDER).join(""),
    ).trim();
    const images = [...composerImagesRef.current];
    if (prompt.length === 0 && images.length === 0) {
      setIsStashMenuOpen((open) => !open);
      return;
    }
    // A repeat ⌘S on the *same* still-unencoded snapshot would stash it
    // twice. Guard on the snapshot itself rather than a bare boolean: once
    // the composer has been cleared the user can type something genuinely
    // new (or switch threads) while encoding continues, and that deserves its
    // own entry.
    const snapshotKey = `${String(composerDraftTarget)} ${prompt} ${images
      .map((image) => image.id)
      .join(",")}`;
    if (stashInFlightRef.current.has(snapshotKey)) return;
    stashInFlightRef.current.add(snapshotKey);

    const stashTarget = composerDraftTarget;
    const entryId = randomUUID();
    try {
      // Persist the text-only entry *first*, then clear. Ordering matters in
      // both directions: writing before clearing means a crash or closed tab
      // mid-encode still leaves the prompt recoverable, while clearing before
      // the async image work means edits typed during encoding are not wiped.
      // Images are appended to the stored entry as they finish encoding.
      const { evicted, written, durable } = stashEntryToQueue({
        id: entryId,
        createdAt: new Date().toISOString(),
        prompt,
        attachments: [],
        droppedImageNames: [],
        unreadableImageNames: [],
        pendingImageCount: images.length,
        pictureIds: images.map((image) => image.id),
      });

      // Clearing the composer is only safe once the write actually landed.
      // If it was rejected (quota) the store has already rolled itself back,
      // so leave the composer untouched rather than making it the second
      // casualty of a reload.
      if (!written) {
        toastManager.add({
          type: "error",
          title: "Could not stash this prompt",
          description:
            "Browser storage rejected the write, so the composer was left as-is. Free up site data and try again.",
          data: { hideCopyButton: true },
        });
        return;
      }
      // Written but only into the in-memory fallback (localStorage blocked):
      // the entry is visible and restorable this session, so proceed with the
      // clear, but say it won't survive a reload.
      if (!durable) {
        toastManager.add({
          type: "warning",
          title: "Stashed prompt will not survive a reload",
          description:
            "Browser storage is unavailable, so this stash is kept in memory only for this session.",
          data: { hideCopyButton: true },
        });
      }

      // Only the prompt and images are cleared — terminal/element contexts,
      // preview annotations, and review comments are not stashable, so
      // destroying them here would be unrecoverable.
      promptRef.current = "";
      clearComposerDraftPromptAndImages(stashTarget);
      for (const image of images) {
        releaseAttachmentUpload(image.id);
      }
      setComposerCursor(0);
      setComposerTrigger(null);
      pulseStashBadge();

      if (evicted) {
        toastManager.add({
          type: "warning",
          title: "Oldest stashed prompt discarded",
          description: `The stash holds ${MAX_STASH_ENTRIES} prompts; the oldest was removed to make room.`,
          data: { hideCopyButton: true },
        });
      }

      // Images are re-encoded for the stash rather than stored verbatim: the
      // composer allows up to 10MB per image, but localStorage gives the whole
      // origin ~5MB. Only the stashed copy shrinks; the live attachment (and
      // anything sent without stashing) keeps the original file.
      const candidateAttachments: PersistedComposerImageAttachment[] = [];
      const oversizedImageNames: string[] = [];
      const unreadableImageNames: string[] = [];
      for (const image of images) {
        const result = await compressImageForStash(image.file);
        if (!result.ok) {
          // "too large" and "could not be read" are distinct outcomes; the
          // menu and restore toast report them separately.
          (result.reason === "too-large" ? oversizedImageNames : unreadableImageNames).push(
            image.name,
          );
          continue;
        }
        candidateAttachments.push({
          id: image.id,
          name: image.name,
          mimeType: result.image.mimeType,
          sizeBytes: result.image.sizeBytes,
          dataUrl: result.image.dataUrl,
          // The notes are words the person wrote: they travel with the picture.
          ...(image.picture ? { picture: persistedPicture(image.picture) } : {}),
        });
      }
      const { kept, droppedNames } = partitionStashAttachments(candidateAttachments);

      const { attached, durable: imagesDurable } = finalizeStashEntryImages(entryId, {
        attachments: kept,
        droppedImageNames: [...oversizedImageNames, ...droppedNames],
        unreadableImageNames,
      });
      if (attached) {
        // The second phase can be rejected on its own: the text-only entry
        // fit, but adding image payloads pushed past the quota. Disk would
        // then still hold the phase-one entry with pendingImageCount set,
        // which reads as an orphan after reload — so say so now. Gated on the
        // entry write having been durable: on the in-memory fallback nothing
        // is ever durable, and the session-only warning already covered it.
        if (!imagesDurable && durable && images.length > 0) {
          toastManager.add({
            type: "warning",
            title: "Stashed images were not saved",
            description:
              "The prompt was stashed, but browser storage rejected its images. They will be missing if you reload.",
            data: { hideCopyButton: true },
          });
        }
      } else if (kept.length > 0) {
        // The entry was restored or deleted before its images finished
        // encoding, so they have nowhere to land. Say so rather than letting
        // them evaporate.
        toastManager.add({
          type: "warning",
          title: "Stashed images did not attach",
          description: `That prompt was restored or deleted before ${kept.length} image${kept.length === 1 ? "" : "s"} finished saving. Re-attach ${kept.length === 1 ? "it" : "them"} if you still need ${kept.length === 1 ? "it" : "them"}.`,
          data: { hideCopyButton: true },
        });
      }
    } finally {
      // Must clear on every path: a throw that left this set would wedge this
      // snapshot's ⌘S until the composer remounts.
      stashInFlightRef.current.delete(snapshotKey);
    }
  }, [
    clearComposerDraftPromptAndImages,
    setComposerTrigger,
    composerDraftTarget,
    composerImagesRef,
    finalizeStashEntryImages,
    promptRef,
    pulseStashBadge,
    stashEntryToQueue,
  ]);

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
  const hasBlockingComposerTopDrawer =
    activePendingApproval !== null || pendingUserInputs.length > 0;
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
      showComposerTopDrawer ||
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
    (props.externalDrawerAttached || showComposerTopDrawer || isComposerCollapsedMobile);
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
    !showComposerTopDrawer &&
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
  useSyncStateOnChange(isStashMenuOpen, setIsStashMenuOpen, false, [prompt]);

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
  const addComposerImages = async (files: File[]) => {
    if (!activeThreadId || files.length === 0) return;
    // Captured before the awaits below: the user may switch threads while a
    // picture is read. It still lands in this thread's draft (the pictures
    // hook keeps each picture's own draft), and a send there must wait for it.
    const threadId = activeThreadId;
    const pendingCount = pendingImageCompressionsRef.current.get(threadId) ?? 0;
    pendingImageCompressionsRef.current.set(threadId, pendingCount + files.length);
    try {
      await composerPictures.add(files);
    } finally {
      const remaining = (pendingImageCompressionsRef.current.get(threadId) ?? 0) - files.length;
      if (remaining > 0) {
        pendingImageCompressionsRef.current.set(threadId, remaining);
      } else {
        pendingImageCompressionsRef.current.delete(threadId);
      }
    }
  };

  // ------------------------------------------------------------------
  // Callbacks: paste / drag
  // ------------------------------------------------------------------
  /**
   * Pasted or dropped files: a picture Claude can look at goes to the
   * pictures, anything else to the files, and what cannot go says why.
   */
  const addComposerAttachments = (files: ReadonlyArray<File>) => {
    if (!activeThreadId || files.length === 0) return;
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
    void addComposerImages(pictures);
  };

  const onComposerPaste = (event: React.ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    if (activePendingProgress?.activeQuestion) {
      if (activePendingProgress.activeQuestion.allowCustomAnswer !== false)
        void props.questionAttachments?.add(files);
      return;
    }
    addComposerAttachments(files);
  };

  const insertComposerTextAtEnd = (
    text: string,
    options?: { ensureLeadingBoundary?: boolean },
  ): boolean => {
    if (
      text.length === 0 ||
      isConnecting ||
      isComposerApprovalState ||
      pendingUserInputs.length > 0 ||
      projectSelectionRequired
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
        providerAvailable:
          !noProviderAvailable &&
          providerSendBlockReason === null &&
          zeropsSendBlockReason === null,
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
        return validationMessage === null;
      },
    }),
    [
      detectTrigger,
      activeThread,
      addComposerImages,
      composerDraftTarget,
      composerCursor,
      composerTerminalContexts,
      insertComposerDraftTerminalContext,
      promptRef,
      composerImagesRef,
      composerTerminalContextsRef,
      composerReviewComments,
      isConnecting,
      isComposerApprovalState,
      isChoiceOnlyPendingQuestion,
      pendingUserInputs.length,
      projectSelectionRequired,
      applyPromptReplacement,
      isComposerModelPickerOpen,
      readComposerSnapshot,
      resetComposerTrigger,
      setComposerTrigger,
      selectedModel,
      selectedModelOptionsForDispatch,
      selectedModelSelection,
      noProviderAvailable,
      providerSendBlockReason,
      zeropsSendBlockReason,
      selectedPromptEffort,
      selectedProvider,
      selectedProviderModels,
      interactionMode,
      planModeUiEnabled,
      compactThreadContext,
    ],
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
        {showComposerTopDrawer && (!isTasksDrawerOpen || hasBlockingComposerTopDrawer) ? (
          <div
            className="chat-composer-top-drawer"
            data-chat-composer-top-drawer="true"
            data-variant={activePendingApproval ? "warning" : "info"}
          >
            {!isComposerCollapsedMobile && activePendingApproval ? (
              <div className="flex min-w-0 flex-wrap items-center gap-1 px-3 py-1.5 sm:px-4">
                <ComposerPendingApprovalPanel
                  approval={activePendingApproval}
                  pendingCount={pendingApprovals.length}
                />
                <div className="flex min-w-0 flex-wrap items-center gap-0.5">
                  <ComposerPendingApprovalActions
                    requestId={activePendingApproval.requestId}
                    isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                    options={activePendingApproval.options}
                    onRespondToApproval={onRespondToApproval}
                  />
                </div>
              </div>
            ) : !isComposerCollapsedMobile && pendingUserInputs.length > 0 ? (
              <>
                <ComposerPendingUserInputPanel
                  pendingUserInputs={pendingUserInputs}
                  respondingRequestIds={respondingRequestIds}
                  answers={activePendingDraftAnswers}
                  questionIndex={activePendingQuestionIndex}
                  onToggleOption={onSelectActivePendingUserInputOption}
                  onAdvance={onAdvanceActivePendingUserInput}
                  onDismiss={onDismissActivePendingUserInput}
                />
                {props.questionAttachments?.current.map(({ attachment }) => (
                  <div key={attachment.id} className="flex items-center gap-2 px-3 pb-2">
                    <span>{attachment.name}</span>
                    <span>
                      {props.questionAttachments?.uploads[attachment.id]?.status === "ready"
                        ? "Attached to this answer"
                        : props.questionAttachments?.uploads[attachment.id]?.status === "failed"
                          ? "Upload failed"
                          : "Uploading"}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={`Remove ${attachment.name} from this answer`}
                      onClick={() => props.questionAttachments?.remove(attachment.id)}
                    >
                      Remove
                    </Button>
                    {props.questionAttachments?.uploads[attachment.id]?.status === "failed" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => props.questionAttachments?.retry(attachment.id)}
                      >
                        Retry upload
                      </Button>
                    )}
                  </div>
                ))}
              </>
            ) : !isComposerCollapsedMobile && showPlanFollowUpPrompt && activeProposedPlan ? (
              <ComposerPlanFollowUpBanner
                key={activeProposedPlan.id}
                planTitle={proposedPlanTitle(activeProposedPlan.planMarkdown) ?? null}
              />
            ) : isComposerCollapsedMobile && activePendingApproval ? (
              <div data-chat-composer-collapsed-controls="true">
                <ComposerPendingApprovalPanel
                  approval={activePendingApproval}
                  pendingCount={pendingApprovals.length}
                  className="px-3 pt-2 sm:px-4"
                />
                <div className="flex flex-wrap items-center justify-end gap-1 px-3 pt-2 pb-3 sm:px-4">
                  <ComposerPendingApprovalActions
                    requestId={activePendingApproval.requestId}
                    isResponding={respondingRequestIds.includes(activePendingApproval.requestId)}
                    options={activePendingApproval.options}
                    onRespondToApproval={onRespondToApproval}
                  />
                </div>
              </div>
            ) : isComposerCollapsedMobile && pendingUserInputs.length > 0 ? (
              <div data-chat-composer-collapsed-controls="true">
                <ComposerPendingUserInputPanel
                  pendingUserInputs={pendingUserInputs}
                  respondingRequestIds={respondingRequestIds}
                  answers={activePendingDraftAnswers}
                  questionIndex={activePendingQuestionIndex}
                  onToggleOption={onSelectActivePendingUserInputOption}
                  onAdvance={onAdvanceActivePendingUserInput}
                  onDismiss={onDismissActivePendingUserInput}
                />
                <div className="px-3 pb-3 sm:px-4">
                  <div
                    data-chat-composer-mobile-pending-compact="true"
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-lg border border-border/55 bg-background/55 p-1.5 pl-3 transition-colors hover:bg-background/80",
                      !activePendingProgress?.activeQuestion?.multiSelect && "p-0",
                    )}
                  >
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 flex-1 truncate bg-transparent py-1.5 text-left text-sm",
                        activePendingProgress?.customAnswer
                          ? "text-foreground"
                          : "text-placeholder",
                        !activePendingProgress?.activeQuestion?.multiSelect && "px-3 py-2",
                      )}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={expandMobileComposer}
                      aria-label="Write custom answer"
                    >
                      {activePendingProgress?.customAnswer || "Write custom answer"}
                    </button>
                    {inlineTasksBadge}
                    {inlineStashBadge}
                    {activePendingProgress?.activeQuestion?.multiSelect ? (
                      <ComposerPrimaryActions
                        compact
                        pendingAction={pendingPrimaryAction}
                        isRunning={false}
                        showPlanFollowUpPrompt={false}
                        promptHasText={false}
                        isSendBusy={isSendBusy}
                        sendDisabledReason={sendDisabledReason}
                        isConnecting={isConnecting}
                        isEnvironmentUnavailable={
                          environmentUnavailable || noProviderAvailable || projectSelectionRequired
                        }
                        isPreparingWorktree={false}
                        hasSendableContent={false}
                        preserveComposerFocusOnPointerDown
                        onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                        onInterrupt={handleInterruptPrimaryAction}
                        onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
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
            className={cn("group relative z-10 p-px", composerProviderState.composerFrameClassName)}
          >
            <div
              ref={composerSurfaceRef}
              data-chat-composer-surface="true"
              data-chat-composer-mobile-collapsed={isComposerCollapsedMobile ? "true" : "false"}
              className={cn(
                "transition-[background-color] duration-200",
                isDragOverComposer ? "bg-accent/45 ring-1 ring-primary/70" : null,
                projectSelectionRequired ? "opacity-75" : null,
                composerProviderState.composerSurfaceClassName,
              )}
            >
              {top}
              {showCollapsedMobilePromptRow ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <button
                    type="button"
                    className={cn(
                      "min-w-0 flex-1 truncate bg-transparent p-0 text-left text-[14px] focus:outline-none",
                      (activePendingProgress ? activePendingProgress.customAnswer : prompt.trim())
                        ? "text-foreground"
                        : "text-placeholder",
                    )}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={isChoiceOnlyPendingQuestion ? undefined : expandMobileComposer}
                    disabled={isChoiceOnlyPendingQuestion}
                    aria-label="Expand composer"
                  >
                    {activePendingProgress
                      ? isChoiceOnlyPendingQuestion
                        ? "Choose an option above"
                        : activePendingProgress.customAnswer ||
                          "Type your own answer, or leave this blank to use the selected option"
                      : prompt.trim() ||
                        (zeropsSignInRequired
                          ? "Sign in a coding agent to start"
                          : showProviderUnavailable
                            ? "Enable a provider in Settings"
                            : "Ask anything...")}
                  </button>
                  {inlineTasksBadge}
                  {inlineStashBadge}
                  <button
                    type="button"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover disabled:opacity-64"
                    disabled={collapsedComposerPrimaryActionDisabled}
                    aria-label={collapsedComposerPrimaryActionLabel}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      submitComposer();
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path
                        d="M8 3L8 13M8 3L4 7M8 3L12 7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
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
                  <ComposerCommandMenuLayer anchor={composerMenuAnchor}>
                    <ComposerStashMenu
                      entries={stashQueue}
                      onRestore={restoreStashEntry}
                      onDelete={deleteStashEntry}
                      onClose={() => setIsStashMenuOpen(false)}
                    />
                  </ComposerCommandMenuLayer>
                )}

                {composerMenuOpen && !isComposerApprovalState && (
                  <ComposerCommandMenuLayer anchor={composerMenuAnchor}>
                    <ComposerCommandMenu
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

                {!isComposerCollapsedMobile &&
                  !isComposerApprovalState &&
                  pendingUserInputs.length === 0 &&
                  vaultChanges.length > 0 &&
                  onDismissVaultChange !== undefined && (
                    <ComposerPendingVaultChanges
                      changes={vaultChanges}
                      onRemove={onDismissVaultChange}
                      className="mb-3"
                    />
                  )}

                <div className="relative">
                  <ComposerPromptEditor
                    editorRef={composerEditorRef}
                    value={
                      isComposerApprovalState
                        ? ""
                        : activePendingProgress
                          ? activePendingProgress.customAnswer
                          : prompt
                    }
                    cursor={composerCursor}
                    terminalContexts={
                      !isComposerApprovalState && pendingUserInputs.length === 0
                        ? composerTerminalContexts
                        : []
                    }
                    skills={selectedProviderSkills}
                    crewmates={mentionCrewmates}
                    pictures={
                      !isComposerApprovalState && pendingUserInputs.length === 0
                        ? composerPictureChips
                        : NO_PICTURES
                    }
                    onOpenPicture={composerPictures.open}
                    onRemovePicture={composerPictures.remove}
                    onRetryPicture={composerPictures.retry}
                    onPastePictures={
                      !isComposerApprovalState && pendingUserInputs.length === 0
                        ? composerPictures.paste
                        : undefined
                    }
                    files={
                      !isComposerApprovalState && pendingUserInputs.length === 0
                        ? composerFileList.chips
                        : NO_FILES
                    }
                    onRemoveFile={composerFileList.remove}
                    onRetryFile={composerFileList.retry}
                    {...(showMobilePendingAnswerActions ? { className: "max-sm:pb-11" } : {})}
                    onRemoveTerminalContext={removeComposerTerminalContextFromDraft}
                    onChange={onPromptChange}
                    onCommandKeyDown={onComposerCommandKey}
                    onPaste={onComposerPaste}
                    placeholder={
                      isComposerApprovalState
                        ? "Resolve this approval request to continue"
                        : activePendingProgress
                          ? isChoiceOnlyPendingQuestion
                            ? "Choose an option above"
                            : "Type your own answer, or leave this blank to use the selected option"
                          : showPlanFollowUpPrompt && activeProposedPlan
                            ? "Add feedback to refine the plan, or leave this blank to implement it"
                            : projectSelectionRequired
                              ? "Choose a project above to start a thread"
                              : zeropsSignInRequired
                                ? "Sign in a coding agent to start"
                                : showProviderUnavailable
                                  ? "Enable a provider in Settings to send a message"
                                  : phase === "disconnected"
                                    ? idlePlaceholder
                                    : connectedPlaceholder
                    }
                    disabled={
                      isConnecting ||
                      isComposerApprovalState ||
                      projectSelectionRequired ||
                      isChoiceOnlyPendingQuestion
                    }
                  />
                  {isMobileViewport || isComposerApprovalState ? null : (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="composer-full-toggle"
                            aria-label={
                              fullComposer === "on" ? "Back to the conversation" : "Full screen"
                            }
                            aria-pressed={fullComposer === "on"}
                            // The caret stays where it was in the text.
                            onPointerDown={(event) => event.preventDefault()}
                            onClick={() => {
                              if (fullComposer === "on") leaveFullComposer();
                              else setFullComposerAt({ threadId: activeThreadId, state: "on" });
                            }}
                          >
                            {fullComposer === "on" ? (
                              <Minimize2Icon aria-hidden="true" />
                            ) : (
                              <Maximize2Icon aria-hidden="true" />
                            )}
                          </button>
                        }
                      />
                      <TooltipPopup side="top">
                        {fullComposer === "on"
                          ? "Back to the conversation (Esc)"
                          : "Write in full screen"}
                      </TooltipPopup>
                    </Tooltip>
                  )}
                  {composerPictures.view}
                  {showMobilePendingAnswerActions ? (
                    <div
                      data-chat-composer-mobile-pending-actions="true"
                      className="absolute bottom-0 right-0 flex items-center justify-end gap-1"
                    >
                      {inlineTasksBadge}
                      {inlineStashBadge}
                      <ComposerPrimaryActions
                        compact
                        pendingAction={pendingPrimaryAction}
                        isRunning={false}
                        showPlanFollowUpPrompt={false}
                        promptHasText={false}
                        isSendBusy={isSendBusy}
                        sendDisabledReason={sendDisabledReason}
                        isConnecting={isConnecting}
                        isEnvironmentUnavailable={
                          environmentUnavailable || noProviderAvailable || projectSelectionRequired
                        }
                        isPreparingWorktree={false}
                        hasSendableContent={false}
                        preserveComposerFocusOnPointerDown
                        onPreviousPendingQuestion={onPreviousActivePendingUserInputQuestion}
                        onInterrupt={handleInterruptPrimaryAction}
                        onImplementPlanInNewThread={handleImplementPlanInNewThreadPrimaryAction}
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <ComposerPromptLengthValidation
                message={providerInputSubmissionError ?? composerSubmissionError}
              />

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
                      <CrewRunsOnControl label={crewRunsOn.label} onEdit={crewRunsOn.onEdit} />
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
                        className="shrink-0 gap-2 px-2 text-secondary-label sm:px-3"
                      >
                        <CircleAlertIcon className="size-4" />
                        {providerSetupInstanceId
                          ? "Open provider settings"
                          : "No provider available"}
                      </Button>
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
                        lockedProvider={lockedProvider}
                        lockedContinuationGroupKey={lockedContinuationGroupKey}
                        instanceEntries={providerInstanceEntries}
                        keybindings={keybindings}
                        modelOptionsByInstance={modelOptionsByInstance}
                        {...(zeropsSignInRequired
                          ? { triggerLabelOverride: "Sign in an agent" }
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
                        onOpenProviderSetup={onOpenProviderSetup}
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
                    {showMobilePendingAnswerActions ? null : inlineTasksBadge}
                    {showMobilePendingAnswerActions ? null : inlineStashBadge}
                    <ComposerFooterPrimaryActions
                      compact={isComposerPrimaryActionsCompact}
                      activeContextWindow={activeContextWindow}
                      reserveContextWindowMeter={reserveContextWindowMeter}
                      activeThreadModelDisplayName={activeThreadModelDisplayName}
                      pendingAction={pendingPrimaryAction}
                      isRunning={phase === "running"}
                      showPlanFollowUpPrompt={
                        pendingUserInputs.length === 0 && showPlanFollowUpPrompt
                      }
                      promptHasText={prompt.trim().length > 0}
                      isSendBusy={isSendBusy}
                      sendDisabledReason={sendDisabledReason}
                      isConnecting={isConnecting}
                      isEnvironmentUnavailable={
                        environmentUnavailable || noProviderAvailable || projectSelectionRequired
                      }
                      isPreparingWorktree={isPreparingWorktree}
                      hasSendableContent={composerSendState.hasSendableContent}
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
