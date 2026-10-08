import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";
import { onAccountLifetimeClose } from "../zerops/accountLifetime";
import { resolveZeropsAgentPickerPanelView } from "./zerops/ZeropsAgentPickerPanel.logic";
import {
  zeropsAgentAvailabilityIsRunnable,
  type ZeropsAgentAvailability,
} from "@t3tools/client-runtime/zerops/agentAvailability";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import {
  resolveOwnedAgentId,
  agentOwnershipComposerNotice,
  type ZeropsAgentOwnership,
} from "@t3tools/client-runtime/zerops/agentOwnership";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type EnvironmentId,
  isProviderDriverKind,
  type KeybindingCommand,
  type KeybindingRule,
  type ResolvedKeybindingsConfig,
  type ServerUpsertKeybindingInput,
  ProjectId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type MessageId,
  type ModelSelection,
  type ProviderInteractionMode,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  type ScopedProjectRef,
  type ScopedThreadRef,
  type ThreadId,
  type TurnId,
  type ZeropsAgentAuthSnapshot,
} from "@t3tools/contracts";
import {
  type ChatMessage,
  isImageAttachment,
  type SessionPhase,
  type Thread,
  type ThreadShell,
} from "../types";
import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
} from "../lib/projectScriptKeybindings";
import { type ComposerImageAttachment, type DraftThreadState } from "../composerDraftStore";
import * as Schema from "effect/Schema";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentThreadDetails } from "../state/threads";
import {
  reconcileInlinePicturePlaceholders,
  stripInlinePicturePlaceholders,
} from "../lib/composerPictures";
import { reconcileInlineFilePlaceholders, stripInlineFilePlaceholders } from "../lib/composerFiles";
import {
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";
import type { DraftThreadEnvMode } from "../composerDraftStore";
import type { ComposerSubmissionIntent } from "../composer-logic";
import type { TimelineEntry } from "../session-logic";
import {
  NO_PROVIDER_MODEL_SELECTION,
  resolveSelectableProviderInstanceEntry,
  type ProviderInstanceEntry,
} from "../providerInstances";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "t3code:last-invoked-script-by-project";
export const MAX_HIDDEN_MOUNTED_TERMINAL_THREADS = 10;

export const ENVIRONMENT_RECONNECT_WARNING_GRACE_MS = 2_000;

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export function shouldDockDraftHeroForSubmission(input: {
  isDraftHeroState: boolean;
  activeThreadKey: string | null;
  submissionIntent: ComposerSubmissionIntent;
}): boolean {
  return (
    input.submissionIntent === "foreground" &&
    input.isDraftHeroState &&
    input.activeThreadKey !== null
  );
}

export function shouldReleaseTimelineAnchorForToolActivity(input: {
  anchorMessageId: MessageId | null;
  liveFollowEnabled: boolean;
  runningTurnId: TurnId | null;
  timelineEntries: ReadonlyArray<TimelineEntry>;
}): boolean {
  if (input.anchorMessageId === null || !input.liveFollowEnabled || input.runningTurnId === null) {
    return false;
  }

  return input.timelineEntries.some((timelineEntry) => {
    if (timelineEntry.kind !== "work" || timelineEntry.entry.turnId !== input.runningTurnId) {
      return false;
    }

    const entry = timelineEntry.entry;
    return (
      entry.tone === "tool" ||
      entry.itemType !== undefined ||
      entry.requestKind !== undefined ||
      (entry.command?.trim().length ?? 0) > 0
    );
  });
}

export function resolveDraftHeroState(input: {
  isLocalDraftThread: boolean;
  hasTimelineEntries: boolean;
  isWorking: boolean;
  draftHeroDockRequested: boolean;
  backgroundSubmissionPending: boolean;
}): boolean {
  if (input.backgroundSubmissionPending) {
    return true;
  }
  return (
    input.isLocalDraftThread &&
    !input.hasTimelineEntries &&
    !input.isWorking &&
    !input.draftHeroDockRequested
  );
}

/**
 * Keep a thread's own last painted timeline for its next open. Remounting the
 * list with an empty first paint punches a hole through the chat pane — white
 * in light mode — while the thread detail reloads, even when the destination
 * was on screen moments ago.
 *
 * The timeline only ever holds a thread's own snapshot, never the rows of
 * the conversation left under the next one's name. Stored at module scope so
 * it outlives the view; the account lifetime clears it.
 */
export type HeldThreadTimeline<T extends readonly unknown[]> = {
  threadKey: string | null;
  entries: T;
};

const MAX_REMEMBERED_THREAD_TIMELINES = 16;

let rememberedThreadTimelines = new Map<string, HeldThreadTimeline<readonly unknown[]>>();
let rememberedThreadTimelineOrder: string[] = [];

export function rememberReadyThreadTimeline<T extends readonly unknown[]>(
  held: HeldThreadTimeline<T>,
): void {
  if (held.threadKey === null || held.entries.length === 0) {
    return;
  }
  rememberedThreadTimelines.set(held.threadKey, held);
  rememberedThreadTimelineOrder = [
    ...rememberedThreadTimelineOrder.filter((key) => key !== held.threadKey),
    held.threadKey,
  ];
  while (rememberedThreadTimelineOrder.length > MAX_REMEMBERED_THREAD_TIMELINES) {
    const evicted = rememberedThreadTimelineOrder.shift();
    if (evicted !== undefined) {
      rememberedThreadTimelines.delete(evicted);
    }
  }
}

export function peekRememberedThreadTimeline<T extends readonly unknown[]>(
  threadKey: string | null,
): T | null {
  if (threadKey === null) {
    return null;
  }
  return (rememberedThreadTimelines.get(threadKey)?.entries as T | undefined) ?? null;
}

export function resetHeldThreadTimeline(): void {
  rememberedThreadTimelines = new Map();
  rememberedThreadTimelineOrder = [];
}
onAccountLifetimeClose(resetHeldThreadTimeline);

export function resolveThreadSwitchTimeline<T extends readonly unknown[]>(input: {
  loading: boolean;
  activeThreadKey: string | null;
  nextEntries: T;
  rememberedForActive?: T | null;
}): { entries: T } {
  if (input.nextEntries.length > 0) {
    return { entries: input.nextEntries };
  }
  const rememberedForActive =
    input.rememberedForActive ?? peekRememberedThreadTimeline<T>(input.activeThreadKey);
  if (input.loading && rememberedForActive !== null && rememberedForActive.length > 0) {
    return { entries: rememberedForActive };
  }
  return { entries: input.nextEntries };
}

export function resolveDraftPromotionNavigationTarget(input: {
  serverThreadRef: ScopedThreadRef | null;
  serverThreadStarted: boolean;
  backgroundSubmissionPending: boolean;
}): ScopedThreadRef | null {
  if (input.backgroundSubmissionPending) {
    return null;
  }
  return input.serverThreadStarted ? input.serverThreadRef : null;
}

export function scheduleEnvironmentReconnectWarning(showWarning: () => void): () => void {
  const timeoutId = globalThis.setTimeout(showWarning, ENVIRONMENT_RECONNECT_WARNING_GRACE_MS);
  return () => globalThis.clearTimeout(timeoutId);
}

export function hasEnvironmentReconnectWarningGraceElapsed(
  activeEnvironmentId: EnvironmentId | null,
  elapsedEnvironmentId: EnvironmentId | null,
): boolean {
  return activeEnvironmentId !== null && activeEnvironmentId === elapsedEnvironmentId;
}

export function startNewThreadForProject(
  projectRef: ScopedProjectRef | null,
  handleNewThread: (projectRef: ScopedProjectRef) => Promise<unknown>,
): boolean {
  if (projectRef === null) return false;
  void handleNewThread(projectRef);

  return true;
}

export function resolveThreadMetadataUpdateForNextTurn(input: {
  currentModelSelection: ModelSelection;
  nextModelSelection?: ModelSelection;
  currentBranch: string | null;
  nextBranch?: string;
}): {
  modelSelection?: ModelSelection;
  branch?: string;
  worktreePath?: null;
} | null {
  const nextModelSelection = input.nextModelSelection;
  const modelSelectionChanged =
    nextModelSelection !== undefined &&
    (nextModelSelection.model !== input.currentModelSelection.model ||
      nextModelSelection.instanceId !== input.currentModelSelection.instanceId ||
      JSON.stringify(nextModelSelection.options ?? null) !==
        JSON.stringify(input.currentModelSelection.options ?? null));
  const branchChanged = input.nextBranch !== undefined && input.nextBranch !== input.currentBranch;
  if (!modelSelectionChanged && !branchChanged) {
    return null;
  }
  return {
    ...(modelSelectionChanged ? { modelSelection: nextModelSelection } : {}),
    ...(branchChanged ? { branch: input.nextBranch, worktreePath: null } : {}),
  };
}

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModelSelection: ModelSelection,
): Thread {
  return {
    id: threadId,
    environmentId: draftThread.environmentId,
    projectId: draftThread.projectId,
    title: "New thread",
    modelSelection: fallbackModelSelection,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    createdAt: draftThread.createdAt,
    updatedAt: draftThread.createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestTurn: null,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    checkpoints: [],
    activities: [],
    proposedPlans: [],
  };
}

export function buildLoadingThreadFromShell(shell: ThreadShell): Thread {
  return {
    ...shell,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    deletedAt: null,
  };
}

export function shouldWriteThreadErrorToCurrentServerThread(input: {
  activeServerThread:
    | {
        environmentId: EnvironmentId;
        id: ThreadId;
      }
    | null
    | undefined;
  routeThreadRef: ScopedThreadRef;
  targetThreadId: ThreadId;
}): boolean {
  return Boolean(
    input.activeServerThread &&
    input.targetThreadId === input.routeThreadRef.threadId &&
    input.activeServerThread.environmentId === input.routeThreadRef.environmentId &&
    input.activeServerThread.id === input.targetThreadId,
  );
}

export function buildThreadTurnInterruptInput(thread: Pick<Thread, "id" | "session">): {
  threadId: ThreadId;
  turnId?: TurnId;
} {
  const runningTurnId = thread.session?.status === "running" ? thread.session.activeTurnId : null;
  return {
    threadId: thread.id,
    ...(runningTurnId !== null ? { turnId: runningTurnId } : {}),
  };
}

/** Use the same enabled instance for the composer, provider status, and chat actions. */
export function resolveComposerProviderSelection(input: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  candidateInstanceIds: ReadonlyArray<ProviderInstanceId | null | undefined>;
  lockedProvider: ProviderDriverKind | null;
  lockedInstanceId: ProviderInstanceId | null | undefined;
  /**
   * Zerops agent-auth gating for the composer (D6). On an unstarted thread
   * (`lockedProvider === null`), a candidate instance whose agent this
   * viewer cannot run right now is skipped entirely — never offered as the
   * selection, never sent to; `zeropsSignInRequired` comes back `true` when
   * that is the *only* reason nothing got selected. A started thread keeps
   * its exact selection regardless — the picker, not the selection, is
   * where it offers sign-in there. `undefined` (no agent-auth feed for this
   * environment) behaves exactly as before zerops existed.
   */
  zerops?:
    | {
        readonly available: boolean;
        readonly isAgentRunnable: (instanceId: ProviderInstanceId) => boolean;
      }
    | undefined;
}) {
  const requestedInstanceId = input.candidateInstanceIds.find(
    (candidate) => candidate != null && candidate !== NO_PROVIDER_MODEL_SELECTION.instanceId,
  );
  const requestedDriverKind =
    input.lockedProvider ??
    input.entries.find((entry) => entry.instanceId === requestedInstanceId)?.driverKind ??
    input.entries[0]?.driverKind ??
    ProviderDriverKind.make("unconfigured");
  const lockedContinuationGroupKey = input.lockedProvider
    ? (input.entries.find((entry) => entry.instanceId === input.lockedInstanceId)
        ?.continuationGroupKey ?? null)
    : null;
  // Missing metadata must not move Antigravity history into another Google profile.
  const requiresExactInstance =
    input.lockedProvider === "antigravity" &&
    input.lockedInstanceId != null &&
    lockedContinuationGroupKey === null;
  const compatibleEntries = input.entries.filter(
    (entry) =>
      (!input.lockedProvider || entry.driverKind === input.lockedProvider) &&
      (!lockedContinuationGroupKey || entry.continuationGroupKey === lockedContinuationGroupKey) &&
      (!requiresExactInstance || entry.instanceId === input.lockedInstanceId),
  );
  const isZeropsGated = input.lockedProvider === null && (input.zerops?.available ?? false);
  const passesZeropsGate = (entry: ProviderInstanceEntry): boolean =>
    !isZeropsGated || input.zerops!.isAgentRunnable(entry.instanceId);
  const selectedProviderEntry =
    input.candidateInstanceIds
      .map((candidate) =>
        compatibleEntries.find(
          (entry) =>
            entry.instanceId === candidate &&
            entry.enabled &&
            entry.isAvailable &&
            passesZeropsGate(entry),
        ),
      )
      .find((entry) => entry !== undefined) ??
    resolveSelectableProviderInstanceEntry(
      compatibleEntries.filter(
        (entry) => entry.driverKind === requestedDriverKind && passesZeropsGate(entry),
      ),
      undefined,
    ) ??
    resolveSelectableProviderInstanceEntry(compatibleEntries.filter(passesZeropsGate), undefined);
  const unavailableProviderInstanceId = selectedProviderEntry
    ? undefined
    : input.lockedProvider
      ? (input.lockedInstanceId ?? requestedInstanceId)
      : requestedInstanceId;
  // True only when zerops sign-in gating is the reason nothing got selected —
  // an otherwise-selectable candidate existed, but no agent it maps to is
  // runnable by this viewer right now.
  const zeropsSignInRequired =
    isZeropsGated &&
    selectedProviderEntry === undefined &&
    compatibleEntries.some((entry) => entry.enabled && entry.isAvailable);
  return {
    selectedProviderEntry,
    requestedDriverKind,
    lockedContinuationGroupKey,
    unavailableProviderInstanceId,
    zeropsSignInRequired,
  };
}

/** Unknown auth holds the initial composer without changing the selected login. */
export function isZeropsInstanceRunnable(
  availabilityByInstanceId: ReadonlyMap<ProviderInstanceId, ZeropsAgentAvailability> | undefined,
  instanceId: ProviderInstanceId,
): boolean {
  const availability = availabilityByInstanceId?.get(instanceId);
  return (
    availability === undefined ||
    availability.kind === "unknown" ||
    zeropsAgentAvailabilityIsRunnable(availability)
  );
}

/** What a conversation on someone else's agent shows instead of a composer. */
export interface ZeropsConversationReadOnly {
  /** The ownership line the footer carries — the same words the banner used. */
  readonly notice: string;
  /** Who a pending question or approval waits on — never "you". */
  readonly waitingLabel: string;
}

/**
 * Whether this conversation is one the viewer only reads (D6): its agent is
 * a personal login recorded as another project member's. Then nothing that
 * would act on the agent renders — no composer, no answers to its questions,
 * no approvals — and the timeline stays browsable. A token-authorized agent
 * belongs to the project, so it never makes a conversation read-only;
 * `unrecorded` keeps the composer with its banner, because the viewer's own
 * sign-in is the way out of it.
 */
export function resolveZeropsConversationReadOnly(input: {
  readonly agent: { readonly flagToken: boolean } | undefined;
  readonly ownership: ZeropsAgentOwnership;
}): ZeropsConversationReadOnly | null {
  if (input.agent === undefined || input.agent.flagToken) return null;
  if (input.ownership !== "someone-else") return null;
  const notice = agentOwnershipComposerNotice(input.ownership);
  if (notice === undefined) return null;
  return { notice, waitingLabel: "Waiting for the agent's owner" };
}

/**
 * Whether the composer takes the focus its conversation's open gives it. Shown as the
 * conversation opens, it does, as ever. Its room held at the open (`conversationFooter`), the
 * focus waits for it — and is given as it shows only where the person has not put the focus
 * anywhere meanwhile.
 */
export function composerOpenFocus(input: {
  readonly composerShown: boolean;
  /** It shows after its room was held at the open. */
  readonly late: boolean;
  /** An element other than the page holds the focus. */
  readonly focusElsewhere: boolean;
}): boolean {
  return input.composerShown && (!input.late || !input.focusElsewhere);
}

/** Someone else's conversation as HQ's word paints it, before the Mate's own sign-in is read. */
export const HQ_SAID_READ_ONLY: ZeropsConversationReadOnly = {
  notice: agentOwnershipComposerNotice("someone-else")!,
  waitingLabel: "Waiting for the agent's owner",
};

/** Keep restored drafts and every plan control on the selected instance's supported mode. */
export function resolveComposerInteractionMode(input: {
  planModeEnabled: boolean;
  provider: Pick<ServerProvider, "showInteractionModeToggle"> | null | undefined;
  interactionMode: ProviderInteractionMode;
}): { enabled: boolean; interactionMode: ProviderInteractionMode } {
  const enabled =
    input.planModeEnabled &&
    input.provider != null &&
    input.provider.showInteractionModeToggle !== false;
  return {
    enabled,
    interactionMode: enabled ? input.interactionMode : "default",
  };
}

/** A configured provider without model evidence cannot accept a model-backed turn. */
export function getProviderCatalogSendBlockReason(
  provider: Pick<ServerProvider, "models" | "message"> | null | undefined,
): string | null {
  return provider !== null && provider !== undefined && provider.models.length === 0
    ? (provider.message ?? "No models are available for this provider.")
    : null;
}

export function getAntigravitySendBlockReason(
  provider:
    | Pick<ServerProvider, "driver" | "installed" | "auth" | "models" | "status">
    | null
    | undefined,
  model: string,
): string | null {
  if (provider?.driver !== "antigravity") return null;
  if (!provider.installed) {
    return "Install Antigravity in provider settings before sending.";
  }
  if (provider.auth.status === "unauthenticated") {
    return "Sign in to Antigravity in provider settings before sending.";
  }
  const slug = model.trim();
  if (slug.length === 0) return "Choose an Antigravity model before sending.";
  // A restart clears the account status and catalog. Session startup checks
  // saved credentials and validates the model before sending the prompt.
  if (provider.auth.status === "unknown") return null;
  if (provider.models.length === 0) {
    return "Refresh Antigravity models in provider settings before sending.";
  }
  // A saved model that left the catalog is kept in the picker as unavailable
  // so the user sees what the thread used. The server rejects it at turn
  // start, so block here unless the provider is in an error state, where a
  // retry with the same model is the right move.
  if (
    provider.status === "ready" &&
    slug !== ANTIGRAVITY_DEFAULT_MODEL &&
    !provider.models.some((entry) => entry.slug === slug || entry.aliases?.includes(slug))
  ) {
    return "That Antigravity model is no longer available. Choose another model.";
  }
  return null;
}

export function buildRunningThreadTurnInterruptInput(
  thread: Pick<Thread, "id" | "session"> | null | undefined,
  phase: SessionPhase,
): { threadId: ThreadId; turnId?: TurnId } | null {
  if (phase !== "running" || thread?.session?.status !== "running") {
    return null;
  }
  return buildThreadTurnInterruptInput(thread);
}

export function reconcileMountedTerminalThreadIds(input: {
  currentThreadIds: ReadonlyArray<string>;
  openThreadIds: ReadonlyArray<string>;
  activeThreadId: string | null;
  activeThreadTerminalOpen: boolean;
  maxHiddenThreadCount?: number;
}): string[] {
  const openThreadIdSet = new Set(input.openThreadIds);
  const hiddenThreadIds = input.currentThreadIds.filter(
    (threadId) => threadId !== input.activeThreadId && openThreadIdSet.has(threadId),
  );
  const maxHiddenThreadCount = Math.max(
    0,
    input.maxHiddenThreadCount ?? MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  );
  const nextThreadIds =
    hiddenThreadIds.length > maxHiddenThreadCount
      ? hiddenThreadIds.slice(-maxHiddenThreadCount)
      : hiddenThreadIds;

  if (
    input.activeThreadId &&
    input.activeThreadTerminalOpen &&
    !nextThreadIds.includes(input.activeThreadId)
  ) {
    nextThreadIds.push(input.activeThreadId);
  }

  return nextThreadIds;
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (!isImageAttachment(attachment)) {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function timelineHasEphemeralPreviewUrls(
  entries: ReadonlyArray<Pick<TimelineEntry, "kind"> & { message?: ChatMessage }>,
): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "message" &&
      entry.message !== undefined &&
      collectUserMessageBlobPreviewUrls(entry.message).length > 0,
  );
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (!isImageAttachment(attachment)) continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export { readFileAsDataUrl } from "../lib/imageCompression";

/**
 * `read`, once for each file: a draft saved again and again reads only the
 * files it has not read yet. A read that fails is tried again next time.
 */
export function readOncePerFile(
  read: (file: File) => Promise<string>,
): (file: File) => Promise<string> {
  const reads = new WeakMap<File, Promise<string>>();
  return (file) => {
    const known = reads.get(file);
    if (known) return known;
    const reading = read(file);
    reads.set(file, reading);
    reading.catch(() => reads.delete(file));
    return reading;
  };
}

/**
 * Queued messages put back into the composer (after Stop or a Cancel): their
 * prompts after its own, blank lines between, their files after its own, and
 * their pictures after its own while there is room. The room is the message's
 * attachment limit less what the composer holds — pictures, their kept
 * originals and files — and the queued files; a queued picture takes one, two
 * with its kept original. The pictures past the room go back to the queue,
 * and their places, which sit last, leave the text with them.
 */
export function restoreQueuedToComposer<I, F = never>(input: {
  readonly prompt: string;
  readonly imageCount: number;
  /** The files the composer already holds. */
  readonly fileCount?: number;
  /** All the composer holds as a message sends it: pictures, kept originals, files. */
  readonly heldAttachments?: number;
  /** What a queued picture takes of the room: one, two with its kept original. */
  readonly weigh?: (image: I) => number;
  readonly messages: ReadonlyArray<{
    readonly prompt: string;
    readonly images: ReadonlyArray<I>;
    readonly files?: ReadonlyArray<F> | undefined;
  }>;
}): { prompt: string; images: I[]; overflow: I[]; files: F[] } {
  const files = input.messages.flatMap((message) => message.files ?? []);
  const held = input.heldAttachments ?? input.imageCount + (input.fileCount ?? 0);
  let room = Math.max(0, PROVIDER_SEND_TURN_MAX_ATTACHMENTS - held - files.length);
  const queued = input.messages.flatMap((message) => message.images);
  const weigh = input.weigh ?? (() => 1);
  let fitting = 0;
  while (fitting < queued.length && weigh(queued[fitting]!) <= room) {
    room -= weigh(queued[fitting]!);
    fitting += 1;
  }
  const images = queued.slice(0, fitting);
  const prompt = [input.prompt, ...input.messages.map((message) => message.prompt)]
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
  return {
    prompt: reconcileInlineFilePlaceholders(
      reconcileInlinePicturePlaceholders(prompt, input.imageCount + images.length),
      (input.fileCount ?? 0) + files.length,
    ),
    images,
    overflow: queued.slice(fitting),
    files,
  };
}

export function resolveSendEnvMode(input: {
  requestedEnvMode: DraftThreadEnvMode;
  isGitRepo: boolean;
}): DraftThreadEnvMode {
  return input.isGitRepo ? input.requestedEnvMode : "local";
}

export function resolveBackgroundDraftWorkspaceOptions(input: {
  envMode: DraftThreadEnvMode;
  branch: string | null;
  startFromOrigin: boolean;
}): {
  envMode: DraftThreadEnvMode;
  branch: string | null;
  worktreePath: null;
  startFromOrigin: boolean;
} {
  return {
    envMode: input.envMode,
    branch: input.branch,
    worktreePath: null,
    startFromOrigin: input.envMode === "worktree" && input.startFromOrigin,
  };
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
  /**
   * Optional element-pick attachment count. Element contexts contribute to
   * "sendable content" exactly like images and (text-bearing) terminal
   * contexts do: a prompt of just element chips is still a valid send.
   */
  elementContextCount?: number;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineFilePlaceholders(
    stripInlinePicturePlaceholders(stripInlineTerminalContextPlaceholders(options.prompt)),
  ).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  const elementContextCount = options.elementContextCount ?? 0;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 ||
      options.imageCount > 0 ||
      sendableTerminalContexts.length > 0 ||
      elementContextCount > 0,
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

// Git status for a checkout arrives after the composer paints, and the branch
// strip mounts on the assumption that a project is a Git repo. Without a
// memory, a non-Git project would mount the strip and drop it on every visit.
// Keyed by environment and checkout for the session; never persisted.
const sessionCheckoutIsRepo = new Map<string, boolean>();

function checkoutIsRepoKey(environmentId: EnvironmentId, cwd: string): string {
  return JSON.stringify([environmentId, cwd]);
}

export function rememberCheckoutIsRepo(
  environmentId: EnvironmentId,
  cwd: string,
  isRepo: boolean,
): void {
  sessionCheckoutIsRepo.set(checkoutIsRepoKey(environmentId, cwd), isRepo);
}

export function recallCheckoutIsRepo(
  environmentId: EnvironmentId,
  cwd: string | null,
): boolean | undefined {
  return cwd === null
    ? undefined
    : sessionCheckoutIsRepo.get(checkoutIsRepoKey(environmentId, cwd));
}

/**
 * Whether a thread ran at least one turn, judged from its shell alone.
 *
 * `threadHasStarted` needs the detail: a thread whose latest turn was cleared
 * still has messages, and the loading shell carries none. The shell records
 * when the last user message landed, which every started thread has.
 */
export function threadShellHasStarted(
  shell: Pick<ThreadShell, "latestTurn" | "latestUserMessageAt" | "session"> | null | undefined,
): boolean {
  return Boolean(
    shell &&
    (shell.latestTurn !== null || shell.latestUserMessageAt !== null || shell.session !== null),
  );
}

/**
 * Runs `revert` and resolves once the thread no longer holds `messageId` and
 * its checkpoints are back at `turnCount`, or rejects with the revert failure
 * the server recorded, or after `timeoutMs`. The command's acceptance alone is
 * not the rewind: the provider history rolls back asynchronously.
 */
export async function waitForRevertedMessage(
  threadRef: ScopedThreadRef,
  messageId: MessageId,
  turnCount: number,
  revert: () => Promise<void>,
  timeoutMs = 120_000,
): Promise<void> {
  const threadAtom = environmentThreadDetails.detailAtom(threadRef);
  const initial = appAtomRegistry.get(threadAtom);
  if (!initial?.messages.some((message) => message.id === messageId)) {
    throw new Error("The message to rewind is no longer available.");
  }
  const previousFailures = new Set(
    initial.activities
      .filter((activity) => activity.kind === "checkpoint.revert.failed")
      .map((activity) => activity.id),
  );
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let accepted = false;
    let unsubscribe = () => {};
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) globalThis.clearTimeout(timeout);
      unsubscribe();
      if (error !== undefined) reject(error);
      else resolve();
    };
    const inspect = () => {
      const thread = appAtomRegistry.get(threadAtom);
      if (!thread) return;
      const failure = thread.activities.findLast(
        (activity) =>
          activity.kind === "checkpoint.revert.failed" && !previousFailures.has(activity.id),
      );
      if (failure) {
        const payload = failure.payload;
        finish(
          new Error(
            typeof payload === "object" &&
              payload !== null &&
              "detail" in payload &&
              typeof payload.detail === "string"
              ? payload.detail
              : failure.summary,
          ),
        );
      } else if (
        accepted &&
        !thread.messages.some((message) => message.id === messageId) &&
        thread.checkpoints.every((checkpoint) => checkpoint.checkpointTurnCount <= turnCount) &&
        (turnCount === 0
          ? thread.latestTurn === null
          : thread.checkpoints.some(
              (checkpoint) => checkpoint.turnId === thread.latestTurn?.turnId,
            ))
      ) {
        finish();
      }
    };
    unsubscribe = appAtomRegistry.subscribe(threadAtom, inspect);
    timeout = globalThis.setTimeout(() => {
      finish(new Error("Timed out waiting for the thread to rewind."));
    }, timeoutMs);
    Promise.resolve()
      .then(revert)
      .then(() => {
        accepted = true;
        inspect();
      }, finish);
  });
}

export function threadHasStarted(thread: Thread | null | undefined): boolean {
  return Boolean(
    thread && (thread.latestTurn !== null || thread.messages.length > 0 || thread.session !== null),
  );
}

// Imported history has no session until its first prompt. Resolve its instance
// through the environment's provider catalog before locking to a driver.
export function deriveLockedProvider(input: {
  thread: Thread | null | undefined;
  selectedProvider: string | null;
  threadProvider: string | null;
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver">>;
}): ProviderDriverKind | null {
  if (!threadHasStarted(input.thread)) {
    return null;
  }
  const sessionProvider = input.thread?.session?.providerName ?? null;
  if (sessionProvider && isProviderDriverKind(sessionProvider)) {
    return sessionProvider;
  }
  // Preserve the existing lock while an instance is missing from the catalog;
  // a started thread must not silently fall back to a different driver.
  const threadProvider =
    input.providers.find((provider) => provider.instanceId === input.threadProvider)?.driver ??
    input.threadProvider;
  const selectedProvider =
    input.providers.find((provider) => provider.instanceId === input.selectedProvider)?.driver ??
    input.selectedProvider;
  const narrowedThreadProvider =
    threadProvider && isProviderDriverKind(threadProvider) ? threadProvider : null;
  const narrowedSelectedProvider =
    selectedProvider && isProviderDriverKind(selectedProvider) ? selectedProvider : null;
  return narrowedThreadProvider ?? narrowedSelectedProvider ?? null;
}

export function getStartedThreadModelChangeBlockReason(input: {
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "requiresNewThreadForModelChange">>;
  hasStartedSession: boolean;
  currentModelSelection: ModelSelection;
  currentProviderInstanceId?: ModelSelection["instanceId"] | null | undefined;
  nextModelSelection: ModelSelection;
}): { title: string; description: string } | null {
  if (!input.hasStartedSession) {
    return null;
  }
  const currentModelSelection = {
    ...input.currentModelSelection,
    instanceId: input.currentProviderInstanceId ?? input.currentModelSelection.instanceId,
  };
  if (
    currentModelSelection.instanceId === input.nextModelSelection.instanceId &&
    currentModelSelection.model === input.nextModelSelection.model
  ) {
    return null;
  }
  const currentProvider = input.providers.find(
    (snapshot) => snapshot.instanceId === currentModelSelection.instanceId,
  );
  const nextProvider = input.providers.find(
    (snapshot) => snapshot.instanceId === input.nextModelSelection.instanceId,
  );
  if (
    currentProvider?.requiresNewThreadForModelChange !== true &&
    nextProvider?.requiresNewThreadForModelChange !== true
  ) {
    return null;
  }
  return {
    title: "Start a new chat to change models",
    description: "This provider does not allow switching models after a conversation has started.",
  };
}

export async function waitForStartedServerThread(
  threadRef: ScopedThreadRef,
  timeoutMs = 1_000,
): Promise<boolean> {
  const threadAtom = environmentThreadDetails.detailAtom(threadRef);
  const getThread = () => appAtomRegistry.get(threadAtom);
  const thread = getThread();

  if (threadHasStarted(thread)) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      resolve(result);
    };

    const unsubscribe = appAtomRegistry.subscribe(threadAtom, (thread) => {
      if (!threadHasStarted(thread)) {
        return;
      }
      finish(true);
    });

    if (threadHasStarted(getThread())) {
      finish(true);
      return;
    }

    timeoutId = globalThis.setTimeout(() => {
      finish(false);
    }, timeoutMs);
  });
}

export interface LocalDispatchSnapshot {
  startedAt: string;
  preparingWorktree: boolean;
  submissionIntent: ComposerSubmissionIntent;
  latestUserMessageId: ChatMessage["id"] | null;
  latestTurnTurnId: TurnId | null;
  latestTurnRequestedAt: string | null;
  latestTurnStartedAt: string | null;
  latestTurnCompletedAt: string | null;
  sessionStatus: NonNullable<Thread["session"]>["status"] | null;
  sessionUpdatedAt: string | null;
  latestTurnStartFailureId: string | null;
}

export function latestTurnStartFailureId(
  activeThread: Thread | undefined,
  latestUserMessageId: ChatMessage["id"] | null,
): string | null {
  if (latestUserMessageId === null) return null;
  return (
    activeThread?.activities.findLast((activity) => {
      if (activity.kind !== "provider.turn.start.failed") return false;
      const payload =
        typeof activity.payload === "object" && activity.payload !== null
          ? (activity.payload as { readonly requestId?: unknown })
          : null;
      return payload?.requestId === latestUserMessageId;
    })?.id ?? null
  );
}

export function createLocalDispatchSnapshot(
  activeThread: Thread | undefined,
  options?: {
    preparingWorktree?: boolean;
    submissionIntent?: ComposerSubmissionIntent;
  },
): LocalDispatchSnapshot {
  const latestTurn = activeThread?.latestTurn ?? null;
  const session = activeThread?.session ?? null;
  const latestUserMessage = activeThread?.messages.findLast((message) => message.role === "user");
  return {
    startedAt: new Date().toISOString(),
    preparingWorktree: Boolean(options?.preparingWorktree),
    submissionIntent: options?.submissionIntent ?? "foreground",
    latestUserMessageId: latestUserMessage?.id ?? null,
    latestTurnTurnId: latestTurn?.turnId ?? null,
    latestTurnRequestedAt: latestTurn?.requestedAt ?? null,
    latestTurnStartedAt: latestTurn?.startedAt ?? null,
    latestTurnCompletedAt: latestTurn?.completedAt ?? null,
    sessionStatus: session?.status ?? null,
    sessionUpdatedAt: session?.updatedAt ?? null,
    latestTurnStartFailureId: latestTurnStartFailureId(activeThread, latestUserMessage?.id ?? null),
  };
}

export function hasServerAcknowledgedLocalDispatch(input: {
  localDispatch: LocalDispatchSnapshot | null;
  phase: SessionPhase;
  latestTurn: Thread["latestTurn"] | null;
  latestUserMessageId: ChatMessage["id"] | null;
  session: Thread["session"] | null;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  latestTurnStartFailureId?: string | null;
  threadError: string | null | undefined;
}): boolean {
  if (!input.localDispatch) {
    return false;
  }
  if (input.hasPendingApproval || input.hasPendingUserInput || Boolean(input.threadError)) {
    return true;
  }
  if (
    input.latestTurnStartFailureId !== undefined &&
    input.latestTurnStartFailureId !== null &&
    input.latestTurnStartFailureId !== input.localDispatch.latestTurnStartFailureId
  ) {
    return true;
  }
  if (input.phase === "connecting") {
    return false;
  }

  const latestTurn = input.latestTurn ?? null;
  const session = input.session ?? null;
  const latestUserMessageChanged =
    input.localDispatch.latestUserMessageId !== input.latestUserMessageId;
  const latestTurnChanged =
    input.localDispatch.latestTurnTurnId !== (latestTurn?.turnId ?? null) ||
    input.localDispatch.latestTurnRequestedAt !== (latestTurn?.requestedAt ?? null) ||
    input.localDispatch.latestTurnStartedAt !== (latestTurn?.startedAt ?? null) ||
    input.localDispatch.latestTurnCompletedAt !== (latestTurn?.completedAt ?? null);

  if (input.phase === "running") {
    // Steering adds a user message to the current running turn without
    // necessarily changing any of the turn timestamps. Treat that projected
    // message as the server acknowledgment so the composer does not remain
    // stuck in its local "Sending" state until the turn settles.
    if (latestUserMessageChanged) {
      return true;
    }
    if (!latestTurnChanged) {
      return false;
    }
    if (latestTurn?.startedAt === null || latestTurn === null) {
      return false;
    }
    if (
      session?.activeTurnId !== null &&
      session?.activeTurnId !== undefined &&
      latestTurn?.turnId !== session.activeTurnId
    ) {
      return false;
    }
    return true;
  }

  return (
    latestTurnChanged ||
    input.localDispatch.sessionStatus !== (session?.status ?? null) ||
    input.localDispatch.sessionUpdatedAt !== (session?.updatedAt ?? null)
  );
}

// Returning to the window should land the caret in the composer, so the reader can type right
// away. The exceptions are places where focus is deliberate: another text field, a terminal in
// the drawer or the right panel, or an open dialog or popup. A focused button outside those is
// not one of them, so it yields to the composer.
export function shouldRefocusComposerOnWindowFocus(
  activeElement:
    | (Pick<Element, "tagName" | "closest" | "getAttribute"> & { isContentEditable?: boolean })
    | null,
): boolean {
  if (activeElement === null || activeElement.tagName === "BODY") return true;
  if (
    activeElement.tagName === "INPUT" ||
    activeElement.tagName === "TEXTAREA" ||
    activeElement.tagName === "SELECT" ||
    activeElement.tagName === "IFRAME" ||
    activeElement.tagName === "WEBVIEW" ||
    activeElement.isContentEditable === true ||
    activeElement.getAttribute("role") === "textbox"
  ) {
    return false;
  }
  return (
    activeElement.closest(
      '[role="dialog"], [role="alertdialog"], [data-slot$="-popup"], [data-terminal-owner]',
    ) === null
  );
}

/**
 * Whether the diff panel, as it opens, shows the working tree. Every generic
 * opening does — a tab's fallback, a thread change; one made for a specific
 * diff (a turn from the timeline) marks itself explicit for that thread and
 * keeps the selection it set.
 */
export function diffOpeningShowsWorkingTree(input: {
  readonly diffOpen: boolean;
  readonly activeThreadRef: ScopedThreadRef | null;
  readonly explicitThreadRef: ScopedThreadRef | null;
}): boolean {
  return (
    input.diffOpen &&
    input.activeThreadRef !== null &&
    input.explicitThreadRef !== input.activeThreadRef
  );
}

/**
 * Whether a conversation's content is on its way: none of its messages is here yet, while its
 * shell says it has been talked to. Its empty opening waits then — a load never paints something
 * it takes back.
 */
export function conversationContentPending(input: {
  readonly messageCount: number;
  readonly shell: {
    readonly latestUserMessageAt: string | null;
    readonly latestTurn: unknown;
  } | null;
}): boolean {
  if (input.messageCount > 0 || input.shell === null) return false;
  return input.shell.latestUserMessageAt !== null || input.shell.latestTurn !== null;
}

/**
 * When the person's newest turn in a conversation was made — its newest user message; `null` where
 * it holds none, undefined while it is unread. Older history loaded into the window never moves it.
 */
export function newestPersonTurn(
  messages: ReadonlyArray<{ readonly role: string; readonly createdAt: string }> | undefined,
): string | null | undefined {
  if (messages === undefined) return undefined;
  let newest: { readonly at: string; readonly ms: number } | null = null;
  for (const message of messages) {
    if (message.role !== "user") continue;
    const ms = Date.parse(message.createdAt);
    if (newest === null || ms > newest.ms) newest = { at: message.createdAt, ms };
  }
  return newest?.at ?? null;
}

/**
 * The error this view wrote on a conversation, while it still stands: until the person sends
 * again (the send clears it), or a turn of theirs newer than the newest when it was written
 * (`after`; `null`, none yet) exists — the ask another of their browsers sent through a moment
 * later. The Mate's own messages, older history loaded, and a window a reconnect shrank move
 * nothing; an error that knows nothing of its turns (`after` absent) stands until the next send.
 */
export function localThreadErrorStanding(
  entry:
    | { readonly message: string | null; readonly after?: string | null | undefined }
    | undefined,
  newest: string | null | undefined,
): string | null {
  if (entry === undefined || entry.message === null) return null;
  if (entry.after === undefined || newest === undefined || newest === null) return entry.message;
  if (entry.after === null || Date.parse(newest) > Date.parse(entry.after)) return null;
  return entry.message;
}

/** The same words, newest turn and refused instance can retain the existing error. */
export function threadErrorEntryUnchanged(
  existing:
    | {
        readonly message: string | null;
        readonly after?: string | null | undefined;
        readonly refusalSource?: { readonly loginId: string; readonly reason: string } | undefined;
      }
    | undefined,
  next: {
    readonly message: string | null;
    readonly after?: string | null | undefined;
    readonly refusalSource?: { readonly loginId: string; readonly reason: string } | undefined;
  },
): boolean {
  return (
    existing !== undefined &&
    (existing.message ?? null) === next.message &&
    existing.after === next.after &&
    existing.refusalSource?.loginId === next.refusalSource?.loginId &&
    existing.refusalSource?.reason === next.refusalSource?.reason
  );
}

/** Why a queued message's send did not go. */
export type QueuedSendFailure =
  | { readonly kind: "interrupted" }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "upload-failed" }
  | { readonly kind: "too-long" };

/** What a send does once its uploads (files, pictures, kept originals) have settled. */
export type SendStepAfterUploads =
  | { readonly action: "send" }
  | { readonly action: "abort-queued"; readonly failure: QueuedSendFailure }
  | { readonly action: "thread-error"; readonly message: string };

/**
 * After the uploads: everything up, the message goes. Something not up, a
 * queued message goes back to the queue's head held with its reason (its
 * bubble says it); a live one stays in the composer and the thread says why.
 */
export function sendStepAfterUploads(input: {
  readonly uploaded: ReadonlyArray<unknown> | null;
  readonly queued: boolean;
}): SendStepAfterUploads {
  if (input.uploaded !== null) return { action: "send" };
  return input.queued
    ? { action: "abort-queued", failure: { kind: "upload-failed" } }
    : { action: "thread-error", message: "Retry or remove failed uploads before sending." };
}

/** What becomes of it: back for the drain to send again, or held with its reason. */
export type QueuedSendOutcome =
  | { readonly action: "requeue" }
  | { readonly action: "hold"; readonly reason: string };

/** How many times a send interrupted goes back before it is held for the person. */
export const QUEUED_SEND_RETRIES = 3;

const errorWords = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("message" in error)) return undefined;
  const message = (error as { readonly message: unknown }).message;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : undefined;
};

/**
 * A queued send that did not go. A failure of the moment — the command interrupted, the link
 * dropped, the account's access still being read when its wait ran out — goes back unheld for
 * the drain to send once the link and the gates allow, up to {@link QUEUED_SEND_RETRIES} times.
 * A refusal with words — D6, an upload, the server's own — is held with them, for its bubble to
 * say and the person to retry.
 */
export function queuedSendOutcome(failure: QueuedSendFailure, retries: number): QueuedSendOutcome {
  switch (failure.kind) {
    case "upload-failed":
      return { action: "hold", reason: "An attachment didn't upload." };
    case "too-long":
      return { action: "hold", reason: "Too long to send. Cancel it to edit." };
    case "interrupted":
    case "error": {
      const error = failure.kind === "error" ? failure.error : undefined;
      const words = errorWords(error);
      const momentary =
        failure.kind === "interrupted" ||
        (typeof error === "object" &&
          error !== null &&
          (error as { readonly _tag?: unknown })._tag === "CapabilityRefusal" &&
          (error as { readonly waitable?: unknown }).waitable === true) ||
        isTransportConnectionErrorMessage(words);
      if (momentary) {
        return retries < QUEUED_SEND_RETRIES
          ? { action: "requeue" }
          : { action: "hold", reason: "Couldn't reach it. Retry when it's back." };
      }
      return { action: "hold", reason: words ?? "Didn't send." };
    }
  }
}

/**
 * What saving an action's shortcut writes to the desktop's keybindings: the new one replacing
 * the one it had, or — cleared, or the action deleted — the old one gone, so no shortcut is left
 * running an action that no longer has it. One another project's action of the same id still
 * runs by is kept; the leftovers of earlier edits go.
 */
export function projectScriptKeybindingWrites(input: {
  /** The shortcut it is saved with; null when cleared or deleted. */
  readonly rule: KeybindingRule | null;
  readonly command: KeybindingCommand | null;
  /** The keybindings the server holds now. */
  readonly bound: ResolvedKeybindingsConfig;
  readonly retainedElsewhere: boolean;
}): {
  readonly remove: ReadonlyArray<KeybindingRule>;
  readonly upsert: ServerUpsertKeybindingInput | null;
} {
  const { rule, command } = input;
  if (rule === null && input.retainedElsewhere) return { remove: [], upsert: null };
  const previous = input.bound.flatMap((binding) => {
    if (command === null || binding.command !== command || binding.whenAst) return [];
    try {
      const decoded = decodeProjectScriptKeybindingRule({
        keybinding: keybindingValueForCommand([binding], command),
        command,
      });
      return decoded ? [decoded] : [];
    } catch {
      return [];
    }
  });
  if (rule === null) return { remove: previous, upsert: null };
  const latest = previous.at(-1);
  return {
    remove: previous.slice(0, -1),
    upsert: latest !== undefined && latest.key !== rule.key ? { ...rule, replace: latest } : rule,
  };
}
