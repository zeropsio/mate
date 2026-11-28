/**
 * What happened over a conversation that the person may still act on, each read from its record
 * into the quiet row at the conversation's end that says it (`NoticeLine`) — where the composer's
 * strips once stacked (the owner's pick, S6 on the "Composer Strips" board, 2026-10-12).
 */
import {
  OPEN_TAKEN_LABEL,
  OPENING_TAKEN_WORDS,
  STRANDED_TAKE_WORDS,
} from "@t3tools/client-runtime/zerops";
import {
  CircleAlertIcon,
  GitBranchIcon,
  Minimize2Icon,
  RefreshCwIcon,
  SquareKanbanIcon,
} from "lucide-react";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import type { MateSetupFailure, MateSetupHandOver } from "../../zerops/mateStandUp";
import type { CrewChatNotices } from "../zerops/crew/crewChatNotices";
import type { TimelineEntry } from "../../session-logic";
import type { ConversationNotice } from "./ConversationRows";

/** An older session that holds a lot of context: Compact, or keep its whole history. */
export function resumeCompactionNotice(input: {
  /** The thread and the snapshot it read: a dismissal holds for that snapshot. */
  readonly key: string;
  readonly usedTokens: number;
  /** Why compacting cannot run now. */
  readonly unavailable: string | null;
  readonly onCompact: () => void;
  readonly onKeepFullHistory: () => void;
}): ConversationNotice {
  return {
    id: `resume-compaction:${input.key}`,
    icon: <Minimize2Icon />,
    words: (
      <>
        <strong>Resume with less context</strong> · {formatContextWindowTokens(input.usedTokens)}{" "}
        tokens from an older session
      </>
    ),
    action: { label: "Compact", onAction: input.onCompact, unavailable: input.unavailable },
    dismissLabel: "Keep full history",
    onDismiss: input.onKeepFullHistory,
  };
}

/** The checkout is on another branch than the conversation last ran on. */
export function branchChangedNotice(input: {
  readonly key: string;
  readonly mismatch: { readonly threadBranch: string; readonly currentBranch: string };
  readonly restoring: boolean;
  readonly onRestore: () => void;
  readonly onDismiss: () => void;
}): ConversationNotice {
  const { threadBranch, currentBranch } = input.mismatch;
  return {
    id: `branch-changed:${input.key}`,
    icon: <GitBranchIcon />,
    words: (
      <>
        Branch changed — was <strong>{threadBranch}</strong>; sending continues on{" "}
        <strong>{currentBranch}</strong>
      </>
    ),
    action: input.restoring
      ? { label: "Restoring...", onAction: () => {}, unavailable: "Restoring the branch" }
      : { label: "Restore branch", onAction: input.onRestore },
    dismissLabel: "Dismiss branch change notice",
    onDismiss: input.onDismiss,
    // It shows on the person's keystroke in a draft (`useBranchAdvice`).
    byPerson: true,
  };
}

/** What the Mate answered a hand-over that did not reach its agent, under the failure. */
function handOverWords(name: string, answer: MateSetupHandOver | undefined): string | null {
  switch (answer?.kind) {
    case "refused":
      return `${name} has no agent of yours signed in to take it.`;
    case "unreachable":
      return `${name} didn't answer. Try again.`;
    case "failed":
      return answer.words;
    default:
      return null;
  }
}

/**
 * A Mate's setup that did not finish — zcp's failed stand-up, ended — said in its main conversation,
 * where the person who runs it lands and where its one way on runs: the failure handed to an agent
 * turn, which works on it in this conversation. Not dismissed: it stands until a new stand-up does.
 */
export function setupFailedNotice(input: {
  readonly name: string;
  readonly key: string;
  readonly failure: MateSetupFailure;
  readonly answer: MateSetupHandOver | undefined;
  readonly onHandOver: () => void;
}): ConversationNotice {
  const { name, failure, answer } = input;
  const title = `${name}'s setup didn't finish`;
  const detail = [...failure.causes, handOverWords(name, answer)].filter(
    (line): line is string => line !== null,
  );
  return {
    id: `setup-failed:${input.key}`,
    icon: <CircleAlertIcon />,
    words: (
      <>
        <strong>{title}</strong>
        {failure.what === null ? null : ` · ${failure.what}`}
      </>
    ),
    ...(detail.length === 0
      ? {}
      : { detail: <p className="whitespace-pre-wrap wrap-break-word">{detail.join("\n")}</p> }),
    action:
      answer?.kind === "sending"
        ? { label: `Asking ${name}…`, onAction: () => {}, unavailable: `Asking ${name}` }
        : { label: `Ask ${name} to fix it`, onAction: input.onHandOver },
    failed: true,
    announce: failure.what === null ? title : `${title}: ${failure.what}`,
  };
}

/**
 * A task the person took from the Board for this Mate that none of its conversations carries
 * (`strandedTakes`): said in the Mate's conversations, where its Take lands, with **Open its
 * conversation**, which opens it under the same task. Not dismissed: it stands until a conversation
 * carries the task, or the task is no longer theirs.
 */
export function strandedTakeNotice(take: {
  readonly taskId: string;
  readonly title: string;
  readonly opening: boolean;
  readonly open: (() => void) | null;
}): ConversationNotice {
  const { open } = take;
  return {
    id: `taken-stranded:${take.taskId}`,
    icon: <SquareKanbanIcon />,
    words: (
      <>
        <strong>{take.title}</strong> · Taken by you. {STRANDED_TAKE_WORDS}
      </>
    ),
    action: take.opening
      ? { label: OPENING_TAKEN_WORDS, onAction: () => {}, unavailable: OPENING_TAKEN_WORDS }
      : open === null
        ? { label: OPEN_TAKEN_LABEL, onAction: () => {}, unavailable: "Reading the Board…" }
        : { label: OPEN_TAKEN_LABEL, onAction: open },
    announce: `${take.title}: ${STRANDED_TAKE_WORDS}`,
  };
}

/**
 * A crewmate's job or the crew's goal changed since its session began: its next message starts a
 * fresh conversation. Said where the conversation ends — the change carries no time of its own,
 * and nothing happens in this conversation after it but what still runs.
 */
export function crewNextConversationNotice(
  notices: CrewChatNotices | null,
): ConversationNotice | null {
  const words = notices?.pending ?? null;
  if (words === null) return null;
  const [what, ...next] = words.split(/(?<=\.) /u);
  return {
    id: `crew-next:${words}`,
    icon: <RefreshCwIcon />,
    words: (
      <>
        <strong>{what}</strong>
        {next.length > 0 ? ` ${next.join(" ")}` : null}
      </>
    ),
  };
}

/**
 * Where a conversation's notices stand: its last rows while it holds any; just above the composer,
 * within its empty state, while there is no conversation to hold them — a fresh draft's hero, an
 * empty conversation, a crewmate's with only its seams — so the empty state stays drawn and no
 * list of one row replaces it.
 */
export function noticesHome(input: {
  readonly heroDraft: boolean;
  readonly entries: ReadonlyArray<TimelineEntry>;
  readonly isWorking: boolean;
  readonly queued: number;
}): "conversation" | "composer" {
  if (input.heroDraft) return "composer";
  if (input.isWorking || input.queued > 0) return "conversation";
  return input.entries.every((entry) => entry.kind === "work" && entry.entry.crewSeam != null)
    ? "composer"
    : "conversation";
}

/**
 * A notice the person's own action brought — the /usage-limits answer, the branch advice on their
 * keystroke — that was not there before: it brings the conversation to its end, as a send does.
 * What arrives on its own follows the list's usual end-following.
 */
export function personNoticeArrived(
  before: ReadonlySet<string>,
  notices: ReadonlyArray<ConversationNotice>,
): boolean {
  return notices.some((notice) => notice.byPerson === true && !before.has(notice.id));
}
