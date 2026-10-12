/**
 * What happened over a conversation that the person may still act on, each read from its record
 * into the quiet row at the conversation's end that says it (`NoticeLine`) — where the composer's
 * strips once stacked (the owner's pick, S6 on the "Composer Strips" board, 2026-10-12).
 */
import { GitBranchIcon, Minimize2Icon, RefreshCwIcon } from "lucide-react";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import type { CrewChatNotices } from "../zerops/crew/crewChatNotices";
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
