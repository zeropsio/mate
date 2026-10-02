/**
 * The summary a Mate sends up its link to HQ for the menu (`@t3tools/shared/mateLink`): its main
 * chat — the thread every client opens as "the Mate" (`resolvePrimaryConversation`) — how many of
 * its chats run or wait on the person, and who signed its agent logins in.
 *
 * Pure: the caller reads the thread shells (live step included) and the signers.
 *
 * @module zeropsHqSummary
 */
import type { OrchestrationThreadShell, ThreadLiveStep } from "@t3tools/contracts";
import { type MateMainChat, type MateSummary, linkText } from "@t3tools/shared/mateLink";
import { resolvePrimaryConversation } from "@t3tools/shared/primaryConversation";
import { resolveThreadStatus } from "@t3tools/shared/threadStatus";

const RUNNING = new Set(["working", "connecting"]);
const WAITING = new Set(["input", "approval"]);

const text = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value.trim().length === 0
    ? null
    : linkText(value.trim());

/** What the agent does right now, in a line: its running call, else thinking or writing. */
export function liveStepLine(step: ThreadLiveStep | null | undefined): string | null {
  if (step === null || step === undefined) return null;
  switch (step.kind) {
    case "thinking":
      return "Thinking";
    case "writing":
      return "Writing";
    case "calls": {
      const call = step.calls.at(-1);
      return call === undefined ? null : linkText(call.detail ?? call.title);
    }
  }
}

function mainChat(thread: OrchestrationThreadShell): MateMainChat {
  const assistant = thread.latestMessagePreview?.role === "assistant";
  return {
    threadId: thread.id,
    status: resolveThreadStatus(thread).kind,
    lastRequest: text(thread.latestUserMessagePreview?.text),
    lastWords: assistant ? text(thread.latestMessagePreview?.text) : null,
    lastTurnAt: thread.latestTurn?.requestedAt ?? null,
    waitingQuestion: text(thread.pendingQuestion),
    firstError: text(thread.session?.lastError?.split("\n")[0]),
    liveStep: liveStepLine(thread.liveStep),
  };
}

export function mateSummaryOf(
  threads: ReadonlyArray<OrchestrationThreadShell>,
  signers: Readonly<Record<string, string>>,
): MateSummary {
  const live = threads.filter((thread) => thread.archivedAt === null);
  const kinds = live.map((thread) => resolveThreadStatus(thread).kind);
  const { primary } = resolvePrimaryConversation(live);
  return {
    main: primary === undefined ? null : mainChat(primary),
    running: kinds.filter((kind) => RUNNING.has(kind)).length,
    waiting: kinds.filter((kind) => WAITING.has(kind)).length,
    signers: { ...signers },
  };
}
