import { onAccountLifetimeClose } from "../zerops/accountLifetime";
import { resolveAgentAuthorizer, type LocalAgentSigners } from "../zerops/useZeropsAgentSigner";
import { resolveZeropsAgentPickerPanelView } from "./zerops/ZeropsAgentPickerPanel.logic";
import {
  resolveZeropsAgentAvailability,
  zeropsAgentAvailabilityIsRunnable,
  type ZeropsAgentAvailability,
} from "@t3tools/client-runtime/zerops/agentAvailability";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import {
  agentIdForProviderInstance,
  ANTIGRAVITY_DEFAULT_MODEL,
  type EnvironmentId,
  isProviderDriverKind,
  ProjectId,
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
  type ZeropsAgentId,
} from "@t3tools/contracts";
import {
  type ChatMessage,
  isImageAttachment,
  type SessionPhase,
  type Thread,
  type ThreadShell,
} from "../types";
import { type ComposerImageAttachment, type DraftThreadState } from "../composerDraftStore";
import * as Schema from "effect/Schema";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentThreadDetails } from "../state/threads";
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
export const MAX_HIDDEN_MOUNTED_PREVIEW_THREADS = 3;
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
 * A thread only ever paints its own snapshot: showing another conversation
 * while the next one loads would paint something the reload takes back.
 * Stored at module scope because ChatView remounts when the thread route
 * changes; the account lifetime clears it.
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

/**
 * Per-instance zerops runnability (D6), derived once from the agent-auth
 * feed so the composer's selection gate and the model picker's panels read
 * the same answer for the same instance. `undefined` when nothing gates the
 * agents — no environment to read, a non-Zerops environment
 * (`available: false`), or a failed read, an old Mate's `unsupported`
 * included: the composer offers no retry for one, so gating on it would
 * hide the models with no way out, and the server's turn refusal stays the
 * authority. Every caller then falls back to pre-zerops behavior. While the
 * snapshot is still being read, every agent instance is `unknown` with that
 * read — never `needs-sign-in`.
 */
export function resolveZeropsProviderAvailability(input: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly agentAuth: Known<ZeropsAgentAuthSnapshot> | undefined;
  readonly viewerSubject: string | undefined;
  readonly localSigners: LocalAgentSigners;
  readonly recordFailed: ReadonlySet<ZeropsAgentId>;
}): ReadonlyMap<ProviderInstanceId, ZeropsAgentAvailability> | undefined {
  const agentAuth = input.agentAuth;
  if (agentAuth === undefined || agentAuth.state === "gone" || agentAuth.state === "failed") {
    return undefined;
  }
  if (agentAuth.state === "known" && !agentAuth.value.available) return undefined;
  const map = new Map<ProviderInstanceId, ZeropsAgentAvailability>();
  for (const entry of input.entries) {
    const agentId = agentIdForProviderInstance(entry.instanceId);
    if (agentId === undefined) continue;
    if (agentAuth.state !== "known") {
      map.set(
        entry.instanceId,
        resolveZeropsAgentAvailability({ agent: agentAuth, viewerSubject: input.viewerSubject }),
      );
      continue;
    }
    const agent = agentAuth.value.agents.find((candidate) => candidate.agentId === agentId);
    if (agent === undefined) continue;
    map.set(
      entry.instanceId,
      resolveZeropsAgentAvailability({
        agent: {
          ...agentAuth,
          value: {
            credPresent: agent.credPresent,
            flagToken: agent.flagToken,
            providerAuth: agent.providerAuth,
            state: agent.state,
            loginPhase: agent.login?.phase,
            authorizedBy: resolveAgentAuthorizer(
              agent.agentId,
              agent.authorizedBy,
              input.localSigners,
            ),
          },
        },
        viewerSubject: input.viewerSubject,
        recordFailed: input.recordFailed.has(agent.agentId),
      }),
    );
  }
  return map;
}

/**
 * Whether the composer's zerops gate should treat `instanceId` as runnable.
 * An instance with no entry in the map — a non-Zerops environment, or a
 * driver Mate never signs anybody in to — is always runnable: there is
 * nothing here to gate it. Nor does an `unknown` sign-in move a selection:
 * only a known answer can say the viewer cannot run the agent, and Send
 * waits on it meanwhile (`resolveZeropsOwnedAgentSendBlockReason`).
 */
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

/**
 * Why Send is disabled for the instance this composer would spend (D6) —
 * `undefined` when that instance is not gated (no instance, not a Zerops
 * agent, or nothing mapped for it), or when its agent is runnable (`ready`,
 * or `registering`: the server lets that one through for the signer too, so
 * it must never read as blocked here). An `unknown` sign-in holds Send while
 * it is read. Reuses the picker panel's own status line — one piece of copy
 * per state, wherever it shows.
 */
export function resolveZeropsOwnedAgentSendBlockReason(input: {
  readonly instanceId: ProviderInstanceId | null | undefined;
  readonly availabilityByInstanceId:
    | ReadonlyMap<ProviderInstanceId, ZeropsAgentAvailability>
    | undefined;
}): string | undefined {
  if (input.instanceId == null) return undefined;
  const agentId = agentIdForProviderInstance(input.instanceId);
  const availability = input.availabilityByInstanceId?.get(input.instanceId);
  if (agentId === undefined || availability === undefined) return undefined;
  if (availability.kind === "ready" || zeropsAgentAvailabilityIsRunnable(availability)) {
    return undefined;
  }
  return resolveZeropsAgentPickerPanelView({ agentId, availability }).statusLine;
}

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
  return reconcileRetainedMountedThreadIds({
    currentThreadIds: input.currentThreadIds,
    openThreadIds: input.openThreadIds,
    activeThreadId: input.activeThreadId,
    activeThreadOpen: input.activeThreadTerminalOpen,
    maxHiddenThreadCount: input.maxHiddenThreadCount ?? MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  });
}

export function reconcileRetainedMountedThreadIds(input: {
  currentThreadIds: ReadonlyArray<string>;
  openThreadIds: ReadonlyArray<string>;
  activeThreadId: string | null;
  activeThreadOpen: boolean;
  maxHiddenThreadCount: number;
  retainInactiveActiveThread?: boolean;
}): string[] {
  const openThreadIdSet = new Set(input.openThreadIds);
  const hiddenThreadIds = input.currentThreadIds.filter(
    (threadId) =>
      (threadId !== input.activeThreadId || input.retainInactiveActiveThread === true) &&
      openThreadIdSet.has(threadId),
  );
  const maxHiddenThreadCount = Math.max(0, input.maxHiddenThreadCount);
  const nextThreadIds =
    hiddenThreadIds.length > maxHiddenThreadCount
      ? hiddenThreadIds.slice(-maxHiddenThreadCount)
      : hiddenThreadIds;

  if (
    input.activeThreadId &&
    input.activeThreadOpen &&
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

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
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
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
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

export function branchMismatchKey(
  threadId: string | null,
  mismatch: { threadBranch: string; currentBranch: string } | null,
): string | null {
  if (!threadId || !mismatch) {
    return null;
  }
  return `${threadId}:${mismatch.threadBranch}:${mismatch.currentBranch}`;
}

// The mismatch banner only matters when the user is about to send: passive
// reading of an old thread carries no risk (the branch picker tint already
// covers ambient awareness). Draft content is the intent signal — composer
// focus is useless here because ChatView autofocuses the composer on every
// thread open. `wasShownForCurrentMismatch` keeps the banner mounted once
// revealed so it doesn't flicker away when the draft is cleared.
export function shouldShowBranchMismatchBanner(input: {
  hasMismatch: boolean;
  isDismissed: boolean;
  composerHasContent: boolean;
  wasShownForCurrentMismatch: boolean;
}): boolean {
  if (!input.hasMismatch || input.isDismissed) {
    return false;
  }
  return input.composerHasContent || input.wasShownForCurrentMismatch;
}

// Session-scoped (module-level so it survives ChatView remounts, e.g. route
// changes). Durable cross-device dismissal is planned as a server-side ack.
const sessionDismissedBranchMismatchKeys = new Set<string>();

export function dismissBranchMismatchForSession(key: string): void {
  sessionDismissedBranchMismatchKeys.add(key);
}

export function isBranchMismatchDismissedForSession(key: string | null): boolean {
  return key !== null && sessionDismissedBranchMismatchKeys.has(key);
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
