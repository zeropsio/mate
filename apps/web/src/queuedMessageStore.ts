import type { ModelSelection, ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { create } from "zustand";

import type { LocalDispatchSnapshot } from "./components/ChatView.logic";
import type { ComposerSubmissionIntent } from "./composer-logic";
import type { ComposerImageAttachment, ComposerSendIds } from "./composerDraftStore";
import type { ComposerFileAttachment } from "./lib/composerFiles";
import type { TerminalContextDraft } from "./lib/terminalContext";
import { randomUUID } from "./lib/utils";
import type { ReviewCommentContext } from "./reviewCommentContext";
import type { SessionPhase } from "./types";
import { onAccountLifetimeClose } from "./zerops/accountLifetime";

/**
 * The composer's agent, model and modes when the message was queued. A message that leaves
 * while its conversation is not on screen goes with these, not with whatever composer is open.
 */
export interface QueuedMessageSendSettings {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  /** The effort written into the text, for the agents that read it there; null where none is. */
  readonly promptEffort: string | null;
}

/**
 * A thread's queued message under way, whichever sender took it — the open conversation or the
 * root sender: preparing (uploads, the thread's settings) until its turn start goes out, then
 * the thread as it was at that moment. The next message waits until the server has moved past
 * it, so two messages never leave on one boundary.
 */
export type QueuedSendInFlight =
  | { readonly phase: "preparing" }
  | { readonly phase: "dispatched"; readonly thread: LocalDispatchSnapshot };

/**
 * A composer submission held back while the thread's turn is running. It
 * carries the full draft snapshot so the send path can dispatch it later with
 * the same text, attachments, and contexts the user pressed Enter on.
 */
export interface QueuedComposerMessage {
  id: string;
  prompt: string;
  images: ComposerImageAttachment[];
  /** Files that are not pictures; absent on a message queued before files could go. */
  files?: ComposerFileAttachment[];
  terminalContexts: TerminalContextDraft[];
  reviewComments: ReviewCommentContext[];
  submissionIntent: ComposerSubmissionIntent;
  /**
   * What it goes with when it leaves while its conversation is not on screen. Absent on the
   * overflow a restore queues: that one waits for its conversation's Send now.
   */
  sendSettings?: QueuedMessageSendSettings;
  /**
   * The newest completed tool activity at queue time. A different id later
   * means a tool call finished after the user queued, which is the boundary
   * the message goes out on.
   */
  queuedAfterToolActivityId: string | null;
  /**
   * Set when the message was created by Stop or a failed restore, not by the
   * user pressing send. It waits for Send now instead of leaving on its own.
   */
  holdUntilUserAction?: boolean;
  /** Why its send was refused, in the refusal's own words; its bubble says it. */
  heldReason?: string;
  /** How many times its send was interrupted and it went back for the drain to retry. */
  retries?: number;
  /**
   * The ids its interrupted send went with. The server may have taken that command before its
   * answer was lost, so the retry goes with the same ids and the server's receipts take it once.
   */
  sendIds?: ComposerSendIds;
  createdAt: string;
}

interface QueuedMessageStoreState {
  queuesByThreadKey: Record<string, QueuedComposerMessage[]>;
  /**
   * Bumped per thread by `drain`. A send that took a message before its thread's drain and
   * finishes its upload after it compares this to the value it captured and gives up, so Stop
   * cannot be followed by a queued message starting a new turn. Per thread: Stop in one
   * conversation never holds another's send.
   */
  drainGenerationByThreadKey: Record<string, number>;
  /**
   * How many views of each conversation are on screen. An open conversation sends its own
   * queue; the root sender sends the others'.
   */
  openThreadKeys: Record<string, number>;
  /** Each thread's queued send in flight, while it prepares and until the server picks it up. */
  queuedSendByThreadKey: Record<string, QueuedSendInFlight>;
  /** Marks a conversation on screen until the returned release runs. */
  holdOpen: (threadKey: string) => () => void;
  /** Records a thread's queued send in flight, or forgets it (null). */
  setQueuedSend: (threadKey: string, send: QueuedSendInFlight | null) => void;
  enqueue: (threadKey: string, message: Omit<QueuedComposerMessage, "id">) => QueuedComposerMessage;
  /**
   * Removes one message and returns it, or null when another caller already
   * took it. The remaining messages are re-anchored to `toolActivityId` so
   * only one queued message leaves per tool boundary.
   */
  take: (
    threadKey: string,
    id: string,
    toolActivityId: string | null,
  ) => QueuedComposerMessage | null;
  /** Removes one message without touching the others' anchors. Null when already gone. */
  remove: (threadKey: string, id: string) => QueuedComposerMessage | null;
  /**
   * Puts a message back at the head, held for user action. Used when its
   * send failed: the queue keeps its order and nothing behind it overtakes.
   */
  holdAtFront: (threadKey: string, message: QueuedComposerMessage, reason?: string) => void;
  /**
   * Puts a message whose send was interrupted back at the head, unheld and counted: the drain
   * sends it again once the link and the gates allow.
   */
  requeueAtFront: (threadKey: string, message: QueuedComposerMessage) => void;
  /** The person's Retry: the held message's hold and reason go. Null when already gone. */
  release: (threadKey: string, id: string) => QueuedComposerMessage | null;
  /** Removes and returns every queued message for the thread, oldest first. */
  drain: (threadKey: string) => QueuedComposerMessage[];
}

const EMPTY_QUEUE: QueuedComposerMessage[] = [];

/**
 * In-memory only: a queued message is a live intent, not a draft worth
 * persisting. Like every other account-scoped client state, it goes when the
 * account does.
 */
export const useQueuedMessageStore = create<QueuedMessageStoreState>()((set, get) => {
  /** Puts a message at the head of its thread's queue: nothing behind it overtakes. */
  const putAtFront = (threadKey: string, message: QueuedComposerMessage) => {
    set((state) => {
      const rest = (state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE).filter(
        (entry) => entry.id !== message.id,
      );
      return { queuesByThreadKey: { ...state.queuesByThreadKey, [threadKey]: [message, ...rest] } };
    });
  };
  return {
    queuesByThreadKey: {},
    drainGenerationByThreadKey: {},
    openThreadKeys: {},
    queuedSendByThreadKey: {},
    holdOpen: (threadKey) => {
      const step = (by: 1 | -1) =>
        set((state) => {
          const count = (state.openThreadKeys[threadKey] ?? 0) + by;
          const openThreadKeys = { ...state.openThreadKeys };
          if (count > 0) openThreadKeys[threadKey] = count;
          else delete openThreadKeys[threadKey];
          return { openThreadKeys };
        });
      step(1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        step(-1);
      };
    },
    setQueuedSend: (threadKey, send) => {
      set((state) => {
        const queuedSendByThreadKey = { ...state.queuedSendByThreadKey };
        if (send === null) delete queuedSendByThreadKey[threadKey];
        else queuedSendByThreadKey[threadKey] = send;
        return { queuedSendByThreadKey };
      });
    },
    enqueue: (threadKey, message) => {
      const entry: QueuedComposerMessage = { ...message, id: randomUUID() };
      set((state) => ({
        queuesByThreadKey: {
          ...state.queuesByThreadKey,
          [threadKey]: [...(state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE), entry],
        },
      }));
      return entry;
    },
    take: (threadKey, id, toolActivityId) => {
      const queue = get().queuesByThreadKey[threadKey];
      const entry = queue?.find((message) => message.id === id);
      if (!queue || !entry) {
        return null;
      }
      set((state) => {
        const remaining = (state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE)
          .filter((message) => message.id !== id)
          .map((message) =>
            message.queuedAfterToolActivityId === toolActivityId
              ? message
              : { ...message, queuedAfterToolActivityId: toolActivityId },
          );
        const queuesByThreadKey = { ...state.queuesByThreadKey };
        if (remaining.length === 0) {
          delete queuesByThreadKey[threadKey];
        } else {
          queuesByThreadKey[threadKey] = remaining;
        }
        return { queuesByThreadKey };
      });
      return entry;
    },
    remove: (threadKey, id) => {
      const queue = get().queuesByThreadKey[threadKey];
      const entry = queue?.find((message) => message.id === id);
      if (!queue || !entry) {
        return null;
      }
      set((state) => {
        const remaining = (state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE).filter(
          (message) => message.id !== id,
        );
        const queuesByThreadKey = { ...state.queuesByThreadKey };
        if (remaining.length === 0) {
          delete queuesByThreadKey[threadKey];
        } else {
          queuesByThreadKey[threadKey] = remaining;
        }
        return { queuesByThreadKey };
      });
      return entry;
    },
    holdAtFront: (threadKey, message, reason) => {
      const { heldReason: _was, ...rest } = message;
      putAtFront(threadKey, {
        ...rest,
        holdUntilUserAction: true,
        ...(reason === undefined ? {} : { heldReason: reason }),
      });
    },
    requeueAtFront: (threadKey, message) => {
      const { holdUntilUserAction: _held, heldReason: _reason, ...rest } = message;
      putAtFront(threadKey, { ...rest, retries: (message.retries ?? 0) + 1 });
    },
    release: (threadKey, id) => {
      const entry = get().queuesByThreadKey[threadKey]?.find((message) => message.id === id);
      if (!entry) return null;
      // A person's Retry goes with fresh ids: a refusal remembered by command id never returns.
      const { holdUntilUserAction: _held, heldReason: _reason, sendIds: _ids, ...released } = entry;
      set((state) => ({
        queuesByThreadKey: {
          ...state.queuesByThreadKey,
          [threadKey]: (state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE).map((message) =>
            message.id === id ? released : message,
          ),
        },
      }));
      return released;
    },
    drain: (threadKey) => {
      const queue = get().queuesByThreadKey[threadKey];
      const bumped = (state: QueuedMessageStoreState) => ({
        ...state.drainGenerationByThreadKey,
        [threadKey]: (state.drainGenerationByThreadKey[threadKey] ?? 0) + 1,
      });
      // Bumped even with nothing left queued: the one message a send already took and is
      // still uploading must not start a turn after Stop either.
      if (!queue || queue.length === 0) {
        set((state) => ({ drainGenerationByThreadKey: bumped(state) }));
        return EMPTY_QUEUE;
      }
      set((state) => {
        const queuesByThreadKey = { ...state.queuesByThreadKey };
        delete queuesByThreadKey[threadKey];
        return { queuesByThreadKey, drainGenerationByThreadKey: bumped(state) };
      });
      return queue;
    },
  };
});

/**
 * The newest finished tool call. Its id changing is the boundary a queued
 * message goes out on. Live arrays are sorted, but a snapshot loaded from the
 * database is not, so pick by sequence rather than position.
 */
export function latestCompletedToolActivityId(
  activities: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly sequence?: number | undefined;
    readonly createdAt: string;
  }>,
): string | null {
  let latest: (typeof activities)[number] | null = null;
  for (const activity of activities) {
    if (activity.kind !== "tool.completed") continue;
    if (
      latest === null ||
      (activity.sequence ?? -1) > (latest.sequence ?? -1) ||
      ((activity.sequence ?? -1) === (latest.sequence ?? -1) &&
        activity.createdAt > latest.createdAt)
    ) {
      latest = activity;
    }
  }
  return latest?.id ?? null;
}

/**
 * A queued message is due mid-turn once a tool call finished after it was
 * queued, and as soon as the turn is over otherwise. "connecting" is the gap
 * between a send and the provider picking it up, so nothing is due there.
 */
export function isQueuedMessageDue(input: {
  message: Pick<QueuedComposerMessage, "queuedAfterToolActivityId" | "holdUntilUserAction">;
  phase: SessionPhase;
  latestToolActivityId: string | null;
}): boolean {
  if (input.message.holdUntilUserAction) return false;
  if (input.phase === "connecting") return false;
  if (input.phase !== "running") return true;
  return input.latestToolActivityId !== input.message.queuedAfterToolActivityId;
}

/**
 * The ids a queued send goes with: the caller's own, else those its interrupted attempt went
 * with — the server may have taken that command, and its receipts take a retry of it once —
 * else fresh ones, minted here so a failure knows which ids it was.
 */
export function queuedSendAttemptIds(input: {
  readonly given: ComposerSendIds | undefined;
  readonly stored: ComposerSendIds | undefined;
  readonly mint: () => ComposerSendIds;
}): ComposerSendIds {
  return input.given ?? input.stored ?? input.mint();
}

/** What a queued bubble says, and what its ↑ does. */
export interface QueuedBubbleState {
  /** In the clock's place: a held send's reason, or what it waits for. Null: the clock. */
  readonly line: { readonly text: string; readonly tone: "muted" | "error" } | null;
  /** The clock's tooltip, where the clock shows. */
  readonly clockLabel: string;
  /** The ↑: Send now, or Retry on a refused send; disabled, with why, while an answer is due. */
  readonly send: { readonly label: string; readonly retry: boolean; readonly disabled: boolean };
}

const WAITS_FOR_ANSWER = "Waits for your answer above";

/**
 * A queued bubble's words. A send refused says why, in its place, and ↑ retries it; a message
 * behind a held one says it waits for it; the next one, while a question or an approval waits
 * on the person, says so and its ↑ waits too — never a press that silently does nothing.
 */
export function queuedBubbleState(input: {
  readonly message: Pick<QueuedComposerMessage, "holdUntilUserAction" | "heldReason">;
  readonly isNext: boolean;
  /** A message ahead of it is held. */
  readonly heldAhead: boolean;
  /** A question or an approval waits on the person: the queue waits with it. */
  readonly blockedByAnswer: boolean;
}): QueuedBubbleState {
  const { message, isNext, heldAhead, blockedByAnswer } = input;
  const reason = message.holdUntilUserAction ? message.heldReason : undefined;
  const blocked = isNext && blockedByAnswer;
  const line =
    reason !== undefined
      ? ({ text: reason, tone: "error" } as const)
      : blocked
        ? ({ text: WAITS_FOR_ANSWER, tone: "muted" } as const)
        : !isNext && heldAhead
          ? ({ text: "Waits for the message above", tone: "muted" } as const)
          : null;
  return {
    line,
    clockLabel: message.holdUntilUserAction
      ? "Waits for Send now"
      : isNext
        ? "Sends after the next tool call or when the turn ends"
        : "Sends after the messages above it",
    send: {
      label: blocked ? WAITS_FOR_ANSWER : reason !== undefined ? "Retry" : "Send now",
      retry: reason !== undefined,
      disabled: blocked,
    },
  };
}

onAccountLifetimeClose(() => {
  useQueuedMessageStore.setState({ queuesByThreadKey: {}, queuedSendByThreadKey: {} });
});

export function useQueuedMessages(threadKey: string): QueuedComposerMessage[] {
  return useQueuedMessageStore((state) => state.queuesByThreadKey[threadKey] ?? EMPTY_QUEUE);
}

/** The thread's drain count: a send captures it at its take and gives up if Stop moved it. */
export function drainGenerationOf(threadKey: string): number {
  return useQueuedMessageStore.getState().drainGenerationByThreadKey[threadKey] ?? 0;
}

/**
 * Takes a thread's queued message to send it — either sender, the open conversation or the
 * root one — and marks the thread's send in flight. Null when another caller took it first.
 */
export function beginQueuedSend(
  threadKey: string,
  id: string,
  toolActivityId: string | null,
): QueuedComposerMessage | null {
  const store = useQueuedMessageStore.getState();
  const taken = store.take(threadKey, id, toolActivityId);
  if (taken !== null) store.setQueuedSend(threadKey, { phase: "preparing" });
  return taken;
}

/** The thread's queued send went out as it was then (a snapshot), or ended without one (null). */
export function settleQueuedSend(
  threadKey: string,
  dispatched: LocalDispatchSnapshot | null,
): void {
  useQueuedMessageStore
    .getState()
    .setQueuedSend(
      threadKey,
      dispatched === null ? null : { phase: "dispatched", thread: dispatched },
    );
}
