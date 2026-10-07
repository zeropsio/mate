import type {
  SetThreadInteractionModeInput,
  SetThreadRuntimeModeInput,
  StartThreadTurnInput,
  UpdateThreadMetadataInput,
} from "@t3tools/client-runtime/operations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { SentAsk, makeSendTurnReceipts } from "@t3tools/client-runtime/data";
import type { ChatAttachment, UploadChatAttachment } from "@t3tools/contracts";
import { applyClaudePromptEffortPrefix } from "@t3tools/shared/model";
import { IMAGE_ONLY_BOOTSTRAP_PROMPT, isSlashCommand } from "@t3tools/shared/userAsk";

import type { ComposerImageAttachment, ComposerSendIds } from "../../composerDraftStore";
import type { ComposerFileAttachment } from "../../lib/composerFiles";
import { materializePicturePrompt } from "../../lib/composerPictures";
import { appendTerminalContextsToPrompt } from "../../lib/terminalContext";
import {
  beginQueuedSend,
  drainGenerationOf,
  isQueuedMessageDue,
  latestCompletedToolActivityId,
  queuedSendAttemptIds,
  settleQueuedSend,
  useQueuedMessageStore,
  type QueuedSendInFlight,
  type QueuedComposerMessage,
} from "../../queuedMessageStore";
import { appendReviewCommentsToPrompt } from "../../reviewCommentContext";
import { derivePhase } from "../../session-logic";
import type { SessionPhase, Thread } from "../../types";
import {
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  hasServerAcknowledgedLocalDispatch,
  latestTurnStartFailureId,
  queuedSendOutcome,
  sendStepAfterUploads,
  type QueuedSendFailure,
} from "../ChatView.logic";
import { crewMessageCommand, type CrewMessageCommand } from "../zerops/crew/crewComposerSend";
import { getComposerSubmissionValidationMessage } from "./composerSubmission";

/**
 * Whether a thread's last queued send is still waiting for the server to pick it up. The next
 * message waits with it, so a send that starts a new turn and the one behind it never leave on
 * one boundary.
 */
export function queuedSendAwaitsServer(input: {
  readonly send: QueuedSendInFlight | undefined;
  readonly thread: Thread | null;
  readonly phase: SessionPhase;
  readonly pendingRequest: boolean;
}): boolean {
  const { send, thread } = input;
  if (send === undefined) return false;
  if (send.phase === "preparing") return true;
  const latestUserMessageId =
    thread?.messages.findLast((message) => message.role === "user")?.id ?? null;
  return !hasServerAcknowledgedLocalDispatch({
    localDispatch: send.thread,
    phase: input.phase,
    latestTurn: thread?.latestTurn ?? null,
    latestUserMessageId,
    session: thread?.session ?? null,
    hasPendingApproval: input.pendingRequest,
    hasPendingUserInput: false,
    latestTurnStartFailureId: latestTurnStartFailureId(thread ?? undefined, latestUserMessageId),
    threadError: null,
  });
}

/**
 * Whether the head of a conversation's queue leaves now from the root sender. Only for a
 * conversation not on screen — an open one sends its own — once it is due (a tool call finished
 * after it was queued, or the turn ended), with its Mate connected and its thread loaded, nothing
 * waiting on the person, and the send before it picked up.
 */
export function backgroundQueuedMessageDue(input: {
  readonly next: QueuedComposerMessage | undefined;
  readonly open: boolean;
  readonly thread: Thread | null;
  readonly threadLive: boolean;
  readonly connected: boolean;
  readonly serverConfigKnown: boolean;
  readonly pendingRequest: boolean;
  readonly send: QueuedSendInFlight | undefined;
}): boolean {
  const { next, thread } = input;
  if (next === undefined || next.sendSettings === undefined) return false;
  if (input.open || thread === null || !input.threadLive) return false;
  if (!input.connected || !input.serverConfigKnown || input.pendingRequest) return false;
  const phase = derivePhase(thread.session);
  if (
    queuedSendAwaitsServer({
      send: input.send,
      thread,
      phase,
      pendingRequest: input.pendingRequest,
    })
  ) {
    return false;
  }
  return isQueuedMessageDue({
    message: next,
    phase,
    latestToolActivityId: latestCompletedToolActivityId(thread.activities),
  });
}

/** The account's turn receipts (`sentAsk.ts`) as a sender uses them. */
export type TurnSendReceipts = Pick<
  ReturnType<typeof makeSendTurnReceipts>,
  "requested" | "accepted" | "failed"
>;

/**
 * What a turn send records in the account's turn receipts: the words the person typed, for a send
 * that starts a turn with words — never a slash command, never a send of pictures alone. The open
 * conversation and the root sender both record through it, so one message makes the same
 * `mate-send-turn` operation wherever it leaves.
 */
export function turnSendAsk(input: {
  readonly trimmedPrompt: string;
  readonly messageId: string;
  readonly threadId: string;
  readonly at: string;
}): SentAsk | null {
  if (input.trimmedPrompt.length === 0 || isSlashCommand(input.trimmedPrompt)) return null;
  return {
    messageId: input.messageId,
    threadId: input.threadId,
    text: input.trimmedPrompt,
    at: input.at,
  };
}

/** What the root sender needs to send a queued message without its conversation's view. */
export interface BackgroundQueuedSendDeps {
  /** The thread as it is now; read again after every wait. */
  readonly readThread: () => Thread | null;
  readonly supportsAttachmentUploads: boolean;
  readonly uploads: {
    readonly start: (
      images: ReadonlyArray<ComposerImageAttachment>,
      files: ReadonlyArray<ComposerFileAttachment>,
    ) => void;
    readonly settle: (ids: ReadonlyArray<string>) => Promise<void>;
    readonly uploaded: (
      images: ReadonlyArray<ComposerImageAttachment>,
      files: ReadonlyArray<ComposerFileAttachment>,
    ) => ReadonlyArray<ChatAttachment> | null;
    readonly release: (
      images: ReadonlyArray<ComposerImageAttachment>,
      files: ReadonlyArray<ComposerFileAttachment>,
    ) => void;
  };
  readonly readDataUrl: (file: File) => Promise<string>;
  readonly updateMetadata: (
    input: UpdateThreadMetadataInput,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly setRuntimeMode: (
    input: SetThreadRuntimeModeInput,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly setInteractionMode: (
    input: SetThreadInteractionModeInput,
  ) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly startTurn: (input: StartThreadTurnInput) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly sendCrew: (input: CrewMessageCommand) => Promise<AtomCommandResult<unknown, unknown>>;
  readonly mintIds: () => ComposerSendIds;
  /** The account's turn receipts; `null` outside an account, where the open view records none. */
  readonly receipts: TurnSendReceipts | null;
}

const failureOf = (result: AtomCommandResult<unknown, unknown>): QueuedSendFailure =>
  isAtomCommandInterrupted(result)
    ? { kind: "interrupted" }
    : { kind: "error", error: result._tag === "Failure" ? squashAtomCommandFailure(result) : null };

/**
 * Sends one queued message of a conversation not on screen as a turn on its thread, with the
 * agent, model and modes it was queued with. It reads nothing from a composer. Its outcome is the
 * queue's, as the open conversation's own send: an interruption goes back unheld for the next
 * try with the same ids, a refusal stays at the head held with its words, a Stop during its
 * uploads leaves it waiting for Send now — and no turn starts.
 */
export async function sendQueuedMessageInBackground(
  threadKey: string,
  messageId: string,
  deps: BackgroundQueuedSendDeps,
): Promise<void> {
  const store = () => useQueuedMessageStore.getState();
  const message = store().queuesByThreadKey[threadKey]?.find((entry) => entry.id === messageId);
  const settings = message?.sendSettings;
  const thread = deps.readThread();
  if (message === undefined || settings === undefined || thread === null) return;

  const files = message.files ?? [];
  const { trimmedPrompt, sendableTerminalContexts, hasSendableContent } = deriveComposerSendState({
    prompt: message.prompt,
    imageCount: message.images.length + files.length,
    terminalContexts: message.terminalContexts,
    elementContextCount: message.reviewComments.length,
  });
  // Only expired terminal context was left: retrying would block the queue on every boundary.
  if (!hasSendableContent) {
    store().remove(threadKey, message.id);
    return;
  }
  const messageText = appendReviewCommentsToPrompt(
    appendTerminalContextsToPrompt(
      materializePicturePrompt(message.prompt, message.images, files),
      sendableTerminalContexts,
    ),
    message.reviewComments,
  );
  const text = applyClaudePromptEffortPrefix(
    messageText || IMAGE_ONLY_BOOTSTRAP_PROMPT,
    settings.promptEffort,
  );
  if (
    getComposerSubmissionValidationMessage({
      prompt: message.prompt,
      providerInput: text,
      submissionTarget: "provider-turn",
    }) !== null
  ) {
    const outcome = queuedSendOutcome({ kind: "too-long" }, 0);
    store().holdAtFront(threadKey, message, outcome.action === "hold" ? outcome.reason : undefined);
    return;
  }

  const taken = beginQueuedSend(
    threadKey,
    message.id,
    latestCompletedToolActivityId(thread.activities),
  );
  if (taken === null) return;
  const drainGenerationAtTake = drainGenerationOf(threadKey);
  const ids = queuedSendAttemptIds({
    given: undefined,
    stored: message.sendIds,
    mint: deps.mintIds,
  });
  const abort = (failure: QueuedSendFailure) => {
    settleQueuedSend(threadKey, null);
    const outcome = queuedSendOutcome(failure, message.retries ?? 0);
    if (outcome.action === "requeue") {
      store().requeueAtFront(threadKey, { ...message, sendIds: ids });
    } else store().holdAtFront(threadKey, message, outcome.reason);
  };

  // Uploaded, the stored attachments; without uploads, the pictures as data.
  let uploadedAttachments: ReadonlyArray<ChatAttachment> = [];
  let attachments: ReadonlyArray<UploadChatAttachment | ChatAttachment> = [];
  if (deps.supportsAttachmentUploads && message.images.length + files.length > 0) {
    deps.uploads.start(message.images, files);
    await deps.uploads.settle([
      ...message.images.map((image) => image.id),
      ...files.map((file) => file.id),
    ]);
    const uploaded = deps.uploads.uploaded(message.images, files);
    const step = sendStepAfterUploads({ uploaded, queued: true });
    if (step.action !== "send" || uploaded === null) {
      abort(step.action === "abort-queued" ? step.failure : { kind: "upload-failed" });
      return;
    }
    uploadedAttachments = uploaded;
    attachments = uploaded;
  } else if (message.images.length > 0) {
    try {
      attachments = await Promise.all(
        message.images.map(async (image) => ({
          type: "image" as const,
          name: image.name,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
          dataUrl: await deps.readDataUrl(image.file),
        })),
      );
    } catch {
      abort({ kind: "upload-failed" });
      return;
    }
  }
  // Stop drained the queue while this one uploaded: no turn starts after a Stop. It waits at
  // the head for the person's Send now instead of going anywhere by itself.
  if (drainGenerationOf(threadKey) !== drainGenerationAtTake) {
    settleQueuedSend(threadKey, null);
    store().holdAtFront(threadKey, message);
    return;
  }

  const current = deps.readThread() ?? thread;
  // A crewmate's chat never starts a turn of its own: the crew engine writes the message in.
  const crewMessage = crewMessageCommand(current, {
    text: messageText || IMAGE_ONLY_BOOTSTRAP_PROMPT,
    attachments: uploadedAttachments,
  });
  if (crewMessage !== null) {
    const result = await deps.sendCrew(crewMessage);
    if (result._tag === "Failure") {
      abort(failureOf(result));
      return;
    }
    settleQueuedSend(threadKey, null);
    deps.uploads.release(message.images, files);
    return;
  }

  // The server starts the turn with the thread's stored model and modes, so the ones the
  // message was queued with are saved first.
  const createdAt = new Date().toISOString();
  const threadId = current.id;
  // Recorded where the open conversation records its own send: words, never a crew message.
  const environmentId = current.environmentId;
  const ask = turnSendAsk({ trimmedPrompt, messageId: ids.messageId, threadId, at: createdAt });
  if (ask !== null) deps.receipts?.requested(environmentId, ask);
  const modelChanged =
    settings.modelSelection.instanceId !== current.modelSelection.instanceId ||
    settings.modelSelection.model !== current.modelSelection.model ||
    JSON.stringify(settings.modelSelection.options ?? null) !==
      JSON.stringify(current.modelSelection.options ?? null);
  const steps: Array<() => Promise<AtomCommandResult<unknown, unknown>>> = [];
  if (modelChanged) {
    steps.push(() => deps.updateMetadata({ threadId, modelSelection: settings.modelSelection }));
  }
  if (settings.runtimeMode !== current.runtimeMode) {
    steps.push(() =>
      deps.setRuntimeMode({ threadId, runtimeMode: settings.runtimeMode, createdAt }),
    );
  }
  if (settings.interactionMode !== current.interactionMode) {
    steps.push(() =>
      deps.setInteractionMode({ threadId, interactionMode: settings.interactionMode, createdAt }),
    );
  }
  for (const step of steps) {
    const result = await step();
    if (result._tag === "Failure") {
      deps.receipts?.failed(environmentId, ids.messageId, false);
      abort(failureOf(result));
      return;
    }
  }

  settleQueuedSend(threadKey, createLocalDispatchSnapshot(deps.readThread() ?? current));
  const result = await deps.startTurn({
    commandId: ids.commandId,
    threadId,
    message: { messageId: ids.messageId, role: "user", text, attachments: [...attachments] },
    modelSelection: settings.modelSelection,
    runtimeMode: settings.runtimeMode,
    interactionMode: settings.interactionMode,
    createdAt,
  });
  if (result._tag === "Failure") {
    deps.receipts?.failed(environmentId, ids.messageId, true);
    abort(failureOf(result));
    return;
  }
  deps.receipts?.accepted(environmentId, ids.messageId);
  deps.uploads.release(message.images, files);
}
